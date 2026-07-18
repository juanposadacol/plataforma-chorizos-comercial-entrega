import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { clsx } from 'clsx';
import { panelClass } from '../components/AdminUi';

export interface DashboardMetric {
  label: string;
  value: string;
  helper?: string;
  change?: number | null;
  icon: LucideIcon;
  accent?: 'wine' | 'gold' | 'green' | 'blue';
}

export function DashboardCards({ metrics }: { metrics: DashboardMetric[] }) {
  const accents = {
    wine: 'bg-wine/10 text-wine',
    gold: 'bg-amber-100 text-amber-800',
    green: 'bg-emerald-100 text-emerald-800',
    blue: 'bg-sky-100 text-sky-800',
  };
  return (
    <section
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5"
      aria-label="Indicadores del negocio"
    >
      {metrics.map(({ label, value, helper, change, icon: Icon, accent = 'wine' }) => (
        <article key={label} className={clsx(panelClass, 'relative overflow-hidden p-4 sm:p-5')}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.1em] text-artisan-muted">
                {label}
              </p>
              <p
                className="mt-2 truncate font-display text-2xl font-bold text-artisan-ink"
                title={value}
              >
                {value}
              </p>
            </div>
            <span
              className={clsx(
                'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
                accents[accent],
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
          </div>
          <div className="mt-3 flex min-h-5 items-center gap-1.5 text-xs">
            {change == null ? (
              <Minus className="h-3.5 w-3.5 text-artisan-muted" />
            ) : change >= 0 ? (
              <ArrowUpRight className="h-3.5 w-3.5 text-emerald-700" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5 text-red-700" />
            )}
            {change != null && (
              <span
                className={change >= 0 ? 'font-bold text-emerald-700' : 'font-bold text-red-700'}
              >
                {Math.abs(change).toFixed(1)}%
              </span>
            )}
            <span className="truncate text-artisan-muted">{helper}</span>
          </div>
        </article>
      ))}
    </section>
  );
}
