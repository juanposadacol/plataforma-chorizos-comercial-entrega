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
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_idempotency_key is null
     or jsonb_typeof(coalesce(p_request_context, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Solicitud invÃ¡lida';
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

  v_phone := public.normalize_phone(coalesce(p_payload #>> '{customer,phone}', ''));
  v_customer_name := btrim(coalesce(p_payload #>> '{customer,name}', ''));
  if v_phone !~ '^[1-9][0-9]{9,14}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Celular invÃ¡lido';
  end if;
  if char_length(v_customer_name) not between 2 and 140 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Nombre invÃ¡lido';
  end if;

  if p_auth_user_id is not null and not v_is_staff then
    if public.normalize_phone(coalesce(p_request_context ->> 'auth_phone', '')) <> v_phone then
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
      if public.normalize_phone(v_customer.phone) <> v_phone then
        raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: El celular no coincide con la sesiÃ³n';
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
    v_phone := public.normalize_phone(v_customer.phone);
    v_customer_name := v_customer.full_name;
  elsif (p_payload ->> 'customer_id') is not null then
    raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: Se requiere autenticaciÃ³n';
  end if;

  if v_customer.id is null then
    select * into v_customer
    from public.customers c
    where public.normalize_phone(c.phone) = v_phone and c.deleted_at is null
    for update;
  end if;

  -- A known phone is an account identifier. Guests must complete OTP authentication before
  -- receiving its assigned list/special prices or creating an order on that customer.
  if v_customer.id is not null and not v_is_staff then
    if p_auth_user_id is null then
      raise exception using errcode = 'P0001', message = 'CUSTOMER_AUTH_REQUIRED: Este celular ya estÃ¡ registrado; inicia sesiÃ³n con OTP';
    end if;
    if v_customer.auth_user_id is not null and v_customer.auth_user_id <> p_auth_user_id then
      raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: El cliente pertenece a otra sesiÃ³n';
    end if;
  end if;

  if v_customer.id is null then
    v_public_list_id := public.default_public_price_list_id();
    if v_public_list_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: No existe lista pÃºblica activa';
    end if;
    insert into public.customers(
      auth_user_id, full_name, phone, email, price_list_id, classification, status
    ) values (
      case when v_is_staff then null else p_auth_user_id end,
      v_customer_name,
      v_phone,
      nullif(p_payload #>> '{customer,email}', ''),
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
  v_customer_id := v_customer.id;
  v_customer_name := v_customer.full_name;

  if nullif(p_payload ->> 'address_id', '') is not null and not exists (
    select 1 from public.customer_addresses ca
    where ca.id = (p_payload ->> 'address_id')::uuid
      and ca.customer_id = v_customer_id and ca.is_active and ca.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: DirecciÃ³n no autorizada';
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
    raise exception using errcode = 'P0001', message = 'INVALID_DELIVERY_METHOD: Forma de entrega invÃ¡lida';
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
    raise exception using errcode = 'P0001', message = 'INVALID_PAYMENT_METHOD: Forma de pago invÃ¡lida';
  end if;

  if nullif(p_payload ->> 'requested_delivery_date', '') is not null then
    v_requested_date := (p_payload ->> 'requested_delivery_date')::date;
    if v_requested_date < (now() at time zone 'America/Bogota')::date then
      raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_IN_PAST: La fecha solicitada ya pasÃ³';
    end if;
  end if;

  if jsonb_typeof(p_payload -> 'items') <> 'array'
     or jsonb_array_length(p_payload -> 'items') < 1
     or jsonb_array_length(p_payload -> 'items') > 100 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: El pedido no contiene productos vÃ¡lidos';
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
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Producto o cantidad invÃ¡lidos';
    end;
    if v_quantity <= 0 or v_quantity > 9999 or trunc(v_quantity) <> v_quantity then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Cantidad invÃ¡lida';
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
      v_unit_cost := coalesce(v_variant.average_cost, v_variant.current_cost, v_product.average_cost, v_product.current_cost, 0);
      v_sku := v_variant.sku;
      v_variant_name := v_variant.name;
      v_stock_before := v_variant.stock_on_hand;
      v_reserved_before := v_variant.stock_reserved;
    else
      v_available := v_product.stock_available;
      v_allow_backorder := v_product.allow_backorder;
      v_unit_cost := coalesce(v_product.average_cost, v_product.current_cost, 0);
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
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: El pedido no alcanza el mÃ­nimo requerido';
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
    p_idempotency_key, v_customer_id, v_customer_name, v_phone, v_customer.email,
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
        'Reserva automÃ¡tica al crear el pedido'
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
    v_customer_name || ' realizÃ³ un pedido por $' || to_char(v_subtotal + v_delivery_fee, 'FM999G999G999G990D00'),
    jsonb_build_object('order_number', v_order_number, 'total', v_subtotal + v_delivery_fee),
    v_order_id, v_customer_id
  ) returning id into v_notification_id;

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

