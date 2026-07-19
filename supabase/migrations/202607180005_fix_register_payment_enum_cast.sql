-- Migración 202607180005: Corrección de tipo en register_payment.
-- Problema: el CASE que actualiza orders.payment_status devolvía tipo text
-- (literales sin cast), pero la columna es de tipo public.order_payment_status.
-- PostgreSQL rechaza la asignación con:
--   "column payment_status is of type order_payment_status but expression is of type text"
-- Causa raíz: migration 202607170002 usó literales sin cast en el CASE del UPDATE.
-- Solución: reemplazar register_payment(uuid overload) con las mismas ramas pero
-- con ::public.order_payment_status en cada literal del CASE.
-- No se modifican datos existentes ni otras funciones.
begin;

set search_path = public, pg_temp;

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

  -- FIX: cast explícito a ::public.order_payment_status en cada rama del CASE
  -- para que PostgreSQL no infiera el tipo del CASE como text.
  update public.orders
  set amount_paid = v_approved_total,
      payment_status = case
        when v_approved_total >= total_amount then 'paid'::public.order_payment_status
        when v_approved_total > 0             then 'partial'::public.order_payment_status
        when payment_status = 'credit'::public.order_payment_status
                                              then 'credit'::public.order_payment_status
        else                                       'pending'::public.order_payment_status
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
    'payment_status', case
      when v_approved_total >= v_order.total_amount then 'paid'
      when v_approved_total > 0 then 'partial'
      else v_order.payment_status::text
    end
  );
end;
$$;

-- Mantener exactamente los mismos permisos que en 202607170002.
revoke all on function public.register_payment(uuid,numeric,uuid,text,text,text,public.payment_record_status,uuid,uuid) from public;
grant execute on function public.register_payment(uuid,numeric,uuid,text,text,text,public.payment_record_status,uuid,uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
