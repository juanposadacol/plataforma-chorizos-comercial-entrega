/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Plus, Save } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AdminOrder, Payment } from '../../features/admin/types';
import { invokeAdminRpc } from '../../features/admin/adminService';
import { useAdminData } from '../../features/admin/useAdminData';
import {
  firstText,
  formatAdminDate,
  formatMoney,
  matchesSearch,
  toNumber,
} from '../../features/admin/utils';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  ExportCsvButton,
  inputClass,
  labelClass,
  LoadingState,
  Modal,
  PageHeader,
  panelClass,
  SearchField,
  StatusBadge,
  type TableColumn,
} from '../../features/admin/components/AdminUi';

interface Receivable extends Record<string, unknown> {
  id: string;
  customer_id?: string;
  order_id?: string;
  original_amount: number;
  paid_amount?: number;
  balance: number;
  due_date?: string | null;
  days_overdue?: number;
  status: string;
}
type PaymentTab = 'payments' | 'receivables';

export function PaymentsPage() {
  const [params] = useSearchParams();
  const paymentsState = useAdminData<Payment>(
    'payments',
    { orderBy: 'created_at', limit: 1500 },
    true,
  );
  const ordersState = useAdminData<AdminOrder>(
    'orders',
    { orderBy: 'created_at', limit: 1000 },
    true,
  );
  const receivablesState = useAdminData<Receivable>(
    'accounts_receivable',
    { orderBy: 'due_date', ascending: true, limit: 1000 },
    true,
  );
  const [tab, setTab] = useState<PaymentTab>('payments');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    order_id: '',
    amount: '',
    method: 'transfer',
    reference: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const orderId = params.get('pedido');
    if (orderId) {
      setForm((current) => ({ ...current, order_id: orderId }));
      setModalOpen(true);
    }
  }, [params]);

  const orderById = useMemo(
    () => new Map(ordersState.data.map((order) => [order.id, order])),
    [ordersState.data],
  );
  const filteredPayments = useMemo(
    () =>
      paymentsState.data.filter(
        (payment) =>
          matchesSearch(payment, search) ||
          matchesSearch(orderById.get(payment.order_id ?? '') ?? { id: '' }, search),
      ),
    [orderById, paymentsState.data, search],
  );
  const filteredReceivables = useMemo(
    () =>
      receivablesState.data.filter(
        (item) =>
          matchesSearch(item, search) ||
          matchesSearch(orderById.get(item.order_id ?? '') ?? { id: '' }, search),
      ),
    [orderById, receivablesState.data, search],
  );
  const selectedOrder = orderById.get(form.order_id);
  const orderPayments = paymentsState.data
    .filter(
      (payment) =>
        payment.order_id === form.order_id && !['rejected', 'refunded'].includes(payment.status),
    )
    .reduce((sum, payment) => sum + toNumber(payment.amount), 0);
  const orderBalance = Math.max(0, toNumber(selectedOrder?.total) - orderPayments);
  const totalCollected = paymentsState.data
    .filter((payment) => !['rejected', 'refunded'].includes(payment.status))
    .reduce((sum, payment) => sum + toNumber(payment.amount), 0);
  const totalReceivable = receivablesState.data.reduce(
    (sum, item) => sum + toNumber(item.balance),
    0,
  );
  const overdue = receivablesState.data
    .filter((item) => item.status === 'overdue' || toNumber(item.days_overdue) > 0)
    .reduce((sum, item) => sum + toNumber(item.balance), 0);

  const openCreate = () => {
    setForm({ order_id: '', amount: '', method: 'transfer', reference: '', notes: '' });
    setError(null);
    setModalOpen(true);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await invokeAdminRpc('register_payment', {
        p_order_id: form.order_id,
        p_amount: Number(form.amount),
        p_method: form.method,
        p_reference: form.reference || null,
        p_notes: form.notes || null,
      });
      setModalOpen(false);
      setSuccess('Pago registrado y saldo actualizado.');
      window.setTimeout(() => setSuccess(null), 4000);
      await Promise.all([paymentsState.reload(), ordersState.reload(), receivablesState.reload()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible registrar el pago.');
    } finally {
      setSaving(false);
    }
  };

  const paymentColumns: TableColumn<Payment>[] = [
    {
      key: 'date',
      header: 'Fecha',
      render: (payment) =>
        formatAdminDate(payment.paid_at ?? payment.payment_date ?? payment.created_at, true),
    },
    {
      key: 'order',
      header: 'Pedido',
      render: (payment) => {
        const order = orderById.get(payment.order_id ?? '');
        return order ? (
          <Link className="font-bold text-wine hover:underline" to={`/admin/pedidos/${order.id}`}>
            #{firstText(order, 'order_number', 'consecutive')}
          </Link>
        ) : (
          '—'
        );
      },
    },
    {
      key: 'customer',
      header: 'Cliente',
      render: (payment) => {
        const order = orderById.get(payment.order_id ?? '');
        return order
          ? firstText(order, 'customer_name_snapshot', 'customer_name')
          : payment.customer_id?.slice(0, 8) || '—';
      },
    },
    {
      key: 'method',
      header: 'Método',
      render: (payment) => (
        <span className="capitalize">
          {firstText(payment, 'method', 'payment_method').replaceAll('_', ' ') || '—'}
        </span>
      ),
    },
    { key: 'reference', header: 'Referencia', render: (payment) => payment.reference || '—' },
    {
      key: 'amount',
      header: 'Valor',
      render: (payment) => (
        <span className="font-black text-emerald-700">{formatMoney(payment.amount)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (payment) => <StatusBadge status={payment.status} />,
    },
  ];
  const receivableColumns: TableColumn<Receivable>[] = [
    {
      key: 'order',
      header: 'Pedido',
      render: (item) => {
        const order = orderById.get(item.order_id ?? '');
        return order ? (
          <Link className="font-bold text-wine hover:underline" to={`/admin/pedidos/${order.id}`}>
            #{firstText(order, 'order_number', 'consecutive')}
          </Link>
        ) : (
          item.order_id?.slice(0, 8) || '—'
        );
      },
    },
    {
      key: 'customer',
      header: 'Cliente',
      render: (item) => {
        const order = orderById.get(item.order_id ?? '');
        return order
          ? firstText(order, 'customer_name_snapshot', 'customer_name')
          : item.customer_id?.slice(0, 8) || '—';
      },
    },
    {
      key: 'original',
      header: 'Valor original',
      render: (item) => formatMoney(item.original_amount),
    },
    { key: 'paid', header: 'Pagado', render: (item) => formatMoney(item.paid_amount) },
    {
      key: 'balance',
      header: 'Saldo',
      render: (item) => <span className="font-black text-wine">{formatMoney(item.balance)}</span>,
    },
    {
      key: 'due',
      header: 'Vencimiento',
      render: (item) => (
        <div>
          <p>{formatAdminDate(item.due_date)}</p>
          {toNumber(item.days_overdue) > 0 && (
            <p className="text-xs font-bold text-red-700">{item.days_overdue} días de mora</p>
          )}
        </div>
      ),
    },
    { key: 'status', header: 'Estado', render: (item) => <StatusBadge status={item.status} /> },
  ];

  const activeRows = tab === 'payments' ? filteredPayments : filteredReceivables;
  return (
    <>
      <PageHeader
        eyebrow="Tesorería"
        title="Pagos y cartera"
        description="Registra abonos, concilia recaudos y controla saldos por cobrar sin confundir flujo de caja con utilidad."
        actions={
          <>
            <ExportCsvButton
              filename={tab === 'payments' ? 'pagos' : 'cuentas-por-cobrar'}
              rows={activeRows}
            />
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Registrar pago
            </Button>
          </>
        }
      />
      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {success}
        </div>
      )}
      {error && !modalOpen && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <section className="grid gap-3 sm:grid-cols-3">
        <article className={`${panelClass} p-5`}>
          <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
            Total recaudado
          </p>
          <p className="mt-2 font-display text-2xl font-bold text-emerald-700">
            {formatMoney(totalCollected)}
          </p>
        </article>
        <article className={`${panelClass} p-5`}>
          <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
            Cuentas por cobrar
          </p>
          <p className="mt-2 font-display text-2xl font-bold">{formatMoney(totalReceivable)}</p>
        </article>
        <article className={`${panelClass} p-5`}>
          <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
            Cartera vencida
          </p>
          <p className="mt-2 font-display text-2xl font-bold text-red-700">
            {formatMoney(overdue)}
          </p>
        </article>
      </section>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex rounded-xl border border-artisan-line bg-white p-1">
          <button
            type="button"
            className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === 'payments' ? 'bg-wine text-white' : 'text-artisan-muted hover:bg-artisan-paper'}`}
            onClick={() => setTab('payments')}
          >
            Pagos
          </button>
          <button
            type="button"
            className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === 'receivables' ? 'bg-wine text-white' : 'text-artisan-muted hover:bg-artisan-paper'}`}
            onClick={() => setTab('receivables')}
          >
            Cuentas por cobrar
          </button>
        </div>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Buscar pedido, cliente, método o referencia…"
        />
      </div>
      <section className={`${panelClass} overflow-hidden`}>
        {paymentsState.loading || ordersState.loading || receivablesState.loading ? (
          <LoadingState />
        ) : paymentsState.error || ordersState.error || receivablesState.error ? (
          <ErrorState
            message={paymentsState.error || ordersState.error || receivablesState.error || ''}
            onRetry={() =>
              void Promise.all([
                paymentsState.reload(),
                ordersState.reload(),
                receivablesState.reload(),
              ])
            }
          />
        ) : activeRows.length ? (
          tab === 'payments' ? (
            <DataTable
              rows={filteredPayments}
              columns={paymentColumns}
              getRowKey={(payment) => payment.id}
            />
          ) : (
            <DataTable
              rows={filteredReceivables}
              columns={receivableColumns}
              getRowKey={(item) => item.id}
            />
          )
        ) : (
          <EmptyState
            title={tab === 'payments' ? 'Sin pagos registrados' : 'Sin cuentas por cobrar'}
            description={
              tab === 'payments'
                ? 'Los pagos completos y parciales aparecerán aquí.'
                : 'No hay cartera pendiente con los filtros actuales.'
            }
          />
        )}
      </section>
      <Modal
        open={modalOpen}
        title="Registrar pago"
        description="El servidor actualiza el estado del pedido y la cuenta por cobrar de forma consistente."
        onClose={() => !saving && setModalOpen(false)}
      >
        <form onSubmit={submit} className="space-y-4">
          <label>
            <span className={labelClass}>Pedido *</span>
            <select
              required
              className={inputClass}
              value={form.order_id}
              onChange={(event) =>
                setForm((current) => ({ ...current, order_id: event.target.value }))
              }
            >
              <option value="">Selecciona un pedido</option>
              {ordersState.data
                .filter((order) => !['cancelled', 'returned'].includes(order.status))
                .map((order) => (
                  <option key={order.id} value={order.id}>
                    #{firstText(order, 'order_number', 'consecutive')} ·{' '}
                    {firstText(order, 'customer_name_snapshot', 'customer_name')} ·{' '}
                    {formatMoney(order.total)}
                  </option>
                ))}
            </select>
          </label>
          {selectedOrder && (
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-artisan-paper p-4 text-sm">
              <div>
                <p className="text-xs font-bold uppercase text-artisan-muted">Total</p>
                <p className="mt-1 font-black">{formatMoney(selectedOrder.total)}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-artisan-muted">Saldo</p>
                <p className="mt-1 font-black text-wine">{formatMoney(orderBalance)}</p>
              </div>
            </div>
          )}
          <label>
            <span className={labelClass}>Valor del pago *</span>
            <input
              required
              type="number"
              min="1"
              max={orderBalance || undefined}
              step="100"
              className={inputClass}
              value={form.amount}
              onChange={(event) =>
                setForm((current) => ({ ...current, amount: event.target.value }))
              }
            />
          </label>
          <label>
            <span className={labelClass}>Método *</span>
            <select
              required
              className={inputClass}
              value={form.method}
              onChange={(event) =>
                setForm((current) => ({ ...current, method: event.target.value }))
              }
            >
              <option value="cash">Efectivo</option>
              <option value="transfer">Transferencia</option>
              <option value="card">Tarjeta</option>
              <option value="cash_on_delivery">Contraentrega</option>
              <option value="credit">Crédito</option>
              <option value="other">Otro</option>
            </select>
          </label>
          <label>
            <span className={labelClass}>Referencia</span>
            <input
              className={inputClass}
              value={form.reference}
              onChange={(event) =>
                setForm((current) => ({ ...current, reference: event.target.value }))
              }
              placeholder="Número de transacción o comprobante"
            />
          </label>
          <label>
            <span className={labelClass}>Observación</span>
            <textarea
              className={`${inputClass} min-h-20`}
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </label>
          {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          <div className="flex justify-end gap-2 border-t border-artisan-line pt-4">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !selectedOrder}>
              <Save className="h-4 w-4" />
              {saving ? 'Registrando…' : 'Registrar pago'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
export default PaymentsPage;
