/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, KeyRound, ShoppingCart, Tag } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { fetchRecord, fetchRecords, invokeAdminRpc } from '../../features/admin/adminService';
import type { AdminOrder, Customer, CustomerProductPrice } from '../../features/admin/types';
import { firstText, formatAdminDate, formatMoney, toNumber } from '../../features/admin/utils';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  panelClass,
  SectionTitle,
  StatusBadge,
  type TableColumn,
} from '../../features/admin/components/AdminUi';

export function CustomerDetailPage() {
  const { id } = useParams();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [specialPrices, setSpecialPrices] = useState<CustomerProductPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [customerData, orderData, priceData] = await Promise.all([
        fetchRecord<Customer>('customers', id),
        fetchRecords<AdminOrder>('orders', {
          eq: { customer_id: id },
          orderBy: 'created_at',
          limit: 200,
        }),
        fetchRecords<CustomerProductPrice>('customer_product_prices', {
          eq: { customer_id: id },
          orderBy: 'created_at',
          limit: 200,
        }),
      ]);
      setCustomer(customerData);
      setOrders(orderData);
      setSpecialPrices(priceData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar el cliente.');
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(
    () =>
      orders
        .filter((order) => !['cancelled', 'returned'].includes(order.status))
        .reduce((sum, order) => sum + toNumber(order.total), 0),
    [orders],
  );
  const resetPin = async () => {
    if (!customer) return;
    setResetting(true);
    setPinMessage(null);
    setError(null);
    try {
      const result = await invokeAdminRpc<{ temporary_pin?: string; message?: string }>(
        'admin_reset_customer_pin',
        { p_customer_id: customer.id },
      );
      setPinMessage(
        result.temporary_pin
          ? `PIN temporal: ${result.temporary_pin}. Compártelo por un canal seguro; solo se mostrará una vez.`
          : (result.message ?? 'Se inició el restablecimiento seguro del PIN.'),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible restablecer el PIN.');
    } finally {
      setResetting(false);
    }
  };

  const orderColumns: TableColumn<AdminOrder>[] = [
    {
      key: 'order',
      header: 'Pedido',
      render: (order) => (
        <Link className="font-bold text-wine hover:underline" to={`/admin/pedidos/${order.id}`}>
          #{firstText(order, 'order_number', 'consecutive')}
        </Link>
      ),
    },
    { key: 'date', header: 'Fecha', render: (order) => formatAdminDate(order.created_at) },
    { key: 'status', header: 'Estado', render: (order) => <StatusBadge status={order.status} /> },
    {
      key: 'total',
      header: 'Total',
      render: (order) => <span className="font-black">{formatMoney(order.total)}</span>,
    },
  ];
  if (loading)
    return (
      <div className={panelClass}>
        <LoadingState />
      </div>
    );
  if (error && !customer)
    return (
      <div className={panelClass}>
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  if (!customer)
    return (
      <div className={panelClass}>
        <EmptyState
          title="Cliente no encontrado"
          description="El registro no existe o no tienes acceso."
        />
      </div>
    );
  return (
    <>
      <Link
        to="/admin/clientes"
        className="inline-flex items-center gap-2 text-sm font-bold text-artisan-muted hover:text-wine"
      >
        <ArrowLeft className="h-4 w-4" />
        Todos los clientes
      </Link>
      <PageHeader
        eyebrow={customer.classification ?? 'Cliente'}
        title={firstText(customer, 'full_name', 'name')}
        description={`${customer.phone} · ${customer.municipality || 'Ubicación sin definir'}`}
        actions={
          <>
            <Button variant="secondary" disabled={resetting} onClick={() => void resetPin()}>
              <KeyRound className="h-4 w-4" />
              {resetting ? 'Procesando…' : 'Restablecer PIN'}
            </Button>
            <Link
              to={`/admin/precios?cliente=${customer.id}`}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-artisan-line bg-white px-4 py-2 text-sm font-bold hover:bg-artisan-paper"
            >
              <Tag className="h-4 w-4" />
              Precio especial
            </Link>
            <Link
              to={`/?cliente=${customer.id}`}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-wine px-4 py-2 text-sm font-bold text-white hover:bg-wine-dark"
            >
              <ShoppingCart className="h-4 w-4" />
              Crear pedido
            </Link>
          </>
        }
      />
      {pinMessage && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          {pinMessage}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className={`${panelClass} p-5`}>
          <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
            Total comprado
          </p>
          <p className="mt-2 font-display text-2xl font-bold">{formatMoney(total)}</p>
        </article>
        <article className={`${panelClass} p-5`}>
          <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">Pedidos</p>
          <p className="mt-2 font-display text-2xl font-bold">{orders.length}</p>
        </article>
        <article className={`${panelClass} p-5`}>
          <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
            Ticket promedio
          </p>
          <p className="mt-2 font-display text-2xl font-bold">
            {formatMoney(orders.length ? total / orders.length : 0)}
          </p>
        </article>
        <article className={`${panelClass} p-5`}>
          <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
            Precios especiales
          </p>
          <p className="mt-2 font-display text-2xl font-bold">
            {specialPrices.filter((price) => price.active !== false).length}
          </p>
        </article>
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <article className={`${panelClass} overflow-hidden`}>
          <SectionTitle title="Historial de pedidos" />
          {orders.length ? (
            <DataTable rows={orders} columns={orderColumns} getRowKey={(order) => order.id} />
          ) : (
            <EmptyState
              title="Sin pedidos"
              description="Este cliente todavía no tiene pedidos registrados."
            />
          )}
        </article>
        <article className={`${panelClass} overflow-hidden`}>
          <SectionTitle title="Información comercial" />
          <dl className="space-y-4 p-5 text-sm">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
                Estado
              </dt>
              <dd className="mt-1">
                <StatusBadge status={customer.status ?? 'active'} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
                Dirección
              </dt>
              <dd className="mt-1 font-semibold">{customer.address || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
                Condición de pago
              </dt>
              <dd className="mt-1 font-semibold capitalize">
                {customer.payment_terms || 'Contado'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
                Cupo de crédito
              </dt>
              <dd className="mt-1 font-semibold">{formatMoney(customer.credit_limit)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
                Saldo pendiente
              </dt>
              <dd className="mt-1 font-black text-wine">
                {formatMoney(customer.outstanding_balance)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
                Cliente desde
              </dt>
              <dd className="mt-1 font-semibold">{formatAdminDate(customer.created_at)}</dd>
            </div>
          </dl>
        </article>
      </section>
    </>
  );
}
export default CustomerDetailPage;
