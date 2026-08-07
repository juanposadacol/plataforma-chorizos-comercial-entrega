-- Corregir o eliminar un ajuste de inventario registrado por error.
--
-- PROBLEMA
-- El kardex es append-only (`inventory_movements_immutable`), así que un ajuste
-- mal digitado —cantidad equivocada, tipo equivocado, observación equivocada—
-- solo podía "arreglarse" registrando otro ajuste en sentido contrario. El
-- resultado es un kardex lleno de parejas de ajustes que nadie sabe leer.
--
-- QUÉ HABILITA ESTA MIGRACIÓN
-- Dos RPC, ambas transaccionales y solo para superadmin/admin, limitadas a los
-- movimientos MANUALES (ajuste positivo, ajuste negativo, daño y pérdida). Los
-- movimientos que nacen de una operación —reserva, liberación, venta,
-- devolución, compra— NO se tocan: esos se corrigen operando el pedido o la
-- compra que los originó.
--   * update_inventory_adjustment: corrige tipo, cantidad, costo y observación.
--   * delete_inventory_adjustment: elimina el movimiento.
-- Las dos recalculan el stock del producto y, para que el kardex siga siendo
-- legible, desplazan los saldos "antes/después" de los movimientos POSTERIORES
-- del mismo producto por la misma diferencia. El saldo final de la tarjeta y el
-- de la última fila del kardex siguen coincidiendo.
--
-- COMPUERTAS
-- Se reabren los guardas con una segunda marca, `app.inventory_movement_write`,
-- también LOCAL a la transacción (set_config(..., true)) y fijada únicamente por
-- estas dos funciones. La marca de purga de pedidos (`app.purge_order`) se
-- conserva intacta: esta migración vuelve a declarar ambos guardas incluyendo
-- las dos compuertas, para que aplicar las migraciones en orden no pierda
-- ninguna.
--
-- La auditoría automática NO se desactiva: `write_audit_log` deja el antes y el
-- después de cada corrección o eliminación del kardex (son datos de inventario,
-- sin información personal).

begin;

set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Guardas: compuerta de purga de pedidos + compuerta de corrección de kardex
-- ---------------------------------------------------------------------------

create or replace function public.prevent_hard_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Marcas locales a la transacción, fijadas solo por las RPC autorizadas.
  if current_setting('app.purge_order', true) = 'delete_order_permanently' then
    return old;
  end if;
  if tg_table_name = 'inventory_movements'
     and current_setting('app.inventory_movement_write', true) = 'edit_inventory_adjustment' then
    return old;
  end if;
  raise exception using
    errcode = '55000',
    message = format('%s records are immutable; use status/soft-delete fields', tg_table_name);
end;
$$;

comment on function public.prevent_hard_delete() is
  'Bloquea DELETE. Excepciones: la purga transaccional de un pedido (app.purge_order) y la corrección de un ajuste manual de inventario (app.inventory_movement_write).';

create or replace function public.prevent_immutable_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- La compuerta de purga habilita únicamente DELETE: esas tablas siguen siendo
  -- inmutables frente a UPDATE incluso durante una purga.
  if tg_op = 'DELETE'
     and current_setting('app.purge_order', true) = 'delete_order_permanently' then
    return old;
  end if;
  -- La compuerta del kardex habilita UPDATE y DELETE, y solo en
  -- inventory_movements: es la corrección de un ajuste manual.
  if tg_table_name = 'inventory_movements'
     and current_setting('app.inventory_movement_write', true) = 'edit_inventory_adjustment' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception using
    errcode = '55000',
    message = format('%s is append-only', tg_table_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Helper interno: aplica una diferencia de stock y recoloca el kardex
-- ---------------------------------------------------------------------------
-- `p_delta` es cuánto cambia el stock disponible del producto (positivo suma).
-- Además de mover el saldo del producto, desplaza los saldos registrados en los
-- movimientos posteriores del mismo producto para que la columna "Saldo" del
-- kardex siga siendo una serie continua.
create or replace function public.apply_inventory_movement_correction(
  p_movement public.inventory_movements,
  p_delta numeric
)
returns numeric
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_next numeric(16,3);
  v_reserved numeric(16,3);
  v_backorder boolean;
begin
  if p_movement.variant_id is not null then
    select * into v_variant from public.product_variants
    where id = p_movement.variant_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND: La variante ya no existe';
    end if;
    select allow_backorder into v_backorder from public.products where id = p_movement.product_id;
    v_next := v_variant.stock_on_hand + p_delta;
    v_reserved := v_variant.stock_reserved;
  else
    select * into v_product from public.products
    where id = p_movement.product_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND: El producto ya no existe';
    end if;
    v_backorder := v_product.allow_backorder;
    v_next := v_product.stock_on_hand + p_delta;
    v_reserved := v_product.stock_reserved;
  end if;

  if not coalesce(v_backorder, false) and (v_next < 0 or v_next < v_reserved) then
    raise exception using errcode = '23514',
      message = 'ADJUSTMENT_CONSUMES_RESERVED: La corrección dejaría el inventario por debajo de lo reservado';
  end if;

  perform set_config('app.inventory_write', 'transactional_api', true);
  if p_movement.variant_id is not null then
    update public.product_variants
    set stock_on_hand = v_next, updated_at = now()
    where id = p_movement.variant_id;
  else
    update public.products
    set stock_on_hand = v_next, updated_at = now()
    where id = p_movement.product_id;
  end if;

  -- Los movimientos posteriores del mismo producto conservan su cantidad, pero
  -- su saldo se corre por la misma diferencia.
  if p_delta <> 0 then
    update public.inventory_movements im
    set stock_on_hand_before = im.stock_on_hand_before + p_delta,
        stock_on_hand_after = im.stock_on_hand_after + p_delta
    where im.product_id = p_movement.product_id
      and im.variant_id is not distinct from p_movement.variant_id
      and (im.created_at, im.id) > (p_movement.created_at, p_movement.id);
  end if;

  return v_next;
end;
$$;

comment on function public.apply_inventory_movement_correction(public.inventory_movements, numeric) is
  'Uso interno de update_inventory_adjustment/delete_inventory_adjustment: mueve el stock del producto y recoloca los saldos del kardex posterior. Requiere la compuerta app.inventory_movement_write.';

-- ---------------------------------------------------------------------------
-- 3. Corregir un ajuste manual
-- ---------------------------------------------------------------------------
create or replace function public.update_inventory_adjustment(
  p_movement_id uuid,
  p_movement_type public.inventory_movement_type default null,
  p_quantity numeric default null,
  p_unit_cost numeric default null,
  p_notes text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_movement public.inventory_movements%rowtype;
  v_type public.inventory_movement_type;
  v_quantity numeric(16,3);
  v_old_delta numeric(16,3);
  v_new_delta numeric(16,3);
  v_stock numeric(16,3);
begin
  perform public.require_staff(array['superadmin','admin']);

  select * into v_movement from public.inventory_movements
  where id = p_movement_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'MOVEMENT_NOT_FOUND: El movimiento no existe';
  end if;
  if v_movement.movement_type not in (
    'positive_adjustment','negative_adjustment','damage','loss'
  ) or v_movement.order_id is not null or v_movement.purchase_id is not null then
    raise exception using errcode = '22023',
      message = 'MOVEMENT_NOT_EDITABLE: Solo se pueden corregir ajustes manuales de inventario';
  end if;

  v_type := coalesce(p_movement_type, v_movement.movement_type);
  if v_type not in ('positive_adjustment','negative_adjustment','damage','loss') then
    raise exception using errcode = '22023',
      message = 'MOVEMENT_NOT_EDITABLE: Tipo de movimiento no válido para un ajuste manual';
  end if;
  v_quantity := coalesce(p_quantity, v_movement.quantity);
  if v_quantity is null or v_quantity <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_QUANTITY: La cantidad debe ser mayor que cero';
  end if;
  if nullif(btrim(coalesce(p_notes, v_movement.notes)), '') is null then
    raise exception using errcode = '22023', message = 'NOTES_REQUIRED: El motivo del ajuste es obligatorio';
  end if;

  v_old_delta := v_movement.stock_on_hand_after - v_movement.stock_on_hand_before;
  v_new_delta := case when v_type = 'positive_adjustment' then v_quantity else -v_quantity end;

  perform set_config('app.inventory_movement_write', 'edit_inventory_adjustment', true);
  v_stock := public.apply_inventory_movement_correction(v_movement, v_new_delta - v_old_delta);

  update public.inventory_movements
  set movement_type = v_type,
      quantity = v_quantity,
      unit_cost = coalesce(p_unit_cost, unit_cost),
      notes = coalesce(nullif(btrim(p_notes), ''), notes),
      stock_on_hand_after = stock_on_hand_before + v_new_delta
  where id = v_movement.id;

  return jsonb_build_object(
    'movement_id', v_movement.id,
    'product_id', v_movement.product_id,
    'movement_type', v_type,
    'quantity', v_quantity,
    'stock_on_hand', v_stock
  );
end;
$$;

comment on function public.update_inventory_adjustment(uuid, public.inventory_movement_type, numeric, numeric, text) is
  'Corrige un ajuste manual de inventario (tipo, cantidad, costo, motivo), recalcula el stock y recoloca los saldos posteriores del kardex. Solo superadmin/admin.';

-- ---------------------------------------------------------------------------
-- 4. Eliminar un ajuste manual
-- ---------------------------------------------------------------------------
create or replace function public.delete_inventory_adjustment(
  p_movement_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_movement public.inventory_movements%rowtype;
  v_delta numeric(16,3);
  v_stock numeric(16,3);
begin
  perform public.require_staff(array['superadmin','admin']);

  select * into v_movement from public.inventory_movements
  where id = p_movement_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'MOVEMENT_NOT_FOUND: El movimiento no existe';
  end if;
  if v_movement.movement_type not in (
    'positive_adjustment','negative_adjustment','damage','loss'
  ) or v_movement.order_id is not null or v_movement.purchase_id is not null then
    raise exception using errcode = '22023',
      message = 'MOVEMENT_NOT_EDITABLE: Solo se pueden eliminar ajustes manuales de inventario';
  end if;

  v_delta := v_movement.stock_on_hand_after - v_movement.stock_on_hand_before;

  perform set_config('app.inventory_movement_write', 'edit_inventory_adjustment', true);
  -- Eliminar el ajuste es aplicar su efecto al revés.
  v_stock := public.apply_inventory_movement_correction(v_movement, -v_delta);

  perform set_config('app.audit_reason', coalesce(nullif(btrim(p_reason), ''), 'Ajuste de inventario eliminado'), true);
  delete from public.inventory_movements where id = v_movement.id;

  return jsonb_build_object(
    'movement_id', v_movement.id,
    'product_id', v_movement.product_id,
    'deleted', true,
    'stock_on_hand', v_stock
  );
end;
$$;

comment on function public.delete_inventory_adjustment(uuid, text) is
  'Elimina un ajuste manual de inventario, revierte su efecto en el stock y recoloca los saldos posteriores del kardex. Solo superadmin/admin.';

-- ---------------------------------------------------------------------------
-- 5. Privilegios
-- ---------------------------------------------------------------------------
revoke all on function public.apply_inventory_movement_correction(public.inventory_movements, numeric) from public;
revoke all on function public.update_inventory_adjustment(uuid, public.inventory_movement_type, numeric, numeric, text) from public;
revoke all on function public.delete_inventory_adjustment(uuid, text) from public;

grant execute on function public.update_inventory_adjustment(uuid, public.inventory_movement_type, numeric, numeric, text) to authenticated;
grant execute on function public.delete_inventory_adjustment(uuid, text) to authenticated;

commit;
