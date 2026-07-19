/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Play } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { exportCsv, exportExcel, exportPdf, type ExportRow } from '../../lib/export';
import { fetchRecords, invokeAdminRpc } from '../../features/admin/adminService';
import {
  formatAdminDate,
  formatMoney,
  getBogotaDateString,
  toNumber,
} from '../../features/admin/utils';
import { formatBogotaDateParts, getBogotaDateParts } from '../../lib/format';
import {
  Button,
  EmptyState,
  ErrorState,
  inputClass,
  labelClass,
  LoadingState,
  PageHeader,
  panelClass,
  SectionTitle,
} from '../../features/admin/components/AdminUi';

type ReportId =
  | 'sales_day'
  | 'products'
  | 'customers'
  | 'cash_flow'
  | 'inventory'
  | 'low_stock'
  | 'expenses'
  | 'purchases'
  | 'receivables'
  | 'payments'
  | 'cancelled'
  | 'returns';
interface ReportDefinition {
  id: ReportId;
  label: string;
  description: string;
  group: string;
}
const reportDefinitions: ReportDefinition[] = [
  {
    id: 'sales_day',
    label: 'Ventas por día',
    description: 'Ventas netas, costo y utilidad por fecha.',
    group: 'Ventas',
  },
  {
    id: 'products',
    label: 'Ranking de productos',
    description: 'Unidades, facturación y utilidad por producto.',
    group: 'Ventas',
  },
  {
    id: 'customers',
    label: 'Ranking de clientes',
    description: 'Compras, frecuencia y ticket por cliente.',
    group: 'Clientes',
  },
  {
    id: 'cash_flow',
    label: 'Flujo de caja',
    description: 'Entradas, salidas y saldo, separado de la utilidad.',
    group: 'Finanzas',
  },
  {
    id: 'payments',
    label: 'Pagos recibidos',
    description: 'Recaudos por método y estado.',
    group: 'Finanzas',
  },
  {
    id: 'receivables',
    label: 'Cuentas por cobrar',
    description: 'Saldo, vencimiento y días de mora.',
    group: 'Finanzas',
  },
  {
    id: 'expenses',
    label: 'Gastos por categoría',
    description: 'Egresos operativos del período.',
    group: 'Finanzas',
  },
  {
    id: 'purchases',
    label: 'Compras por proveedor',
    description: 'Abastecimiento, pagos y saldos.',
    group: 'Compras',
  },
  {
    id: 'inventory',
    label: 'Inventario actual',
    description: 'Existencias, reservas, costos y valorización.',
    group: 'Inventario',
  },
  {
    id: 'low_stock',
    label: 'Inventario bajo',
    description: 'Productos en o por debajo de su mínimo.',
    group: 'Inventario',
  },
  {
    id: 'cancelled',
    label: 'Pedidos cancelados',
    description: 'Pedidos y valores cancelados en el período.',
    group: 'Operación',
  },
  {
    id: 'returns',
    label: 'Devoluciones',
    description: 'Pedidos devueltos y su impacto financiero.',
    group: 'Operación',
  },
];

const primitiveRows = (data: unknown): ExportRow[] => {
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row as Record<string, unknown>).map(([key, value]) => [
        key,
        value == null || ['string', 'number', 'boolean'].includes(typeof value)
          ? (value as ExportRow[string])
          : JSON.stringify(value),
      ]),
    ),
  );
};
const dateParams = (from: string, to: string) => ({ p_from: from, p_to: to });

export function ReportsPage() {
  const todayBogota = getBogotaDateParts();
  const monthStartBogota = formatBogotaDateParts({ ...todayBogota, day: 1 });
  const [reportId, setReportId] = useState<ReportId>('sales_day');
  const [from, setFrom] = useState(monthStartBogota);
  const [to, setTo] = useState(getBogotaDateString());
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected =
    reportDefinitions.find((report) => report.id === reportId) ?? reportDefinitions[0]!;

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    try {
      let data: unknown;
      const range = {
        gte: { created_at: `${from}T00:00:00-05:00` },
        lte: { created_at: `${to}T23:59:59-05:00` },
        orderBy: 'created_at',
        limit: 5000,
      };
      if (reportId === 'sales_day')
        data = await invokeAdminRpc('report_sales_by_day', dateParams(from, to));
      else if (reportId === 'products')
        data = await invokeAdminRpc('report_product_ranking', dateParams(from, to));
      else if (reportId === 'customers')
        data = await invokeAdminRpc('report_customer_ranking', dateParams(from, to));
      else if (reportId === 'cash_flow')
        data = await invokeAdminRpc('report_cash_flow', dateParams(from, to));
      else if (reportId === 'inventory' || reportId === 'low_stock') {
        const products = await fetchRecords<Record<string, unknown>>('products', {
          orderBy: 'name',
          ascending: true,
          limit: 5000,
        });
        data =
          reportId === 'low_stock'
            ? products.filter(
                (product) =>
                  toNumber(product.stock_available ?? product.stock_on_hand) <=
                  toNumber(product.minimum_stock),
              )
            : products.map((product) => ({
                ...product,
                inventory_value:
                  toNumber(product.stock_on_hand) *
                  toNumber(product.average_cost ?? product.current_cost),
              }));
      } else if (reportId === 'expenses') data = await fetchRecords('expenses', range);
      else if (reportId === 'purchases') data = await fetchRecords('purchases', range);
      else if (reportId === 'payments') data = await fetchRecords('payments', range);
      else if (reportId === 'receivables')
        data = await fetchRecords('accounts_receivable', {
          orderBy: 'due_date',
          ascending: true,
          limit: 5000,
        });
      else
        data = await fetchRecords('orders', {
          ...range,
          eq: { status: reportId === 'cancelled' ? 'cancelled' : 'returned' },
        });
      setRows(primitiveRows(data));
    } catch (caught) {
      setRows([]);
      setError(caught instanceof Error ? caught.message : 'No fue posible generar el reporte.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadReport();
  }, [reportId]);

  const columns = useMemo(
    () => (rows.length ? [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 12) : []),
    [rows],
  );
  const numericKey = useMemo(
    () =>
      columns.find(
        (key) =>
          rows.some((row) => typeof row[key] === 'number') &&
          /(total|sales|value|amount|profit|balance|revenue|quantity|units)/i.test(key),
      ) ?? columns.find((key) => rows.some((row) => typeof row[key] === 'number')),
    [columns, rows],
  );
  const nameKey = useMemo(
    () =>
      columns.find((key) =>
        /(date|day|name|product|customer|category|method|supplier)/i.test(key),
      ) ?? columns[0],
    [columns],
  );
  const chartRows = useMemo(
    () =>
      rows.slice(0, 12).map((row) => ({
        name: String(row[nameKey ?? ''] ?? '—').slice(0, 24),
        value: toNumber(row[numericKey ?? '']),
      })),
    [nameKey, numericKey, rows],
  );
  const filename = `reporte-${reportId}-${from}-${to}`;
  const displayValue = (key: string, value: ExportRow[string]) => {
    if (value == null || value === '') return '—';
    if (
      typeof value === 'number' &&
      /(price|cost|total|amount|sales|revenue|profit|balance|paid|value)/i.test(key)
    )
      return formatMoney(value);
    if (typeof value === 'string' && /(date|created_at|updated_at|due_date)/i.test(key))
      return formatAdminDate(value, key.includes('_at'));
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    return String(value).replaceAll('_', ' ');
  };

  return (
    <>
      <PageHeader
        eyebrow="Análisis"
        title="Reportes"
        description="Consulta indicadores con filtros de fecha y exporta exactamente el conjunto visible a CSV, Excel compatible o PDF."
      />
      <section className={`${panelClass} p-5 print:hidden`}>
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr_1fr_auto]">
          <label>
            <span className={labelClass}>Reporte</span>
            <select
              className={inputClass}
              value={reportId}
              onChange={(event) => setReportId(event.target.value as ReportId)}
            >
              {[...new Set(reportDefinitions.map((item) => item.group))].map((group) => (
                <optgroup key={group} label={group}>
                  {reportDefinitions
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>Desde</span>
            <input
              type="date"
              className={inputClass}
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            <span className={labelClass}>Hasta</span>
            <input
              type="date"
              className={inputClass}
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={loading || !from || !to}
              onClick={() => void loadReport()}
            >
              <Play className="h-4 w-4" />
              Generar
            </Button>
          </div>
        </div>
      </section>
      <section className={`${panelClass} overflow-hidden`}>
        <SectionTitle
          title={selected.label}
          description={selected.description}
          action={
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button
                variant="secondary"
                disabled={!rows.length}
                onClick={() => exportCsv(filename, rows)}
              >
                <Download className="h-4 w-4" />
                CSV
              </Button>
              <Button
                variant="secondary"
                disabled={!rows.length}
                onClick={() => void exportExcel(filename, rows)}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Excel
              </Button>
              <Button
                variant="secondary"
                disabled={!rows.length}
                onClick={() => exportPdf(filename, selected.label, rows)}
              >
                <FileText className="h-4 w-4" />
                PDF
              </Button>
            </div>
          }
        />
        {loading ? (
          <LoadingState label="Calculando reporte…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void loadReport()} />
        ) : !rows.length ? (
          <EmptyState
            title="Sin resultados"
            description="No hay registros para este reporte y rango de fechas."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead>
                  <tr className="border-b border-artisan-line bg-artisan-paper/60">
                    {columns.map((column) => (
                      <th
                        key={column}
                        className="px-4 py-3 text-xs font-black uppercase tracking-wide text-artisan-muted"
                      >
                        {column.replaceAll('_', ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-artisan-line">
                  {rows.slice(0, 500).map((row, index) => (
                    <tr key={index} className="hover:bg-artisan-cream/60">
                      {columns.map((column) => (
                        <td
                          key={column}
                          className="max-w-xs truncate px-4 py-3"
                          title={String(row[column] ?? '')}
                        >
                          {displayValue(column, row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 500 && (
              <p className="border-t border-artisan-line p-3 text-center text-xs text-artisan-muted">
                Vista limitada a 500 filas. La exportación incluye las {rows.length} filas.
              </p>
            )}
          </>
        )}
      </section>
      {rows.length > 0 && numericKey && (
        <section className={`${panelClass} overflow-hidden`}>
          <SectionTitle
            title="Vista gráfica"
            description={`Primeros ${Math.min(12, rows.length)} resultados · ${numericKey.replaceAll('_', ' ')}`}
          />
          <div className="h-80 p-5">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows}>
                <CartesianGrid stroke="#eadbc6" strokeDasharray="4 4" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: '#78685d' }}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={72}
                />
                <YAxis tick={{ fontSize: 11, fill: '#78685d' }} />
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                <Bar
                  dataKey="value"
                  name={numericKey.replaceAll('_', ' ')}
                  fill="#741d17"
                  radius={[8, 8, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </>
  );
}
export default ReportsPage;
