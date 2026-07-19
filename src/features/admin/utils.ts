import { formatMoney } from '../../lib/format';
import type { DateRange, OrderStatus, PaymentStatus } from './types';

export { formatMoney };

export const toNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const firstText = (record: Record<string, unknown>, ...keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return '';
};

export const formatAdminDate = (value: unknown, includeTime = false): string => {
  if (!value || typeof value !== 'string') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' as const } : {}),
    timeZone: 'America/Bogota',
  }).format(date);
};

export const orderStatusLabels: Record<string, string> = {
  new: 'Nuevo',
  pending_confirmation: 'Por confirmar',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  dispatched: 'Despachado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  returned: 'Devuelto',
};

export const paymentStatusLabels: Record<string, string> = {
  pending: 'Pendiente',
  under_review: 'En verificación',
  partial: 'Parcial',
  paid: 'Pagado',
  credit: 'Crédito',
  rejected: 'Rechazado',
  refunded: 'Reembolsado',
};

export const orderStatuses = Object.keys(orderStatusLabels) as OrderStatus[];
export const paymentStatuses = Object.keys(paymentStatusLabels) as PaymentStatus[];

export type StatusTone = 'wine' | 'gold' | 'green' | 'red' | 'blue' | 'gray';

export const getStatusTone = (status: string): StatusTone => {
  if (['delivered', 'paid', 'sent', 'read', 'active', 'received', 'completed'].includes(status))
    return 'green';
  if (['cancelled', 'rejected', 'failed', 'inactive', 'overdue'].includes(status)) return 'red';
  if (['preparing', 'verifying', 'partial', 'processing', 'dispatched'].includes(status))
    return 'blue';
  if (['pending', 'pending_confirmation', 'new', 'ready', 'credit'].includes(status)) return 'gold';
  return 'gray';
};

const startOfDay = (date: Date) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const endOfDay = (date: Date) => {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
};

export type RangePreset =
  'today' | 'yesterday' | '7days' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'year';

export const getDateRange = (preset: RangePreset): DateRange => {
  const today = new Date();
  const from = startOfDay(today);
  const to = endOfDay(today);
  if (preset === 'yesterday') {
    from.setDate(from.getDate() - 1);
    to.setDate(to.getDate() - 1);
    return { from, to, label: 'Ayer' };
  }
  if (preset === '7days') {
    from.setDate(from.getDate() - 6);
    return { from, to, label: 'Últimos 7 días' };
  }
  if (preset === 'week' || preset === 'lastWeek') {
    const weekday = (from.getDay() + 6) % 7;
    from.setDate(from.getDate() - weekday + (preset === 'lastWeek' ? -7 : 0));
    if (preset === 'lastWeek') {
      to.setTime(from.getTime());
      to.setDate(to.getDate() + 6);
      to.setHours(23, 59, 59, 999);
    }
    return { from, to, label: preset === 'week' ? 'Semana actual' : 'Semana anterior' };
  }
  if (preset === 'month' || preset === 'lastMonth') {
    if (preset === 'lastMonth') {
      from.setMonth(from.getMonth() - 1, 1);
      to.setDate(0);
      to.setHours(23, 59, 59, 999);
    } else {
      from.setDate(1);
    }
    return { from, to, label: preset === 'month' ? 'Mes actual' : 'Mes anterior' };
  }
  if (preset === 'year') {
    from.setMonth(0, 1);
    return { from, to, label: 'Año actual' };
  }
  return { from, to, label: 'Hoy' };
};

export const downloadCsv = (filename: string, rows: Record<string, unknown>[]): void => {
  if (!rows.length) return;
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown) => {
    const normalized =
      value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `"${normalized.replaceAll('"', '""')}"`;
  };
  const content = [
    headers.map(escape).join(','),
    ...rows.map((row) => headers.map((key) => escape(row[key])).join(',')),
  ].join('\n');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const percentage = (part: number, total: number): number =>
  total > 0 ? (part / total) * 100 : 0;

export const matchesSearch = (record: Record<string, unknown>, search: string): boolean => {
  const query = search.trim().toLocaleLowerCase('es');
  if (!query) return true;
  return Object.values(record).some((value) =>
    ['string', 'number'].includes(typeof value)
      ? String(value).toLocaleLowerCase('es').includes(query)
      : false,
  );
};
