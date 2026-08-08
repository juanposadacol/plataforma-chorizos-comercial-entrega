-- La compra es de carne, y su único efecto es fijar el costo por chorizo.
--
-- CÓMO COMPRA EL NEGOCIO
-- No se compran chorizos terminados: se compra carne. De una compra salen
-- chorizos de los tres sabores, y para costear no importa cuál ni las
-- diferencias marginales entre ellos: lo que interesa es cuánto costó producir
-- una unidad.
--
--     costo por chorizo = valor pagado ÷ chorizos obtenidos
--
-- Ejemplo del negocio: 300 kg de carne que rinden 630 chorizos.
--
-- QUÉ HACE `register_meat_purchase`
--   1. Registra la compra con el proveedor, la fecha, la factura, los kilos, el
--      valor pagado y el rendimiento en unidades. Sin líneas por producto, sin
--      descuento y sin impuesto: esos campos quedan en cero.
--   2. Calcula el costo unitario y lo escribe como costo actual y costo promedio
--      de TODOS los productos activos. Desde ese momento cada pedido cuesta sus
--      líneas con ese valor y la utilidad del panel sale de la compra real.
--   3. Si quedó saldo con el proveedor, abre la cuenta por pagar y suma ese
--      saldo al proveedor, igual que hacía la recepción de compras.
--
-- QUÉ NO HACE
-- No mueve existencias: la carne no es una unidad vendible y repartir el
-- rendimiento entre los tres sabores sería inventarse un dato. El stock de cada
-- chorizo se sigue manejando en Inventario, que es donde el negocio cuenta lo
-- que produjo.
--
-- `receive_purchase` y las compras con líneas por producto siguen existiendo sin
-- cambios para el historial ya registrado.

begin;

set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Columnas propias de una compra de materia prima
-- ---------------------------------------------------------------------------
alter table public.purchases
  add column if not exists input_quantity numeric(16,3),
  add column if not exists yield_units numeric(16,3),
  add column if not exists unit_cost_result numeric(16,2);

comment on column public.purchases.input_quantity is 'Cantidad de materia prima comprada (kg de carne).';
comment on column public.purchases.yield_units is 'Unidades obtenidas de esa compra (chorizos).';
comment on column public.purchases.unit_cost_result is 'Costo por unidad resultante: total pagado ÷ unidades obtenidas.';

do $checks$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'purchases_input_quantity_check'
  ) then
    alter table public.purchases
      add constraint purchases_input_quantity_check
      check (input_quantity is null or input_quantity > 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'purchases_yield_units_check'
  ) then
    alter table public.purchases
      add constraint purchases_yield_units_check
      check (yield_units is null or yield_units > 0);
  end if;
end;
$checks$;

-- ---------------------------------------------------------------------------
-- 2. Registrar la compra de carne y costear con ella
-- ---------------------------------------------------------------------------
create or replace function public.register_meat_purchase(
  p_supplier_id uuid,
  p_purchase_date date,
  p_input_quantity numeric,
  p_amount numeric,
  p_yield_units numeric,
  p_invoice_number text default null,
  p_paid_amount numeric default 0,
  p_due_date date default null,
  p_notes text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_supplier public.suppliers%rowtype;
  v_amount numeric(16,2);
  v_paid numeric(16,2);
  v_balance numeric(16,2);
  v_unit_cost numeric(16,2);
  v_purchase public.purchases%rowtype;
  v_products_updated integer := 0;
  v_payable_created integer := 0;
begin
  perform public.require_staff(array['superadmin','admin','bodega','contabilidad']);

  select * into v_supplier from public.suppliers
  where id = p_supplier_id and deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'SUPPLIER_NOT_FOUND: El proveedor no existe';
  end if;
  if not coalesce(v_supplier.is_active, true) then
    raise exception using errcode = '22023', message = 'SUPPLIER_INACTIVE: El proveedor está inactivo';
  end if;

  if coalesce(p_input_quantity, 0) <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_QUANTITY: La cantidad de carne debe ser mayor que cero';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_AMOUNT: El valor pagado debe ser mayor que cero';
  end if;
  if coalesce(p_yield_units, 0) <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_YIELD: Las unidades obtenidas deben ser mayores que cero';
  end if;

  v_amount := round(p_amount, 2);
  v_paid := round(greatest(coalesce(p_paid_amount, 0), 0), 2);
  if v_paid > v_amount then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT: El abono no puede superar el valor de la compra';
  end if;
  v_balance := round(v_amount - v_paid, 2);
  if p_due_date is not null and p_due_date < p_purchase_date then
    raise exception using errcode = '22023', message = 'INVALID_DUE_DATE: El vencimiento no puede ser anterior a la compra';
  end if;

  -- El dato que da sentido a toda la operación.
  v_unit_cost := round(v_amount / p_yield_units, 2);

  insert into public.purchases(
    supplier_id, purchase_date, invoice_number, status,
    subtotal_amount, discount_amount, tax_amount, total_amount,
    paid_amount, balance_amount, due_date, notes,
    input_quantity, yield_units, unit_cost_result,
    received_at, received_by, created_by
  ) values (
    v_supplier.id, coalesce(p_purchase_date, current_date), nullif(btrim(p_invoice_number), ''),
    'received', v_amount, 0, 0, v_amount,
    v_paid, v_balance, p_due_date, nullif(btrim(p_notes), ''),
    p_input_quantity, p_yield_units, v_unit_cost,
    now(), auth.uid(), auth.uid()
  ) returning * into v_purchase;

  -- El costo por chorizo es el mismo para todos los sabores: es lo que dijo el
  -- negocio y es lo único que el rendimiento permite afirmar.
  perform set_config('app.inventory_write', 'transactional_api', true);
  update public.products
  set current_cost = v_unit_cost,
      average_cost = v_unit_cost,
      updated_at = now()
  where status = 'active' and deleted_at is null;
  get diagnostics v_products_updated = row_count;

  if v_balance > 0 then
    insert into public.accounts_payable(
      supplier_id, purchase_id, original_amount, paid_amount, balance_amount, due_date, status, created_by
    ) values (
      v_supplier.id, v_purchase.id, v_amount, v_paid, v_balance,
      coalesce(p_due_date, v_purchase.purchase_date),
      case when v_paid > 0 then 'partial' else 'pending' end,
      auth.uid()
    ) on conflict (purchase_id) do nothing;
    get diagnostics v_payable_created = row_count;
    if v_payable_created = 1 then
      update public.suppliers
      set outstanding_balance = outstanding_balance + v_balance, updated_at = now()
      where id = v_supplier.id;
    end if;
  end if;

  insert into public.audit_logs(actor_user_id, action, entity_name, record_id, new_values, reason)
  values (
    auth.uid(), 'MEAT_PURCHASE', 'purchases', v_purchase.id,
    jsonb_build_object(
      'input_quantity', p_input_quantity,
      'yield_units', p_yield_units,
      'total_amount', v_amount,
      'unit_cost', v_unit_cost,
      'products_updated', v_products_updated
    ),
    'Compra de carne; costo por unidad aplicado al catálogo'
  );

  return jsonb_build_object(
    'purchase_id', v_purchase.id,
    'purchase_number', v_purchase.purchase_number,
    'unit_cost', v_unit_cost,
    'total_amount', v_amount,
    'balance_amount', v_balance,
    'products_updated', v_products_updated
  );
end;
$$;

comment on function public.register_meat_purchase(uuid, date, numeric, numeric, numeric, text, numeric, date, text) is
  'Registra una compra de carne (kilos, valor pagado y unidades obtenidas) y fija el costo por unidad —valor ÷ rendimiento— como costo actual y promedio de todos los productos activos. No mueve existencias.';

revoke all on function public.register_meat_purchase(uuid, date, numeric, numeric, numeric, text, numeric, date, text) from public;
grant execute on function public.register_meat_purchase(uuid, date, numeric, numeric, numeric, text, numeric, date, text) to authenticated;

notify pgrst, 'reload schema';

commit;
