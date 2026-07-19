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
import { fetchRecords, getDashboardMetrics, invokeAdminRpc } from '../../features/admin/adminService';
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
import type {
  AdminProduct,
  CustomerRankingRow,
  DashboardMetricsSummary,
  DateRange,
  ProductRankingRow,
  SalesBreakdownRow,
  SalesByDayRow,
} from '../../features/admin/types';
import {
  formatMoney,
  getBogotaDateString,
  getDateRange,
  percentChange,
  sumStatusCounts,
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

const formatDayLabel = (isoDate: string) =>
  new Intl.DateTimeFormat('es-CO', { month: 'short', day: '2-digit', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );

interface DashboardData {
  metrics: DashboardMetricsSummary;
  products: AdminProduct[];
  salesByDay: SalesByDayRow[];
  productRanking: ProductRankingRow[];
  customerRanking: CustomerRankingRow[];
  paymentDistribution: SalesBreakdownRow[];
}

export function AdminDashboardPage() {
  const [preset, setPreset] = useState<RangePreset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
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
        const fromDate = getBogotaDateString(range.from);
        const toDate = getBogotaDateString(range.to);
        const [metrics, products, salesByDay, productRanking, customerRanking, paymentDistribution] =
          await Promise.all([
            getDashboardMetrics(range.from, range.to),
            fetchRecords<AdminProduct>('products', {
              orderBy: 'name',
              ascending: true,
              limit: 1000,
            }),
            invokeAdminRpc<SalesByDayRow[]>('report_sales_by_day', {
              p_from: fromDate,
              p_to: toDate,
            }),
            invokeAdminRpc<ProductRankingRow[]>('report_product_ranking', {
              p_from: fromDate,
              p_to: toDate,
              p_limit: 6,
            }),
            invokeAdminRpc<CustomerRankingRow[]>('report_customer_ranking', {
              p_from: fromDate,
              p_to: toDate,
              p_limit: 6,
            }),
            invokeAdminRpc<SalesBreakdownRow[]>('report_sales_breakdown', {
              p_dimension: 'payment_method',
              p_from: fromDate,
              p_to: toDate,
            }),
          ]);
        if (active)
          setData({ metrics, products, salesByDay, productRanking, customerRanking, paymentDistribution });
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
    if (!data) return null;
    const { metrics } = data;
    const totalOrdersInPeriod = Object.values(metrics.order_status_counts).reduce(
      (sum, value) => sum + toNumber(value),
      0,
    );
    const lowStock = data.products.filter(
      (product) =>
        toNumber(product.stock_available ?? product.stock_current ?? product.stock_on_hand) <=
        toNumber(product.minimum_stock),
    ).length;

    const metricCards: DashboardMetric[] = [
      {
        label: 'Ventas de hoy',
        value: formatMoney(metrics.sales_today),
        helper: 'frente a ayer',
        change: percentChange(metrics.sales_today, metrics.sales_yesterday),
        icon: CircleDollarSign,
        accent: 'wine',
      },
      {
        label: 'Ventas de ayer',
        value: formatMoney(metrics.sales_yesterday),
        helper: 'pedidos entregados',
        icon: Receipt,
        accent: 'gold',
      },
      {
        label: 'Ventas semana',
        value: formatMoney(metrics.sales_current_week),
        helper: 'lunes a hoy',
        icon: TrendingUp,
        accent: 'green',
      },
      {
        label: 'Ventas mes',
        value: formatMoney(metrics.sales_current_month),
        helper: 'mes actual',
        icon: Banknote,
        accent: 'wine',
      },
      {
        label: 'Pedidos nuevos',
        value: String(metrics.new_orders),
        helper: range.label.toLocaleLowerCase('es'),
        icon: ShoppingBag,
        accent: 'gold',
      },
      {
        label: 'Pendientes',
        value: String(sumStatusCounts(metrics.order_status_counts, 'pending_confirmation', 'confirmed')),
        helper: 'requieren seguimiento',
        icon: Clock3,
        accent: 'blue',
      },
      {
        label: 'En preparación',
        value: String(sumStatusCounts(metrics.order_status_counts, 'preparing')),
        helper: 'en producción',
        icon: PackageCheck,
        accent: 'blue',
      },
      {
        label: 'Entregados',
        value: String(metrics.delivered_orders),
        helper: `${totalOrdersInPeriod} pedidos en total`,
        icon: ClipboardCheck,
        accent: 'green',
      },
      {
        label: 'Ticket promedio',
        value: formatMoney(metrics.average_ticket),
        helper: 'por pedido entregado',
        icon: WalletCards,
        accent: 'wine',
      },
      {
        label: 'Utilidad bruta',
        value: formatMoney(metrics.gross_profit),
        helper: `${metrics.gross_margin.toFixed(1)}% de margen`,
        icon: TrendingUp,
        accent: 'green',
      },
      {
        label: 'Utilidad neta',
        value: formatMoney(metrics.net_profit),
        helper: 'bruta menos gastos',
        icon: Percent,
        accent: 'green',
      },
      {
        label: 'Recaudado',
        value: formatMoney(metrics.collected),
        helper: range.label.toLocaleLowerCase('es'),
        icon: Banknote,
        accent: 'green',
      },
      {
        label: 'Por cobrar',
        value: formatMoney(metrics.accounts_receivable),
        helper: 'saldo pendiente vigente',
        icon: CircleDollarSign,
        accent: 'gold',
      },
      {
        label: 'Valor inventario',
        value: formatMoney(metrics.inventory_value),
        helper: `${lowStock} productos con alerta`,
        icon: Boxes,
        accent: lowStock ? 'gold' : 'green',
      },
      {
        label: 'Clientes nuevos',
        value: String(metrics.new_customers),
        helper: range.label.toLocaleLowerCase('es'),
        icon: UserPlus,
        accent: 'blue',
      },
      {
        label: 'Notificaciones',
        value: String(metrics.pending_notifications),
        helper: 'pendientes de atención',
        icon: BellRing,
        accent: metrics.pending_notifications ? 'gold' : 'green',
      },
    ];

    const salesSeries = data.salesByDay.map((row) => ({
      label: formatDayLabel(row.sale_date),
      sales: toNumber(row.net_sales),
      profit: toNumber(row.gross_profit),
    }));
    const productRanking = data.productRanking.map((row) => ({
      name: row.product_name,
      value: toNumber(row.net_sales),
    }));
    const customerRanking = data.customerRanking.map((row) => ({
      name: row.customer_name,
      value: toNumber(row.net_sales),
    }));
    const paymentDistribution = data.paymentDistribution.map((row) => ({
      name: row.dimension_label,
      value: toNumber(row.net_sales),
    }));

    return {
      metrics: metricCards,
      hasActivity: totalOrdersInPeriod > 0,
      salesSeries,
      productRanking,
      customerRanking,
      paymentDistribution,
    };
  }, [range.label, data]);

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
      ) : !data || !analytics ? (
        <div className={panelClass}>
          <EmptyState
            title="Sin información para mostrar"
            description="Los indicadores aparecerán cuando existan registros en Supabase."
          />
        </div>
      ) : (
        <>
          <DashboardCards metrics={analytics.metrics} />
          {!analytics.hasActivity ? (
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
                description="Ranking calculado desde el detalle histórico de pedidos entregados."
                data={analytics.productRanking}
              />
              <RankingChart
                title="Clientes que más compran"
                description="Facturación acumulada por cliente en el período (pedidos entregados)."
                data={analytics.customerRanking}
              />
              <DistributionChart
                title="Ventas por forma de pago"
                description="Participación del valor vendido por método (pedidos entregados)."
                data={analytics.paymentDistribution}
              />
            </section>
          )}
          <InventoryAlerts products={data.products} />
        </>
      )}
    </>
  );
}

export default AdminDashboardPage;
