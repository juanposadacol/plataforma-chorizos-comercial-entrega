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
