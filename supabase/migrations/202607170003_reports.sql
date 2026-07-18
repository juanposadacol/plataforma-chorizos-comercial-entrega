-- Financial and operational reports. Sales are recognized when an order is delivered.
begin;
set search_path = public, pg_temp;

create or replace function public.assert_report_access()
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.require_staff(array['superadmin','admin','vendedor','bodega','contabilidad']);
end;
$$;

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
      coalesce(sum(o.subtotal_amount - o.discount_amount) filter (
        where o.delivered_at >= b.today_start and o.delivered_at < b.tomorrow_start
      ), 0) as sales_today,
      coalesce(sum(o.subtotal_amount - o.discount_amount) filter (
        where o.delivered_at >= b.today_start - interval '1 day' and o.delivered_at < b.today_start
      ), 0) as sales_yesterday,
      coalesce(sum(o.subtotal_amount - o.discount_amount) filter (
        where o.delivered_at >= b.week_start and o.delivered_at < b.tomorrow_start
      ), 0) as sales_current_week,
      coalesce(sum(o.subtotal_amount - o.discount_amount) filter (
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
  ), current_balances as (
    select
      (select coalesce(sum(balance_amount), 0) from public.accounts_receivable
       where status in ('pending','partial','overdue') and deleted_at is null) as accounts_receivable,
      (select coalesce(sum(balance_amount), 0) from public.accounts_payable
       where status in ('pending','partial','overdue') and deleted_at is null) as accounts_payable,
      (
        select coalesce(sum(greatest(p.stock_on_hand, 0) * p.average_cost), 0)
        from public.products p where p.track_inventory and p.deleted_at is null
      ) + (
        select coalesce(sum(greatest(v.stock_on_hand, 0) * coalesce(v.average_cost, v.current_cost, 0)), 0)
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
    'sales_cost', rs.sales_cost,
    'gross_profit', rs.gross_profit,
    'operating_expenses', e.operating_expenses,
    'net_profit', rs.gross_profit - e.operating_expenses,
    'gross_margin', case when rs.net_sales = 0 then 0 else round(rs.gross_profit / rs.net_sales * 100, 2) end,
    'delivered_orders', rs.delivered_orders,
    'average_ticket', case when rs.delivered_orders = 0 then 0 else round(rs.net_sales / rs.delivered_orders, 2) end,
    'units_sold', u.units_sold,
    'collected', col.collected,
    'accounts_receivable', cb.accounts_receivable,
    'accounts_payable', cb.accounts_payable,
    'inventory_value', cb.inventory_value,
    'new_customers', nc.total,
    'low_stock_products', cb.low_stock_products,
    'pending_notifications', cb.pending_notifications,
    'order_status_counts', sc.value
  ) into v_result
  from range_sales rs cross join units u cross join expenses e cross join collections col
  cross join headlines h cross join status_counts sc cross join current_balances cb cross join new_customers nc;
  return v_result;
end;
$$;

create or replace function public.report_sales_by_day(p_from date, p_to date)
returns table (
  sale_date date,
  delivered_orders bigint,
  units_sold numeric,
  net_sales numeric,
  sales_cost numeric,
  gross_profit numeric,
  gross_margin numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_report_access();
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 1826 then
    raise exception using errcode = '22023', message = 'Invalid report range';
  end if;
  return query
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as day
  ), sales as (
    select
      (o.delivered_at at time zone 'America/Bogota')::date as day,
      count(distinct o.id) as orders,
      coalesce(sum(oi.quantity), 0) as units,
      coalesce(sum(oi.total_amount), 0) as revenue,
      coalesce(sum(oi.total_cost), 0) as cost,
      coalesce(sum(oi.gross_profit), 0) as profit
    from public.orders o
    join public.order_items oi on oi.order_id = o.id and oi.deleted_at is null
    where o.status = 'delivered' and o.deleted_at is null
      and (o.delivered_at at time zone 'America/Bogota')::date between p_from and p_to
    group by 1
  )
  select d.day, coalesce(s.orders, 0), coalesce(s.units, 0), coalesce(s.revenue, 0),
         coalesce(s.cost, 0), coalesce(s.profit, 0),
         case when coalesce(s.revenue, 0) = 0 then 0 else round(s.profit / s.revenue * 100, 2) end
  from days d left join sales s on s.day = d.day order by d.day;
end;
$$;

create or replace function public.report_product_ranking(p_from date, p_to date, p_limit integer default 20)
returns table (
  product_id uuid,
  sku text,
  product_name text,
  units_sold numeric,
  order_count bigint,
  net_sales numeric,
  sales_cost numeric,
  gross_profit numeric,
  gross_margin numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_report_access();
  if p_from is null or p_to is null or p_from > p_to or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Invalid report parameters';
  end if;
  return query
  select oi.product_id, min(oi.sku), min(oi.product_name), sum(oi.quantity), count(distinct o.id),
         sum(oi.total_amount), sum(oi.total_cost), sum(oi.gross_profit),
         case when sum(oi.total_amount) = 0 then 0 else round(sum(oi.gross_profit) / sum(oi.total_amount) * 100, 2) end
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.status = 'delivered' and o.deleted_at is null and oi.deleted_at is null
    and (o.delivered_at at time zone 'America/Bogota')::date between p_from and p_to
  group by oi.product_id
  order by sum(oi.total_amount) desc, sum(oi.quantity) desc
  limit p_limit;
end;
$$;

create or replace function public.report_customer_ranking(p_from date, p_to date, p_limit integer default 20)
returns table (
  customer_id uuid,
  customer_name text,
  order_count bigint,
  net_sales numeric,
  total_paid numeric,
  average_ticket numeric,
  last_purchase_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_report_access();
  if p_from is null or p_to is null or p_from > p_to or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Invalid report parameters';
  end if;
  return query
  select o.customer_id, min(o.customer_name), count(*),
         sum(o.subtotal_amount - o.discount_amount),
         coalesce((select sum(p.amount) from public.payments p
           where p.customer_id = o.customer_id and p.status = 'approved' and p.deleted_at is null
             and (p.paid_at at time zone 'America/Bogota')::date between p_from and p_to), 0),
         round(avg(o.subtotal_amount - o.discount_amount), 2), max(o.delivered_at)
  from public.orders o
  where o.status = 'delivered' and o.deleted_at is null
    and (o.delivered_at at time zone 'America/Bogota')::date between p_from and p_to
  group by o.customer_id
  order by sum(o.subtotal_amount - o.discount_amount) desc, count(*) desc
  limit p_limit;
end;
$$;

create or replace function public.report_sales_breakdown(
  p_dimension text,
  p_from date,
  p_to date
)
returns table (
  dimension_key text,
  dimension_label text,
  order_count bigint,
  units_sold numeric,
  net_sales numeric,
  gross_profit numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_report_access();
  if p_dimension not in ('price_list','payment_method','channel','status','category','municipality','neighborhood')
     or p_from is null or p_to is null or p_from > p_to then
    raise exception using errcode = '22023', message = 'Invalid report parameters';
  end if;
  return query
  select
    case p_dimension
      when 'price_list' then coalesce(oi.price_list_id::text, 'public')
      when 'payment_method' then o.payment_method_id::text
      when 'channel' then o.channel::text
      when 'status' then o.status::text
      when 'category' then coalesce(p.category_id::text, 'uncategorized')
      when 'municipality' then coalesce(nullif(o.municipality, ''), 'Sin dato')
      else coalesce(nullif(o.neighborhood, ''), 'Sin dato')
    end,
    case p_dimension
      when 'price_list' then coalesce(oi.price_list_name, 'Público')
      when 'payment_method' then o.payment_method_name
      when 'channel' then o.channel::text
      when 'status' then o.status::text
      when 'category' then coalesce(c.name, 'Sin categoría')
      when 'municipality' then coalesce(nullif(o.municipality, ''), 'Sin dato')
      else coalesce(nullif(o.neighborhood, ''), 'Sin dato')
    end,
    count(distinct o.id), sum(oi.quantity), sum(oi.total_amount), sum(oi.gross_profit)
  from public.orders o
  join public.order_items oi on oi.order_id = o.id and oi.deleted_at is null
  join public.products p on p.id = oi.product_id
  left join public.categories c on c.id = p.category_id
  where o.deleted_at is null
    and (case when p_dimension = 'status' then true else o.status = 'delivered' end)
    and ((case when p_dimension = 'status' then o.created_at else o.delivered_at end) at time zone 'America/Bogota')::date
      between p_from and p_to
  group by 1, 2
  order by sum(oi.total_amount) desc;
end;
$$;

create or replace function public.report_cash_flow(p_from date, p_to date)
returns table (
  movement_date date,
  inflows numeric,
  outflows numeric,
  net_flow numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_report_access();
  if p_from is null or p_to is null or p_from > p_to then
    raise exception using errcode = '22023', message = 'Invalid report range';
  end if;
  return query
  with days as (select generate_series(p_from, p_to, interval '1 day')::date as day), flow as (
    select (cm.occurred_at at time zone 'America/Bogota')::date as day,
      sum(cm.amount) filter (where cm.movement_type in ('income','transfer_in')) as incoming,
      sum(cm.amount) filter (where cm.movement_type in ('expense','transfer_out')) as outgoing
    from public.cash_movements cm
    where cm.deleted_at is null
      and (cm.occurred_at at time zone 'America/Bogota')::date between p_from and p_to
    group by 1
  )
  select d.day, coalesce(f.incoming, 0), coalesce(f.outgoing, 0),
         coalesce(f.incoming, 0) - coalesce(f.outgoing, 0)
  from days d left join flow f on f.day = d.day order by d.day;
end;
$$;

create or replace function public.report_inventory_snapshot()
returns table (
  product_id uuid,
  sku text,
  product_name text,
  stock_on_hand numeric,
  stock_reserved numeric,
  stock_available numeric,
  minimum_stock numeric,
  average_cost numeric,
  inventory_value numeric,
  is_low_stock boolean,
  last_movement_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.assert_report_access();
  return query
  select p.id, p.sku, p.name, p.stock_on_hand, p.stock_reserved, p.stock_available,
         p.minimum_stock, p.average_cost, round(greatest(p.stock_on_hand, 0) * p.average_cost, 2),
         p.stock_available <= p.minimum_stock,
         (select max(im.occurred_at) from public.inventory_movements im where im.product_id = p.id)
  from public.products p
  where p.track_inventory and p.deleted_at is null
  order by (p.stock_available <= p.minimum_stock) desc, p.stock_available, p.name;
end;
$$;

revoke all on function public.assert_report_access() from public;
revoke all on function public.get_dashboard_metrics(timestamptz,timestamptz) from public;
revoke all on function public.report_sales_by_day(date,date) from public;
revoke all on function public.report_product_ranking(date,date,integer) from public;
revoke all on function public.report_customer_ranking(date,date,integer) from public;
revoke all on function public.report_sales_breakdown(text,date,date) from public;
revoke all on function public.report_cash_flow(date,date) from public;
revoke all on function public.report_inventory_snapshot() from public;

grant execute on function public.get_dashboard_metrics(timestamptz,timestamptz),
  public.report_sales_by_day(date,date),
  public.report_product_ranking(date,date,integer),
  public.report_customer_ranking(date,date,integer),
  public.report_sales_breakdown(text,date,date),
  public.report_cash_flow(date,date),
  public.report_inventory_snapshot()
  to authenticated;

commit;
