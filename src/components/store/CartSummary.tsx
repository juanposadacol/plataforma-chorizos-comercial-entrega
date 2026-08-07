import { ArrowRight, LockKeyhole, ShoppingBag, Trash2 } from 'lucide-react';
import { packSizeLabel } from '../../domain/packs';
import { formatMoney } from '../../lib/format';
import type { CartLine, Product, SelectOption } from '../../types/domain';

export function CartSummary({
  products,
  lines,
  deliveryMethod,
  onRemoveLine,
}: {
  products: Product[];
  /** Una fila por producto y presentación. */
  lines: CartLine[];
  deliveryMethod?: SelectOption;
  onRemoveLine: (key: string) => void;
}) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const rows = lines
    .map((line) => ({ line, product: productById.get(line.productId) }))
    .filter((row): row is { line: CartLine; product: Product } => Boolean(row.product));
  const subtotal = rows.reduce(
    (sum, { line, product }) => sum + product.effective_price * line.quantity,
    0,
  );
  const fee = Number(deliveryMethod?.fee ?? 0);
  const total = subtotal + fee;
  const units = rows.reduce((sum, { line }) => sum + line.quantity, 0);
  return (
    <aside className="cart-summary card" aria-label="Resumen del pedido">
      <div className="card-title">
        <span>2</span>
        <div>
          <p className="eyebrow eyebrow--wine">Tu selección</p>
          <h2>Resumen</h2>
          <p>Precios informativos; se validan al confirmar.</p>
        </div>
      </div>
      {!rows.length ? (
        <div className="empty-cart">
          <ShoppingBag aria-hidden="true" />
          <strong>Tu carrito está vacío</strong>
          <p>Agrega al menos un paquete para continuar.</p>
        </div>
      ) : (
        <div className="summary-lines" aria-live="polite">
          {rows.map(({ line, product }) => (
            <div className="summary-product" key={line.key}>
              <img src={product.image_url} alt="" />
              <div>
                <strong>{product.name}</strong>
                <span>
                  {line.quantity} × {formatMoney(product.effective_price)}
                </span>
                <span className="summary-pack">{packSizeLabel(line.packSize)}</span>
              </div>
              <div className="summary-product-total">
                <strong>{formatMoney(product.effective_price * line.quantity)}</strong>
                <button
                  type="button"
                  onClick={() => onRemoveLine(line.key)}
                  aria-label={`Quitar ${product.name} de ${packSizeLabel(line.packSize)}`}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="totals">
        <div>
          <span>Paquetes</span>
          <strong>{units}</strong>
        </div>
        <div>
          <span>Subtotal</span>
          <strong>{formatMoney(subtotal)}</strong>
        </div>
        <div>
          <span>Domicilio</span>
          <strong>{fee ? formatMoney(fee) : 'Por confirmar'}</strong>
        </div>
        <div className="grand">
          <span>Total estimado</span>
          <strong>{formatMoney(total)}</strong>
        </div>
      </div>
      <a
        className={rows.length ? 'summary-continue' : 'summary-continue disabled'}
        href={rows.length ? '#datos-entrega' : '#catalogo'}
      >
        {rows.length ? 'Completar datos' : 'Elegir productos'} <ArrowRight aria-hidden="true" />
      </a>
      <p className="summary-security">
        <LockKeyhole aria-hidden="true" /> Tu pedido se guarda antes de abrir WhatsApp.
      </p>
    </aside>
  );
}
