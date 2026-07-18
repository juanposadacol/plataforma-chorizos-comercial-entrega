import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AdminProduct } from '../types';
import { firstText, toNumber } from '../utils';
import { EmptyState, panelClass, SectionTitle } from '../components/AdminUi';

export function InventoryAlerts({ products }: { products: AdminProduct[] }) {
  const lowStock = products
    .filter(
      (product) =>
        toNumber(product.stock_available ?? product.stock_current ?? product.stock_on_hand) <=
        toNumber(product.minimum_stock),
    )
    .sort(
      (a, b) =>
        toNumber(a.stock_available ?? a.stock_current) -
        toNumber(b.stock_available ?? b.stock_current),
    )
    .slice(0, 8);
  return (
    <article className={`${panelClass} overflow-hidden`}>
      <SectionTitle
        title="Alertas de inventario"
        description="Productos disponibles en o por debajo de su mínimo."
        action={
          <Link
            to="/admin/inventario"
            className="inline-flex items-center gap-1 text-sm font-bold text-wine hover:underline"
          >
            Ver kardex <ArrowRight className="h-4 w-4" />
          </Link>
        }
      />
      {lowStock.length === 0 ? (
        <EmptyState
          title="Inventario saludable"
          description="No hay productos por debajo del stock mínimo configurado."
        />
      ) : (
        <ul className="divide-y divide-artisan-line">
          {lowStock.map((product) => {
            const available = toNumber(
              product.stock_available ?? product.stock_current ?? product.stock_on_hand,
            );
            return (
              <li key={product.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-artisan-ink">
                    {firstText(product, 'name')}
                  </p>
                  <p className="text-xs text-artisan-muted">
                    SKU {firstText(product, 'sku') || 'sin asignar'} · mínimo{' '}
                    {toNumber(product.minimum_stock)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black text-wine">{available}</p>
                  <p className="text-[11px] uppercase tracking-wide text-artisan-muted">
                    disponibles
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
