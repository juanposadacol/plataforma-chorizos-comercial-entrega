import { DEFAULT_PACK_SIZE, type PackSize } from '../../domain/packs';
import type { CartLine, Product } from '../../types/domain';
import { EmptyState } from '../ui/AsyncState';
import { ProductCard } from './ProductCard';

interface ProductGridProps {
  products: Product[];
  /** Presentación activa por producto. */
  selectedPack: Record<string, PackSize>;
  /** Cantidad de la presentación activa. */
  quantityOf: (productId: string, packSize: PackSize) => number;
  /** Líneas ya agregadas de cada producto. */
  linesOfProduct: (productId: string) => CartLine[];
  onIncrement: (id: string, packSize: PackSize) => void;
  onDecrement: (id: string, packSize: PackSize) => void;
  onPackSize: (id: string, packSize: PackSize) => void;
  onRemoveLine: (key: string) => void;
}

export function ProductGrid({
  products,
  selectedPack,
  quantityOf,
  linesOfProduct,
  onIncrement,
  onDecrement,
  onPackSize,
  onRemoveLine,
}: ProductGridProps) {
  if (!products.length)
    return <EmptyState title="No encontramos productos" message="Prueba con otra categoría." />;
  return (
    <div className="products-grid">
      {products.map((product) => {
        const packSize = selectedPack[product.id] ?? DEFAULT_PACK_SIZE;
        return (
          <ProductCard
            key={product.id}
            product={product}
            packSize={packSize}
            quantity={quantityOf(product.id, packSize)}
            lines={linesOfProduct(product.id)}
            onIncrement={() => onIncrement(product.id, packSize)}
            onDecrement={() => onDecrement(product.id, packSize)}
            onPackSize={(next) => onPackSize(product.id, next)}
            onRemoveLine={onRemoveLine}
          />
        );
      })}
    </div>
  );
}

export function CatalogFilters({
  categories,
  selectedCategory,
  onCategory,
}: {
  categories: string[];
  selectedCategory: string;
  onCategory: (value: string) => void;
}) {
  return (
    <div className="catalog-filters">
      <div className="category-chips" role="group" aria-label="Filtrar por categoría">
        {['Todos', ...categories].map((category) => (
          <button
            key={category}
            type="button"
            className={selectedCategory === category ? 'active' : ''}
            onClick={() => onCategory(category)}
          >
            {category}
          </button>
        ))}
      </div>
    </div>
  );
}
