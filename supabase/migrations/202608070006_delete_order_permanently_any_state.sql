-- Eliminación definitiva de un pedido en CUALQUIER estado, incluido pagado y
-- entregado.
--
-- PROBLEMA
-- La versión anterior (202607290001_delete_order_permanently.sql) solo aceptaba
-- pedidos 'new'/'pending_confirmation', sin pagos y sin entrega: en la práctica
-- solo servía para borrar un pedido recién creado. La operación real necesita
-- también borrar un pedido registrado por error que YA quedó marcado como
-- pagado o entregado —el caso reportado— sin dejar el inventario, la caja ni la
-- cartera descuadrados.
--
-- QUÉ HACE AHORA
-- La RPC revierte, dentro de la MISMA transacción y antes de borrar:
--   1. Inventario: aplica el inverso del efecto NETO que el pedido dejó en el
--      kardex. Cada `inventory_movements` guarda los saldos antes y después, así
--      que la suma de (después - antes) por producto es exactamente lo que el
--      pedido movió, sin importar por qué estados pasó (reserva, liberación,
--      venta, devolución). Devolverlo es restarle ese neto.
--   2. Caja: descuenta de cada `cash_accounts` el neto que dejaron los
--      movimientos del pedido y borra esos movimientos.
--   3. Cartera y pagos: se eliminan; los agregados del cliente
--      (total_paid, outstanding_balance, order_count, total_purchased,
--      average_ticket, last_purchase_at) se RECALCULAN desde los datos que
--      quedan, nunca se ajustan a mano.
--
-- LO QUE SIGUE BLOQUEADO
-- Un gasto contable (`expenses`) asociado al pedido: es un documento propio de
-- contabilidad, con su propia numeración y su propio flujo de aprobación, y
-- borrarlo aquí sería borrar contabilidad ajena al pedido. Se pide eliminarlo
-- primero desde Gastos (ORDER_HAS_EXPENSE).
--
-- SEGURIDAD (sin cambios respecto a la versión anterior)
--   * Solo `superadmin`, con sesión real (auth.uid()), nunca anónimo ni
--     service_role.
--   * Confirmación textual exacta del `order_number`.
--   * Bloqueo `for update nowait` del pedido: una carrera falla de inmediato.
--   * La compuerta `app.purge_order` sigue siendo LOCAL a la transacción
--     (set_config(..., true)), así que no se filtra a otra sesión ni sobrevive a
--     un rollback. Los guardas `prevent_hard_delete`, `prevent_immutable_mutation`
--     y `write_audit_log` no se modifican en esta migración: ya reconocen esa
--     compuerta desde 202607290001.

begin;

set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Elegibilidad
-- ---------------------------------------------------------------------------
-- Ahora cualquier pedido vivo es elegible: lo único que la RPC no puede
-- revertir es un gasto contable asociado.
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
      and o.deleted_at is null
      and not exists (select 1 from public.expenses e where e.order_id = o.id)
  );
$$;

comment on function public.order_is_purgeable(uuid) is
  'True si el pedido puede eliminarse definitivamente. Cualquier estado y cualquier situación de pago son elegibles; solo lo impide un gasto contable asociado.';

-- ---------------------------------------------------------------------------
-- 2. RPC transaccional
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
  v_stock record;
  v_cash record;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_next_on_hand numeric(16,3);
  v_next_reserved numeric(16,3);
  v_item_ids uuid[];
  v_reservation_ids uuid[];
  v_movement_ids uuid[];
  v_payment_ids uuid[];
  v_receivable_ids uuid[];
  v_cash_ids uuid[];
  v_history_ids uuid[];
  v_notification_ids uuid[];
  v_stock_restored numeric(16,3) := 0;
  v_reserved_released numeric(16,3) := 0;
  v_payments_removed integer := 0;
  v_cash_reverted numeric(16,2) := 0;
  v_relinked_orders integer := 0;
  v_customer_id uuid;
  v_order_count integer := 0;
  v_total_purchased numeric(16,2) := 0;
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

  -- (e) Único caso irreversible desde aquí: contabilidad propia del pedido.
  if exists (select 1 from public.expenses where order_id = v_order.id) then
    raise exception using errcode = '22023',
      message = 'ORDER_HAS_EXPENSE: El pedido tiene un gasto contable asociado; elimínalo primero desde Gastos';
  end if;

  v_customer_id := v_order.customer_id;

  -- (f) Inventario: se aplica el INVERSO del efecto neto que el pedido dejó en
  -- el kardex, producto por producto (y variante por variante). El neto sale de
  -- los propios movimientos, que guardan saldo antes y después, así que sirve
  -- igual para un pedido nuevo (solo reservas) que para uno entregado (venta) o
  -- devuelto (venta + devolución).
  perform set_config('app.inventory_write', 'transactional_api', true);

  for v_stock in
    select im.product_id,
           im.variant_id,
           sum(im.stock_on_hand_after - im.stock_on_hand_before) as on_hand_delta,
           sum(im.stock_reserved_after - im.stock_reserved_before) as reserved_delta
    from public.inventory_movements im
    where im.order_id = v_order.id
    group by im.product_id, im.variant_id
    order by im.product_id, im.variant_id nulls first
  loop
    if v_stock.variant_id is not null then
      select * into v_variant from public.product_variants
      where id = v_stock.variant_id for update;
      if not found then
        raise exception using errcode = 'P0002',
          message = 'INVENTORY_NOT_REVERSIBLE: La variante del pedido ya no existe';
      end if;
      v_next_on_hand := v_variant.stock_on_hand - v_stock.on_hand_delta;
      v_next_reserved := v_variant.stock_reserved - v_stock.reserved_delta;
      if v_next_on_hand < 0 or v_next_reserved < 0 then
        raise exception using errcode = '23514',
          message = 'INVENTORY_NOT_REVERSIBLE: Revertir el pedido dejaría el inventario en negativo';
      end if;
      update public.product_variants
      set stock_on_hand = v_next_on_hand,
          stock_reserved = v_next_reserved,
          updated_at = now()
      where id = v_variant.id;
    else
      select * into v_product from public.products
      where id = v_stock.product_id for update;
      if not found then
        raise exception using errcode = 'P0002',
          message = 'INVENTORY_NOT_REVERSIBLE: El producto del pedido ya no existe';
      end if;
      v_next_on_hand := v_product.stock_on_hand - v_stock.on_hand_delta;
      v_next_reserved := v_product.stock_reserved - v_stock.reserved_delta;
      if v_next_on_hand < 0 or v_next_reserved < 0 then
        raise exception using errcode = '23514',
          message = 'INVENTORY_NOT_REVERSIBLE: Revertir el pedido dejaría el inventario en negativo';
      end if;
      update public.products
      set stock_on_hand = v_next_on_hand,
          stock_reserved = v_next_reserved,
          updated_at = now()
      where id = v_product.id;
    end if;
    -- Lo devuelto al stock (positivo cuando el pedido había vendido unidades).
    v_stock_restored := v_stock_restored - v_stock.on_hand_delta;
    v_reserved_released := v_reserved_released - v_stock.reserved_delta;
  end loop;

  -- (g) Caja: se descuenta de cada cuenta el neto que dejaron los movimientos
  -- del pedido (incluidos los que solo apuntan al pago y no al pedido).
  for v_cash in
    select cm.id, cm.cash_account_id, (cm.balance_after - cm.balance_before) as delta
    from public.cash_movements cm
    where cm.order_id = v_order.id
       or cm.payment_id in (select p.id from public.payments p where p.order_id = v_order.id)
    for update
  loop
    update public.cash_accounts
    set current_balance = current_balance - v_cash.delta, updated_at = now()
    where id = v_cash.cash_account_id;
    v_cash_reverted := v_cash_reverted + v_cash.delta;
  end loop;

  -- (h) Inventario de identificadores ANTES de borrar, para poder limpiar
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
  select coalesce(array_agg(id), '{}'::uuid[]) into v_cash_ids
    from public.cash_movements
    where order_id = v_order.id or payment_id = any(v_payment_ids);
  select coalesce(array_agg(id), '{}'::uuid[]) into v_history_ids
    from public.order_status_history where order_id = v_order.id;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_notification_ids
    from public.notifications where order_id = v_order.id;
  v_payments_removed := coalesce(array_length(v_payment_ids, 1), 0);

  -- (i) Purga. La compuerta es local a esta transacción.
  perform set_config('app.purge_order', 'delete_order_permanently', true);

  -- Orden obligado por las FK `on delete restrict`: de las hojas a la raíz.
  delete from public.inventory_movements where order_id = v_order.id;
  delete from public.inventory_reservations where order_id = v_order.id;
  delete from public.cash_movements where id = any(v_cash_ids);
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

  -- (j) Agregados del cliente: se RECALCULAN con lo que queda, nunca se ajustan
  -- restando el pedido borrado (así un histórico ya descuadrado se corrige en
  -- lugar de arrastrarse).
  if v_customer_id is not null then
    select count(*), coalesce(sum(o.subtotal_amount - o.discount_amount), 0)
      into v_order_count, v_total_purchased
    from public.orders o
    where o.customer_id = v_customer_id
      and o.delivered_at is not null
      and o.deleted_at is null;

    update public.customers c
    set order_count = v_order_count,
        total_purchased = v_total_purchased,
        average_ticket = case when v_order_count > 0
          then round(v_total_purchased / v_order_count, 2) else 0 end,
        last_purchase_at = (
          select max(o.delivered_at) from public.orders o
          where o.customer_id = c.id and o.delivered_at is not null and o.deleted_at is null
        ),
        total_paid = (
          select coalesce(sum(p.amount), 0) from public.payments p
          where p.customer_id = c.id and p.status = 'approved' and p.deleted_at is null
        ),
        outstanding_balance = (
          select coalesce(sum(ar.balance_amount), 0) from public.accounts_receivable ar
          where ar.customer_id = c.id
            and ar.status in ('pending','partial','overdue')
            and ar.deleted_at is null
        ),
        updated_at = now()
    where c.id = v_customer_id;
  end if;

  -- (k) Auditoría histórica del pedido: contiene el contenido comercial completo
  -- capturado en su creación. Debe irse con el pedido.
  delete from public.audit_logs
  where (entity_name = 'orders' and record_id = v_order.id)
     or (entity_name = 'order_items' and record_id = any(v_item_ids))
     or (entity_name = 'order_status_history' and record_id = any(v_history_ids))
     or (entity_name = 'inventory_reservations' and record_id = any(v_reservation_ids))
     or (entity_name = 'inventory_movements' and record_id = any(v_movement_ids))
     or (entity_name = 'payments' and record_id = any(v_payment_ids))
     or (entity_name = 'cash_movements' and record_id = any(v_cash_ids))
     or (entity_name = 'accounts_receivable' and record_id = any(v_receivable_ids));

  -- (l) Huella técnica mínima. Sin productos, cantidades, total, cliente ni
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
      'payments_removed', v_payments_removed,
      'stock_restored', v_stock_restored,
      'commercial_content_retained', false
    )
  );

  return jsonb_build_object(
    'deleted', true,
    'items_removed', coalesce(array_length(v_item_ids, 1), 0),
    -- Se conserva el nombre histórico de la clave que ya leía el panel.
    'reservations_released', coalesce(array_length(v_reservation_ids, 1), 0),
    'quantity_released', v_reserved_released,
    'stock_restored', v_stock_restored,
    'payments_removed', v_payments_removed,
    'cash_reverted', v_cash_reverted,
    'orders_unlinked', v_relinked_orders
  );
end;
$$;

comment on function public.delete_order_permanently(uuid, text) is
  'Elimina definitivamente un pedido en cualquier estado, incluido pagado o entregado. Solo superadmin, con confirmación textual del order_number. Revierte inventario, caja, pagos y cartera, recalcula los agregados del cliente y borra las filas dependientes en una sola transacción.';

-- ---------------------------------------------------------------------------
-- 3. Privilegios: nunca anónimo, nunca DELETE directo desde el navegador
-- ---------------------------------------------------------------------------

revoke all on function public.delete_order_permanently(uuid, text) from public;
revoke all on function public.order_is_purgeable(uuid) from public;

-- `anon` queda deliberadamente fuera. `service_role` también: esta operación
-- exige una identidad humana verificable vía auth.uid().
grant execute on function public.delete_order_permanently(uuid, text) to authenticated;
grant execute on function public.order_is_purgeable(uuid) to authenticated;

commit;
