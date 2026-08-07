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

const SQL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True for a bare "YYYY-MM-DD" string — a PostgreSQL DATE value with no time or
 * timezone component (sale_date, due_date, expense_date, purchase_date,
 * requested_delivery_date, valid_from/valid_until...). PostgREST always
 * serializes TIMESTAMPTZ with a full time + offset, so this shape check alone
 * is enough to tell the two apart — no need to know the column name.
 */
export const isBareSqlDate = (value: string): boolean => SQL_DATE_PATTERN.test(value);

/**
 * Formats a PostgreSQL DATE value as DD/MM/YYYY without ever constructing a JS
 * Date object. `new Date("2026-07-18")` parses ISO date-only strings as UTC
 * midnight; rendering that instant in America/Bogota (UTC-5) rolls the date back
 * to the previous day. A DATE column has no timezone to convert — it must be
 * shown exactly as stored.
 */
export const formatSqlDate = (value: string): string => {
  const match = SQL_DATE_PATTERN.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
};

/** Indicativo telefónico de Colombia. Solo se antepone al marcar, nunca al guardar. */
export const COLOMBIA_COUNTRY_CODE = '57';

/**
 * Forma canónica en la que se GUARDA un celular colombiano: los 10 dígitos
 * locales, sin el indicativo 57 y sin símbolos.
 *
 * El indicativo solo sirve para marcar (SMS de Supabase Auth, enlaces de
 * WhatsApp), así que se retira aquí y se vuelve a anteponer con
 * `toColombianE164` en el único momento en que hace falta. Números de otros
 * países se devuelven completos: solo se quita un 57 que sobre 10 dígitos.
 */
export const normalizeColombianPhone = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  // 0057 es el prefijo de marcación internacional; equivale a "+57".
  const national = digits.startsWith('0057') ? digits.slice(4) : digits;
  if (national.length === 12 && national.startsWith(COLOMBIA_COUNTRY_CODE))
    return national.slice(2);
  return national;
};

/**
 * Formato internacional (+57XXXXXXXXXX) exigido por Supabase Auth para el SMS y
 * útil para enlaces `wa.me`. Es la inversa de `normalizeColombianPhone`.
 */
export const toColombianE164 = (value: string): string => {
  const local = normalizeColombianPhone(value);
  return local.length === 10 ? `+${COLOMBIA_COUNTRY_CODE}${local}` : `+${local}`;
};

/** Igual que `toColombianE164` pero sin el "+", como lo requiere `https://wa.me/`. */
export const toWhatsappPhone = (value: string): string => toColombianE164(value).slice(1);

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
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      hour + BOGOTA_UTC_OFFSET_HOURS,
      minute,
      second,
      millisecond,
    ),
  );

export const bogotaStartOfDay = (parts: BogotaDateParts): Date => bogotaPartsToInstant(parts);
export const bogotaEndOfDay = (parts: BogotaDateParts): Date =>
  bogotaPartsToInstant(parts, 23, 59, 59, 999);

export const addBogotaDays = (parts: BogotaDateParts, days: number): BogotaDateParts => {
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
  };
};

/** Day of week for a Bogota calendar date, Monday = 0 ... Sunday = 6. */
export const bogotaMondayIndex = (parts: BogotaDateParts): number => {
  const jsWeekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return (jsWeekday + 6) % 7;
};

export const lastDayOfBogotaMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
