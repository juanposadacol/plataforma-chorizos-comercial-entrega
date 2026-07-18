/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, MapPin, Phone, Printer, Save, UserRound } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchRecord,
  fetchRecords,
  invokeAdminRpc,
  updateRecord,
} from '../../features/admin/adminService';
import type { AdminOrder, AdminOrderItem, Payment } from '../../features/admin/types';
import {
  firstText,
  formatAdminDate,
  formatMoney,
  orderStatusLabels,
  orderStatuses,
  paymentStatusLabels,
  toNumber,
} from '../../features/admin/utils';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  inputClass,
  labelClass,
  LoadingState,
  PageHeader,
  panelClass,
  SectionTitle,
  StatusBadge,
  type TableColumn,
} from '../../features/admin/components/AdminUi';

interface StatusHistory extends Record<string, unknown> {
  id: string;
  status: string;
  notes?: string | null;
  created_at: string;
}

export function OrderDetailPage() {
  const { id } = useParams();
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [items, setItems] = useState<AdminOrderItem[]>([]);
  const [history, setHistory] = useState<StatusHistory[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState('');
  const [transitionNote, setTransitionNote] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [orderData, itemData, historyData, paymentData] = await Promise.all([
        fetchRecord<AdminOrder>('orders', id),
        fetchRecords<AdminOrderItem>('order_items', {
          eq: { order_id: id },
          orderBy: 'created_at',
          ascending: true,
        }),
        fetchRecords<StatusHistory>('order_status_history', {
          eq: { order_id: id },
          orderBy: 'created_at',
          ascending: true,
        }),
        fetchRecords<Payment>('payments', {
          eq: { order_id: id },
          orderBy: 'created_at',
          ascending: false,
        }),
      ]);
      setOrder(orderData);
      setItems(itemData);
      setHistory(historyData);
      setPayments(paymentData);
      setNextStatus(orderData?.status ?? '');
      setInternalNotes(orderData?.internal_notes ?? '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el pedido.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const paid = useMemo(
    () =>
      payments
        .filter((payment) => !['rejected', 'refunded'].includes(payment.status))
        .reduce((sum, payment) => sum + toNumber(payment.amount), 0),
    [payments],
  );

  const transition = async () => {
    if (!order || !nextStatus || nextStatus === order.status) return;
    if (['cancelled', 'returned'].includes(nextStatus) && !transitionNote.trim()) {
      setError('Escribe el motivo para cancelar o devolver un pedido.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await invokeAdminRpc('transition_order_status', {
        p_order_id: order.id,
        p_new_status: nextStatus,
        p_notes: transitionNote || null,
      });
      setTransitionNote('');
      setSuccess('Estado actualizado y registrado en el historial.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cambiar el estado.');
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async () => {
    if (!order) return;
    setSaving(true);
    setError(null);
    try {
      await updateRecord('orders', order.id, { internal_notes: internalNotes || null });
      setSuccess('Nota interna guardada.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar la nota.');
    } finally {
      setSaving(false);
    }
  };

  const itemColumns: TableColumn<AdminOrderItem>[] = [
    {
      key: 'product',
      header: 'Producto',
      render: (item) => (
        <div>
          <p className="font-bold">{firstText(item, 'product_name', 'name') || 'Producto'}</p>
          <p className="text-xs text-artisan-muted">{firstText(item, 'sku')}</p>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      render: (item) => <span className="font-semibold">{toNumber(item.quantity)}</span>,
    },
    { key: 'price', header: 'Precio unitario', render: (item) => formatMoney(item.unit_price) },
    {
      key: 'subtotal',
      header: 'Subtotal',
      render: (item) => <span className="font-black">{formatMoney(item.subtotal)}</span>,
    },
    {
      key: 'profit',
      header: 'Utilidad',
      render: (item) =>
        formatMoney(item.gross_profit ?? toNumber(item.subtotal) - toNumber(item.total_cost)),
    },
  ];

  if (loading)
    return (
      <div className={panelClass}>
        <LoadingState label="Cargando detalle del pedido…" />
      </div>
    );
  if (error && !order)
    return (
      <div className={panelClass}>
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  if (!order)
    return (
      <div className={panelClass}>
        <EmptyState
          title="Pedido no encontrado"
          description="El pedido no existe o no tienes permiso para consultarlo."
          action={
            <Link to="/admin/pedidos" className="font-bold text-wine hover:underline">
              Volver a pedidos
            </Link>
          }
        />
      </div>
    );

  return (
    <>
      <Link
        to="/admin/pedidos"
        className="inline-flex items-center gap-2 text-sm font-bold text-artisan-muted hover:text-wine print:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        Todos los pedidos
      </Link>
      <PageHeader
        eyebrow={`Pedido #${firstText(order, 'order_number', 'consecutive') || order.id.slice(0, 8)}`}
        title={firstText(order, 'customer_name_snapshot', 'customer_name') || 'Cliente sin nombre'}
        description={`Creado ${formatAdminDate(order.created_at, true)} · Entrega ${formatAdminDate(order.requested_delivery_date ?? order.requested_date)}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Imprimir / PDF
            </Button>
            <Link
              to={`/admin/pagos?pedido=${order.id}`}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-wine px-4 py-2 text-sm font-bold text-white hover:bg-wine-dark"
            >
              Registrar pago
            </Link>
          </>
        }
      />
      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {success}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <article className={`${panelClass} overflow-hidden`}>
            <SectionTitle
              title="Productos"
              description={`${items.length} referencias en este pedido`}
            />
            {items.length ? (
              <DataTable rows={items} columns={itemColumns} getRowKey={(item) => item.id} />
            ) : (
              <EmptyState
                title="Sin productos"
                description="Este pedido no tiene detalles disponibles."
              />
            )}
          </article>
          <article className={`${panelClass} overflow-hidden`}>
            <SectionTitle title="Datos de entrega" />
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <div className="flex gap-3">
                <UserRound className="mt-0.5 h-5 w-5 text-wine" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
                    Cliente
                  </p>
                  <p className="mt-1 font-semibold">
                    {firstText(order, 'customer_name_snapshot', 'customer_name')}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Phone className="mt-0.5 h-5 w-5 text-wine" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
                    Celular
                  </p>
                  <p className="mt-1 font-semibold">
                    {firstText(order, 'customer_phone_snapshot', 'customer_phone') || '—'}
                  </p>
                </div>
              </div>
              <div className="flex gap-3 sm:col-span-2">
                <MapPin className="mt-0.5 h-5 w-5 text-wine" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
                    Dirección
                  </p>
                  <p className="mt-1 font-semibold">
                    {firstText(order, 'delivery_address', 'address') || '—'}
                  </p>
                  <p className="text-sm text-artisan-muted">
                    {[order.neighborhood, order.municipality].filter(Boolean).join(', ')}
                  </p>
                </div>
              </div>
              {order.customer_notes && (
                <div className="rounded-xl bg-artisan-paper p-4 sm:col-span-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
                    Observaciones del cliente
                  </p>
                  <p className="mt-2 text-sm leading-6">{order.customer_notes}</p>
                </div>
              )}
            </div>
          </article>
        </div>
        <div className="space-y-4">
          <article className={`${panelClass} overflow-hidden`}>
            <SectionTitle title="Resumen financiero" />
            <dl className="space-y-3 p-5 text-sm">
              <div className="flex justify-between">
                <dt className="text-artisan-muted">Subtotal</dt>
                <dd className="font-semibold">{formatMoney(order.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-artisan-muted">Descuento</dt>
                <dd className="font-semibold">
                  − {formatMoney(order.discount_amount ?? order.discount)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-artisan-muted">Domicilio</dt>
                <dd className="font-semibold">{formatMoney(order.delivery_fee)}</dd>
              </div>
              <div className="flex justify-between border-t border-artisan-line pt-3 text-lg">
                <dt className="font-black">Total</dt>
                <dd className="font-black text-wine">{formatMoney(order.total)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-artisan-muted">Pagado</dt>
                <dd className="font-semibold text-emerald-700">{formatMoney(paid)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-artisan-muted">Saldo</dt>
                <dd className="font-black">
                  {formatMoney(Math.max(0, toNumber(order.total) - paid))}
                </dd>
              </div>
              <div className="flex justify-between pt-2">
                <dt className="text-artisan-muted">Estado del pago</dt>
                <dd>
                  <StatusBadge
                    status={order.payment_status}
                    label={paymentStatusLabels[order.payment_status]}
                  />
                </dd>
              </div>
            </dl>
          </article>
          <article className={`${panelClass} overflow-hidden print:hidden`}>
            <SectionTitle
              title="Cambiar estado"
              description="La transición queda auditada y actualiza inventario cuando corresponde."
            />
            <div className="space-y-4 p-5">
              <label>
                <span className={labelClass}>Nuevo estado</span>
                <select
                  className={inputClass}
                  value={nextStatus}
                  onChange={(event) => setNextStatus(event.target.value)}
                >
                  {orderStatuses.map((value) => (
                    <option key={value} value={value}>
                      {orderStatusLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelClass}>Nota o motivo</span>
                <textarea
                  className={`${inputClass} min-h-20`}
                  value={transitionNote}
                  onChange={(event) => setTransitionNote(event.target.value)}
                  placeholder="Obligatorio para cancelaciones y devoluciones"
                />
              </label>
              <Button
                className="w-full"
                disabled={saving || nextStatus === order.status}
                onClick={() => void transition()}
              >
                <CheckCircle2 className="h-4 w-4" />
                Aplicar estado
              </Button>
            </div>
          </article>
          <article className={`${panelClass} overflow-hidden print:hidden`}>
            <SectionTitle title="Nota interna" description="Visible solo para el equipo." />
            <div className="space-y-3 p-5">
              <textarea
                className={`${inputClass} min-h-24`}
                value={internalNotes}
                onChange={(event) => setInternalNotes(event.target.value)}
                placeholder="Información de producción, despacho o servicio…"
              />
              <Button
                variant="secondary"
                className="w-full"
                disabled={saving || internalNotes === (order.internal_notes ?? '')}
                onClick={() => void saveNotes()}
              >
                <Save className="h-4 w-4" />
                Guardar nota
              </Button>
            </div>
          </article>
          <article className={`${panelClass} overflow-hidden`}>
            <SectionTitle title="Historial" />
            {history.length ? (
              <ol className="space-y-0 p-5">
                {history.map((entry, index) => (
                  <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
                    <span className="relative z-10 mt-1 h-3 w-3 shrink-0 rounded-full bg-wine ring-4 ring-wine/10" />
                    {index < history.length - 1 && (
                      <span className="absolute left-[5px] top-4 h-full w-px bg-artisan-line" />
                    )}
                    <div>
                      <StatusBadge status={entry.status} label={orderStatusLabels[entry.status]} />
                      <p className="mt-1 text-xs text-artisan-muted">
                        {formatAdminDate(entry.created_at, true)}
                      </p>
                      {entry.notes && <p className="mt-1 text-sm">{entry.notes}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title="Sin historial"
                description="Las transiciones del pedido aparecerán aquí."
              />
            )}
          </article>
        </div>
      </section>
    </>
  );
}

export default OrderDetailPage;
