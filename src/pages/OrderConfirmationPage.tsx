import { CheckCircle2, Copy, ExternalLink, Home, MessageCircle, PackageCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { formatMoney } from '../lib/format';
import type { OrderResult } from '../types/domain';

export function OrderConfirmationPage() {
  const { state } = useLocation();
  const order = (state as { order?: OrderResult } | null)?.order;
  const [copied, setCopied] = useState(false);
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
  const trackingUrl = `${window.location.origin}/seguir/${order.tracking_token}`;
  const copy = async () => {
    await navigator.clipboard.writeText(trackingUrl);
    setCopied(true);
  };
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
        <dl className="confirmation-details">
          <div>
            <dt>Estado</dt>
            <dd>{order.status}</dd>
          </div>
          <div>
            <dt>Pago</dt>
            <dd>{order.payment_status}</dd>
          </div>
          <div>
            <dt>Notificación</dt>
            <dd>{order.notification_status ?? 'Pendiente'}</dd>
          </div>
        </dl>
        <div className="confirmation-actions">
          <Link className="primary-button" to={`/seguir/${order.tracking_token}`}>
            <PackageCheck /> Ver seguimiento
          </Link>
          <button className="secondary-button" onClick={() => void copy()}>
            <Copy /> {copied ? 'Enlace copiado' : 'Copiar enlace'}
          </button>
          {order.manual_whatsapp_url && (
            <a
              className="whatsapp-button"
              href={order.manual_whatsapp_url}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle /> Avisar por WhatsApp <ExternalLink />
            </a>
          )}
          <Link className="text-link" to="/">
            <Home /> Volver a la tienda
          </Link>
        </div>
      </section>
    </main>
  );
}
