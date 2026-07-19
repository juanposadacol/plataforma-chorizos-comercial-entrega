-- Fixes two pre-production audit blockers (AUDITORIA_PREPRODUCCION_NETLIFY.md):
--
-- H-05 (idempotencia de pagos): register_payment's early idempotency check only
-- looked up the payment by idempotency_key and returned success — it never
-- verified the cached payment actually belonged to the SAME order/amount/method
-- the caller is asking for. Reusing a key for a different order silently
-- returned a nonsensical mix (payment_id from the old payment, amount_paid
-- computed for the new order) instead of failing. The function also had no
-- `exception when unique_violation` handler (unlike create_order), so a genuine
-- race between two concurrent calls with the same key could surface a raw
-- Postgres constraint error to the user instead of the existing payment.
--
-- H-13 (roles en deliver_and_pay_order): deliver_and_pay_order accepts
-- superadmin/admin/vendedor/contabilidad, but when the order isn't delivered
-- yet it delegates to transition_order_status, whose fine-grained rules only
-- let superadmin/admin (and bodega, adjacently) actually move a status to
-- 'delivered' — a role check further down transition_order_status explicitly
-- blocks vendedor from reaching any status past 'confirmed' unless it also
-- holds the bodega role (confirmed by a ROLLBACK-wrapped live test against
-- the linked project: a pure-vendedor session got
-- "El vendedor no puede realizar esta transición" trying to reach 'delivered').
-- So BOTH contabilidad and plain vendedor hit an opaque 42501 from the nested
-- call when "Entregar y pagar" is used on an undelivered order. Fixed with an
-- explicit, function-local role check before attempting the delivery step —
-- only superadmin/admin may trigger it through this combined action — with a
-- clear message. transition_order_status's own role rules are intentionally
-- left untouched (principle of least privilege: neither contabilidad nor
-- vendedor gain any new capability to change order status/inventory; both may
-- still use this same function to pay an order someone else already
-- delivered).
--
-- Both fixes are pure CREATE OR REPLACE FUNCTION — no data is touched, no
-- table/column changes, no grants change (GRANT persists across CREATE OR
-- REPLACE FUNCTION for an unchanged signature). Idempotent: re-applying this
-- migration is a no-op beyond redefining the same function bodies.
begin;
set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- H-05: register_payment — validate idempotency-key reuse and handle races.
-- ---------------------------------------------------------------------------
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
  v_existing public.payments%rowtype;
begin
  perform public.require_staff(array['superadmin','admin','vendedor','contabilidad']);
  if p_amount <= 0 or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Amount and idempotency key are required';
  end if;

  select * into v_existing from public.payments where idempotency_key = p_idempotency_key;
  if found then
    -- H-05: a replayed key must describe the exact same operation. A different
    -- order, amount, or method means the client reused a key it should not
    -- have — fail loudly instead of silently returning an unrelated result.
    if v_existing.order_id is distinct from p_order_id then
      raise exception using errcode = '22023',
        message = 'IDEMPOTENCY_KEY_REUSED: Esta llave de idempotencia ya se usó para otro pedido';
    end if;
    if round(v_existing.amount, 2) is distinct from round(p_amount, 2)
       or v_existing.payment_method_id is distinct from p_payment_method_id then
      raise exception using errcode = '22023',
        message = 'IDEMPOTENCY_KEY_REUSED: Esta llave de idempotencia ya se usó con un monto o método distinto';
    end if;
    select coalesce(sum(amount) filter (where status = 'approved' and deleted_at is null), 0)
      into v_approved_total from public.payments where order_id = v_existing.order_id;
    return jsonb_build_object(
      'payment_id', v_existing.id, 'order_id', v_existing.order_id,
      'amount_paid', v_approved_total,
      'balance', (select o.total_amount from public.orders o where o.id = v_existing.order_id) - v_approved_total,
      'idempotent_replay', true
    );
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
exception
  -- H-05: a genuine race between two concurrent calls carrying the same
  -- idempotency_key both passing the initial "not found" lookup before either
  -- commits is possible under READ COMMITTED. Catch it the same way
  -- create_order already does, instead of surfacing a raw constraint error.
  when unique_violation then
    select * into v_existing from public.payments where idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      select coalesce(sum(amount) filter (where status = 'approved' and deleted_at is null), 0)
        into v_approved_total from public.payments where order_id = v_existing.order_id;
      return jsonb_build_object(
        'payment_id', v_existing.id, 'order_id', v_existing.order_id,
        'amount_paid', v_approved_total,
        'balance', (select o.total_amount from public.orders o where o.id = v_existing.order_id) - v_approved_total,
        'idempotent_replay', true
      );
    end if;
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- H-13: deliver_and_pay_order — contabilidad may pay, but may not deliver.
-- ---------------------------------------------------------------------------
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
    -- H-13: mínimo privilegio — contabilidad y vendedor pueden pagar cualquier
    -- pedido a través de esta función, pero ninguno de los dos puede disparar
    -- el paso de entrega: transition_order_status ya bloquea a vendedor de
    -- avanzar más allá de 'confirmed' (a menos que también tenga el rol
    -- bodega), y nunca aceptó contabilidad. Solo superadmin/admin pueden
    -- hacerlo aquí — transition_order_status conserva su propia lista de
    -- roles sin cambios; no se le concede a contabilidad ni a vendedor
    -- ninguna capacidad operativa nueva.
    if not public.has_any_role(array['superadmin','admin']) then
      raise exception using errcode = '42501',
        message = 'ROLE_CANNOT_DELIVER: Tu rol solo puede registrar pagos de pedidos ya entregados';
    end if;
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

commit;
