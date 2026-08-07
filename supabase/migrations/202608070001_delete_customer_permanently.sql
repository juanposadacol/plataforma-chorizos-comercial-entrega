-- Eliminación definitiva de clientes creados por error o durante pruebas.
--
-- Sigue exactamente el patrón ya establecido por
-- 202607290001_delete_order_permanently.sql: la compuerta `app.purge_order` es
-- LOCAL a la transacción (set_config con `true`), así que no puede filtrarse a
-- otra sesión ni sobrevivir a un rollback.
--
-- REGLA DE ELEGIBILIDAD: un cliente con pedidos NO se elimina. Las FK hacia
-- `orders`, `payments` y `accounts_receivable` son `on delete restrict` y el
-- historial comercial debe conservarse. Para retirar a un cliente que ya compró
-- se usa el estado «Inactivo»; si de verdad se quiere borrar, primero deben
-- eliminarse sus pedidos con delete_order_permanently().

begin;

-- ---------------------------------------------------------------------------
-- 1. La compuerta admite ahora las dos purgas
-- ---------------------------------------------------------------------------

comment on function public.prevent_hard_delete() is
  'Bloquea DELETE. Únicas excepciones: las purgas transaccionales de pedido y de cliente (app.purge_order).';

create or replace function public.prevent_hard_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Marca local a la transacción, fijada solo por las RPC de purga.
  if current_setting('app.purge_order', true)
     in ('delete_order_permanently', 'delete_customer_permanently') then
    return old;
  end if;
  raise exception using
    errcode = '55000',
    message = format('%s records are immutable; use status/soft-delete fields', tg_table_name);
end;
$$;

create or replace function public.prevent_immutable_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- La compuerta habilita únicamente DELETE: estas tablas siguen siendo
  -- inmutables frente a UPDATE incluso durante una purga.
  if tg_op = 'DELETE'
     and current_setting('app.purge_order', true)
         in ('delete_order_permanently', 'delete_customer_permanently') then
    return old;
  end if;
  raise exception using
    errcode = '55000',
    message = format('%s is append-only', tg_table_name);
end;
$$;

-- Durante la purga no se escribe auditoría automática: `old_values` copiaría los
-- datos personales del cliente justo en la tabla que sobrevive.
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_record_id uuid;
  v_reason text;
begin
  if current_setting('app.purge_order', true)
     in ('delete_order_permanently', 'delete_customer_permanently') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new);
  end if;

  -- PIN hashes are authentication material and must never be copied to audit payloads.
  if tg_table_name = 'customers' then
    v_old := v_old - 'pin_hash';
    v_new := v_new - 'pin_hash';
  end if;

  v_record_id := coalesce(
    nullif(v_new ->> 'id', '')::uuid,
    nullif(v_old ->> 'id', '')::uuid
  );
  v_reason := nullif(current_setting('app.audit_reason', true), '');

  insert into public.audit_logs (
    actor_user_id, action, entity_name, record_id,
    old_values, new_values, reason, metadata
  ) values (
    auth.uid(), tg_op, tg_table_name, v_record_id,
    v_old, v_new, v_reason,
    jsonb_build_object('schema', tg_table_schema, 'trigger', tg_name)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Elegibilidad (lectura, sin efectos) — la usan la RPC y el panel
-- ---------------------------------------------------------------------------

create or replace function public.customer_is_purgeable(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.customers c
    where c.id = p_customer_id
      -- Sin historial comercial de ningún tipo.
      and not exists (select 1 from public.orders o where o.customer_id = c.id)
      and not exists (select 1 from public.payments p where p.customer_id = c.id)
      and not exists (
        select 1 from public.accounts_receivable ar where ar.customer_id = c.id
      )
  );
$$;

comment on function public.customer_is_purgeable(uuid) is
  'True si el cliente no tiene pedidos, pagos ni cartera y puede eliminarse definitivamente.';

-- ---------------------------------------------------------------------------
-- 3. RPC transaccional
-- ---------------------------------------------------------------------------

create or replace function public.delete_customer_permanently(
  p_customer_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
volatile
-- SECURITY DEFINER es necesario: `authenticated` no tiene privilegio de DELETE
-- sobre customers. La autorización se resuelve dentro contra auth.uid().
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid;
  v_customer public.customers%rowtype;
  v_address_ids uuid[];
  v_price_ids uuid[];
  v_notification_ids uuid[];
  v_addresses_removed integer := 0;
  v_prices_removed integer := 0;
  v_notifications_removed integer := 0;
begin
  -- (a) Identidad. Sin sesión no hay operación.
  v_actor := auth.uid();
  if v_actor is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED: Se requiere una sesión activa';
  end if;

  -- (b) Rol de mayor privilegio del proyecto.
  if not public.has_role('superadmin') then
    raise exception using errcode = '42501',
      message = 'NOT_AUTHORIZED: Solo un superadministrador puede eliminar clientes definitivamente';
  end if;

  if p_customer_id is null then
    raise exception using errcode = '22004', message = 'CUSTOMER_NOT_FOUND: Falta el identificador del cliente';
  end if;

  -- (c) Bloqueo de la fila; una carrera falla de inmediato en vez de esperar.
  begin
    select * into v_customer from public.customers where id = p_customer_id for update nowait;
  exception when lock_not_available then
    raise exception using errcode = '55P03',
      message = 'CUSTOMER_LOCKED: El cliente está siendo modificado por otra operación; intenta de nuevo';
  end;

  if v_customer.id is null then
    raise exception using errcode = 'P0002', message = 'CUSTOMER_NOT_FOUND: El cliente no existe';
  end if;

  -- (d) Confirmación textual exacta: debe coincidir con el celular registrado.
  if p_confirmation is null or btrim(p_confirmation) <> v_customer.phone then
    raise exception using errcode = '22023',
      message = 'CONFIRMATION_MISMATCH: El texto de confirmación no coincide con el celular del cliente';
  end if;

  -- (e) Revalidación en el servidor, ya con la fila bloqueada.
  if exists (select 1 from public.orders o where o.customer_id = v_customer.id) then
    raise exception using errcode = '22023',
      message = 'CUSTOMER_HAS_ORDERS: El cliente tiene pedidos registrados. Elimínalos primero o desactívalo.';
  end if;
  if exists (select 1 from public.payments p where p.customer_id = v_customer.id) then
    raise exception using errcode = '22023',
      message = 'CUSTOMER_HAS_PAYMENT: El cliente tiene pagos registrados y no puede eliminarse';
  end if;
  if exists (select 1 from public.accounts_receivable ar where ar.customer_id = v_customer.id) then
    raise exception using errcode = '22023',
      message = 'CUSTOMER_HAS_RECEIVABLE: El cliente tiene cartera registrada y no puede eliminarse';
  end if;

  -- (f) Inventario de identificadores ANTES de borrar, para limpiar después la
  -- auditoría histórica de esas mismas filas.
  select coalesce(array_agg(id), '{}'::uuid[]) into v_address_ids
    from public.customer_addresses where customer_id = v_customer.id;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_price_ids
    from public.customer_product_prices where customer_id = v_customer.id;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_notification_ids
    from public.notifications where customer_id = v_customer.id;

  -- (g) Purga. La compuerta es local a esta transacción.
  perform set_config('app.purge_order', 'delete_customer_permanently', true);

  -- Orden obligado por las FK `on delete restrict`: de las hojas a la raíz.
  delete from public.notification_deliveries
    where notification_id = any(v_notification_ids);
  delete from public.notifications where customer_id = v_customer.id;
  get diagnostics v_notifications_removed = row_count;
  delete from public.customer_product_prices where customer_id = v_customer.id;
  get diagnostics v_prices_removed = row_count;
  delete from public.customer_addresses where customer_id = v_customer.id;
  get diagnostics v_addresses_removed = row_count;
  delete from public.customers where id = v_customer.id;

  -- (h) Auditoría histórica del cliente: contiene sus datos personales completos
  -- capturados en cada cambio. Debe irse con el cliente.
  delete from public.audit_logs
  where (entity_name = 'customers' and record_id = v_customer.id)
     or (entity_name = 'customer_addresses' and record_id = any(v_address_ids))
     or (entity_name = 'customer_product_prices' and record_id = any(v_price_ids))
     or (entity_name = 'notifications' and record_id = any(v_notification_ids));

  -- (i) Huella técnica mínima: sin nombre, celular, dirección ni ningún otro
  -- dato personal. `record_id` queda nulo a propósito.
  insert into public.audit_logs(
    actor_user_id, action, entity_name, record_id,
    old_values, new_values, reason, metadata
  ) values (
    v_actor, 'CUSTOMER_PURGED', 'customers', null,
    null, null, 'Eliminación definitiva de cliente',
    jsonb_build_object(
      'purged_at', now(),
      'addresses_removed', v_addresses_removed,
      'special_prices_removed', v_prices_removed,
      'notifications_removed', v_notifications_removed,
      'personal_data_retained', false
    )
  );

  return jsonb_build_object(
    'deleted', true,
    'addresses_removed', v_addresses_removed,
    'special_prices_removed', v_prices_removed,
    'notifications_removed', v_notifications_removed
  );
end;
$$;

comment on function public.delete_customer_permanently(uuid, text) is
  'Elimina definitivamente un cliente sin historial comercial. Solo superadmin, con confirmación textual de su celular. Borra direcciones, precios especiales, notificaciones y la auditoría con datos personales en una sola transacción.';

-- ---------------------------------------------------------------------------
-- 4. Privilegios: nunca anónimo, nunca DELETE directo desde el navegador
-- ---------------------------------------------------------------------------

revoke all on function public.delete_customer_permanently(uuid, text) from public;
revoke all on function public.customer_is_purgeable(uuid) from public;

grant execute on function public.delete_customer_permanently(uuid, text) to authenticated;
grant execute on function public.customer_is_purgeable(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
