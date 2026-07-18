import { Search } from 'lucide-react';
import type { Product } from '../../types/domain';
import { EmptyState } from '../ui/AsyncState';
import { ProductCard } from './ProductCard';

interface ProductGridProps {
  products: Product[];
  quantities: Record<string, number>;
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
}

export function ProductGrid({ products, quantities, onIncrement, onDecrement }: ProductGridProps) {
  if (!products.length)
    return (
      <EmptyState title="No encontramos productos" message="Prueba otra búsqueda o categoría." />
    );
  return (
    <div className="products-grid">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          quantity={quantities[product.id] ?? 0}
          onIncrement={() => onIncrement(product.id)}
          onDecrement={() => onDecrement(product.id)}
        />
      ))}
    </div>
  );
}

export function CatalogFilters({
  search,
  onSearch,
  categories,
  selectedCategory,
  onCategory,
}: {
  search: string;
  onSearch: (value: string) => void;
  categories: string[];
  selectedCategory: string;
  onCategory: (value: string) => void;
}) {
  return (
    <div className="catalog-filters">
      <label className="search-field">
        <Search aria-hidden="true" />
        <span className="sr-only">Buscar productos</span>
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Busca un sabor…"
        />
      </label>
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
