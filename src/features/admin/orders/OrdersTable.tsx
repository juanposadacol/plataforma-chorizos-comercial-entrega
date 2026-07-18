import { useMemo, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { invokeAdminRpc } from '../adminService';
import type { AdminOrder } from '../types';
import {
  firstText,
  formatAdminDate,
  formatMoney,
  matchesSearch,
  orderStatusLabels,
  orderStatuses,
  paymentStatusLabels,
} from '../utils';
import { useAdminData } from '../useAdminData';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  ExportCsvButton,
  inputClass,
  LoadingState,
  SearchField,
  StatusBadge,
  type TableColumn,
} from '../components/AdminUi';

export function OrdersTable() {
  const { data, loading, refreshing, error, reload } = useAdminData<AdminOrder>(
    'orders',
    { orderBy: 'created_at', limit: 1000 },
    true,
  );
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [updating, setUpdating] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      data.filter(
        (order) =>
          matchesSearch(order, search) &&
          (status === 'all' || order.status === status) &&
          (paymentStatus === 'all' || order.payment_status === paymentStatus),
      ),
    [data, paymentStatus, search, status],
  );

  const transition = async (order: AdminOrder, nextStatus: string) => {
    if (nextStatus === order.status) return;
    setUpdating(order.id);
    setMutationError(null);
    try {
      await invokeAdminRpc('transition_order_status', {
        p_order_id: order.id,
        p_new_status: nextStatus,
        p_notes: 'Actualizado desde el panel de pedidos',
      });
      await reload();
    } catch (caught) {
      setMutationError(
        caught instanceof Error ? caught.message : 'No fue posible cambiar el estado.',
      );
    } finally {
      setUpdating(null);
    }
  };

  const columns: TableColumn<AdminOrder>[] = [
    {
      key: 'order',
      header: 'Pedido',
      render: (order) => (
        <div>
          <Link
            className="font-black text-wine hover:underline"
            to={`/admin/pedidos/${order.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            #{firstText(order, 'order_number', 'consecutive') || order.id.slice(0, 8)}
          </Link>
          <p className="mt-0.5 text-xs text-artisan-muted">
            {formatAdminDate(order.created_at, true)}
          </p>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Cliente',
      render: (order) => (
        <div>
          <p className="font-semibold">
            {firstText(order, 'customer_name_snapshot', 'customer_name') || 'Sin nombre'}
          </p>
          <p className="text-xs text-artisan-muted">
            {firstText(order, 'customer_phone_snapshot', 'customer_phone') || 'Sin celular'}
          </p>
        </div>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      render: (order) => <span className="font-black">{formatMoney(order.total)}</span>,
    },
    {
      key: 'payment',
      header: 'Pago',
      render: (order) => (
        <StatusBadge
          status={order.payment_status}
          label={paymentStatusLabels[order.payment_status]}
        />
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (order) => (
        <select
          aria-label={`Estado del pedido ${firstText(order, 'order_number')}`}
          className="rounded-lg border border-artisan-line bg-white px-2 py-1.5 text-xs font-bold text-artisan-ink outline-none focus:border-wine"
          value={order.status}
          disabled={updating === order.id}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => void transition(order, event.target.value)}
        >
          {orderStatuses.map((value) => (
            <option key={value} value={value}>
              {orderStatusLabels[value]}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'open',
      header: '',
      className: 'w-12',
      render: (order) => (
        <Link
          to={`/admin/pedidos/${order.id}`}
          aria-label="Abrir pedido"
          className="grid h-9 w-9 place-items-center rounded-lg text-wine hover:bg-wine/10"
        >
          <ArrowRight className="h-4 w-4" />
        </Link>
      ),
    },
  ];

  if (loading)
    return (
      <div className="overflow-hidden rounded-2xl border border-artisan-line bg-white">
        <LoadingState label="Cargando pedidos…" />
      </div>
    );
  if (error)
    return (
      <div className="overflow-hidden rounded-2xl border border-artisan-line bg-white">
        <ErrorState message={error} onRetry={() => void reload()} />
      </div>
    );

  return (
    <div className="space-y-4">
      {mutationError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {mutationError}
        </div>
      )}
      <div className="flex flex-col gap-3 xl:flex-row">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Buscar por pedido, cliente o celular…"
        />
        <div className="flex flex-wrap gap-2">
          <select
            className={`${inputClass} w-auto`}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">Todos los estados</option>
            {orderStatuses.map((value) => (
              <option key={value} value={value}>
                {orderStatusLabels[value]}
              </option>
            ))}
          </select>
          <select
            className={`${inputClass} w-auto`}
            value={paymentStatus}
            onChange={(event) => setPaymentStatus(event.target.value)}
          >
            <option value="all">Cualquier pago</option>
            {Object.entries(paymentStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => void reload()} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
          <ExportCsvButton filename="pedidos" rows={filtered} />
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-artisan-line bg-white shadow-sm">
        {filtered.length ? (
          <DataTable
            rows={filtered}
            columns={columns}
            getRowKey={(row) => row.id}
            rowLabel={(row) => `Pedido ${firstText(row, 'order_number')}`}
          />
        ) : (
          <EmptyState
            title="No encontramos pedidos"
            description={
              search || status !== 'all' || paymentStatus !== 'all'
                ? 'Ajusta los filtros para ver otros resultados.'
                : 'Los pedidos guardados en la tienda aparecerán aquí en tiempo real.'
            }
          />
        )}
      </div>
    </div>
  );
}
