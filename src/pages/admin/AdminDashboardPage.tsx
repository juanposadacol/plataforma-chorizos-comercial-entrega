import { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  BellRing,
  Boxes,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  PackageCheck,
  Percent,
  Receipt,
  ShoppingBag,
  TrendingUp,
  UserPlus,
  WalletCards,
} from 'lucide-react';
import { getDashboardSnapshot } from '../../features/admin/adminService';
import {
  DashboardCards,
  type DashboardMetric,
} from '../../features/admin/dashboard/DashboardCards';
import {
  DistributionChart,
  RankingChart,
  SalesChart,
} from '../../features/admin/dashboard/DashboardCharts';
import { InventoryAlerts } from '../../features/admin/inventory/InventoryAlerts';
import type { AdminOrder, DashboardSnapshot, DateRange } from '../../features/admin/types';
import {
  firstText,
  formatMoney,
  getDateRange,
  percentage,
  toNumber,
  type RangePreset,
} from '../../features/admin/utils';
import {
  EmptyState,
  ErrorState,
  inputClass,
  LoadingState,
  PageHeader,
  panelClass,
} from '../../features/admin/components/AdminUi';

const isWithin = (value: string | undefined, from: Date, to: Date) => {
  if (!value) return false;
  const date = new Date(value);
  return date >= from && date <= to;
};

const validSalesOrder = (order: AdminOrder) => !['cancelled', 'returned'].includes(order.status);
const salesTotal = (orders: AdminOrder[]) =>
  orders.filter(validSalesOrder).reduce((sum, order) => sum + toNumber(order.total), 0);
const change = (current: number, previous: number) =>
  previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : null;

export function AdminDashboardPage() {
  const [preset, setPreset] = useState<RangePreset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo<DateRange>(() => {
    if (customFrom && customTo) {
      return {
        from: new Date(`${customFrom}T00:00:00-05:00`),
        to: new Date(`${customTo}T23:59:59-05:00`),
        label: 'Rango personalizado',
      };
    }
    return getDateRange(preset);
  }, [customFrom, customTo, preset]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const monthStart = getDateRange('month').from;
        const yesterday = getDateRange('yesterday').from;
        const earliest = new Date(
          Math.min(range.from.getTime(), monthStart.getTime(), yesterday.getTime()),
        );
        const result = await getDashboardSnapshot(earliest, new Date());
        if (active) setSnapshot(result);
      } catch (caught) {
        if (active)
          setError(caught instanceof Error ? caught.message : 'No fue posible cargar el tablero.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [range.from, range.to]);

  const analytics = useMemo(() => {
    if (!snapshot) return null;
    const periodOrders = snapshot.orders.filter((order) =>
      isWithin(order.created_at, range.from, range.to),
    );
    const today = getDateRange('today');
    const yesterday = getDateRange('yesterday');
    const week = getDateRange('week');
    const month = getDateRange('month');
    const todaySales = salesTotal(
      snapshot.orders.filter((order) => isWithin(order.created_at, today.from, today.to)),
    );
    const yesterdaySales = salesTotal(
      snapshot.orders.filter((order) => isWithin(order.created_at, yesterday.from, yesterday.to)),
    );
    const periodSales = salesTotal(periodOrders);
    const delivered = periodOrders.filter((order) => order.status === 'delivered');
    const grossProfit = periodOrders
      .filter(validSalesOrder)
      .reduce(
        (sum, order) =>
          sum +
          toNumber(
            order.gross_profit ??
              toNumber(order.total) - toNumber(order.cost_of_sales ?? order.cost_total),
          ),
        0,
      );
    const periodExpenses = snapshot.expenses
      .filter((expense) =>
        isWithin(expense.created_at ?? expense.expense_date, range.from, range.to),
      )
      .reduce((sum, expense) => sum + toNumber(expense.amount), 0);
    const collected = snapshot.payments
      .filter(
        (payment) =>
          isWithin(payment.created_at ?? payment.payment_date, range.from, range.to) &&
          !['rejected', 'refunded'].includes(payment.status),
      )
      .reduce((sum, payment) => sum + toNumber(payment.amount), 0);
    const receivables = periodOrders
      .filter((order) => ['pending', 'partial', 'credit'].includes(order.payment_status))
      .reduce((sum, order) => sum + toNumber(order.total), 0);
    const inventoryValue = snapshot.products.reduce(
      (sum, product) =>
        sum +
        toNumber(product.stock_on_hand ?? product.stock_current) *
          toNumber(product.average_cost ?? product.current_cost),
      0,
    );
    const lowStock = snapshot.products.filter(
      (product) =>
        toNumber(product.stock_available ?? product.stock_current ?? product.stock_on_hand) <=
        toNumber(product.minimum_stock),
    ).length;
    const pendingNotifications = snapshot.notifications.filter(
      (notification) =>
        !notification.read_at && !['sent', 'read'].includes(notification.status ?? ''),
    ).length;
    const metrics: DashboardMetric[] = [
      {
        label: 'Ventas de hoy',
        value: formatMoney(todaySales),
        helper: 'frente a ayer',
        change: change(todaySales, yesterdaySales),
        icon: CircleDollarSign,
        accent: 'wine',
      },
      {
        label: 'Ventas de ayer',
        value: formatMoney(yesterdaySales),
        helper: 'pedidos no cancelados',
        icon: Receipt,
        accent: 'gold',
      },
      {
        label: 'Ventas semana',
        value: formatMoney(
          salesTotal(
            snapshot.orders.filter((order) => isWithin(order.created_at, week.from, week.to)),
          ),
        ),
        helper: 'semana actual',
        icon: TrendingUp,
        accent: 'green',
      },
      {
        label: 'Ventas mes',
        value: formatMoney(
          salesTotal(
            snapshot.orders.filter((order) => isWithin(order.created_at, month.from, month.to)),
          ),
        ),
        helper: 'mes actual',
        icon: Banknote,
        accent: 'wine',
      },
      {
        label: 'Pedidos nuevos',
        value: String(periodOrders.filter((order) => order.status === 'new').length),
        helper: range.label.toLocaleLowerCase('es'),
        icon: ShoppingBag,
        accent: 'gold',
      },
      {
        label: 'Pendientes',
        value: String(
          periodOrders.filter((order) =>
            ['pending_confirmation', 'confirmed'].includes(order.status),
          ).length,
        ),
        helper: 'requieren seguimiento',
        icon: Clock3,
        accent: 'blue',
      },
      {
        label: 'En preparación',
        value: String(periodOrders.filter((order) => order.status === 'preparing').length),
        helper: 'en producción',
        icon: PackageCheck,
        accent: 'blue',
      },
      {
        label: 'Entregados',
        value: String(delivered.length),
        helper: `${periodOrders.length} pedidos en total`,
        icon: ClipboardCheck,
        accent: 'green',
      },
      {
        label: 'Ticket promedio',
        value: formatMoney(periodOrders.length ? periodSales / periodOrders.length : 0),
        helper: 'por pedido válido',
        icon: WalletCards,
        accent: 'wine',
      },
      {
        label: 'Utilidad bruta',
        value: formatMoney(grossProfit),
        helper: `${percentage(grossProfit, periodSales).toFixed(1)}% de margen`,
        icon: TrendingUp,
        accent: 'green',
      },
      {
        label: 'Utilidad neta',
        value: formatMoney(grossProfit - periodExpenses),
        helper: 'bruta menos gastos',
        icon: Percent,
        accent: 'green',
      },
      {
        label: 'Recaudado',
        value: formatMoney(collected),
        helper: range.label.toLocaleLowerCase('es'),
        icon: Banknote,
        accent: 'green',
      },
      {
        label: 'Por cobrar',
        value: formatMoney(receivables),
        helper: 'saldo estimado del período',
        icon: CircleDollarSign,
        accent: 'gold',
      },
      {
        label: 'Valor inventario',
        value: formatMoney(inventoryValue),
        helper: `${lowStock} productos con alerta`,
        icon: Boxes,
        accent: lowStock ? 'gold' : 'green',
      },
      {
        label: 'Clientes nuevos',
        value: String(
          snapshot.customers.filter((customer) =>
            isWithin(customer.created_at, range.from, range.to),
          ).length,
        ),
        helper: range.label.toLocaleLowerCase('es'),
        icon: UserPlus,
        accent: 'blue',
      },
      {
        label: 'Notificaciones',
        value: String(pendingNotifications),
        helper: 'pendientes de atención',
        icon: BellRing,
        accent: pendingNotifications ? 'gold' : 'green',
      },
    ];

    const salesByDay = new Map<string, { sales: number; profit: number }>();
    periodOrders.filter(validSalesOrder).forEach((order) => {
      const key = new Intl.DateTimeFormat('es-CO', {
        month: 'short',
        day: '2-digit',
        timeZone: 'America/Bogota',
      }).format(new Date(order.created_at));
      const current = salesByDay.get(key) ?? { sales: 0, profit: 0 };
      current.sales += toNumber(order.total);
      current.profit += toNumber(
        order.gross_profit ??
          toNumber(order.total) - toNumber(order.cost_of_sales ?? order.cost_total),
      );
      salesByDay.set(key, current);
    });

    const periodOrderIds = new Set(periodOrders.filter(validSalesOrder).map((order) => order.id));
    const productTotals = new Map<string, number>();
    snapshot.orderItems
      .filter((item) => periodOrderIds.has(item.order_id))
      .forEach((item) => {
        const name =
          firstText(item, 'product_name', 'name') || firstText(item, 'sku') || 'Producto';
        productTotals.set(name, (productTotals.get(name) ?? 0) + toNumber(item.subtotal));
      });
    const customerTotals = new Map<string, number>();
    periodOrders.filter(validSalesOrder).forEach((order) => {
      const name =
        firstText(order, 'customer_name_snapshot', 'customer_name') || 'Cliente sin nombre';
      customerTotals.set(name, (customerTotals.get(name) ?? 0) + toNumber(order.total));
    });
    const paymentTotals = new Map<string, number>();
    periodOrders.filter(validSalesOrder).forEach((order) => {
      const method =
        firstText(order, 'payment_method_name', 'payment_method', 'payment_method_code') ||
        'Sin especificar';
      paymentTotals.set(method, (paymentTotals.get(method) ?? 0) + toNumber(order.total));
    });
    const toRanking = (source: Map<string, number>) =>
      [...source]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);
    return {
      metrics,
      periodOrders,
      salesSeries: [...salesByDay].map(([label, values]) => ({ label, ...values })),
      productRanking: toRanking(productTotals),
      customerRanking: toRanking(customerTotals),
      paymentDistribution: toRanking(paymentTotals),
    };
  }, [range, snapshot]);

  return (
    <>
      <PageHeader
        eyebrow="Centro de control"
        title="Resumen del negocio"
        description="Ventas, utilidad, pedidos e inventario con información registrada en Supabase."
        actions={
          <div className="flex flex-wrap gap-2">
            <select
              className={`${inputClass} w-auto min-w-44`}
              value={preset}
              onChange={(event) => {
                setPreset(event.target.value as RangePreset);
                setCustomFrom('');
                setCustomTo('');
              }}
            >
              <option value="today">Hoy</option>
              <option value="yesterday">Ayer</option>
              <option value="7days">Últimos 7 días</option>
              <option value="week">Semana actual</option>
              <option value="lastWeek">Semana anterior</option>
              <option value="month">Mes actual</option>
              <option value="lastMonth">Mes anterior</option>
              <option value="year">Año actual</option>
            </select>
            <input
              aria-label="Fecha inicial"
              type="date"
              className={`${inputClass} w-auto`}
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
            />
            <input
              aria-label="Fecha final"
              type="date"
              className={`${inputClass} w-auto`}
              value={customTo}
              min={customFrom}
              onChange={(event) => setCustomTo(event.target.value)}
            />
          </div>
        }
      />
      {loading ? (
        <div className={panelClass}>
          <LoadingState label="Calculando indicadores…" />
        </div>
      ) : error ? (
        <div className={panelClass}>
          <ErrorState message={error} onRetry={() => window.location.reload()} />
        </div>
      ) : !snapshot || !analytics ? (
        <div className={panelClass}>
          <EmptyState
            title="Sin información para mostrar"
            description="Los indicadores aparecerán cuando existan registros en Supabase."
          />
        </div>
      ) : (
        <>
          <DashboardCards metrics={analytics.metrics} />
          {analytics.periodOrders.length === 0 ? (
            <div className={panelClass}>
              <EmptyState
                title={`Sin ventas en ${range.label.toLocaleLowerCase('es')}`}
                description="Cambia el rango o registra el primer pedido para ver las gráficas."
              />
            </div>
          ) : (
            <section className="grid gap-4 lg:grid-cols-2">
              <SalesChart data={analytics.salesSeries} />
              <RankingChart
                title="Productos con mayor facturación"
                description="Ranking calculado desde el detalle histórico de pedidos."
                data={analytics.productRanking}
              />
              <RankingChart
                title="Clientes que más compran"
                description="Facturación acumulada por cliente en el período."
                data={analytics.customerRanking}
              />
              <DistributionChart
                title="Ventas por forma de pago"
                description="Participación del valor vendido por método."
                data={analytics.paymentDistribution}
              />
            </section>
          )}
          <InventoryAlerts products={snapshot.products} />
        </>
      )}
    </>
  );
}

export default AdminDashboardPage;
