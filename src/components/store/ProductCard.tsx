import { BadgeCheck, CircleCheck, Package } from 'lucide-react';
import { basePresentation, type PackSize } from '../../domain/packs';
import { formatMoney } from '../../lib/format';
import type { Product } from '../../types/domain';
import { PackSizeSelector } from './PackSizeSelector';
import { QuantitySelector } from './QuantitySelector';

export function ProductCard({
  product,
  quantity,
  packSize,
  onIncrement,
  onDecrement,
  onPackSize,
}: {
  product: Product;
  quantity: number;
  packSize: PackSize;
  onIncrement: () => void;
  onDecrement: () => void;
  onPackSize: (packSize: PackSize) => void;
}) {
  const available = product.allow_backorder || product.stock_available > 0;
  const presentation = basePresentation(product.presentation);
  return (
    <article className="product-card">
      <div className="product-image-wrap">
        <img
          src={product.image_url}
          alt={`Chorizo ${product.name}, ${presentation}`}
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
            <Package aria-hidden="true" /> {presentation}
          </span>
          <span className={available ? 'stock stock--ok' : 'stock stock--out'}>
            <CircleCheck aria-hidden="true" /> {available ? 'Disponible' : 'Agotado'}
          </span>
        </div>
        {available ? (
          <>
            <PackSizeSelector
              productId={product.id}
              productName={product.name}
              value={packSize}
              onChange={onPackSize}
            />
            <QuantitySelector
              name={product.name}
              value={quantity}
              maximum={product.allow_backorder ? 999 : product.stock_available}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
            />
          </>
        ) : (
          <p className="out-of-stock">Este producto no está disponible por ahora.</p>
        )}
      </div>
    </article>
  );
}
