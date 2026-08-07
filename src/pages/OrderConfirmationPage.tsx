import { CheckCircle2, ExternalLink, MessageCircle, PackageCheck } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { formatMoney } from '../lib/format';
import type { OrderResult } from '../types/domain';

export function OrderConfirmationPage() {
  const { state } = useLocation();
  const order = (state as { order?: OrderResult } | null)?.order;
  if (!order)
    return (
      <main className="center-page">
        <PackageCheck />
        <h1>No hay una confirmación reciente</h1>
        <p>Si ya hiciste un pedido, consúltalo con su enlace de seguimiento.</p>
        <Link className="primary-button" to="/seguir">
          Seguir un pedido
        </Link>
      </main>
    );
  return (
    <main className="confirmation-page">
      <section className="confirmation-card">
        <span className="confirmation-icon">
          <CheckCircle2 />
        </span>
        <p className="eyebrow eyebrow--wine">Pedido guardado</p>
        <h1>¡Gracias por tu compra!</h1>
        <p>
          Tu pedido ya existe en el sistema. La notificación de WhatsApp es independiente y no
          afecta esta confirmación.
        </p>
        <div className="order-number">
          <span>Número de pedido</span>
          <strong>{order.order_number}</strong>
        </div>
        <div className="confirmation-total">
          <span>Total autorizado</span>
          <strong>{formatMoney(order.total)}</strong>
        </div>
        {order.manual_whatsapp_url && (
          <div className="confirmation-actions">
            <a
              className="whatsapp-button"
              href={order.manual_whatsapp_url}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle /> Avisar por WhatsApp <ExternalLink />
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
