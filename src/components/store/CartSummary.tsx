import { ArrowRight, LockKeyhole, ShoppingBag, Trash2 } from 'lucide-react';
import { formatMoney } from '../../lib/format';
import type { Product, SelectOption } from '../../types/domain';

export function CartSummary({
  products,
  quantities,
  deliveryMethod,
  onRemove,
}: {
  products: Product[];
  quantities: Record<string, number>;
  deliveryMethod?: SelectOption;
  onRemove: (id: string) => void;
}) {
  const selected = products.filter((product) => (quantities[product.id] ?? 0) > 0);
  const subtotal = selected.reduce(
    (sum, product) => sum + product.effective_price * (quantities[product.id] ?? 0),
    0,
  );
  const fee = Number(deliveryMethod?.fee ?? 0);
  const total = subtotal + fee;
  const units = selected.reduce((sum, product) => sum + (quantities[product.id] ?? 0), 0);
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
      {!selected.length ? (
        <div className="empty-cart">
          <ShoppingBag aria-hidden="true" />
          <strong>Tu carrito está vacío</strong>
          <p>Agrega al menos un paquete para continuar.</p>
        </div>
      ) : (
        <div className="summary-lines" aria-live="polite">
          {selected.map((product) => (
            <div className="summary-product" key={product.id}>
              <img src={product.image_url} alt="" />
              <div>
                <strong>{product.name}</strong>
                <span>
                  {quantities[product.id]} × {formatMoney(product.effective_price)}
                </span>
              </div>
              <div className="summary-product-total">
                <strong>
                  {formatMoney(product.effective_price * (quantities[product.id] ?? 0))}
                </strong>
                <button
                  type="button"
                  onClick={() => onRemove(product.id)}
                  aria-label={`Quitar ${product.name}`}
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
        className={selected.length ? 'summary-continue' : 'summary-continue disabled'}
        href={selected.length ? '#datos-entrega' : '#catalogo'}
      >
        {selected.length ? 'Completar datos' : 'Elegir productos'} <ArrowRight aria-hidden="true" />
      </a>
      <p className="summary-security">
        <LockKeyhole aria-hidden="true" /> Tu pedido se guarda antes de abrir WhatsApp.
      </p>
    </aside>
  );
}
