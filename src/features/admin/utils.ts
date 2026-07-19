import {
  addBogotaDays,
  bogotaEndOfDay,
  bogotaMondayIndex,
  bogotaStartOfDay,
  formatMoney,
  getBogotaDateParts,
  getBogotaDateString,
  lastDayOfBogotaMonth,
} from '../../lib/format';
import type { DateRange, OrderStatus, PaymentStatus } from './types';

export { formatMoney, getBogotaDateString };

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

export type RangePreset =
  'today' | 'yesterday' | '7days' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'year';

/**
 * Computes UI date-range presets anchored to the current calendar day in
 * America/Bogota — never the browser/OS local timezone. `reference` defaults to
 * "now" but can be overridden in tests to pin a deterministic instant.
 */
export const getDateRange = (preset: RangePreset, reference: Date = new Date()): DateRange => {
  const todayParts = getBogotaDateParts(reference);
  const today = { from: bogotaStartOfDay(todayParts), to: bogotaEndOfDay(todayParts) };

  if (preset === 'yesterday') {
    const parts = addBogotaDays(todayParts, -1);
    return { from: bogotaStartOfDay(parts), to: bogotaEndOfDay(parts), label: 'Ayer' };
  }
  if (preset === '7days') {
    const fromParts = addBogotaDays(todayParts, -6);
    return { from: bogotaStartOfDay(fromParts), to: today.to, label: 'Últimos 7 días' };
  }
  if (preset === 'week' || preset === 'lastWeek') {
    let fromParts = addBogotaDays(todayParts, -bogotaMondayIndex(todayParts));
    let toParts = todayParts;
    if (preset === 'lastWeek') {
      fromParts = addBogotaDays(fromParts, -7);
      toParts = addBogotaDays(fromParts, 6);
    }
    return {
      from: bogotaStartOfDay(fromParts),
      to: bogotaEndOfDay(toParts),
      label: preset === 'week' ? 'Semana actual' : 'Semana anterior',
    };
  }
  if (preset === 'month' || preset === 'lastMonth') {
    let { year, month } = todayParts;
    let toParts = todayParts;
    if (preset === 'lastMonth') {
      month -= 1;
      if (month === 0) {
        month = 12;
        year -= 1;
      }
      toParts = { year, month, day: lastDayOfBogotaMonth(year, month) };
    }
    return {
      from: bogotaStartOfDay({ year, month, day: 1 }),
      to: bogotaEndOfDay(toParts),
      label: preset === 'month' ? 'Mes actual' : 'Mes anterior',
    };
  }
  if (preset === 'year') {
    return {
      from: bogotaStartOfDay({ year: todayParts.year, month: 1, day: 1 }),
      to: today.to,
      label: 'Año actual',
    };
  }
  return { from: today.from, to: today.to, label: 'Hoy' };
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

/** Percentage change vs. a previous value, null when there is nothing to compare against. */
export const percentChange = (current: number, previous: number): number | null =>
  previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : null;

/** Sums selected keys out of the dashboard RPC's order_status_counts jsonb map. */
export const sumStatusCounts = (counts: Record<string, number>, ...statuses: string[]): number =>
  statuses.reduce((sum, status) => sum + toNumber(counts[status]), 0);

export const matchesSearch = (record: Record<string, unknown>, search: string): boolean => {
  const query = search.trim().toLocaleLowerCase('es');
  if (!query) return true;
  return Object.values(record).some((value) =>
    ['string', 'number'].includes(typeof value)
      ? String(value).toLocaleLowerCase('es').includes(query)
      : false,
  );
};
