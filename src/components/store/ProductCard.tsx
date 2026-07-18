import { BadgeCheck, Package, Warehouse } from 'lucide-react';
import { formatMoney } from '../../lib/format';
import type { Product } from '../../types/domain';
import { QuantitySelector } from './QuantitySelector';

export function ProductCard({
  product,
  quantity,
  onIncrement,
  onDecrement,
}: {
  product: Product;
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const available = product.allow_backorder || product.stock_available > 0;
  return (
    <article className="product-card">
      <div className="product-image-wrap">
        <img
          src={product.image_url}
          alt={`Chorizo ${product.name}, ${product.presentation}`}
          loading="lazy"
          width="1254"
          height="1254"
        />
        {product.is_featured && (
          <span className="featured-badge">
            <BadgeCheck aria-hidden="true" /> Favorito
          </span>
        )}
      </div>
      <div className="product-body">
        <div className="product-heading">
          <div>
            <p className="product-category">{product.category_name}</p>
            <h3>{product.name}</h3>
          </div>
          <strong className="price">{formatMoney(product.effective_price)}</strong>
        </div>
        <p className="product-description">{product.short_description}</p>
        <div className="product-meta">
          <span>
            <Package aria-hidden="true" /> {product.presentation}
          </span>
          <span className={available ? 'stock stock--ok' : 'stock stock--out'}>
            <Warehouse aria-hidden="true" />{' '}
            {available ? `${product.stock_available} disponibles` : 'Agotado'}
          </span>
        </div>
        {available ? (
          <QuantitySelector
            name={product.name}
            value={quantity}
            maximum={product.allow_backorder ? 999 : product.stock_available}
            onIncrement={onIncrement}
            onDecrement={onDecrement}
          />
        ) : (
          <p className="out-of-stock">Este producto no está disponible por ahora.</p>
        )}
      </div>
    </article>
  );
}
