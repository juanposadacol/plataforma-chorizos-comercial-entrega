-- Eliminación definitiva de pedidos creados por error o durante pruebas.
--
-- CONTEXTO Y RESTRICCIONES DEL ESQUEMA
--
-- El esquema está deliberadamente diseñado para que NADA se borre:
--   * `prevent_hard_delete()` está enganchado a 30 tablas (entre ellas orders,
--     order_items, inventory_reservations, payments, accounts_receivable,
--     expenses, cash_movements, notifications) y aborta cualquier DELETE;
--   * `prevent_immutable_mutation()` hace append-only a order_status_history,
--     inventory_movements, cash_movements y audit_logs;
--   * `write_audit_log()` copia la fila COMPLETA a audit_logs.old_values en cada
--     DELETE, lo que reintroduciría el contenido del pedido —productos,
--     cantidades, total y datos personales— justo en la tabla que sobrevive.
--
-- Por eso esta migración abre una compuerta estrecha y explícita en los tres
-- guardas, activada solo por `app.purge_order`. Se sigue el mismo patrón ya
-- establecido en este proyecto por `app.inventory_write`
-- (202607170002_transactional_api.sql:571): la marca se fija con
-- `set_config(..., true)`, es decir LOCAL a la transacción, así que no puede
-- filtrarse a otra sesión ni sobrevivir a un rollback.
--
-- La compuerta NO relaja la integridad referencial: todas las FK siguen siendo
-- `on delete restrict`, así que el orden de borrado debe ser correcto o la
-- transacción falla.

begin;

-- ---------------------------------------------------------------------------
-- 1. Compuertas en los guardas existentes
-- ---------------------------------------------------------------------------

comment on function public.prevent_hard_delete() is
  'Bloquea DELETE. Única excepción: la purga transaccional de un pedido (app.purge_order).';

create or replace function public.prevent_hard_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Marca local a la transacción, fijada solo por delete_order_permanently().
  if current_setting('app.purge_order', true) = 'delete_order_permanently' then
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
     and current_setting('app.purge_order', true) = 'delete_order_permanently' then
    return old;
  end if;
  raise exception using
    errcode = '55000',
    message = format('%s is append-only', tg_table_name);
end;
$$;

-- Durante la purga no se escribe auditoría automática: `old_values` contendría
-- el contenido comercial completo del pedido. delete_order_permanently() deja a
-- cambio una única huella técnica mínima, sin contenido.
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
  if current_setting('app.purge_order', true) = 'delete_order_permanently' then
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

-- Estados y pago admitidos. Cualquier otro valor del enum queda excluido.
create or replace function public.order_is_purgeable(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.status in ('new', 'pending_confirmation')
      and o.payment_status = 'pending'
      and o.amount_paid = 0
      and o.delivered_at is null
      and o.dispatched_at is null
      and o.returned_at is null
      -- Ningún pago aplicado (se toleran los ya anulados).
      and not exists (
        select 1 from public.payments pay
        where pay.order_id = o.id
          and pay.status not in ('cancelled', 'rejected')
      )
      -- Ningún registro contable ni de caja.
      and not exists (select 1 from public.expenses e where e.order_id = o.id)
      and not exists (select 1 from public.cash_movements cm where cm.order_id = o.id)
      -- Cartera sin abonos.
      and not exists (
        select 1 from public.accounts_receivable ar
        where ar.order_id = o.id
          and (ar.paid_amount > 0 or ar.written_off_amount > 0)
      )
      -- Inventario reversible: solo reservas, nunca ventas ni devoluciones.
      and not exists (
        select 1 from public.inventory_movements im
        where im.order_id = o.id and im.movement_type <> 'reservation'
      )
      and not exists (
        select 1 from public.inventory_reservations ir
        where ir.order_id = o.id and ir.status = 'fulfilled'
      )
  );
$$;

comment on function public.order_is_purgeable(uuid) is
  'True si el pedido cumple todas las condiciones para ser eliminado definitivamente.';

-- ---------------------------------------------------------------------------
-- 3. RPC transaccional
-- ---------------------------------------------------------------------------

create or replace function public.delete_order_permanently(
  p_order_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
volatile
-- SECURITY DEFINER es necesario: el rol `authenticated` no tiene (ni debe tener)
-- privilegio de DELETE sobre las tablas operativas. La autorización se resuelve
-- dentro de la función contra auth.uid() y el catálogo real de roles.
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid;
  v_order public.orders%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_before_reserved numeric(16,3);
  v_item_ids uuid[];
  v_reservation_ids uuid[];
  v_movement_ids uuid[];
  v_payment_ids uuid[];
  v_receivable_ids uuid[];
  v_history_ids uuid[];
  v_notification_ids uuid[];
  v_released_count integer := 0;
  v_released_quantity numeric(16,3) := 0;
  v_relinked_orders integer := 0;
begin
  -- (a) Identidad. Sin sesión no hay operación: esta RPC nunca es anónima y no
  -- admite el atajo de service_role que sí permite require_staff().
  v_actor := auth.uid();
  if v_actor is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED: Se requiere una sesión activa';
  end if;

  -- (b) Rol de mayor privilegio del proyecto, vía el helper real.
  if not public.has_role('superadmin') then
    raise exception using errcode = '42501',
      message = 'NOT_AUTHORIZED: Solo un superadministrador puede eliminar pedidos definitivamente';
  end if;

  if p_order_id is null then
    raise exception using errcode = '22004', message = 'ORDER_NOT_FOUND: Falta el identificador del pedido';
  end if;

  -- (c) Bloqueo del pedido. `nowait` convierte una carrera en un error inmediato
  -- y legible en vez de una espera indefinida.
  begin
    select * into v_order from public.orders where id = p_order_id for update nowait;
  exception when lock_not_available then
    raise exception using errcode = '55P03',
      message = 'ORDER_LOCKED: El pedido está siendo modificado por otra operación; intenta de nuevo';
  end;

  if v_order.id is null then
    raise exception using errcode = 'P0002', message = 'ORDER_NOT_FOUND: El pedido no existe';
  end if;

  -- (d) Confirmación textual exacta: debe coincidir con el número del pedido.
  if p_confirmation is null or btrim(p_confirmation) <> v_order.order_number then
    raise exception using errcode = '22023',
      message = 'CONFIRMATION_MISMATCH: El texto de confirmación no coincide con el número del pedido';
  end if;

  -- (e) Revalidación en el servidor, ya con el pedido bloqueado. El cliente pudo
  -- haber leído un estado obsoleto.
  if v_order.status not in ('new', 'pending_confirmation') then
    raise exception using errcode = '22023',
      message = 'STATUS_NOT_ELIGIBLE: Solo se pueden eliminar pedidos en estado Nuevo o Por confirmar';
  end if;
  if v_order.payment_status <> 'pending' or v_order.amount_paid <> 0 then
    raise exception using errcode = '22023',
      message = 'ORDER_HAS_PAYMENT: El pedido tiene pagos aplicados y no puede eliminarse';
  end if;
  if v_order.delivered_at is not null
     or v_order.dispatched_at is not null
     or v_order.returned_at is not null then
    raise exception using errcode = '22023',
      message = 'ORDER_HAS_FULFILLMENT: El pedido tiene entrega, despacho o devolución registrada';
  end if;
  if exists (
    select 1 from public.payments
    where order_id = v_order.id and status not in ('cancelled', 'rejected')
  ) then
    raise exception using errcode = '22023',
      message = 'ORDER_HAS_PAYMENT: El pedido tiene pagos aplicados y no puede eliminarse';
  end if;
  if exists (select 1 from public.expenses where order_id = v_order.id) then
    raise exception using errcode = '22023',
      message = 'ORDER_HAS_ACCOUNTING: El pedido tiene un gasto o registro contable asociado';
  end if;
  if exists (select 1 from public.cash_movements where order_id = v_order.id) then
    raise exception using errcode = '22023',
      message = 'ORDER_HAS_ACCOUNTING: El pedido tiene movimientos de caja asociados';
  end if;
  if exists (
    select 1 from public.accounts_receivable
    where order_id = v_order.id and (paid_amount > 0 or written_off_amount > 0)
  ) then
    raise exception using errcode = '22023',
      message = 'ORDER_HAS_PAYMENT: La cartera del pedido tiene abonos registrados';
  end if;
  if exists (
    select 1 from public.inventory_movements
    where order_id = v_order.id and movement_type <> 'reservation'
  ) then
    raise exception using errcode = '22023',
      message = 'INVENTORY_NOT_REVERSIBLE: El pedido tiene movimientos de inventario irreversibles';
  end if;
  if exists (
    select 1 from public.inventory_reservations
    where order_id = v_order.id and status = 'fulfilled'
  ) then
    raise exception using errcode = '22023',
      message = 'INVENTORY_NOT_REVERSIBLE: El pedido tiene reservas ya convertidas en venta';
  end if;

  -- (f) Liberación de inventario con la MISMA lógica segura de la cancelación
  -- (202607180004_admin_flexible_transitions.sql:110): fila bloqueada, chequeo de
  -- consistencia y descuento de stock_reserved.
  perform set_config('app.inventory_write', 'transactional_api', true);

  for v_reservation in
    select ir.* from public.inventory_reservations ir
    where ir.order_id = v_order.id and ir.status = 'active' and ir.deleted_at is null
    order by ir.product_id, ir.variant_id nulls first
    for update
  loop
    if v_reservation.variant_id is not null then
      select * into v_variant from public.product_variants
      where id = v_reservation.variant_id for update;
      v_before_reserved := v_variant.stock_reserved;
      if v_before_reserved < v_reservation.quantity then
        raise exception using errcode = '23514',
          message = 'INVENTORY_NOT_REVERSIBLE: Reserva de inventario inconsistente';
      end if;
      update public.product_variants
      set stock_reserved = stock_reserved - v_reservation.quantity, updated_at = now()
      where id = v_variant.id;
    else
      select * into v_product from public.products
      where id = v_reservation.product_id for update;
      v_before_reserved := v_product.stock_reserved;
      if v_before_reserved < v_reservation.quantity then
        raise exception using errcode = '23514',
          message = 'INVENTORY_NOT_REVERSIBLE: Reserva de inventario inconsistente';
      end if;
      update public.products
      set stock_reserved = stock_reserved - v_reservation.quantity, updated_at = now()
      where id = v_product.id;
    end if;
    v_released_count := v_released_count + 1;
    v_released_quantity := v_released_quantity + v_reservation.quantity;
  end loop;

  -- No se inserta un movimiento 'reservation_release': el movimiento
  -- 'reservation' original se elimina más abajo, de modo que el efecto neto en
  -- el kardex es cero y stock_reserved vuelve exactamente a su valor previo.
  -- Un movimiento de liberación tampoco podría existir: su FK apunta a un
  -- pedido que dejará de existir.

  -- (g) Inventario de identificadores ANTES de borrar, para poder limpiar
  -- después la auditoría histórica de estas mismas filas.
  select coalesce(array_agg(id), '{}'::uuid[]) into v_item_ids
    from public.order_items where order_id = v_order.id;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_reservation_ids
    from public.inventory_reservations where order_id = v_order.id;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_movement_ids
    from public.inventory_movements where order_id = v_order.id;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_payment_ids
    from public.payments where order_id = v_order.id;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_receivable_ids
    from public.accounts_receivable where order_id = v_order.id;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_history_ids
    from public.order_status_history where order_id = v_order.id;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_notification_ids
    from public.notifications where order_id = v_order.id;

  -- (h) Purga. La compuerta es local a esta transacción.
  perform set_config('app.purge_order', 'delete_order_permanently', true);

  -- Orden obligado por las FK `on delete restrict`: de las hojas a la raíz.
  delete from public.inventory_movements where order_id = v_order.id;
  delete from public.inventory_reservations where order_id = v_order.id;
  delete from public.accounts_receivable where order_id = v_order.id;
  delete from public.payments where order_id = v_order.id;
  delete from public.notification_deliveries
    where notification_id = any(v_notification_ids);
  delete from public.notifications where order_id = v_order.id;
  delete from public.order_status_history where order_id = v_order.id;
  delete from public.order_items where order_id = v_order.id;

  -- Provenance de "Repetir pedido": la FK es `on delete set null`, pero se hace
  -- explícito para poder informarlo. Solo toca este puntero; ningún campo
  -- comercial de otros pedidos cambia.
  update public.orders set source_order_id = null
  where source_order_id = v_order.id;
  get diagnostics v_relinked_orders = row_count;

  delete from public.orders where id = v_order.id;

  -- (i) Auditoría histórica del pedido: contiene el contenido comercial completo
  -- capturado en su creación. Debe irse con el pedido.
  delete from public.audit_logs
  where (entity_name = 'orders' and record_id = v_order.id)
     or (entity_name = 'order_items' and record_id = any(v_item_ids))
     or (entity_name = 'order_status_history' and record_id = any(v_history_ids))
     or (entity_name = 'inventory_reservations' and record_id = any(v_reservation_ids))
     or (entity_name = 'inventory_movements' and record_id = any(v_movement_ids))
     or (entity_name = 'payments' and record_id = any(v_payment_ids))
     or (entity_name = 'accounts_receivable' and record_id = any(v_receivable_ids));

  -- (j) Huella técnica mínima. Sin productos, cantidades, total, cliente ni
  -- ningún dato personal: solo que un superadministrador purgó un pedido.
  -- `record_id` queda nulo a propósito para no reconstruir el vínculo.
  insert into public.audit_logs(
    actor_user_id, action, entity_name, record_id,
    old_values, new_values, reason, metadata
  ) values (
    v_actor, 'ORDER_PURGED', 'orders', null,
    null, null, 'Eliminación definitiva de pedido',
    jsonb_build_object(
      'purged_at', now(),
      'items_removed', coalesce(array_length(v_item_ids, 1), 0),
      'reservations_released', v_released_count,
      'commercial_content_retained', false
    )
  );

  return jsonb_build_object(
    'deleted', true,
    'items_removed', coalesce(array_length(v_item_ids, 1), 0),
    'reservations_released', v_released_count,
    'quantity_released', v_released_quantity,
    'orders_unlinked', v_relinked_orders
  );
end;
$$;

comment on function public.delete_order_permanently(uuid, text) is
  'Elimina definitivamente un pedido elegible. Solo superadmin, con confirmación textual del order_number. Libera inventario reservado y borra las filas dependientes en una sola transacción.';

-- ---------------------------------------------------------------------------
-- 4. Privilegios: nunca anónimo, nunca DELETE directo desde el navegador
-- ---------------------------------------------------------------------------

revoke all on function public.delete_order_permanently(uuid, text) from public;
revoke all on function public.order_is_purgeable(uuid) from public;

-- `anon` queda deliberadamente fuera. `service_role` también: esta operación
-- exige una identidad humana verificable vía auth.uid().
grant execute on function public.delete_order_permanently(uuid, text) to authenticated;
grant execute on function public.order_is_purgeable(uuid) to authenticated;

commit;
