export const formatMoney = (value: number | string | null | undefined): string =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(value);

export const formatDate = (value: string | Date | null | undefined): string => {
  if (!value) return 'Por confirmar';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeZone: 'America/Bogota',
  }).format(new Date(value));
};

export const formatDateTime = (value: string | Date): string =>
  new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date(value));

export const normalizeColombianPhone = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `57${digits}`;
  if (digits.startsWith('0057')) return digits.slice(2);
  return digits;
};

export const localDateInBogota = (daysFromToday = 0): string => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + daysFromToday);
  return formatter.format(now);
};

/**
 * Colombia's commercial timezone. America/Bogota is fixed at UTC-5 year-round
 * (no daylight saving time), so this offset never needs to change with the season.
 */
export const BOGOTA_TIME_ZONE = 'America/Bogota';
const BOGOTA_UTC_OFFSET_HOURS = 5;

export interface BogotaDateParts {
  year: number;
  month: number;
  day: number;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** Reads the calendar date (Y-M-D) that `reference` falls on in America/Bogota. */
export const getBogotaDateParts = (reference: Date = new Date()): BogotaDateParts => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BOGOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(reference);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day') };
};

export const formatBogotaDateParts = ({ year, month, day }: BogotaDateParts): string =>
  `${year}-${pad2(month)}-${pad2(day)}`;

/** Formats the calendar date `reference` falls on in America/Bogota as `YYYY-MM-DD`. */
export const getBogotaDateString = (reference: Date = new Date()): string =>
  formatBogotaDateParts(getBogotaDateParts(reference));

/**
 * Converts a Bogota calendar date (and optional wall-clock time) into the absolute
 * instant it represents, expressed as a UTC-based `Date`. Bogota has no DST, so the
 * offset is always exactly 5 hours.
 */
export const bogotaPartsToInstant = (
  parts: BogotaDateParts,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date =>
  new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, hour + BOGOTA_UTC_OFFSET_HOURS, minute, second, millisecond),
  );

export const bogotaStartOfDay = (parts: BogotaDateParts): Date => bogotaPartsToInstant(parts);
export const bogotaEndOfDay = (parts: BogotaDateParts): Date =>
  bogotaPartsToInstant(parts, 23, 59, 59, 999);

export const addBogotaDays = (parts: BogotaDateParts, days: number): BogotaDateParts => {
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return { year: utcDate.getUTCFullYear(), month: utcDate.getUTCMonth() + 1, day: utcDate.getUTCDate() };
};

/** Day of week for a Bogota calendar date, Monday = 0 ... Sunday = 6. */
export const bogotaMondayIndex = (parts: BogotaDateParts): number => {
  const jsWeekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return (jsWeekday + 6) % 7;
};

export const lastDayOfBogotaMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
