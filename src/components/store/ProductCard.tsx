import { BadgeCheck, CircleCheck, Package, Trash2 } from 'lucide-react';
import { basePresentation, packSizeLabel, type PackSize } from '../../domain/packs';
import { formatMoney } from '../../lib/format';
import type { CartLine, Product } from '../../types/domain';
import { PackSizeSelector } from './PackSizeSelector';
import { QuantitySelector } from './QuantitySelector';

export function ProductCard({
  product,
  quantity,
  packSize,
  lines,
  onIncrement,
  onDecrement,
  onPackSize,
  onRemoveLine,
}: {
  product: Product;
  /** Paquetes de la presentación seleccionada en esta tarjeta. */
  quantity: number;
  packSize: PackSize;
  /** Todas las presentaciones de este producto que ya están en el carrito. */
  lines: CartLine[];
  onIncrement: () => void;
  onDecrement: () => void;
  onPackSize: (packSize: PackSize) => void;
  onRemoveLine: (key: string) => void;
}) {
  const available = product.allow_backorder || product.stock_available > 0;
  // 'special', 'volume' o 'list': el servidor resolvió un precio propio de este
  // comprador, distinto del público.
  const agreedPrice = Boolean(product.price_source && product.price_source !== 'public');
  const presentation = basePresentation(product.presentation);
  const unitsInCart = lines.reduce((sum, line) => sum + line.quantity, 0);
  // El tope es por producto: las presentaciones comparten el mismo inventario.
  const maximum = product.allow_backorder
    ? 999
    : Math.max(quantity, product.stock_available - (unitsInCart - quantity));
  return (
    <article className="product-card">
      <div className="product-image-wrap">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={`Chorizo ${product.name}, ${presentation}`}
            loading="lazy"
            width="1254"
            height="1254"
          />
        ) : (
          // Un producto sin fotografía no puede tomar prestada la de otro:
          // ese respaldo era lo que hacía ver los tres chorizos iguales.
          <span className="product-image-placeholder" role="img" aria-label={product.name}>
            {product.name.slice(0, 1)}
          </span>
        )}
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
          <div className="price-block">
            <strong className="price">{formatMoney(product.effective_price)}</strong>
            {/* El precio acordado se ve aquí, no al final de la compra. */}
            {agreedPrice && (
              <span className="price-tag">
                Tu precio
                {product.public_price > product.effective_price && (
                  <em>antes {formatMoney(product.public_price)}</em>
                )}
              </span>
            )}
          </div>
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
              name={`${product.name} de ${packSizeLabel(packSize)}`}
              value={quantity}
              maximum={maximum}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
            />
            {lines.length > 0 && (
              <ul className="product-cart-lines" aria-label={`${product.name} en el carrito`}>
                {lines.map((line) => (
                  <li key={line.key} className={line.packSize === packSize ? 'active' : undefined}>
                    <span>
                      {line.quantity} × {packSizeLabel(line.packSize)}
                    </span>
                    <strong>{formatMoney(product.effective_price * line.quantity)}</strong>
                    <button
                      type="button"
                      onClick={() => onRemoveLine(line.key)}
                      aria-label={`Quitar ${product.name} de ${packSizeLabel(line.packSize)}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="out-of-stock">Este producto no está disponible por ahora.</p>
        )}
      </div>
    </article>
  );
}
