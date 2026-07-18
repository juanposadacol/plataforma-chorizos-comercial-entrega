import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Clock3, MapPin, PackageSearch, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorState, LoadingState } from '../components/ui/AsyncState';
import { getOrderTracking } from '../features/orders/orderApi';
import { getErrorMessage } from '../lib/errors';
import { formatDateTime, formatMoney } from '../lib/format';

const statusOrder = [
  'new',
  'pending_confirmation',
  'confirmed',
  'preparing',
  'ready',
  'dispatched',
  'delivered',
];

export function OrderTrackingPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const order = useQuery({
    queryKey: ['tracking', token],
    queryFn: () => getOrderTracking(token ?? ''),
    enabled: Boolean(token),
    retry: false,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (value) navigate(`/seguir/${encodeURIComponent(value)}`);
  };
  if (!token)
    return (
      <main className="tracking-page">
        <section className="tracking-search card">
          <PackageSearch className="tracking-hero-icon" />
          <p className="eyebrow eyebrow--wine">Seguimiento</p>
          <h1>¿Cómo va tu pedido?</h1>
          <p>
            Pega el código seguro que recibiste al confirmar. No necesitas compartir información
            personal.
          </p>
          <form onSubmit={submit}>
            <label>
              Código de seguimiento
              <div className="search-code">
                <Search />
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Código del pedido"
                />
              </div>
            </label>
            <button className="primary-button" type="submit" disabled={!input.trim()}>
              Consultar <ArrowRight />
            </button>
          </form>
        </section>
      </main>
    );
  if (order.isLoading)
    return (
      <main className="tracking-page">
        <LoadingState label="Buscando tu pedido…" />
      </main>
    );
  if (order.error || !order.data)
    return (
      <main className="tracking-page">
        <ErrorState
          title="No encontramos el pedido"
          message={getErrorMessage(order.error)}
          action={
            <button className="inline-button" onClick={() => navigate('/seguir')}>
              Intentar otro código
            </button>
          }
        />
      </main>
    );
  const current = statusOrder.indexOf(order.data.status);
  return (
    <main className="tracking-page">
      <section className="tracking-card card">
        <div className="tracking-head">
          <div>
            <p className="eyebrow eyebrow--wine">Pedido {order.data.order_number}</p>
            <h1>{order.data.customer_name}, estamos preparando tu compra</h1>
            <p>
              <Clock3 /> Creado {formatDateTime(order.data.created_at)}
            </p>
          </div>
          <strong>{formatMoney(order.data.total)}</strong>
        </div>
        <div className="status-timeline">
          {statusOrder.map((status, index) => (
            <div
              key={status}
              className={index <= current ? 'status-step status-step--done' : 'status-step'}
            >
              <span>{index <= current ? <Check /> : index + 1}</span>
              <small>{status.replaceAll('_', ' ')}</small>
            </div>
          ))}
        </div>
        <div className="tracking-content">
          <div>
            <h2>Productos</h2>
            {order.data.items.map((item) => (
              <div className="tracking-item" key={`${item.sku}-${item.name}`}>
                <img src={item.image_url || '/assets/santa-rosano.png'} alt="" />
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.quantity} × {formatMoney(item.unit_price)}
                  </span>
                </div>
                <strong>{formatMoney(item.subtotal)}</strong>
              </div>
            ))}
          </div>
          <aside>
            <h2>Historial</h2>
            {order.data.history.map((item) => (
              <div className="history-line" key={`${item.status}-${item.created_at}`}>
                <span />
                <div>
                  <strong>{item.status.replaceAll('_', ' ')}</strong>
                  <small>{formatDateTime(item.created_at)}</small>
                  {item.note && <p>{item.note}</p>}
                </div>
              </div>
            ))}
          </aside>
        </div>
        <p className="tracking-address">
          <MapPin /> La dirección completa solo es visible para ti y el equipo autorizado.
        </p>
      </section>
    </main>
  );
}
