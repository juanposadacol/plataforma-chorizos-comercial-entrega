-- Corrige una regresión propia y amplía qué movimientos de inventario se pueden
-- corregir.
--
-- REGRESIÓN (reportada desde el panel: «No fue posible eliminar el cliente»)
-- 202608070007 volvió a declarar `prevent_hard_delete` y
-- `prevent_immutable_mutation` para abrir la compuerta del kardex, pero al
-- reescribirlas dejó por fuera el valor `delete_customer_permanently` que había
-- agregado 202608070001. Resultado: `delete_customer_permanently` chocaba contra
-- su propio guarda y fallaba con «customers records are immutable…», un texto
-- que el panel no sabe traducir y muestra como error genérico.
--
-- Aquí se declaran las dos funciones con TODAS las compuertas vigentes:
--   * `app.purge_order` = delete_order_permanently | delete_customer_permanently
--   * `app.inventory_movement_write` = edit_inventory_adjustment (solo kardex)
--
-- AMPLIACIÓN
-- El inventario inicial (`initial`) pasa a ser corregible y eliminable como
-- cualquier otro ajuste manual: es un dato que se digita al montar el producto y
-- equivocarse ahí era irreversible. Los movimientos que nacen de un pedido o de
-- una compra (reserva, liberación, venta, devolución, compra) siguen intocables:
-- esos se corrigen operando el documento que los originó.

begin;

set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Guardas con todas las compuertas
-- ---------------------------------------------------------------------------

create or replace function public.prevent_hard_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Marcas locales a la transacción, fijadas solo por las RPC autorizadas.
  if current_setting('app.purge_order', true)
     in ('delete_order_permanently', 'delete_customer_permanently') then
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
  'Bloquea DELETE. Excepciones: las purgas transaccionales de pedido y de cliente (app.purge_order) y la corrección de un ajuste manual de inventario (app.inventory_movement_write).';

create or replace function public.prevent_immutable_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Las compuertas de purga habilitan únicamente DELETE: esas tablas siguen
  -- siendo inmutables frente a UPDATE incluso durante una purga.
  if tg_op = 'DELETE'
     and current_setting('app.purge_order', true)
         in ('delete_order_permanently', 'delete_customer_permanently') then
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
-- 2. El inventario inicial también se puede corregir
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
    'initial','positive_adjustment','negative_adjustment','damage','loss'
  ) or v_movement.order_id is not null or v_movement.purchase_id is not null then
    raise exception using errcode = '22023',
      message = 'MOVEMENT_NOT_EDITABLE: Solo se pueden corregir el inventario inicial y los ajustes manuales';
  end if;

  v_type := coalesce(p_movement_type, v_movement.movement_type);
  if v_type not in ('initial','positive_adjustment','negative_adjustment','damage','loss') then
    raise exception using errcode = '22023',
      message = 'MOVEMENT_NOT_EDITABLE: Tipo de movimiento no válido para una corrección manual';
  end if;
  v_quantity := coalesce(p_quantity, v_movement.quantity);
  if v_quantity is null or v_quantity <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_QUANTITY: La cantidad debe ser mayor que cero';
  end if;
  if nullif(btrim(coalesce(p_notes, v_movement.notes)), '') is null then
    raise exception using errcode = '22023', message = 'NOTES_REQUIRED: El motivo del ajuste es obligatorio';
  end if;

  v_old_delta := v_movement.stock_on_hand_after - v_movement.stock_on_hand_before;
  -- `initial` y `positive_adjustment` suman; daño, pérdida y ajuste negativo restan.
  v_new_delta := case
    when v_type in ('initial','positive_adjustment') then v_quantity
    else -v_quantity
  end;

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
  'Corrige el inventario inicial o un ajuste manual (tipo, cantidad, costo, motivo), recalcula el stock y recoloca los saldos posteriores del kardex. Solo superadmin/admin.';

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
    'initial','positive_adjustment','negative_adjustment','damage','loss'
  ) or v_movement.order_id is not null or v_movement.purchase_id is not null then
    raise exception using errcode = '22023',
      message = 'MOVEMENT_NOT_EDITABLE: Un movimiento de pedido o de compra se corrige en su documento de origen, no en el kardex';
  end if;

  v_delta := v_movement.stock_on_hand_after - v_movement.stock_on_hand_before;

  perform set_config('app.inventory_movement_write', 'edit_inventory_adjustment', true);
  -- Eliminar el movimiento es aplicar su efecto al revés.
  v_stock := public.apply_inventory_movement_correction(v_movement, -v_delta);

  perform set_config('app.audit_reason', coalesce(nullif(btrim(p_reason), ''), 'Movimiento de inventario eliminado'), true);
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
  'Elimina el inventario inicial o un ajuste manual, revierte su efecto en el stock y recoloca los saldos posteriores del kardex. Solo superadmin/admin.';

notify pgrst, 'reload schema';

commit;
