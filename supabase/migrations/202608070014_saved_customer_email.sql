-- Reutilizar el correo que el cliente YA tiene guardado, sin publicarlo.
--
-- Qué estaba pasando
-- ------------------
-- `lookup_customer_for_order` devuelve nombre y dirección, y a propósito NO
-- devuelve el correo: sería entregar un dato personal a cualquiera que escriba
-- un celular ajeno. El checkout, en cambio, sí recordaba el correo en este
-- dispositivo. Como `loadCustomerProfile` se quedaba con la PRIMERA fuente que
-- respondiera, todo cliente ya registrado tomaba la respuesta del servidor y
-- nunca llegaba a mirar la memoria del dispositivo: nombre y dirección se
-- autocompletaban («Cargamos los datos guardados») y el correo quedaba vacío.
-- Esa parte se corrige en el navegador.
--
-- Lo que falta resolver en la base es el otro caso: el cliente que tiene correo
-- en su ficha porque lo registró administración, y que compra desde un
-- dispositivo que nunca lo escribió. Ahí el correo no puede viajar al
-- navegador, así que la reutilización ocurre dentro del servidor.
--
-- Qué hace esta migración
-- -----------------------
-- 1. `usable_email(text)`: única definición de «correo que Gmail podría
--    entregar». `customers.email` es texto libre sin CHECK —lo llena
--    administración—, así que un valor como «no tiene» tiene que descartarse
--    antes de convertirse en el destinatario de una entrega que nunca podrá
--    completarse.
-- 2. `mask_email(text)`: pista enmascarada (`j••••@g••••.com`). Alcanza para
--    que el dueño reconozca su propio correo y no sirve para descubrir el de un
--    tercero: no revela ni el nombre de la cuenta ni el del dominio.
-- 3. `lookup_customer_for_order` agrega `has_email` y `email_hint`. El correo
--    completo sigue sin salir de la base.
-- 4. `create_order` resuelve UNA vez qué correo recibe la confirmación
--    —el nuevo si el comprador lo escribió, si no el guardado— y valida ambos.
--
-- Lo que NO cambia: un pedido sin correo se sigue creando, el correo se sigue
-- despachando después del commit desde `process-email-outbox`, y un fallo de
-- Gmail sigue sin poder revertir la compra.

begin;

set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Un solo criterio de «correo utilizable»
-- ---------------------------------------------------------------------------
-- Misma regla que `isDeliverableEmail` en las Edge Functions y que
-- `checkoutSchema` en el navegador. Devuelve el correo limpio o null; nunca
-- lanza, porque se invoca dentro de la transacción del pedido.
create or replace function public.usable_email(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
  select case
    when v is null then null
    when length(v) > 254 then null
    when v !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[a-zA-Z]{2,}$' then null
    else v
  end
  from (select nullif(btrim(coalesce(p_email, '')), '') as v) s;
$fn$;

comment on function public.usable_email(text) is
  'Correo limpio si tiene forma entregable, null si no. Criterio único compartido con el checkout y con process-email-outbox; customers.email no tiene CHECK, así que todo valor guardado se revalida antes de usarse como destinatario.';

revoke all on function public.usable_email(text) from public;
grant execute on function public.usable_email(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Pista enmascarada
-- ---------------------------------------------------------------------------
-- `juan.perez@gmail.com` -> `j••••@g••••.com`. Se conserva la primera letra de
-- la cuenta, la primera del dominio y la extensión. Suficiente para que su
-- dueño lo reconozca; inútil para reconstruir el correo de otra persona.
create or replace function public.mask_email(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
  select case
    when v is null then null
    else left(split_part(v, '@', 1), 1) || '••••@'
      || left(split_part(split_part(v, '@', 2), '.', 1), 1) || '••••.'
      || reverse(split_part(reverse(split_part(v, '@', 2)), '.', 1))
  end
  from (select public.usable_email(p_email) as v) s;
$fn$;

comment on function public.mask_email(text) is
  'Pista enmascarada de un correo (j••••@g••••.com) para confirmarle a su dueño que hay uno guardado, sin revelar cuenta ni dominio a quien solo conoce el celular.';

revoke all on function public.mask_email(text) from public;
grant execute on function public.mask_email(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. El checkout sabe QUE hay correo, no CUÁL es
-- ---------------------------------------------------------------------------
create or replace function public.lookup_customer_for_order(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_phone text;
  v_customer record;
  v_address record;
  v_email text;
begin
  v_phone := public.phone_key(coalesce(p_phone, ''));
  if v_phone !~ '^[1-9][0-9]{9,14}$' then
    return null;
  end if;

  select c.id, c.full_name, c.phone, c.email
    into v_customer
  from public.customers c
  where public.phone_key(c.phone) = v_phone
    and c.deleted_at is null
  order by c.created_at desc
  limit 1;

  if v_customer.id is null then
    return null;
  end if;

  select a.address_line, a.neighborhood, a.municipality
    into v_address
  from public.customer_addresses a
  where a.customer_id = v_customer.id
    and a.deleted_at is null
    and a.is_active
  order by a.is_primary desc, a.created_at desc
  limit 1;

  -- Un correo guardado pero inservible no debe anunciarse: prometería una
  -- confirmación que nunca va a llegar.
  v_email := public.usable_email(v_customer.email);

  return jsonb_build_object(
    'phone', v_customer.phone,
    'name', coalesce(v_customer.full_name, ''),
    'address', coalesce(v_address.address_line, ''),
    'neighborhood', coalesce(v_address.neighborhood, ''),
    'municipality', coalesce(v_address.municipality, ''),
    -- Solo la existencia y una pista. El correo completo no sale de aquí:
    -- basta conocer un celular ajeno para llamar a esta función.
    'has_email', v_email is not null,
    'email_hint', public.mask_email(v_email)
  );
end;
$fn$;

comment on function public.lookup_customer_for_order(text) is
  'Nombre y dirección de entrega asociados a un celular, para autocompletar el checkout. Informa si hay un correo guardado (has_email) y una pista enmascarada (email_hint), nunca el correo completo, ni documento, saldo, cupo o lista de precios.';

revoke all on function public.lookup_customer_for_order(text) from public;
grant execute on function public.lookup_customer_for_order(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. create_order: un solo correo efectivo, validado
-- ---------------------------------------------------------------------------
-- Copia de 202608070013 con un único cambio de comportamiento: el correo que
-- viaja a `orders.customer_email` y a la fila del outbox se resuelve una vez en
-- `v_effective_email`, y tanto el correo escrito como el guardado pasan por
-- `usable_email`.
create or replace function public.create_order(
  p_payload jsonb,
  p_idempotency_key uuid,
  p_auth_user_id uuid default null,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing_order_id uuid;
  v_customer public.customers%rowtype;
  v_customer_id uuid;
  v_customer_name text;
  v_phone text;
  v_public_list_id uuid;
  v_is_staff boolean := false;
  v_delivery public.delivery_methods%rowtype;
  v_payment public.payment_methods%rowtype;
  v_requested_date date;
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(16,2) := 0;
  v_discount numeric(16,2) := 0;
  v_delivery_fee numeric(16,2) := 0;
  v_cost numeric(16,2) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_item record;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_price record;
  v_quantity numeric(16,3);
  v_variant_id uuid;
  v_unit_cost numeric(16,2);
  v_sku text;
  v_variant_name text;
  v_available numeric(16,3);
  v_allow_backorder boolean;
  v_line_total numeric(16,2);
  v_order_item_id uuid;
  v_reservation_id uuid;
  v_stock_before numeric(16,3);
  v_reserved_before numeric(16,3);
  v_notification_id uuid;
  v_message text;
  v_manual_url text;
  v_whatsapp public.whatsapp_settings%rowtype;
  v_delivery_status public.notification_status;
  v_price_list_name text;
  v_minimum_order numeric(16,2) := 0;
  -- Correo escrito por el comprador en el checkout (opcional).
  v_email text;
  -- Correo que de verdad recibe la confirmación: el que acaba de escribir el
  -- comprador y, si no escribió ninguno, el que el cliente ya tenía guardado.
  v_effective_email text;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_idempotency_key is null
     or jsonb_typeof(coalesce(p_request_context, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Solicitud inválida';
  end if;

  select id into v_existing_order_id
  from public.orders
  where idempotency_key = p_idempotency_key and deleted_at is null;
  if found then
    return public.order_result_json(v_existing_order_id);
  end if;

  if p_auth_user_id is not null then
    select exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      join public.profiles pr on pr.id = ur.profile_id
      where ur.profile_id = p_auth_user_id
        and r.code = any(array['superadmin','admin','vendedor','bodega','contabilidad']::text[])
        and r.is_active and r.deleted_at is null
        and pr.is_active and pr.deleted_at is null
        and (ur.expires_at is null or ur.expires_at > now())
    ) into v_is_staff;
  end if;

  -- El celular se guarda SIN el indicativo 57: `phone_key` es la forma canónica.
  v_phone := public.phone_key(coalesce(p_payload #>> '{customer,phone}', ''));
  v_customer_name := btrim(coalesce(p_payload #>> '{customer,name}', ''));
  -- Solo se acepta un correo con forma de correo; uno inválido se ignora en
  -- silencio para que jamás pueda tumbar la creación del pedido.
  v_email := public.usable_email(p_payload #>> '{customer,email}');
  if v_phone !~ '^[1-9][0-9]{9,14}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Celular inválido';
  end if;
  if char_length(v_customer_name) not between 2 and 140 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Nombre inválido';
  end if;

  if p_auth_user_id is not null and not v_is_staff then
    -- Supabase Auth entrega el celular en formato internacional (+57...);
    -- `phone_key` lo compara contra la forma local sin depender del indicativo.
    if public.phone_key(coalesce(p_request_context ->> 'auth_phone', '')) <> v_phone then
      raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: El celular no coincide con Supabase Auth';
    end if;
    select * into v_customer
    from public.customers c
    where c.auth_user_id = p_auth_user_id and c.deleted_at is null
    for update;
    if found then
      if (p_payload ->> 'customer_id') is not null
         and (p_payload ->> 'customer_id')::uuid <> v_customer.id then
        raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: Cliente no autorizado';
      end if;
      if public.phone_key(v_customer.phone) <> v_phone then
        raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: El celular no coincide con la sesión';
      end if;
    end if;
  elsif v_is_staff and (p_payload ->> 'customer_id') is not null then
    select * into v_customer
    from public.customers c
    where c.id = (p_payload ->> 'customer_id')::uuid and c.deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Cliente inexistente';
    end if;
    v_phone := public.phone_key(v_customer.phone);
    v_customer_name := v_customer.full_name;
  elsif (p_payload ->> 'customer_id') is not null then
    raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: Se requiere autenticación';
  end if;

  if v_customer.id is null then
    select * into v_customer
    from public.customers c
    where public.phone_key(c.phone) = v_phone and c.deleted_at is null
    for update;
  end if;

  -- El celular ES la identificación del comprador: quien vuelve a pedir escribe
  -- su número y listo, sin código de un solo uso. Antes, todo celular ya
  -- registrado exigía OTP, lo que dejaba sin poder comprar a cada cliente que
  -- repetía cuando el proveedor de SMS no está configurado.
  --
  -- Queda una sola protección de sesión: si el comprador SÍ tiene sesión, no
  -- puede pedir a nombre de un cliente que pertenece a otra cuenta.
  if v_customer.id is not null and not v_is_staff
     and p_auth_user_id is not null
     and v_customer.auth_user_id is not null
     and v_customer.auth_user_id <> p_auth_user_id then
    raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: El cliente pertenece a otra sesión';
  end if;

  if v_customer.id is null then
    v_public_list_id := public.default_public_price_list_id();
    if v_public_list_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: No existe lista pública activa';
    end if;
    insert into public.customers(
      auth_user_id, full_name, phone, email, price_list_id, classification, status
    ) values (
      case when v_is_staff then null else p_auth_user_id end,
      v_customer_name,
      v_phone,
      v_email,
      v_public_list_id,
      'new',
      'active'
    ) returning * into v_customer;
  elsif v_customer.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: Cliente inactivo o bloqueado';
  elsif p_auth_user_id is not null and not v_is_staff and v_customer.auth_user_id is null then
    -- The Edge Function verified this Auth user and the submitted phone; link once.
    update public.customers set auth_user_id = p_auth_user_id, updated_at = now()
    where id = v_customer.id and auth_user_id is null
    returning * into v_customer;
  end if;
  -- El comprador acaba de escribir su correo: es el dato más reciente que hay.
  if v_email is not null and v_customer.id is not null
     and coalesce(v_customer.email, '') is distinct from v_email then
    update public.customers set email = v_email, updated_at = now()
    where id = v_customer.id
    returning * into v_customer;
  end if;

  -- Aquí se decide QUÉ correo recibe la confirmación. Si el comprador no
  -- escribió ninguno se reutiliza el que ya está en la ficha del cliente, que
  -- es exactamente el correo que administración registró. `customers.email` es
  -- texto libre y sin CHECK, así que se vuelve a validar: un valor como
  -- «no tiene» dejaría una entrega imposible de despachar para siempre.
  v_effective_email := coalesce(v_email, public.usable_email(v_customer.email));

  v_customer_id := v_customer.id;
  v_customer_name := v_customer.full_name;

  if nullif(p_payload ->> 'address_id', '') is not null and not exists (
    select 1 from public.customer_addresses ca
    where ca.id = (p_payload ->> 'address_id')::uuid
      and ca.customer_id = v_customer_id and ca.is_active and ca.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: Dirección no autorizada';
  end if;

  if (p_payload ->> 'delivery_method_id') is not null then
    select * into v_delivery from public.delivery_methods
    where id = (p_payload ->> 'delivery_method_id')::uuid
      and is_active and deleted_at is null;
  else
    select * into v_delivery from public.delivery_methods
    where code = p_payload ->> 'delivery_method_code'
      and is_active and deleted_at is null;
  end if;
  if v_delivery.id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_DELIVERY_METHOD: Forma de entrega inválida';
  end if;

  if (p_payload ->> 'payment_method_id') is not null then
    select * into v_payment from public.payment_methods
    where id = (p_payload ->> 'payment_method_id')::uuid
      and is_active and deleted_at is null;
  else
    select * into v_payment from public.payment_methods
    where code = p_payload ->> 'payment_method_code'
      and is_active and deleted_at is null;
  end if;
  if v_payment.id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_PAYMENT_METHOD: Forma de pago inválida';
  end if;

  if nullif(p_payload ->> 'requested_delivery_date', '') is not null then
    v_requested_date := (p_payload ->> 'requested_delivery_date')::date;
    if v_requested_date < (now() at time zone 'America/Bogota')::date then
      raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_IN_PAST: La fecha solicitada ya pasó';
    end if;
  end if;

  if jsonb_typeof(p_payload -> 'items') <> 'array'
     or jsonb_array_length(p_payload -> 'items') < 1
     or jsonb_array_length(p_payload -> 'items') > 100 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: El pedido no contiene productos válidos';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'items') x
    group by x ->> 'product_id', coalesce(x ->> 'variant_id', '')
    having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Hay productos duplicados';
  end if;

  -- Lock every inventory row in deterministic order; locks are held until transaction end.
  for v_item in
    select value
    from jsonb_array_elements(p_payload -> 'items') value
    order by value ->> 'product_id', coalesce(value ->> 'variant_id', '')
  loop
    begin
      v_quantity := (v_item.value ->> 'quantity')::numeric(16,3);
      v_variant_id := nullif(v_item.value ->> 'variant_id', '')::uuid;
    exception when others then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Producto o cantidad inválidos';
    end;
    if v_quantity <= 0 or v_quantity > 9999 or trunc(v_quantity) <> v_quantity then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Cantidad inválida';
    end if;

    select * into v_product
    from public.products p
    where p.id = (v_item.value ->> 'product_id')::uuid
      and p.status = 'active' and p.deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'PRODUCT_NOT_AVAILABLE: Producto no disponible';
    end if;

    v_variant := null;
    if v_variant_id is not null then
      select * into v_variant
      from public.product_variants pv
      where pv.id = v_variant_id and pv.product_id = v_product.id
        and pv.is_active and pv.deleted_at is null
      for update;
      if not found then
        raise exception using errcode = 'P0001', message = 'PRODUCT_NOT_AVAILABLE: Variante no disponible';
      end if;
      v_available := v_variant.stock_available;
      v_allow_backorder := v_variant.allow_backorder;
      -- average_cost defaults to 0 (not null) until a purchase is received: nullif()
      -- treats that unset 0 the same as a missing value so we correctly fall back to
      -- current_cost instead of costing the line at 0.
      v_unit_cost := coalesce(
        nullif(v_variant.average_cost, 0), nullif(v_variant.current_cost, 0),
        nullif(v_product.average_cost, 0), nullif(v_product.current_cost, 0),
        0
      );
      v_sku := v_variant.sku;
      v_variant_name := v_variant.name;
      v_stock_before := v_variant.stock_on_hand;
      v_reserved_before := v_variant.stock_reserved;
    else
      v_available := v_product.stock_available;
      v_allow_backorder := v_product.allow_backorder;
      v_unit_cost := coalesce(nullif(v_product.average_cost, 0), nullif(v_product.current_cost, 0), 0);
      v_sku := v_product.sku;
      v_variant_name := null;
      v_stock_before := v_product.stock_on_hand;
      v_reserved_before := v_product.stock_reserved;
    end if;
    if v_product.track_inventory and not v_allow_backorder and v_available < v_quantity then
      raise exception using
        errcode = 'P0001',
        message = 'OUT_OF_STOCK: Inventario insuficiente para ' || v_product.name;
    end if;

    select * into v_price
    from public.resolve_product_price_internal(v_customer_id, v_product.id, v_variant_id, v_quantity, current_date);
    v_line_total := round(v_quantity * v_price.unit_price, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_cost := v_cost + round(v_quantity * v_unit_cost, 2);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'variant_id', v_variant_id,
      'sku', v_sku,
      'product_name', v_product.name,
      'variant_name', v_variant_name,
      'image_url', v_product.main_image_url,
      'unit', v_product.unit,
      'quantity', v_quantity,
      'unit_price', v_price.unit_price,
      'public_unit_price', v_price.public_unit_price,
      'line_total', v_line_total,
      'unit_cost', v_unit_cost,
      'price_source', v_price.price_source,
      'price_list_id', v_price.price_list_id,
      'customer_product_price_id', v_price.customer_product_price_id,
      'quantity_price_tier_id', v_price.quantity_price_tier_id,
      'track_inventory', v_product.track_inventory,
      'stock_before', v_stock_before,
      'reserved_before', v_reserved_before
    ));
  end loop;

  select coalesce((s.value #>> '{}')::numeric, 0) into v_minimum_order
  from public.app_settings s
  where s.key = 'minimum_order' and s.deleted_at is null;
  v_minimum_order := coalesce(v_minimum_order, 0);
  if v_subtotal < v_minimum_order then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: El pedido no alcanza el mínimo requerido';
  end if;

  v_delivery_fee := case
    when v_delivery.free_from_amount is not null and v_subtotal >= v_delivery.free_from_amount then 0
    else v_delivery.base_fee
  end;

  insert into public.orders(
    idempotency_key, customer_id, customer_name, customer_phone, customer_email,
    customer_address_id, delivery_address, neighborhood, municipality,
    delivery_method_id, delivery_method_name, payment_method_id, payment_method_name,
    requested_delivery_date, channel, status, payment_status,
    subtotal_amount, discount_amount, delivery_amount, tax_amount, total_amount,
    sales_cost, gross_profit, customer_notes, created_by
  ) values (
    p_idempotency_key, v_customer_id, v_customer_name, v_phone,
    v_effective_email,
    nullif(p_payload ->> 'address_id', '')::uuid,
    btrim(p_payload ->> 'delivery_address'),
    nullif(btrim(p_payload ->> 'neighborhood'), ''),
    nullif(btrim(p_payload ->> 'municipality'), ''),
    v_delivery.id, v_delivery.name, v_payment.id, v_payment.name,
    v_requested_date, coalesce((p_payload ->> 'channel')::public.order_channel, 'web'),
    'new', case when v_payment.allows_credit then 'credit'::public.order_payment_status else 'pending'::public.order_payment_status end,
    v_subtotal, v_discount, v_delivery_fee, 0,
    v_subtotal - v_discount + v_delivery_fee,
    v_cost, v_subtotal - v_discount - v_cost,
    nullif(btrim(p_payload ->> 'customer_notes'), ''),
    case when v_is_staff then p_auth_user_id else null end
  ) returning id, order_number into v_order_id, v_order_number;

  perform set_config('app.inventory_write', 'transactional_api', true);
  for v_item in select value from jsonb_array_elements(v_lines) value loop
    select name into v_price_list_name
    from public.price_lists where id = (v_item.value ->> 'price_list_id')::uuid;

    insert into public.order_items(
      order_id, product_id, variant_id, sku, product_name, variant_name, image_url, unit,
      quantity, unit_price, public_unit_price, subtotal_amount, discount_amount, total_amount,
      unit_cost, total_cost, gross_profit, price_source, price_list_id, price_list_name,
      customer_product_price_id, quantity_price_tier_id
    ) values (
      v_order_id,
      (v_item.value ->> 'product_id')::uuid,
      nullif(v_item.value ->> 'variant_id', '')::uuid,
      v_item.value ->> 'sku', v_item.value ->> 'product_name',
      nullif(v_item.value ->> 'variant_name', ''), nullif(v_item.value ->> 'image_url', ''),
      v_item.value ->> 'unit', (v_item.value ->> 'quantity')::numeric,
      (v_item.value ->> 'unit_price')::numeric, (v_item.value ->> 'public_unit_price')::numeric,
      (v_item.value ->> 'line_total')::numeric, 0, (v_item.value ->> 'line_total')::numeric,
      (v_item.value ->> 'unit_cost')::numeric,
      round((v_item.value ->> 'quantity')::numeric * (v_item.value ->> 'unit_cost')::numeric, 2),
      (v_item.value ->> 'line_total')::numeric -
        round((v_item.value ->> 'quantity')::numeric * (v_item.value ->> 'unit_cost')::numeric, 2),
      case v_item.value ->> 'price_source'
        when 'special' then 'customer_special'
        when 'volume' then 'quantity_tier'
        when 'list' then 'price_list'
        else 'public'
      end,
      (v_item.value ->> 'price_list_id')::uuid, v_price_list_name,
      nullif(v_item.value ->> 'customer_product_price_id', '')::uuid,
      nullif(v_item.value ->> 'quantity_price_tier_id', '')::uuid
    ) returning id into v_order_item_id;

    if (v_item.value ->> 'track_inventory')::boolean then
      if nullif(v_item.value ->> 'variant_id', '') is not null then
        update public.product_variants
        set stock_reserved = stock_reserved + (v_item.value ->> 'quantity')::numeric,
            updated_at = now()
        where id = (v_item.value ->> 'variant_id')::uuid;
      else
        update public.products
        set stock_reserved = stock_reserved + (v_item.value ->> 'quantity')::numeric,
            updated_at = now()
        where id = (v_item.value ->> 'product_id')::uuid;
      end if;

      insert into public.inventory_reservations(
        order_id, order_item_id, product_id, variant_id, quantity, status, created_by
      ) values (
        v_order_id, v_order_item_id, (v_item.value ->> 'product_id')::uuid,
        nullif(v_item.value ->> 'variant_id', '')::uuid,
        (v_item.value ->> 'quantity')::numeric, 'active',
        case when v_is_staff then p_auth_user_id else null end
      ) returning id into v_reservation_id;

      insert into public.inventory_movements(
        product_id, variant_id, movement_type, quantity, unit_cost,
        stock_on_hand_before, stock_on_hand_after, stock_reserved_before, stock_reserved_after,
        order_id, order_item_id, reservation_id, performed_by, notes
      ) values (
        (v_item.value ->> 'product_id')::uuid,
        nullif(v_item.value ->> 'variant_id', '')::uuid,
        'reservation', (v_item.value ->> 'quantity')::numeric,
        (v_item.value ->> 'unit_cost')::numeric,
        (v_item.value ->> 'stock_before')::numeric, (v_item.value ->> 'stock_before')::numeric,
        (v_item.value ->> 'reserved_before')::numeric,
        (v_item.value ->> 'reserved_before')::numeric + (v_item.value ->> 'quantity')::numeric,
        v_order_id, v_order_item_id, v_reservation_id,
        case when v_is_staff then p_auth_user_id else null end,
        'Reserva automática al crear el pedido'
      );
    end if;
  end loop;

  insert into public.order_status_history(order_id, previous_status, new_status, changed_by, notes)
  values (v_order_id, null, 'new', case when v_is_staff then p_auth_user_id else null end, 'Pedido creado');

  if v_payment.allows_credit then
    insert into public.accounts_receivable(
      customer_id, order_id, original_amount, paid_amount, balance_amount, due_date, status, created_by
    ) values (
      v_customer_id, v_order_id, v_subtotal + v_delivery_fee, 0, v_subtotal + v_delivery_fee,
      (now() at time zone 'America/Bogota')::date + greatest(v_customer.credit_days, 0),
      'pending', case when v_is_staff then p_auth_user_id else null end
    );
    update public.customers
    set outstanding_balance = outstanding_balance + v_subtotal + v_delivery_fee,
        updated_at = now()
    where id = v_customer_id;
  end if;

  insert into public.notifications(event_type, title, body, payload, order_id, customer_id)
  values (
    'order.created', 'Nuevo pedido ' || v_order_number,
    v_customer_name || ' realizó un pedido por $' || to_char(v_subtotal + v_delivery_fee, 'FM999G999G999G990D00'),
    jsonb_build_object('order_number', v_order_number, 'total', v_subtotal + v_delivery_fee),
    v_order_id, v_customer_id
  ) returning id into v_notification_id;

  -- Correo de confirmación al comprador. Se encola dentro de la transacción
  -- (una fila, sin red) y se envía DESPUÉS del commit desde el worker
  -- `process-email-outbox`: si Gmail o Apps Script fallan, el pedido ya existe y
  -- lo único pendiente es el reintento del correo.
  if v_effective_email is not null then
    insert into public.notification_deliveries(
      notification_id, channel, status, recipient, provider, message_text
    ) values (
      v_notification_id, 'email', 'pending', v_effective_email,
      'apps_script', 'Pedido recibido ' || v_order_number
    )
    on conflict do nothing;
  end if;

  v_message := public.build_order_admin_message(v_order_id);
  select * into v_whatsapp
  from public.whatsapp_settings
  where is_active and deleted_at is null
  order by created_at
  limit 1;
  if v_whatsapp.id is not null and v_whatsapp.administrator_phone is not null then
    v_manual_url := 'https://wa.me/' || public.normalize_phone(v_whatsapp.administrator_phone) ||
      '?text=' || public.url_encode(v_message);
    v_delivery_status := case when v_whatsapp.automatic_enabled then 'pending' else 'manual_required' end;
    insert into public.notification_deliveries(
      notification_id, channel, status, recipient, provider, template_name, template_language,
      template_parameters, message_text, manual_url
    ) values (
      v_notification_id, 'whatsapp', v_delivery_status,
      public.normalize_phone(v_whatsapp.administrator_phone), v_whatsapp.provider,
      v_whatsapp.administrator_template_name, v_whatsapp.template_language,
      jsonb_build_array(v_order_number, v_customer_name, to_char(v_subtotal + v_delivery_fee, 'FM999999999990D00')),
      v_message, v_manual_url
    );
  end if;

  insert into public.audit_logs(
    actor_user_id, action, entity_name, record_id, new_values, request_id, metadata
  ) values (
    p_auth_user_id, 'CREATE', 'orders', v_order_id,
    jsonb_build_object('order_number', v_order_number, 'total', v_subtotal + v_delivery_fee),
    p_idempotency_key::text,
    jsonb_build_object('channel', coalesce(p_payload ->> 'channel', 'web')) || coalesce(p_request_context, '{}'::jsonb)
  );

  return public.order_result_json(v_order_id);
exception
  when unique_violation then
    select id into v_existing_order_id
    from public.orders where idempotency_key = p_idempotency_key;
    if v_existing_order_id is not null then
      return public.order_result_json(v_existing_order_id);
    end if;
    raise;
end;
$$;

notify pgrst, 'reload schema';

commit;
