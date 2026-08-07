-- Utilidad neta valorada con el COSTO PROMEDIO DE LA SEMANA ANTERIOR.
--
-- MOTIVO
-- Hasta ahora `orders.sales_cost` congelaba el costo promedio móvil vigente en el
-- instante de la entrega. El negocio compra por semana y su costo real cambia
-- semana a semana, así que la utilidad debe medirse contra lo que costó reponer
-- la mercancía en la semana previa a la venta.
--
-- DEFINICIÓN
--   costo_semanal(producto, fecha) =
--     sum(purchase_items.subtotal_amount) / sum(purchase_items.quantity)
--   sobre las compras RECIBIDAS de la última semana calendario (lunes a domingo,
--   hora Bogotá) que sea ANTERIOR a la semana de la venta.
--
-- Si esa semana no tuvo compras del producto se toma la última semana anterior
-- que sí las tuvo; si el producto nunca se ha comprado, se conserva el costo
-- registrado en el pedido. Así la métrica nunca queda en cero por un vacío de
-- datos, y la degradación queda documentada en `weekly_cost_coverage`.
--
-- El costo contable de inventario (average_cost / kardex) NO se modifica: esto
-- es exclusivamente una métrica de reporte.

begin;

set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Costo unitario promedio por producto y semana de compra
-- ---------------------------------------------------------------------------

create or replace view public.product_weekly_purchase_cost
with (security_barrier = true)
as
select
  pi.product_id,
  date_trunc('week', p.purchase_date::timestamp)::date as purchase_week,
  sum(pi.subtotal_amount) as total_cost,
  sum(pi.quantity) as total_quantity,
  round(sum(pi.subtotal_amount) / nullif(sum(pi.quantity), 0), 2) as average_unit_cost
from public.purchase_items pi
join public.purchases p on p.id = pi.purchase_id
where pi.deleted_at is null
  and p.deleted_at is null
  and p.status in ('received', 'partially_received')
group by pi.product_id, date_trunc('week', p.purchase_date::timestamp)::date;

comment on view public.product_weekly_purchase_cost is
  'Costo unitario promedio por producto y semana calendario, calculado sobre compras recibidas (valor pagado / cantidad).';

-- La vista solo se consume desde funciones de reporte con SECURITY DEFINER.
revoke all on public.product_weekly_purchase_cost from anon, authenticated;

create or replace function public.previous_week_unit_cost(
  p_product_id uuid,
  p_reference date
)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select w.average_unit_cost
  from public.product_weekly_purchase_cost w
  where w.product_id = p_product_id
    and w.purchase_week < date_trunc('week', p_reference::timestamp)::date
    and w.average_unit_cost is not null
  order by w.purchase_week desc
  limit 1;
$$;

comment on function public.previous_week_unit_cost(uuid, date) is
  'Costo unitario promedio de la última semana de compras anterior a la semana de la fecha dada. NULL si el producto nunca se ha comprado.';

revoke all on function public.previous_week_unit_cost(uuid, date) from public;
grant execute on function public.previous_week_unit_cost(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_dashboard_metrics: agrega el costo y la utilidad valorados por semana
-- ---------------------------------------------------------------------------
-- `net_profit` pasa a calcularse con el costo de la semana anterior, que es la
-- definición pedida por el negocio. Se conservan `sales_cost` /
-- `gross_profit` (costo registrado en el pedido) y se agrega
-- `net_profit_recorded` para poder comparar ambas lecturas.

create or replace function public.get_dashboard_metrics(
  p_from timestamptz default date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota',
  p_to timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.assert_report_access();
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '5 years' then
    raise exception using errcode = '22023', message = 'Invalid report range';
  end if;

  with bounds as (
    select
      date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota' as today_start,
      (date_trunc('day', now() at time zone 'America/Bogota') + interval '1 day') at time zone 'America/Bogota' as tomorrow_start,
      date_trunc('week', now() at time zone 'America/Bogota') at time zone 'America/Bogota' as week_start,
      date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota' as month_start
  ), range_sales as (
    select
      coalesce(sum(o.subtotal_amount - o.discount_amount), 0) as net_sales,
      coalesce(sum(o.sales_cost), 0) as sales_cost,
      coalesce(sum(o.gross_profit), 0) as gross_profit,
      count(*) as delivered_orders
    from public.orders o
    where o.status = 'delivered' and o.deleted_at is null
      and o.delivered_at >= p_from and o.delivered_at < p_to
  ), weekly_cost as (
    -- Cada línea entregada se valora con el costo promedio de la semana anterior
    -- a SU entrega. `covered` distingue las líneas con dato real de las que
    -- cayeron al costo registrado en el pedido.
    select
      coalesce(sum(
        oi.quantity * coalesce(
          public.previous_week_unit_cost(
            oi.product_id,
            (o.delivered_at at time zone 'America/Bogota')::date
          ),
          oi.unit_cost
        )
      ), 0) as sales_cost_weekly,
      count(*) filter (
        where public.previous_week_unit_cost(
          oi.product_id, (o.delivered_at at time zone 'America/Bogota')::date
        ) is not null
      ) as covered_items,
      count(*) as total_items
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.status = 'delivered' and o.deleted_at is null and oi.deleted_at is null
      and o.delivered_at >= p_from and o.delivered_at < p_to
  ), units as (
    select coalesce(sum(oi.quantity), 0) as units_sold
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.status = 'delivered' and o.deleted_at is null and oi.deleted_at is null
      and o.delivered_at >= p_from and o.delivered_at < p_to
  ), expenses as (
    select coalesce(sum(e.amount), 0) as operating_expenses
    from public.expenses e
    join public.expense_categories ec on ec.id = e.category_id
    where e.status = 'posted' and e.deleted_at is null and ec.is_operating_expense
      and e.expense_date >= (p_from at time zone 'America/Bogota')::date
      and e.expense_date < (p_to at time zone 'America/Bogota')::date + 1
  ), collections as (
    select coalesce(sum(p.amount), 0) as collected
    from public.payments p
    where p.status = 'approved' and p.deleted_at is null
      and p.paid_at >= p_from and p.paid_at < p_to
  ), headlines as (
    select
      coalesce(sum(o.total_amount) filter (
        where o.delivered_at >= b.today_start and o.delivered_at < b.tomorrow_start
      ), 0) as sales_today,
      coalesce(sum(o.total_amount) filter (
        where o.delivered_at >= b.today_start - interval '1 day' and o.delivered_at < b.today_start
      ), 0) as sales_yesterday,
      coalesce(sum(o.total_amount) filter (
        where o.delivered_at >= b.week_start and o.delivered_at < b.tomorrow_start
      ), 0) as sales_current_week,
      coalesce(sum(o.total_amount) filter (
        where o.delivered_at >= b.month_start and o.delivered_at < b.tomorrow_start
      ), 0) as sales_current_month
    from bounds b
    left join public.orders o on o.status = 'delivered' and o.deleted_at is null
      and o.delivered_at >= b.today_start - interval '1 day'
  ), status_counts as (
    select coalesce(jsonb_object_agg(status, total), '{}'::jsonb) as value
    from (
      select o.status::text as status, count(*) as total
      from public.orders o
      where o.deleted_at is null and o.created_at >= p_from and o.created_at < p_to
      group by o.status
    ) grouped
  ), new_orders as (
    select count(*) as total
    from public.orders o
    where o.deleted_at is null and o.created_at >= p_from and o.created_at < p_to
  ), current_balances as (
    select
      (select coalesce(sum(balance_amount), 0) from public.accounts_receivable
       where status in ('pending','partial','overdue') and deleted_at is null) as accounts_receivable,
      (select coalesce(sum(balance_amount), 0) from public.accounts_payable
       where status in ('pending','partial','overdue') and deleted_at is null) as accounts_payable,
      (
        select coalesce(sum(greatest(p.stock_on_hand, 0) * coalesce(nullif(p.average_cost, 0), nullif(p.current_cost, 0), 0)), 0)
        from public.products p where p.track_inventory and p.deleted_at is null
      ) + (
        select coalesce(sum(greatest(v.stock_on_hand, 0) * coalesce(nullif(v.average_cost, 0), nullif(v.current_cost, 0), 0)), 0)
        from public.product_variants v where v.deleted_at is null
      ) as inventory_value,
      (select count(*) from public.products p
       where p.status = 'active' and p.track_inventory and p.stock_available <= p.minimum_stock and p.deleted_at is null) as low_stock_products,
      (select count(*) from public.notification_deliveries nd
       where nd.status in ('pending','retrying','manual_required','failed') and nd.deleted_at is null) as pending_notifications
  ), new_customers as (
    select count(*) as total from public.customers c
    where c.created_at >= p_from and c.created_at < p_to and c.deleted_at is null
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sales_today', h.sales_today,
    'sales_yesterday', h.sales_yesterday,
    'sales_current_week', h.sales_current_week,
    'sales_current_month', h.sales_current_month,
    'net_sales', rs.net_sales,
    'operating_expenses', e.operating_expenses,
    -- Definición vigente del negocio: costo promedio de la semana anterior.
    -- Toda la cadena (costo → utilidad bruta → margen → utilidad neta) usa el
    -- mismo criterio para que las tarjetas del panel no se contradigan.
    'sales_cost', round(wc.sales_cost_weekly, 2),
    'sales_cost_weekly', round(wc.sales_cost_weekly, 2),
    'gross_profit', round(rs.net_sales - wc.sales_cost_weekly, 2),
    'gross_profit_weekly', round(rs.net_sales - wc.sales_cost_weekly, 2),
    'net_profit', round(rs.net_sales - wc.sales_cost_weekly - e.operating_expenses, 2),
    -- Lectura anterior (costo congelado en el pedido), para comparar. Es la que
    -- siguen usando los reportes por día y por producto.
    'sales_cost_recorded', rs.sales_cost,
    'gross_profit_recorded', rs.gross_profit,
    'net_profit_recorded', rs.gross_profit - e.operating_expenses,
    'weekly_cost_coverage', case
      when wc.total_items = 0 then 0
      else round(wc.covered_items::numeric / wc.total_items * 100, 2)
    end,
    'gross_margin', case
      when rs.net_sales = 0 then 0
      else round((rs.net_sales - wc.sales_cost_weekly) / rs.net_sales * 100, 2)
    end,
    'delivered_orders', rs.delivered_orders,
    'average_ticket', case when rs.delivered_orders = 0 then 0 else round(rs.net_sales / rs.delivered_orders, 2) end,
    'units_sold', u.units_sold,
    'collected', col.collected,
    'accounts_receivable', cb.accounts_receivable,
    'accounts_payable', cb.accounts_payable,
    'inventory_value', cb.inventory_value,
    'new_customers', nc.total,
    'new_orders', no_.total,
    'low_stock_products', cb.low_stock_products,
    'pending_notifications', cb.pending_notifications,
    'order_status_counts', sc.value
  ) into v_result
  from range_sales rs cross join weekly_cost wc cross join units u
  cross join expenses e cross join collections col
  cross join headlines h cross join status_counts sc cross join current_balances cb
  cross join new_customers nc cross join new_orders no_;
  return v_result;
end;
$$;

comment on function public.get_dashboard_metrics(timestamptz, timestamptz) is
  'Métricas del panel. La utilidad neta y el margen usan el costo promedio de la semana anterior a cada entrega; net_profit_recorded conserva la lectura con el costo congelado del pedido.';

revoke all on function public.get_dashboard_metrics(timestamptz,timestamptz) from public;
grant execute on function public.get_dashboard_metrics(timestamptz,timestamptz) to authenticated;

notify pgrst, 'reload schema';

commit;
