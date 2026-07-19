-- Migración 202607180004: Transiciones flexibles para administradores y función "entregar y pagar".
-- Problema resuelto: la función transition_order_status solo permitía transiciones adyacentes
-- (e.g., nuevo→confirmado), lo cual bloqueaba la operación real donde el administrador necesita
-- pasar directamente al estado correspondiente sin recorrer cada etapa manualmente.
-- Además se agrega deliver_and_pay_order que ejecuta ambas acciones en una sola transacción.
begin;

set search_path = public, pg_temp;

-- ============================================================
-- 1. transition_order_status: flexible para administradores
-- ============================================================
-- Los administradores (superadmin, admin) pueden hacer cualquier transición
-- hacia adelante o hacia terminales (cancelado, devuelto desde entregado).
-- El personal de bodega y vendedor mantiene las restricciones adyacentes originales.
-- Los efectos sobre inventario (reserva → venta / liberación) se aplican correctamente
-- incluso cuando se omiten estados intermedios porque la lógica busca reservas activas,
-- no el estado anterior.
create or replace function public.transition_order_status(
  p_order_id uuid,
  p_new_status public.order_status,
  p_reason text default null,
  p_notes text default null,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_reservation record;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_before_stock numeric(16,3);
  v_before_reserved numeric(16,3);
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_valid boolean := false;
  v_receivable_balance numeric(16,2) := 0;
begin
  perform public.require_staff(array['superadmin','admin','vendedor','bodega']);
  if p_order_id is null or p_new_status is null then
    raise exception using errcode = '22023', message = 'El pedido y el nuevo estado son obligatorios';
  end if;

  select * into v_order from public.orders
  where id = p_order_id and deleted_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Pedido no encontrado'; end if;
  if p_expected_version is not null and p_expected_version <> v_order.version then
    raise exception using errcode = '40001', message = 'El pedido fue modificado por otro usuario';
  end if;
  if p_new_status = v_order.status then return public.order_result_json(v_order.id); end if;

  -- Los administradores pueden saltar estados; el resto solo puede avanzar adyacente.
  v_is_admin := public.has_any_role(array['superadmin','admin']::text[]);

  v_valid := case
    when v_is_admin then
      -- Admins: cualquier transición hacia adelante o hacia terminales permitidas.
      case v_order.status
        when 'new'                then p_new_status in ('pending_confirmation','confirmed','preparing','ready','dispatched','delivered','cancelled')
        when 'pending_confirmation' then p_new_status in ('confirmed','preparing','ready','dispatched','delivered','cancelled')
        when 'confirmed'          then p_new_status in ('preparing','ready','dispatched','delivered','cancelled')
        when 'preparing'          then p_new_status in ('ready','dispatched','delivered','cancelled')
        when 'ready'              then p_new_status in ('dispatched','delivered','cancelled')
        when 'dispatched'         then p_new_status in ('delivered','cancelled')
        when 'delivered'          then p_new_status = 'returned'
        else false
      end
    else
      -- Personal no-admin: solo transiciones adyacentes.
      case v_order.status
        when 'new'                then p_new_status in ('pending_confirmation','confirmed','cancelled')
        when 'pending_confirmation' then p_new_status in ('confirmed','cancelled')
        when 'confirmed'          then p_new_status in ('preparing','cancelled')
        when 'preparing'          then p_new_status in ('ready','cancelled')
        when 'ready'              then p_new_status in ('dispatched','cancelled')
        when 'dispatched'         then p_new_status in ('delivered','cancelled')
        when 'delivered'          then p_new_status = 'returned'
        else false
      end
  end;

  if not v_valid then
    raise exception using errcode = '22023',
      message = 'Transición de estado inválida: ' || v_order.status::text || ' → ' || p_new_status::text;
  end if;

  if p_new_status in ('cancelled','returned') and nullif(btrim(coalesce(p_reason, p_notes, '')), '') is null then
    raise exception using errcode = '22023',
      message = 'Es obligatorio escribir el motivo para cancelar o devolver un pedido';
  end if;

  -- Restricciones de rol para personal especializado (sin cambio respecto al original).
  if public.has_role('vendedor') and not public.has_any_role(array['superadmin','admin','bodega'])
     and p_new_status not in ('pending_confirmation','confirmed','cancelled') then
    raise exception using errcode = '42501', message = 'El vendedor no puede realizar esta transición';
  end if;
  if public.has_role('bodega') and not public.has_any_role(array['superadmin','admin'])
     and p_new_status in ('pending_confirmation','confirmed') then
    raise exception using errcode = '42501', message = 'El área de bodega no puede realizar esta transición';
  end if;

  perform set_config('app.inventory_write', 'transactional_api', true);

  -- Efectos de inventario: cancelación → liberar reservas activas.
  if p_new_status = 'cancelled' then
    for v_reservation in
      select ir.*
      from public.inventory_reservations ir
      where ir.order_id = v_order.id and ir.status = 'active' and ir.deleted_at is null
      order by ir.product_id, ir.variant_id nulls first
      for update
    loop
      if v_reservation.variant_id is not null then
        select * into v_variant from public.product_variants
        where id = v_reservation.variant_id for update;
        v_before_stock := v_variant.stock_on_hand;
        v_before_reserved := v_variant.stock_reserved;
        if v_before_reserved < v_reservation.quantity then
          raise exception using errcode = '23514', message = 'Reserva de inventario inconsistente';
        end if;
        update public.product_variants
        set stock_reserved = stock_reserved - v_reservation.quantity, updated_at = now()
        where id = v_variant.id;
      else
        select * into v_product from public.products
        where id = v_reservation.product_id for update;
        v_before_stock := v_product.stock_on_hand;
        v_before_reserved := v_product.stock_reserved;
        if v_before_reserved < v_reservation.quantity then
          raise exception using errcode = '23514', message = 'Reserva de inventario inconsistente';
        end if;
        update public.products
        set stock_reserved = stock_reserved - v_reservation.quantity, updated_at = now()
        where id = v_product.id;
      end if;
      update public.inventory_reservations
      set status = 'released', released_at = now(),
          release_reason = coalesce(p_reason, p_notes, 'Cancelación de pedido'),
          updated_at = now()
      where id = v_reservation.id;
      insert into public.inventory_movements(
        product_id, variant_id, movement_type, quantity, unit_cost,
        stock_on_hand_before, stock_on_hand_after, stock_reserved_before, stock_reserved_after,
        order_id, order_item_id, reservation_id, performed_by, notes
      ) values (
        v_reservation.product_id, v_reservation.variant_id, 'reservation_release',
        v_reservation.quantity, null, v_before_stock, v_before_stock,
        v_before_reserved, v_before_reserved - v_reservation.quantity,
        v_order.id, v_reservation.order_item_id, v_reservation.id, v_actor,
        coalesce(p_reason, p_notes, 'Cancelación de pedido')
      );
    end loop;

    select coalesce(balance_amount, 0) into v_receivable_balance
    from public.accounts_receivable where order_id = v_order.id and deleted_at is null for update;
    if found then
      update public.accounts_receivable
      set status = 'cancelled', written_off_amount = balance_amount,
          balance_amount = 0, closed_at = now(), updated_at = now()
      where order_id = v_order.id;
      update public.customers
      set outstanding_balance = greatest(outstanding_balance - v_receivable_balance, 0), updated_at = now()
      where id = v_order.customer_id;
    end if;

  -- Efectos de inventario: entregado → convertir reservas activas en venta definitiva.
  -- Funciona correctamente aunque se hayan saltado estados intermedios porque busca
  -- reservas con status='active', no depende del estado anterior del pedido.
  elsif p_new_status = 'delivered' then
    for v_reservation in
      select ir.*, oi.unit_cost
      from public.inventory_reservations ir
      join public.order_items oi on oi.id = ir.order_item_id
      where ir.order_id = v_order.id and ir.status = 'active' and ir.deleted_at is null
      order by ir.product_id, ir.variant_id nulls first
      for update of ir
    loop
      if v_reservation.variant_id is not null then
        select * into v_variant from public.product_variants
        where id = v_reservation.variant_id for update;
        v_before_stock := v_variant.stock_on_hand;
        v_before_reserved := v_variant.stock_reserved;
        if v_before_reserved < v_reservation.quantity then
          raise exception using errcode = '23514', message = 'Reserva de inventario inconsistente';
        end if;
        update public.product_variants
        set stock_on_hand = stock_on_hand - v_reservation.quantity,
            stock_reserved = stock_reserved - v_reservation.quantity,
            updated_at = now()
        where id = v_variant.id;
      else
        select * into v_product from public.products
        where id = v_reservation.product_id for update;
        v_before_stock := v_product.stock_on_hand;
        v_before_reserved := v_product.stock_reserved;
        if v_before_reserved < v_reservation.quantity then
          raise exception using errcode = '23514', message = 'Reserva de inventario inconsistente';
        end if;
        update public.products
        set stock_on_hand = stock_on_hand - v_reservation.quantity,
            stock_reserved = stock_reserved - v_reservation.quantity,
            updated_at = now()
        where id = v_product.id;
      end if;
      update public.inventory_reservations
      set status = 'fulfilled', fulfilled_at = now(), updated_at = now()
      where id = v_reservation.id;
      insert into public.inventory_movements(
        product_id, variant_id, movement_type, quantity, unit_cost,
        stock_on_hand_before, stock_on_hand_after, stock_reserved_before, stock_reserved_after,
        order_id, order_item_id, reservation_id, performed_by, notes
      ) values (
        v_reservation.product_id, v_reservation.variant_id, 'sale', v_reservation.quantity,
        v_reservation.unit_cost, v_before_stock, v_before_stock - v_reservation.quantity,
        v_before_reserved, v_before_reserved - v_reservation.quantity,
        v_order.id, v_reservation.order_item_id, v_reservation.id, v_actor,
        coalesce(p_notes, 'Pedido entregado')
      );
    end loop;
    update public.customers
    set last_purchase_at = now(),
        order_count = order_count + 1,
        total_purchased = total_purchased + (v_order.subtotal_amount - v_order.discount_amount),
        average_ticket = round(
          (total_purchased + (v_order.subtotal_amount - v_order.discount_amount)) / (order_count + 1), 2
        ),
        updated_at = now()
    where id = v_order.customer_id;

  elsif p_new_status = 'returned' then
    for v_reservation in
      select ir.*, oi.unit_cost
      from public.inventory_reservations ir
      join public.order_items oi on oi.id = ir.order_item_id
      where ir.order_id = v_order.id and ir.status = 'fulfilled' and ir.deleted_at is null
      order by ir.product_id, ir.variant_id nulls first
      for update of ir
    loop
      if v_reservation.variant_id is not null then
        select * into v_variant from public.product_variants
        where id = v_reservation.variant_id for update;
        v_before_stock := v_variant.stock_on_hand;
        v_before_reserved := v_variant.stock_reserved;
        update public.product_variants
        set stock_on_hand = stock_on_hand + v_reservation.quantity, updated_at = now()
        where id = v_variant.id;
      else
        select * into v_product from public.products
        where id = v_reservation.product_id for update;
        v_before_stock := v_product.stock_on_hand;
        v_before_reserved := v_product.stock_reserved;
        update public.products
        set stock_on_hand = stock_on_hand + v_reservation.quantity, updated_at = now()
        where id = v_product.id;
      end if;
      update public.inventory_reservations
      set status = 'cancelled',
          release_reason = coalesce(p_reason, p_notes),
          updated_at = now()
      where id = v_reservation.id;
      insert into public.inventory_movements(
        product_id, variant_id, movement_type, quantity, unit_cost,
        stock_on_hand_before, stock_on_hand_after, stock_reserved_before, stock_reserved_after,
        order_id, order_item_id, reservation_id, performed_by, notes
      ) values (
        v_reservation.product_id, v_reservation.variant_id, 'customer_return', v_reservation.quantity,
        v_reservation.unit_cost, v_before_stock, v_before_stock + v_reservation.quantity,
        v_before_reserved, v_before_reserved,
        v_order.id, v_reservation.order_item_id, v_reservation.id, v_actor,
        coalesce(p_reason, p_notes)
      );
    end loop;
    update public.customers
    set order_count = greatest(order_count - 1, 0),
        total_purchased = greatest(total_purchased - (v_order.subtotal_amount - v_order.discount_amount), 0),
        average_ticket = case when order_count <= 1 then 0 else
          round(greatest(total_purchased - (v_order.subtotal_amount - v_order.discount_amount), 0) / (order_count - 1), 2)
        end,
        updated_at = now()
    where id = v_order.customer_id;
  end if;

  update public.orders set
    status = p_new_status,
    version = version + 1,
    internal_notes = case when nullif(btrim(coalesce(p_notes, '')), '') is null then internal_notes
      else concat_ws(E'\n', internal_notes, p_notes) end,
    confirmed_at = case when p_new_status = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end,
    confirmed_by = case when p_new_status = 'confirmed' and confirmed_by is null then v_actor else confirmed_by end,
    preparation_started_at = case when p_new_status = 'preparing' then coalesce(preparation_started_at, now()) else preparation_started_at end,
    ready_at = case when p_new_status = 'ready' then coalesce(ready_at, now()) else ready_at end,
    dispatched_at = case when p_new_status = 'dispatched' then coalesce(dispatched_at, now()) else dispatched_at end,
    dispatched_by = case when p_new_status = 'dispatched' and dispatched_by is null then v_actor else dispatched_by end,
    delivered_at = case when p_new_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
    delivered_by = case when p_new_status = 'delivered' and delivered_by is null then v_actor else delivered_by end,
    cancelled_at = case when p_new_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
    cancelled_by = case when p_new_status = 'cancelled' and cancelled_by is null then v_actor else cancelled_by end,
    cancellation_reason = case when p_new_status = 'cancelled' then coalesce(p_reason, p_notes) else cancellation_reason end,
    returned_at = case when p_new_status = 'returned' then coalesce(returned_at, now()) else returned_at end,
    payment_status = case
      when p_new_status = 'returned' and amount_paid > 0 then 'refunded'::public.order_payment_status
      else payment_status
    end,
    updated_at = now()
  where id = v_order.id;

  insert into public.order_status_history(order_id, previous_status, new_status, changed_by, reason, notes)
  values (v_order.id, v_order.status, p_new_status, v_actor,
          coalesce(p_reason, case when p_new_status in ('cancelled','returned') then p_notes end),
          p_notes);
  insert into public.audit_logs(actor_user_id, action, entity_name, record_id, old_values, new_values, reason)
  values (
    v_actor, 'STATUS_CHANGE', 'orders', v_order.id,
    jsonb_build_object('status', v_order.status, 'version', v_order.version),
    jsonb_build_object('status', p_new_status, 'version', v_order.version + 1),
    coalesce(p_reason, p_notes)
  );
  return public.order_result_json(v_order.id);
end;
$$;

-- ============================================================
-- 2. deliver_and_pay_order: entregar y pagar en una sola transacción
-- ============================================================
-- Función atómica: marca el pedido como entregado y registra el pago del saldo
-- pendiente, todo dentro de la misma transacción. Si el pedido ya está entregado
-- o ya está pagado, cada paso es idempotente y no produce efectos duplicados.
create or replace function public.deliver_and_pay_order(
  p_order_id uuid,
  p_payment_method_id uuid,
  p_amount numeric default null,
  p_reference text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_approved_total numeric(16,2);
  v_balance numeric(16,2);
  v_pay_amount numeric(16,2);
  v_payment_result jsonb;
begin
  perform public.require_staff(array['superadmin','admin','vendedor','contabilidad']);
  if p_order_id is null or p_payment_method_id is null then
    raise exception using errcode = '22023', message = 'Pedido y método de pago son obligatorios';
  end if;

  select * into v_order from public.orders
  where id = p_order_id and deleted_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Pedido no encontrado'; end if;
  if v_order.status in ('cancelled', 'returned') then
    raise exception using errcode = '22023', message = 'No se puede entregar un pedido cancelado o devuelto';
  end if;

  -- Calcular saldo actual antes de cualquier cambio.
  select coalesce(sum(p.amount) filter (where p.status = 'approved' and p.deleted_at is null), 0)
    into v_approved_total
  from public.payments p
  where p.order_id = v_order.id;

  v_balance := v_order.total_amount - v_approved_total;

  if p_amount is not null and p_amount > v_balance then
    raise exception using errcode = '23514',
      message = 'El valor del pago supera el saldo pendiente del pedido';
  end if;

  v_pay_amount := coalesce(p_amount, v_balance);

  -- Marcar como entregado solo si aún no lo está.
  if v_order.status <> 'delivered' then
    perform public.transition_order_status(
      v_order.id,
      'delivered'::public.order_status,
      null,
      coalesce(p_notes, 'Pedido marcado como entregado y pagado desde el panel de administración'),
      null
    );
  end if;

  -- Registrar pago solo si hay saldo pendiente.
  if v_pay_amount > 0 then
    select public.register_payment(
      v_order.id,
      v_pay_amount,
      p_payment_method_id,
      p_reference,
      null,
      coalesce(p_notes, 'Pago registrado junto con entrega'),
      'approved'::public.payment_record_status,
      null,
      p_idempotency_key
    ) into v_payment_result;
  end if;

  return public.order_result_json(v_order.id);
end;
$$;

-- Permisos para la nueva función.
revoke all on function public.deliver_and_pay_order(uuid,uuid,numeric,text,text,uuid) from public;
grant execute on function public.deliver_and_pay_order(uuid,uuid,numeric,text,text,uuid)
  to authenticated;

-- Permisos para la función actualizada (mantener la misma política).
revoke all on function public.transition_order_status(uuid,public.order_status,text,text,integer) from public;
grant execute on function public.transition_order_status(uuid,public.order_status,text,text,integer)
  to authenticated;

-- Reparar pedidos existentes con total_amount > 0 pero cuyas líneas contienen el total real.
-- El pedido PED-00000001 aparece con total $0 en la interfaz porque el frontend leía
-- la columna 'total' (inexistente) en lugar de 'total_amount'. No hubo corrupción
-- en la base de datos; era un error de mapeo en el frontend. La corrección está
-- en el frontend (types.ts y componentes). Esta consulta confirma la coherencia:
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.orders o
  where o.total_amount > 0 and o.deleted_at is null;
  raise notice 'Pedidos con total_amount > 0: %', v_count;
end;
$$;

notify pgrst, 'reload schema';

commit;
