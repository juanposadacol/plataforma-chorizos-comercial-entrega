import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '../utils';
import { panelClass, SectionTitle } from '../components/AdminUi';

const palette = ['#741d17', '#d9a438', '#176b2c', '#9d3c32', '#4b100d', '#96765f'];
const compactMoney = (value: number) =>
  new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export interface SalesPoint {
  label: string;
  sales: number;
  profit: number;
}
export interface RankingPoint {
  name: string;
  value: number;
  secondary?: number;
}
export interface DistributionPoint {
  name: string;
  value: number;
}

export function SalesChart({ data }: { data: SalesPoint[] }) {
  return (
    <article className={`${panelClass} overflow-hidden lg:col-span-2`}>
      <SectionTitle
        title="Ventas frente a utilidad"
        description="Valores autorizados de pedidos entregados en el período."
      />
      <div className="h-80 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
            <CartesianGrid stroke="#eadbc6" strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#78685d' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={compactMoney}
              tick={{ fontSize: 11, fill: '#78685d' }}
              axisLine={false}
              tickLine={false}
              width={54}
            />
            <Tooltip
              formatter={(value) => formatMoney(Number(value))}
              contentStyle={{ borderRadius: 12, borderColor: '#e7d6bd' }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="sales"
              name="Ventas"
              stroke="#741d17"
              strokeWidth={3}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="profit"
              name="Utilidad bruta"
              stroke="#d9a438"
              strokeWidth={3}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

export function RankingChart({
  title,
  description,
  data,
  valueLabel = 'Ventas',
}: {
  title: string;
  description: string;
  data: RankingPoint[];
  valueLabel?: string;
}) {
  return (
    <article className={`${panelClass} overflow-hidden`}>
      <SectionTitle title={title} description={description} />
      <div className="h-80 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 18 }}>
            <CartesianGrid stroke="#eadbc6" strokeDasharray="4 4" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={compactMoney}
              tick={{ fontSize: 11, fill: '#78685d' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              dataKey="name"
              type="category"
              width={94}
              tick={{ fontSize: 11, fill: '#2b211b' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value) => formatMoney(Number(value))}
              contentStyle={{ borderRadius: 12, borderColor: '#e7d6bd' }}
            />
            <Bar dataKey="value" name={valueLabel} fill="#741d17" radius={[0, 8, 8, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

export function ProductRanking({ data }: { data: RankingPoint[] }) {
  return (
    <RankingChart
      title="Productos con mayor facturación"
      description="Ranking calculado desde el detalle histórico de pedidos."
      data={data}
    />
  );
}

export function CustomerRanking({ data }: { data: RankingPoint[] }) {
  return (
    <RankingChart
      title="Clientes que más compran"
      description="Facturación acumulada por cliente en el período."
      data={data}
    />
  );
}

export function DistributionChart({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: DistributionPoint[];
}) {
  return (
    <article className={`${panelClass} overflow-hidden`}>
      <SectionTitle title={title} description={description} />
      <div className="h-80 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={58}
              outerRadius={96}
              paddingAngle={3}
            >
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={palette[index % palette.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatMoney(Number(value))}
              contentStyle={{ borderRadius: 12, borderColor: '#e7d6bd' }}
            />
            <Legend iconType="circle" />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
