-- Transactional API. All SECURITY DEFINER functions pin search_path and authorize explicitly.
begin;

set search_path = public, pg_temp;

alter table public.orders
  add column if not exists tracking_token uuid not null default gen_random_uuid();
create unique index if not exists orders_tracking_token_uq on public.orders(tracking_token);
alter table public.orders drop constraint if exists orders_requested_date_check;
alter table public.orders add constraint orders_requested_date_check check (
  requested_delivery_date is null
  or requested_delivery_date >= (created_at at time zone 'America/Bogota')::date
);

-- Compatibility alias consumed by the storefront; base_fee remains the writable source.
alter table public.delivery_methods
  add column if not exists fee numeric(16,2) generated always as (base_fee) stored;

create table if not exists public.request_rate_limits (
  bucket text not null,
  subject_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket, subject_hash, window_started_at)
);
alter table public.request_rate_limits enable row level security;
revoke all on public.request_rate_limits from public, anon, authenticated;

create or replace function public.is_service_role()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

create or replace function public.require_staff(p_roles text[] default array['superadmin','admin']::text[])
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not public.is_service_role() and not public.has_any_role(p_roles) then
    raise exception using errcode = '42501', message = 'Insufficient privileges';
  end if;
end;
$$;

create or replace function public.receive_purchase(
  p_purchase_id uuid,
  p_received_items jsonb default null,
  p_notes text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_purchase public.purchases%rowtype;
  v_item public.purchase_items%rowtype;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_receive numeric(16,3);
  v_before_stock numeric(16,3);
  v_before_reserved numeric(16,3);
  v_old_average numeric(16,2);
  v_new_average numeric(16,2);
  v_processed integer := 0;
  v_remaining integer;
  v_payable_created integer := 0;
  v_status public.purchase_status;
begin
  perform public.require_staff(array['superadmin','admin','bodega','contabilidad']);
  if p_received_items is not null and jsonb_typeof(p_received_items) <> 'array' then
    raise exception using errcode = '22023', message = 'Received items must be an array';
  end if;
  select * into v_purchase from public.purchases
  where id = p_purchase_id and deleted_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Purchase not found'; end if;
  if v_purchase.status in ('cancelled','returned') then
    raise exception using errcode = '22023', message = 'Purchase cannot be received in its current status';
  end if;
  if v_purchase.status = 'received' then
    return jsonb_build_object('purchase_id', v_purchase.id, 'status', v_purchase.status, 'received_items', 0);
  end if;

  perform set_config('app.inventory_write', 'transactional_api', true);
  for v_item in
    select * from public.purchase_items pi
    where pi.purchase_id = v_purchase.id
      and pi.deleted_at is null
      and pi.received_quantity < pi.quantity
    order by pi.product_id, pi.variant_id nulls first
    for update
  loop
    if p_received_items is null then
      v_receive := v_item.quantity - v_item.received_quantity;
    else
      select nullif(x ->> 'quantity', '')::numeric into v_receive
      from jsonb_array_elements(p_received_items) x
      where x ->> 'purchase_item_id' = v_item.id::text
      limit 1;
      if v_receive is null then continue; end if;
    end if;
    if v_receive <= 0 or v_receive > v_item.quantity - v_item.received_quantity then
      raise exception using errcode = '22023', message = 'Invalid received quantity';
    end if;

    select * into v_product from public.products where id = v_item.product_id for update;
    if v_item.variant_id is not null then
      select * into v_variant from public.product_variants
      where id = v_item.variant_id and product_id = v_item.product_id for update;
      if not found then raise exception using errcode = '23503', message = 'Purchase variant not found'; end if;
      v_before_stock := v_variant.stock_on_hand;
      v_before_reserved := v_variant.stock_reserved;
      v_old_average := coalesce(v_variant.average_cost, v_variant.current_cost, v_item.unit_cost);
      v_new_average := round(
        ((greatest(v_before_stock, 0) * v_old_average) + (v_receive * v_item.unit_cost)) /
        nullif(greatest(v_before_stock, 0) + v_receive, 0), 2
      );
      update public.product_variants
      set stock_on_hand = stock_on_hand + v_receive,
          current_cost = v_item.unit_cost,
          average_cost = v_new_average,
          updated_at = now()
      where id = v_variant.id;
    else
      v_before_stock := v_product.stock_on_hand;
      v_before_reserved := v_product.stock_reserved;
      v_old_average := coalesce(v_product.average_cost, v_product.current_cost, v_item.unit_cost);
      v_new_average := round(
        ((greatest(v_before_stock, 0) * v_old_average) + (v_receive * v_item.unit_cost)) /
        nullif(greatest(v_before_stock, 0) + v_receive, 0), 2
      );
      update public.products
      set stock_on_hand = stock_on_hand + v_receive,
          current_cost = v_item.unit_cost,
          average_cost = v_new_average,
          updated_at = now()
      where id = v_product.id;
    end if;

    update public.purchase_items
    set received_quantity = received_quantity + v_receive, updated_at = now()
    where id = v_item.id;
    insert into public.inventory_movements(
      product_id, variant_id, movement_type, quantity, unit_cost,
      stock_on_hand_before, stock_on_hand_after, stock_reserved_before, stock_reserved_after,
      purchase_id, purchase_item_id, performed_by, notes
    ) values (
      v_item.product_id, v_item.variant_id, 'purchase', v_receive, v_item.unit_cost,
      v_before_stock, v_before_stock + v_receive, v_before_reserved, v_before_reserved,
      v_purchase.id, v_item.id, auth.uid(), coalesce(p_notes, 'Recepción de compra')
    );
    v_processed := v_processed + 1;
  end loop;
  if v_processed = 0 then
    raise exception using errcode = '22023', message = 'No purchase items were selected for receipt';
  end if;

  select count(*) into v_remaining from public.purchase_items
  where purchase_id = v_purchase.id and deleted_at is null and received_quantity < quantity;
  v_status := case when v_remaining = 0 then 'received' else 'partially_received' end;
  update public.purchases
  set status = v_status, received_at = now(), received_by = auth.uid(),
      notes = case when nullif(btrim(p_notes), '') is null then notes else concat_ws(E'\n', notes, p_notes) end,
      updated_at = now()
  where id = v_purchase.id;

  if v_purchase.balance_amount > 0 then
    insert into public.accounts_payable(
      supplier_id, purchase_id, original_amount, paid_amount, balance_amount, due_date, status, created_by
    ) values (
      v_purchase.supplier_id, v_purchase.id, v_purchase.total_amount, v_purchase.paid_amount,
      v_purchase.balance_amount, coalesce(v_purchase.due_date, v_purchase.purchase_date),
      case when v_purchase.paid_amount > 0 then 'partial' else 'pending' end,
      auth.uid()
    ) on conflict (purchase_id) do nothing;
    get diagnostics v_payable_created = row_count;
    if v_payable_created = 1 then
      update public.suppliers
      set outstanding_balance = outstanding_balance + v_purchase.balance_amount, updated_at = now()
      where id = v_purchase.supplier_id;
    end if;
  end if;

  insert into public.audit_logs(actor_user_id, action, entity_name, record_id, new_values, reason)
  values (
    auth.uid(), 'RECEIVE', 'purchases', v_purchase.id,
    jsonb_build_object('status', v_status, 'item_rows_received', v_processed), p_notes
  );
  return jsonb_build_object(
    'purchase_id', v_purchase.id, 'purchase_number', v_purchase.purchase_number,
    'status', v_status, 'received_items', v_processed
  );
end;
$$;

alter table public.payments
  add column if not exists idempotency_key uuid not null default gen_random_uuid();
create unique index if not exists payments_idempotency_uq on public.payments(idempotency_key);

create or replace function public.register_payment(
  p_order_id uuid,
  p_amount numeric,
  p_payment_method_id uuid,
  p_reference text default null,
  p_receipt_url text default null,
  p_notes text default null,
  p_status public.payment_record_status default 'approved',
  p_cash_account_id uuid default null,
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
  v_method public.payment_methods%rowtype;
  v_payment_id uuid;
  v_approved_total numeric(16,2);
  v_receivable public.accounts_receivable%rowtype;
  v_cash public.cash_accounts%rowtype;
begin
  perform public.require_staff(array['superadmin','admin','vendedor','contabilidad']);
  if p_amount <= 0 or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Amount and idempotency key are required';
  end if;
  select id into v_payment_id from public.payments where idempotency_key = p_idempotency_key;
  if found then
    select coalesce(sum(amount) filter (where status = 'approved' and deleted_at is null), 0)
      into v_approved_total from public.payments where order_id = p_order_id;
    return jsonb_build_object('payment_id', v_payment_id, 'amount_paid', v_approved_total);
  end if;
  select * into v_order from public.orders
  where id = p_order_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'Order not found'; end if;
  if v_order.status in ('cancelled','returned') then
    raise exception using errcode = '22023', message = 'Cannot pay a cancelled or returned order';
  end if;
  select * into v_method from public.payment_methods
  where id = p_payment_method_id and is_active and deleted_at is null;
  if not found then raise exception using errcode = '22023', message = 'Payment method is not active'; end if;
  if v_method.requires_reference and nullif(btrim(p_reference), '') is null then
    raise exception using errcode = '22023', message = 'Payment reference is required';
  end if;
  if p_status = 'approved' and not public.has_any_role(array['superadmin','admin','contabilidad']) then
    raise exception using errcode = '42501', message = 'Only accounting can approve a payment';
  end if;

  select coalesce(sum(amount) filter (where status = 'approved' and deleted_at is null), 0)
    into v_approved_total from public.payments where order_id = v_order.id;
  if p_status = 'approved' and v_approved_total + p_amount > v_order.total_amount then
    raise exception using errcode = '23514', message = 'Payment exceeds outstanding order balance';
  end if;

  insert into public.payments(
    idempotency_key, order_id, customer_id, amount, payment_method_id, payment_method_name,
    reference, receipt_url, status, notes, recorded_by, verified_by, verified_at
  ) values (
    p_idempotency_key, v_order.id, v_order.customer_id, round(p_amount, 2),
    v_method.id, v_method.name, nullif(btrim(p_reference), ''), nullif(btrim(p_receipt_url), ''),
    p_status, p_notes, auth.uid(),
    case when p_status = 'approved' then auth.uid() end,
    case when p_status = 'approved' then now() end
  ) returning id into v_payment_id;

  select coalesce(sum(amount) filter (where status = 'approved' and deleted_at is null), 0)
    into v_approved_total from public.payments where order_id = v_order.id;
  update public.orders
  set amount_paid = v_approved_total,
      payment_status = case
        when v_approved_total >= total_amount then 'paid'
        when v_approved_total > 0 then 'partial'
        when payment_status = 'credit' then 'credit'
        else 'pending'
      end,
      updated_at = now(), version = version + 1
  where id = v_order.id;

  select * into v_receivable from public.accounts_receivable
  where order_id = v_order.id and deleted_at is null for update;
  if found then
    update public.accounts_receivable
    set paid_amount = least(v_approved_total, original_amount - written_off_amount),
        balance_amount = greatest(original_amount - written_off_amount - v_approved_total, 0),
        status = case
          when v_approved_total >= original_amount - written_off_amount then 'paid'
          when v_approved_total > 0 then 'partial'
          when due_date < current_date then 'overdue'
          else 'pending'
        end,
        closed_at = case when v_approved_total >= original_amount - written_off_amount then now() end,
        updated_at = now()
    where id = v_receivable.id;
  end if;
  update public.customers c
  set total_paid = (
        select coalesce(sum(p.amount), 0) from public.payments p
        where p.customer_id = c.id and p.status = 'approved' and p.deleted_at is null
      ),
      outstanding_balance = (
        select coalesce(sum(ar.balance_amount), 0) from public.accounts_receivable ar
        where ar.customer_id = c.id and ar.status in ('pending','partial','overdue') and ar.deleted_at is null
      ),
      updated_at = now()
  where c.id = v_order.customer_id;

  if p_status = 'approved' and p_cash_account_id is not null then
    select * into v_cash from public.cash_accounts
    where id = p_cash_account_id and is_active and deleted_at is null for update;
    if not found then raise exception using errcode = 'P0002', message = 'Cash account not found'; end if;
    update public.cash_accounts
    set current_balance = current_balance + p_amount, updated_at = now()
    where id = v_cash.id;
    insert into public.cash_movements(
      cash_account_id, movement_type, amount, balance_before, balance_after,
      description, reference, order_id, payment_id, performed_by
    ) values (
      v_cash.id, 'income', p_amount, v_cash.current_balance, v_cash.current_balance + p_amount,
      'Pago de pedido ' || v_order.order_number, p_reference, v_order.id, v_payment_id, auth.uid()
    );
  end if;

  insert into public.audit_logs(actor_user_id, action, entity_name, record_id, new_values)
  values (
    auth.uid(), 'CREATE', 'payments', v_payment_id,
    jsonb_build_object('order_id', v_order.id, 'amount', p_amount, 'status', p_status)
  );
  return jsonb_build_object(
    'payment_id', v_payment_id, 'order_id', v_order.id,
    'amount_paid', v_approved_total, 'balance', v_order.total_amount - v_approved_total,
    'payment_status', case when v_approved_total >= v_order.total_amount then 'paid'
      when v_approved_total > 0 then 'partial' else v_order.payment_status::text end
  );
end;
$$;

create or replace function public.set_user_roles(p_profile_id uuid, p_roles text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_role_count integer;
  v_other_superadmins integer;
begin
  perform public.require_staff(array['superadmin','admin']);
  if p_profile_id is null or p_roles is null or cardinality(p_roles) = 0 then
    raise exception using errcode = '22023', message = 'Profile and at least one role are required';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and deleted_at is null) then
    raise exception using errcode = 'P0002', message = 'Profile not found';
  end if;
  if 'superadmin' = any(p_roles) and not public.has_role('superadmin') then
    raise exception using errcode = '42501', message = 'Only a superadministrator can assign that role';
  end if;
  select count(*) into v_role_count from public.roles
  where code = any(p_roles) and is_active and deleted_at is null;
  if v_role_count <> (select count(distinct role_code) from unnest(p_roles) role_code) then
    raise exception using errcode = '22023', message = 'One or more roles are invalid';
  end if;

  if p_profile_id = auth.uid()
     and public.has_role('superadmin')
     and not ('superadmin' = any(p_roles)) then
    select count(distinct ur.profile_id) into v_other_superadmins
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.profile_id
    where r.code = 'superadmin' and r.is_active and r.deleted_at is null
      and p.is_active and p.deleted_at is null
      and ur.profile_id <> p_profile_id
      and (ur.expires_at is null or ur.expires_at > now());
    if v_other_superadmins = 0 then
      raise exception using errcode = '23514', message = 'Cannot remove the last active superadministrator';
    end if;
  end if;

  delete from public.user_roles where profile_id = p_profile_id;
  insert into public.user_roles(profile_id, role_id, assigned_by)
  select p_profile_id, r.id, auth.uid()
  from public.roles r
  where r.code = any(p_roles) and r.is_active and r.deleted_at is null;
  return jsonb_build_object('profile_id', p_profile_id, 'roles', to_jsonb(p_roles));
end;
$$;

create or replace function public.provision_staff_roles(
  p_actor_user_id uuid,
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_roles text[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_superadmin boolean;
  v_actor_admin boolean;
  v_role_count integer;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  select
    bool_or(r.code = 'superadmin'),
    bool_or(r.code in ('superadmin','admin'))
  into v_actor_superadmin, v_actor_admin
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id and r.is_active and r.deleted_at is null
  join public.profiles p on p.id = ur.profile_id and p.is_active and p.deleted_at is null
  where ur.profile_id = p_actor_user_id and (ur.expires_at is null or ur.expires_at > now());
  if not coalesce(v_actor_admin, false) then
    raise exception using errcode = '42501', message = 'Administrator role required';
  end if;
  if 'superadmin' = any(p_roles) and not coalesce(v_actor_superadmin, false) then
    raise exception using errcode = '42501', message = 'Only a superadministrator can assign that role';
  end if;
  select count(*) into v_role_count from public.roles
  where code = any(p_roles) and is_active and deleted_at is null;
  if p_user_id is null or p_roles is null or cardinality(p_roles) = 0
     or v_role_count <> (select count(distinct role_code) from unnest(p_roles) role_code) then
    raise exception using errcode = '22023', message = 'Invalid provisioning data';
  end if;

  insert into public.profiles(id, full_name, email, is_active)
  values (p_user_id, btrim(p_full_name), lower(btrim(p_email)), true)
  on conflict (id) do update set
    full_name = excluded.full_name, email = excluded.email,
    is_active = true, deleted_at = null, updated_at = now();
  delete from public.user_roles where profile_id = p_user_id;
  insert into public.user_roles(profile_id, role_id, assigned_by)
  select p_user_id, r.id, p_actor_user_id from public.roles r
  where r.code = any(p_roles) and r.is_active and r.deleted_at is null;
  return jsonb_build_object('profile_id', p_user_id, 'roles', to_jsonb(p_roles));
end;
$$;

create or replace function public.retry_notification_delivery(p_notification_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  perform public.require_staff(array['superadmin','admin']);
  update public.notification_deliveries
  set status = 'pending', attempt_count = 0, next_attempt_at = now(),
      locked_at = null, locked_by = null, last_error = null, updated_at = now()
  where notification_id = p_notification_id
    and channel = 'whatsapp'
    and status in ('failed','manual_required','cancelled')
    and deleted_at is null;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception using errcode = '22023', message = 'No retryable delivery found';
  end if;
  return jsonb_build_object('notification_id', p_notification_id, 'queued_deliveries', v_count);
end;
$$;

create or replace function public.create_inventory_adjustment(
  p_product_id uuid,
  p_quantity numeric,
  p_movement_type public.inventory_movement_type,
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
  v_product public.products%rowtype;
  v_delta numeric(16,3);
  v_after numeric(16,3);
begin
  perform public.require_staff(array['superadmin','admin','bodega']);
  if p_quantity <= 0 or p_movement_type not in (
    'positive_adjustment','negative_adjustment','damage','loss'
  ) then
    raise exception using errcode = '22023', message = 'Invalid inventory adjustment';
  end if;
  if nullif(btrim(p_notes), '') is null then
    raise exception using errcode = '22023', message = 'Adjustment notes are required';
  end if;
  select * into v_product from public.products
  where id = p_product_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'Product not found'; end if;
  v_delta := case when p_movement_type = 'positive_adjustment' then p_quantity else -p_quantity end;
  v_after := v_product.stock_on_hand + v_delta;
  if not v_product.allow_backorder and v_after < v_product.stock_reserved then
    raise exception using errcode = '23514', message = 'Adjustment would consume reserved inventory';
  end if;
  perform set_config('app.inventory_write', 'transactional_api', true);
  update public.products
  set stock_on_hand = v_after,
      current_cost = case when p_unit_cost is not null and p_movement_type = 'positive_adjustment'
        then p_unit_cost else current_cost end,
      updated_at = now()
  where id = v_product.id;
  insert into public.inventory_movements(
    product_id, movement_type, quantity, unit_cost,
    stock_on_hand_before, stock_on_hand_after, stock_reserved_before, stock_reserved_after,
    performed_by, notes
  ) values (
    v_product.id, p_movement_type, p_quantity, p_unit_cost,
    v_product.stock_on_hand, v_after, v_product.stock_reserved, v_product.stock_reserved,
    auth.uid(), p_notes
  );
  insert into public.audit_logs(actor_user_id, action, entity_name, record_id, old_values, new_values, reason)
  values (
    auth.uid(), 'ADJUST_INVENTORY', 'products', v_product.id,
    jsonb_build_object('stock_on_hand', v_product.stock_on_hand),
    jsonb_build_object('stock_on_hand', v_after, 'movement_type', p_movement_type), p_notes
  );
  return jsonb_build_object('product_id', v_product.id, 'stock_on_hand', v_after, 'stock_reserved', v_product.stock_reserved);
end;
$$;

create or replace function public.admin_reset_customer_pin(p_customer_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.require_staff(array['superadmin','admin']);
  update public.customers
  set pin_hash = null, pin_changed_at = now(), pin_failed_attempts = 0,
      pin_locked_until = null, updated_at = now(), updated_by = auth.uid()
  where id = p_customer_id and deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'Customer not found'; end if;
  insert into public.audit_logs(actor_user_id, action, entity_name, record_id, reason)
  values (auth.uid(), 'RESET_PIN', 'customers', p_customer_id, 'Restablecimiento administrativo; se recomienda OTP de Supabase Auth');
  return jsonb_build_object('customer_id', p_customer_id, 'pin_reset', true);
end;
$$;


create or replace function public.guard_inventory_columns()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if current_setting('app.inventory_write', true) is distinct from 'transactional_api' then
    raise exception using
      errcode = '42501',
      message = 'Stock and cost must be changed through an inventory transaction';
  end if;
  return new;
end;
$$;

drop trigger if exists products_guard_inventory on public.products;
create trigger products_guard_inventory
before update of stock_on_hand, stock_reserved, current_cost, average_cost on public.products
for each row
when (
  old.stock_on_hand is distinct from new.stock_on_hand
  or old.stock_reserved is distinct from new.stock_reserved
  or old.current_cost is distinct from new.current_cost
  or old.average_cost is distinct from new.average_cost
)
execute function public.guard_inventory_columns();

drop trigger if exists product_variants_guard_inventory on public.product_variants;
create trigger product_variants_guard_inventory
before update of stock_on_hand, stock_reserved, current_cost, average_cost on public.product_variants
for each row
when (
  old.stock_on_hand is distinct from new.stock_on_hand
  or old.stock_reserved is distinct from new.stock_reserved
  or old.current_cost is distinct from new.current_cost
  or old.average_cost is distinct from new.average_cost
)
execute function public.guard_inventory_columns();

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
  v_valid boolean := false;
  v_receivable_balance numeric(16,2) := 0;
begin
  perform public.require_staff(array['superadmin','admin','vendedor','bodega']);
  if p_order_id is null or p_new_status is null then
    raise exception using errcode = '22023', message = 'Order and status are required';
  end if;
  select * into v_order from public.orders
  where id = p_order_id and deleted_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Order not found'; end if;
  if p_expected_version is not null and p_expected_version <> v_order.version then
    raise exception using errcode = '40001', message = 'Order was modified by another user';
  end if;
  if p_new_status = v_order.status then return public.order_result_json(v_order.id); end if;

  v_valid := case v_order.status
    when 'new' then p_new_status in ('pending_confirmation','confirmed','cancelled')
    when 'pending_confirmation' then p_new_status in ('confirmed','cancelled')
    when 'confirmed' then p_new_status in ('preparing','cancelled')
    when 'preparing' then p_new_status in ('ready','cancelled')
    when 'ready' then p_new_status in ('dispatched','cancelled')
    when 'dispatched' then p_new_status in ('delivered','cancelled')
    when 'delivered' then p_new_status = 'returned'
    else false
  end;
  if not v_valid then
    raise exception using errcode = '22023', message = 'Invalid order status transition';
  end if;
  if p_new_status in ('cancelled','returned') and nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'A reason is required';
  end if;

  -- Least privilege by workflow stage.
  if public.has_role('vendedor') and not public.has_any_role(array['superadmin','admin','bodega'])
     and p_new_status not in ('pending_confirmation','confirmed','cancelled') then
    raise exception using errcode = '42501', message = 'Seller cannot perform this transition';
  end if;
  if public.has_role('bodega') and not public.has_any_role(array['superadmin','admin'])
     and p_new_status in ('pending_confirmation','confirmed') then
    raise exception using errcode = '42501', message = 'Warehouse cannot perform this transition';
  end if;

  perform set_config('app.inventory_write', 'transactional_api', true);
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
          raise exception using errcode = '23514', message = 'Inventory reservation is inconsistent';
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
          raise exception using errcode = '23514', message = 'Inventory reservation is inconsistent';
        end if;
        update public.products
        set stock_reserved = stock_reserved - v_reservation.quantity, updated_at = now()
        where id = v_product.id;
      end if;
      update public.inventory_reservations
      set status = 'released', released_at = now(), release_reason = p_reason, updated_at = now()
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
        coalesce(p_reason, 'Cancelación de pedido')
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
          raise exception using errcode = '23514', message = 'Inventory reservation is inconsistent';
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
          raise exception using errcode = '23514', message = 'Inventory reservation is inconsistent';
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
        v_order.id, v_reservation.order_item_id, v_reservation.id, v_actor, 'Pedido entregado'
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
    -- Full-order return. A future partial-return module can reuse the same movement contract.
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
      set status = 'cancelled', release_reason = p_reason, updated_at = now()
      where id = v_reservation.id;
      insert into public.inventory_movements(
        product_id, variant_id, movement_type, quantity, unit_cost,
        stock_on_hand_before, stock_on_hand_after, stock_reserved_before, stock_reserved_after,
        order_id, order_item_id, reservation_id, performed_by, notes
      ) values (
        v_reservation.product_id, v_reservation.variant_id, 'customer_return', v_reservation.quantity,
        v_reservation.unit_cost, v_before_stock, v_before_stock + v_reservation.quantity,
        v_before_reserved, v_before_reserved,
        v_order.id, v_reservation.order_item_id, v_reservation.id, v_actor, p_reason
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
    internal_notes = case when nullif(btrim(p_notes), '') is null then internal_notes
      else concat_ws(E'\n', internal_notes, p_notes) end,
    confirmed_at = case when p_new_status = 'confirmed' then now() else confirmed_at end,
    confirmed_by = case when p_new_status = 'confirmed' then v_actor else confirmed_by end,
    preparation_started_at = case when p_new_status = 'preparing' then now() else preparation_started_at end,
    ready_at = case when p_new_status = 'ready' then now() else ready_at end,
    dispatched_at = case when p_new_status = 'dispatched' then now() else dispatched_at end,
    dispatched_by = case when p_new_status = 'dispatched' then v_actor else dispatched_by end,
    delivered_at = case when p_new_status = 'delivered' then now() else delivered_at end,
    delivered_by = case when p_new_status = 'delivered' then v_actor else delivered_by end,
    cancelled_at = case when p_new_status = 'cancelled' then now() else cancelled_at end,
    cancelled_by = case when p_new_status = 'cancelled' then v_actor else cancelled_by end,
    cancellation_reason = case when p_new_status = 'cancelled' then p_reason else cancellation_reason end,
    returned_at = case when p_new_status = 'returned' then now() else returned_at end,
    payment_status = case
      when p_new_status = 'returned' and amount_paid > 0 then 'refunded'::public.order_payment_status
      else payment_status
    end,
    updated_at = now()
  where id = v_order.id;

  insert into public.order_status_history(order_id, previous_status, new_status, changed_by, reason, notes)
  values (v_order.id, v_order.status, p_new_status, v_actor, p_reason, p_notes);
  insert into public.audit_logs(actor_user_id, action, entity_name, record_id, old_values, new_values, reason)
  values (
    v_actor, 'STATUS_CHANGE', 'orders', v_order.id,
    jsonb_build_object('status', v_order.status, 'version', v_order.version),
    jsonb_build_object('status', p_new_status, 'version', v_order.version + 1), p_reason
  );
  return public.order_result_json(v_order.id);
end;
$$;


create or replace function public.check_request_rate_limit(
  p_bucket text,
  p_subject text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_window timestamptz;
  v_count integer;
  v_subject_hash text;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  if p_bucket !~ '^[a-z0-9_:-]{2,80}$'
     or p_subject is null
     or length(p_subject) > 512
     or p_max_requests not between 1 and 10000
     or p_window_seconds not between 1 and 86400 then
    raise exception using errcode = '22023', message = 'Invalid rate-limit parameters';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );
  v_subject_hash := encode(extensions.digest(p_subject, 'sha256'), 'hex');

  insert into public.request_rate_limits(bucket, subject_hash, window_started_at, request_count)
  values (p_bucket, v_subject_hash, v_window, 1)
  on conflict (bucket, subject_hash, window_started_at)
  do update set
    request_count = public.request_rate_limits.request_count + 1,
    updated_at = now()
  returning request_count into v_count;

  -- Bounded opportunistic cleanup; hashed subjects contain no recoverable PII.
  delete from public.request_rate_limits
  where window_started_at < now() - interval '2 days';

  return v_count <= p_max_requests;
end;
$$;

create or replace function public.volume_pricing_enabled()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (
      select case
        when jsonb_typeof(s.value) = 'boolean' then (s.value #>> '{}')::boolean
        else false
      end
      from public.app_settings s
      where s.key = 'volume_pricing_enabled'
        and s.deleted_at is null
      limit 1
    ),
    false
  );
$$;

create or replace function public.resolve_product_price_internal(
  p_customer_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity numeric,
  p_on_date date default current_date
)
returns table (
  unit_price numeric(16,2),
  public_unit_price numeric(16,2),
  price_list_id uuid,
  customer_product_price_id uuid,
  quantity_price_tier_id uuid,
  price_source text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_list_id uuid;
  v_public numeric(16,2);
begin
  if p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'Quantity must be positive';
  end if;

  select coalesce(v.public_price, p.public_price)
    into v_public
  from public.products p
  left join public.product_variants v
    on v.id = p_variant_id
   and v.product_id = p.id
   and v.is_active
   and v.deleted_at is null
  where p.id = p_product_id
    and p.status = 'active'
    and p.deleted_at is null;

  if v_public is null then
    raise exception using errcode = 'P0001', message = 'PRODUCT_NOT_AVAILABLE: Producto no disponible';
  end if;

  select c.price_list_id into v_list_id
  from public.customers c
  where c.id = p_customer_id
    and c.status = 'active'
    and c.deleted_at is null;
  v_list_id := coalesce(v_list_id, public.default_public_price_list_id());

  -- Highest precedence: an explicit agreement for this customer and product.
  return query
  select cpp.unit_price, v_public, v_list_id, cpp.id, null::uuid, 'special'::text
  from public.customer_product_prices cpp
  where cpp.customer_id = p_customer_id
    and cpp.product_id = p_product_id
    and cpp.variant_id is not distinct from p_variant_id
    and cpp.is_active
    and cpp.deleted_at is null
    and cpp.valid_from <= p_on_date
    and (cpp.valid_until is null or cpp.valid_until >= p_on_date)
  order by cpp.valid_from desc, cpp.created_at desc
  limit 1;
  if found then return; end if;

  -- Optional volume tier. The flag is private server configuration.
  if public.volume_pricing_enabled() then
    return query
    select qpt.unit_price, v_public, v_list_id, null::uuid, qpt.id, 'volume'::text
    from public.quantity_price_tiers qpt
    where qpt.price_list_id = v_list_id
      and qpt.product_id = p_product_id
      and qpt.variant_id is not distinct from p_variant_id
      and qpt.minimum_quantity <= p_quantity
      and (qpt.maximum_quantity is null or qpt.maximum_quantity >= p_quantity)
      and qpt.is_active
      and qpt.deleted_at is null
      and qpt.valid_from <= p_on_date
      and (qpt.valid_until is null or qpt.valid_until >= p_on_date)
    order by qpt.minimum_quantity desc, qpt.valid_from desc
    limit 1;
    if found then return; end if;
  end if;

  return query
  select pp.unit_price, v_public, v_list_id, null::uuid, null::uuid, 'list'::text
  from public.product_prices pp
  join public.price_lists pl on pl.id = pp.price_list_id
  where pp.price_list_id = v_list_id
    and pp.product_id = p_product_id
    and pp.variant_id is not distinct from p_variant_id
    and pp.is_active
    and pp.deleted_at is null
    and pp.valid_from <= p_on_date
    and (pp.valid_until is null or pp.valid_until >= p_on_date)
    and pl.is_active
    and pl.deleted_at is null
    and pl.valid_from <= p_on_date
    and (pl.valid_until is null or pl.valid_until >= p_on_date)
  order by pp.valid_from desc, pp.created_at desc
  limit 1;
  if found then return; end if;

  return query select v_public, v_public, v_list_id, null::uuid, null::uuid, 'public'::text;
end;
$$;

create or replace function public.resolve_product_price(
  p_product_id uuid,
  p_quantity numeric default 1,
  p_variant_id uuid default null
)
returns table (
  unit_price numeric(16,2),
  public_unit_price numeric(16,2),
  price_list_id uuid,
  customer_product_price_id uuid,
  quantity_price_tier_id uuid,
  price_source text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  return query
  select * from public.resolve_product_price_internal(
    public.current_customer_id(), p_product_id, p_variant_id, p_quantity, current_date
  );
end;
$$;

create or replace function public.get_catalog_prices()
returns table (
  id uuid,
  sku text,
  slug text,
  name text,
  short_description text,
  category_id uuid,
  category_name text,
  image_url text,
  public_price numeric(16,2),
  effective_price numeric(16,2),
  stock_available numeric(16,3),
  unit text,
  presentation text,
  is_featured boolean,
  allow_backorder boolean,
  price_source text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    p.id,
    p.sku,
    p.slug,
    p.name,
    p.short_description,
    p.category_id,
    coalesce(c.name, 'Chorizos artesanales'),
    p.main_image_url,
    p.public_price,
    rp.unit_price,
    case when p.track_inventory then p.stock_available else 999999::numeric end,
    p.unit,
    p.presentation,
    p.is_featured,
    p.allow_backorder,
    rp.price_source
  from public.products p
  left join public.categories c on c.id = p.category_id and c.deleted_at is null
  cross join lateral public.resolve_product_price_internal(
    public.current_customer_id(), p.id, null, 1, current_date
  ) rp
  where p.status = 'active'
    and p.deleted_at is null
  order by p.sort_order, p.name;
$$;

create or replace function public.get_my_access()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with my_roles as (
    select distinct r.code
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.profile_id
    where ur.profile_id = auth.uid()
      and r.is_active and r.deleted_at is null
      and p.is_active and p.deleted_at is null
      and (ur.expires_at is null or ur.expires_at > now())
  ), permissions(permission) as (
    select distinct unnest(
      case code
        when 'superadmin' then array['*']::text[]
        when 'admin' then array['orders','customers','products','pricing','inventory','purchases','expenses','payments','reports','notifications']::text[]
        when 'vendedor' then array['orders','customers']::text[]
        when 'bodega' then array['orders.logistics','inventory','purchases.receive']::text[]
        when 'contabilidad' then array['payments','expenses','purchases','reports.financial']::text[]
        else array['self']::text[]
      end
    ) from my_roles
  )
  select jsonb_build_object(
    'roles', coalesce((select jsonb_agg(code order by code) from my_roles), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(permission order by permission) from permissions), '[]'::jsonb)
  );
$$;

alter table public.notification_deliveries
  add column if not exists manual_url text;

create or replace function public.url_encode(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
  select string_agg(
    case
      when b between 48 and 57 or b between 65 and 90 or b between 97 and 122 or b in (45,46,95,126)
        then chr(b)
      else '%' || upper(lpad(to_hex(b), 2, '0'))
    end,
    '' order by position
  )
  from (
    select position, get_byte(convert_to(p_value, 'UTF8'), position) as b
    from generate_series(0, octet_length(convert_to(p_value, 'UTF8')) - 1) position
  ) encoded;
$$;

create or replace function public.order_result_json(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'tracking_token', o.tracking_token,
    'subtotal', o.subtotal_amount,
    'discount', o.discount_amount,
    'delivery_fee', o.delivery_amount,
    'total', o.total_amount,
    'status', o.status,
    'payment_status', o.payment_status,
    'manual_whatsapp_url', wd.manual_url,
    'notification_status', coalesce(wd.status::text, 'internal_only')
  )
  from public.orders o
  left join lateral (
    select nd.manual_url, nd.status
    from public.notifications n
    join public.notification_deliveries nd on nd.notification_id = n.id
    where n.order_id = o.id
      and nd.channel = 'whatsapp'
      and nd.deleted_at is null
    order by nd.created_at desc
    limit 1
  ) wd on true
  where o.id = p_order_id and o.deleted_at is null;
$$;

create or replace function public.build_order_admin_message(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select concat_ws(E'\n',
    'Nuevo pedido recibido',
    '',
    'Pedido: ' || o.order_number,
    'Fecha: ' || to_char(o.created_at at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI'),
    'Cliente: ' || o.customer_name,
    'Celular: ' || o.customer_phone,
    'Dirección: ' || o.delivery_address ||
      case when nullif(o.neighborhood, '') is not null then ', ' || o.neighborhood else '' end ||
      case when nullif(o.municipality, '') is not null then ', ' || o.municipality else '' end,
    '',
    lines.summary,
    '',
    'Subtotal: $' || to_char(o.subtotal_amount, 'FM999G999G999G990D00'),
    'Descuento: $' || to_char(o.discount_amount, 'FM999G999G999G990D00'),
    'Domicilio: $' || to_char(o.delivery_amount, 'FM999G999G999G990D00'),
    'Total: $' || to_char(o.total_amount, 'FM999G999G999G990D00'),
    'Forma de pago: ' || o.payment_method_name,
    'Fecha solicitada: ' || coalesce(to_char(o.requested_delivery_date, 'YYYY-MM-DD'), 'Por acordar'),
    case when nullif(o.customer_notes, '') is not null then 'Observaciones: ' || o.customer_notes end,
    case when settings.admin_url is not null then 'Panel: ' || settings.admin_url || '/admin/pedidos/' || o.id end
  )
  from public.orders o
  cross join lateral (
    select string_agg(
      '• ' || oi.product_name || coalesce(' (' || oi.variant_name || ')', '') ||
      ': ' || trim(to_char(oi.quantity, 'FM999999990D999')) ||
      ' × $' || to_char(oi.unit_price, 'FM999G999G999G990D00') ||
      ' = $' || to_char(oi.total_amount, 'FM999G999G999G990D00'),
      E'\n' order by oi.created_at, oi.id
    ) as summary
    from public.order_items oi
    where oi.order_id = o.id and oi.deleted_at is null
  ) lines
  left join lateral (
    select nullif(s.value #>> '{}', '') as admin_url
    from public.app_settings s
    where s.key = 'admin_base_url' and s.deleted_at is null
    limit 1
  ) settings on true
  where o.id = p_order_id and o.deleted_at is null;
$$;

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
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Solicitud inválida';
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
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Celular inválido';
  end if;
  if char_length(v_customer_name) not between 2 and 140 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Nombre inválido';
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
        raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: El celular no coincide con la sesión';
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
    raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: Se requiere autenticación';
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
      raise exception using errcode = 'P0001', message = 'CUSTOMER_AUTH_REQUIRED: Este celular ya está registrado; inicia sesión con OTP';
    end if;
    if v_customer.auth_user_id is not null and v_customer.auth_user_id <> p_auth_user_id then
      raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: El cliente pertenece a otra sesión';
    end if;
  end if;

  if v_customer.id is null then
    v_public_list_id := public.default_public_price_list_id();
    if v_public_list_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: No existe lista pública activa';
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
    raise exception using errcode = 'P0001', message = 'CUSTOMER_NOT_AUTHORIZED: Dirección no autorizada';
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
    raise exception using errcode = 'P0001', message = 'INVALID_DELIVERY_METHOD: Forma de entrega inválida';
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
    raise exception using errcode = 'P0001', message = 'INVALID_PAYMENT_METHOD: Forma de pago inválida';
  end if;

  if nullif(p_payload ->> 'requested_delivery_date', '') is not null then
    v_requested_date := (p_payload ->> 'requested_delivery_date')::date;
    if v_requested_date < (now() at time zone 'America/Bogota')::date then
      raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_IN_PAST: La fecha solicitada ya pasó';
    end if;
  end if;

  if jsonb_typeof(p_payload -> 'items') <> 'array'
     or jsonb_array_length(p_payload -> 'items') < 1
     or jsonb_array_length(p_payload -> 'items') > 100 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: El pedido no contiene productos válidos';
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
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Producto o cantidad inválidos';
    end;
    if v_quantity <= 0 or v_quantity > 9999 or trunc(v_quantity) <> v_quantity then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: Cantidad inválida';
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
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST: El pedido no alcanza el mínimo requerido';
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
    'new', case when v_payment.allows_credit then 'credit' else 'pending' end,
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
        'Reserva automática al crear el pedido'
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
    v_customer_name || ' realizó un pedido por $' || to_char(v_subtotal + v_delivery_fee, 'FM999G999G999G990D00'),
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

create or replace function public.order_tracking_json(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'tracking_token', o.tracking_token,
    'subtotal', o.subtotal_amount,
    'discount', o.discount_amount,
    'delivery_fee', o.delivery_amount,
    'total', o.total_amount,
    'status', o.status,
    'payment_status', o.payment_status,
    'created_at', o.created_at,
    'requested_date', o.requested_delivery_date,
    'customer_name', o.customer_name,
    'items', coalesce(items.value, '[]'::jsonb),
    'history', coalesce(history.value, '[]'::jsonb)
  )
  from public.orders o
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'product_id', oi.product_id,
      'name', oi.product_name,
      'sku', oi.sku,
      'quantity', oi.quantity,
      'unit_price', oi.unit_price,
      'subtotal', oi.total_amount,
      'image_url', oi.image_url
    ) order by oi.created_at, oi.id) as value
    from public.order_items oi
    where oi.order_id = o.id and oi.deleted_at is null
  ) items on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'status', h.new_status,
      'created_at', h.created_at,
      'note', coalesce(h.notes, h.reason)
    ) order by h.created_at, h.id) as value
    from public.order_status_history h
    where h.order_id = o.id
  ) history on true
  where o.id = p_order_id and o.deleted_at is null;
$$;

create or replace function public.get_order_tracking(p_tracking_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order_id uuid;
begin
  select id into v_order_id from public.orders
  where tracking_token = p_tracking_token and deleted_at is null;
  if v_order_id is null then return null; end if;
  return public.order_tracking_json(v_order_id);
end;
$$;

create or replace function public.get_my_orders()
returns setof jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select public.order_tracking_json(o.id)
  from public.orders o
  where o.customer_id = public.current_customer_id()
    and o.deleted_at is null
  order by o.created_at desc
  limit 100;
$$;

create or replace function public.get_public_settings()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'business_name', coalesce(
      (select value #>> '{}' from public.app_settings where key = 'business_name' and is_public and deleted_at is null limit 1),
      'Chorizos Artesanales'
    ),
    'whatsapp_number', (
      select value #>> '{}' from public.app_settings
      where key = 'business_whatsapp' and is_public and deleted_at is null limit 1
    ),
    'currency', 'COP',
    'timezone', 'America/Bogota',
    'minimum_order', coalesce(
      (select (value #>> '{}')::numeric from public.app_settings where key = 'minimum_order' and is_public and deleted_at is null limit 1),
      0
    ),
    'privacy_policy', coalesce(
      (select value #>> '{}' from public.app_settings where key = 'privacy_policy' and is_public and deleted_at is null limit 1),
      ''
    ),
    'terms', coalesce(
      (select value #>> '{}' from public.app_settings where key = 'terms' and is_public and deleted_at is null limit 1),
      ''
    )
  );
$$;

create or replace function public.claim_notification_deliveries(
  p_channel public.notification_channel,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns table (
  delivery_id uuid,
  recipient text,
  template_name text,
  template_language text,
  template_parameters jsonb,
  message_text text,
  attempt_count integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_worker text := gen_random_uuid()::text;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  if p_limit not between 1 and 50 or p_lease_seconds not between 30 and 900 then
    raise exception using errcode = '22023', message = 'Invalid outbox claim parameters';
  end if;

  update public.notification_deliveries nd
  set status = 'retrying', locked_at = null, locked_by = null, next_attempt_at = now(),
      last_error = coalesce(last_error, 'Worker lease expired'), updated_at = now()
  where nd.channel = p_channel
    and nd.status = 'processing'
    and nd.locked_at < now() - make_interval(secs => p_lease_seconds)
    and nd.attempt_count < nd.max_attempts
    and nd.deleted_at is null;

  return query
  with candidates as (
    select nd.id
    from public.notification_deliveries nd
    where nd.channel = p_channel
      and nd.status in ('pending','retrying')
      and nd.next_attempt_at <= now()
      and nd.attempt_count < nd.max_attempts
      and nd.deleted_at is null
    order by nd.next_attempt_at, nd.created_at
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.notification_deliveries nd
    set status = 'processing', attempt_count = nd.attempt_count + 1,
        last_attempt_at = now(), locked_at = now(), locked_by = v_worker, updated_at = now()
    from candidates c
    where nd.id = c.id
    returning nd.*
  )
  select c.id, c.recipient, c.template_name, c.template_language,
         c.template_parameters, c.message_text, c.attempt_count
  from claimed c
  order by c.created_at;
end;
$$;

create or replace function public.complete_notification_delivery(
  p_delivery_id uuid,
  p_succeeded boolean,
  p_external_id text default null,
  p_provider_response jsonb default '{}'::jsonb,
  p_error text default null,
  p_retryable boolean default false
)
returns public.notification_status
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_delivery public.notification_deliveries%rowtype;
  v_status public.notification_status;
  v_delay integer;
begin
  if not public.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  select * into v_delivery from public.notification_deliveries
  where id = p_delivery_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'Delivery not found'; end if;
  if v_delivery.status <> 'processing' then
    raise exception using errcode = '55000', message = 'Delivery is not leased by a worker';
  end if;

  if p_succeeded then
    v_status := 'sent';
  elsif p_retryable and v_delivery.attempt_count < v_delivery.max_attempts then
    v_status := 'retrying';
  elsif v_delivery.manual_url is not null then
    v_status := 'manual_required';
  else
    v_status := 'failed';
  end if;
  v_delay := least(3600, (30 * power(2, greatest(v_delivery.attempt_count - 1, 0)))::integer);

  update public.notification_deliveries
  set status = v_status,
      external_id = coalesce(nullif(p_external_id, ''), external_id),
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      last_error = case when p_succeeded then null else left(coalesce(p_error, 'Unknown provider error'), 1000) end,
      next_attempt_at = case when v_status = 'retrying' then now() + make_interval(secs => v_delay) else next_attempt_at end,
      sent_at = case when p_succeeded then now() else sent_at end,
      locked_at = null, locked_by = null, updated_at = now()
  where id = p_delivery_id;
  return v_status;
end;
$$;

-- Compatibility overload for admin clients that submit a method code/name.
create or replace function public.register_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_method_id uuid;
begin
  select id into v_method_id from public.payment_methods
  where (code = lower(p_method) or lower(name) = lower(p_method))
    and is_active and deleted_at is null
  order by code limit 1;
  if v_method_id is null then raise exception using errcode = '22023', message = 'Payment method is not active'; end if;
  return public.register_payment(
    p_order_id, p_amount, v_method_id, p_reference, null, p_notes,
    'approved'::public.payment_record_status, null, gen_random_uuid()
  );
end;
$$;

-- Lock down all function entry points. Nested calls execute as their owning definer.
revoke all on function public.is_service_role() from public;
revoke all on function public.require_staff(text[]) from public;
revoke all on function public.check_request_rate_limit(text,text,integer,integer) from public;
revoke all on function public.volume_pricing_enabled() from public;
revoke all on function public.resolve_product_price_internal(uuid,uuid,uuid,numeric,date) from public;
revoke all on function public.resolve_product_price(uuid,numeric,uuid) from public;
revoke all on function public.get_catalog_prices() from public;
revoke all on function public.get_my_access() from public;
revoke all on function public.url_encode(text) from public;
revoke all on function public.order_result_json(uuid) from public;
revoke all on function public.build_order_admin_message(uuid) from public;
revoke all on function public.create_order(jsonb,uuid,uuid,jsonb) from public;
revoke all on function public.guard_inventory_columns() from public;
revoke all on function public.transition_order_status(uuid,public.order_status,text,text,integer) from public;
revoke all on function public.receive_purchase(uuid,jsonb,text) from public;
revoke all on function public.register_payment(uuid,numeric,uuid,text,text,text,public.payment_record_status,uuid,uuid) from public;
revoke all on function public.register_payment(uuid,numeric,text,text,text) from public;
revoke all on function public.create_inventory_adjustment(uuid,numeric,public.inventory_movement_type,numeric,text) from public;
revoke all on function public.admin_reset_customer_pin(uuid) from public;
revoke all on function public.order_tracking_json(uuid) from public;
revoke all on function public.get_order_tracking(uuid) from public;
revoke all on function public.get_my_orders() from public;
revoke all on function public.get_public_settings() from public;
revoke all on function public.claim_notification_deliveries(public.notification_channel,integer,integer) from public;
revoke all on function public.complete_notification_delivery(uuid,boolean,text,jsonb,text,boolean) from public;
revoke all on function public.set_user_roles(uuid,text[]) from public;
revoke all on function public.provision_staff_roles(uuid,uuid,text,text,text[]) from public;
revoke all on function public.retry_notification_delivery(uuid) from public;

grant execute on function public.get_catalog_prices(), public.get_public_settings(),
  public.get_order_tracking(uuid) to anon, authenticated;
grant execute on function public.get_my_access(), public.get_my_orders(),
  public.resolve_product_price(uuid,numeric,uuid),
  public.transition_order_status(uuid,public.order_status,text,text,integer),
  public.receive_purchase(uuid,jsonb,text),
  public.register_payment(uuid,numeric,uuid,text,text,text,public.payment_record_status,uuid,uuid),
  public.register_payment(uuid,numeric,text,text,text),
  public.create_inventory_adjustment(uuid,numeric,public.inventory_movement_type,numeric,text),
  public.admin_reset_customer_pin(uuid), public.set_user_roles(uuid,text[]),
  public.retry_notification_delivery(uuid)
  to authenticated;
grant execute on function public.check_request_rate_limit(text,text,integer,integer),
  public.create_order(jsonb,uuid,uuid,jsonb),
  public.claim_notification_deliveries(public.notification_channel,integer,integer),
  public.complete_notification_delivery(uuid,boolean,text,jsonb,text,boolean),
  public.provision_staff_roles(uuid,uuid,text,text,text[])
  to service_role;

commit;
