import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertCircle, Download, Inbox, LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import { clsx } from 'clsx';
import { downloadCsv, getStatusTone, orderStatusLabels, paymentStatusLabels } from '../utils';

export const panelClass = 'rounded-2xl border border-artisan-line bg-white shadow-sm';
export const inputClass =
  'w-full rounded-xl border border-artisan-line bg-white px-3.5 py-2.5 text-sm text-artisan-ink outline-none transition placeholder:text-artisan-muted/60 focus:border-wine focus:ring-2 focus:ring-wine/10 disabled:cursor-not-allowed disabled:bg-artisan-paper/50';
export const labelClass =
  'mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-artisan-muted';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-wine text-white hover:bg-wine-dark focus:ring-wine/25',
    secondary:
      'border border-artisan-line bg-white text-artisan-ink hover:border-wine/30 hover:bg-artisan-cream',
    ghost: 'text-artisan-muted hover:bg-artisan-paper hover:text-wine',
    danger: 'bg-red-700 text-white hover:bg-red-800 focus:ring-red-300',
  };
  return (
    <button
      className={clsx(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-1 text-xs font-black uppercase tracking-[0.2em] text-wine-soft">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-3xl font-bold text-artisan-ink sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-artisan-muted">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
    </header>
  );
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-artisan-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-display text-xl font-bold text-artisan-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-artisan-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = 'Buscar…',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="relative block min-w-0 flex-1 sm:min-w-64">
      <span className="sr-only">Buscar</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-artisan-muted" />
      <input
        className={`${inputClass} pl-9`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tones = {
    wine: 'bg-wine/10 text-wine',
    gold: 'bg-amber-100 text-amber-800',
    green: 'bg-emerald-100 text-emerald-800',
    red: 'bg-red-100 text-red-800',
    blue: 'bg-sky-100 text-sky-800',
    gray: 'bg-stone-100 text-stone-700',
  };
  const translated =
    label ??
    orderStatusLabels[status] ??
    paymentStatusLabels[status] ??
    status.replaceAll('_', ' ');
  return (
    <span
      className={clsx(
        'inline-flex rounded-full px-2.5 py-1 text-xs font-bold capitalize',
        tones[getStatusTone(status)],
      )}
    >
      {translated}
    </span>
  );
}

export function LoadingState({ label = 'Cargando información…' }: { label?: string }) {
  return (
    <div
      className="flex min-h-48 flex-col items-center justify-center gap-3 p-8 text-center text-artisan-muted"
      role="status"
    >
      <LoaderCircle className="h-7 w-7 animate-spin text-wine" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="m-4 flex min-h-40 flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <AlertCircle className="mb-3 h-7 w-7 text-red-700" />
      <h3 className="font-bold text-red-950">No pudimos cargar esta sección</h3>
      <p className="mt-1 max-w-lg text-sm text-red-800">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" /> Reintentar
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title = 'Aún no hay registros',
  description = 'Cuando se cree el primer registro aparecerá en esta sección.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center p-8 text-center">
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-artisan-paper text-wine">
        <Inbox className="h-6 w-6" />
      </span>
      <h3 className="font-bold text-artisan-ink">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-artisan-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ExportCsvButton({
  filename,
  rows,
  disabled,
}: {
  filename: string;
  rows: Record<string, unknown>[];
  disabled?: boolean;
}) {
  return (
    <Button
      variant="secondary"
      disabled={disabled || !rows.length}
      onClick={() => downloadCsv(filename, rows)}
    >
      <Download className="h-4 w-4" /> Exportar CSV
    </Button>
  );
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  size = 'md',
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  if (!open) return null;
  const widths = { md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-artisan-ink/55 p-0 backdrop-blur-sm sm:place-items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-modal-title"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className={clsx(
          'max-h-[94vh] w-full overflow-y-auto rounded-t-3xl bg-artisan-cream shadow-2xl sm:rounded-3xl',
          widths[size],
        )}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-artisan-line bg-artisan-cream/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 id="admin-modal-title" className="font-display text-2xl font-bold text-artisan-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-artisan-muted">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-artisan-muted hover:bg-artisan-paper hover:text-wine"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  onRowClick,
  rowLabel,
}: {
  rows: T[];
  columns: TableColumn<T>[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-artisan-line bg-artisan-paper/55">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={clsx(
                    'px-4 py-3 text-xs font-black uppercase tracking-[0.1em] text-artisan-muted',
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-artisan-line">
            {rows.map((row) => (
              <tr
                key={getRowKey(row)}
                className={clsx(
                  'bg-white transition hover:bg-artisan-cream/60',
                  onRowClick && 'cursor-pointer',
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={clsx('px-4 py-3.5 align-middle text-artisan-ink', column.className)}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-artisan-line md:hidden">
        {rows.map((row) => (
          <article
            key={getRowKey(row)}
            className={clsx(
              'space-y-3 bg-white p-4',
              onRowClick && 'cursor-pointer active:bg-artisan-cream',
            )}
            onClick={() => onRowClick?.(row)}
            aria-label={rowLabel?.(row)}
          >
            {columns.map((column, index) => (
              <div
                key={column.key}
                className={clsx('flex items-start justify-between gap-4', index === 0 && 'pb-1')}
              >
                <span className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
                  {column.header}
                </span>
                <div className="min-w-0 text-right text-sm text-artisan-ink">
                  {column.render(row)}
                </div>
              </div>
            ))}
          </article>
        ))}
      </div>
    </>
  );
}
