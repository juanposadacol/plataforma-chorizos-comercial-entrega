import { useQuery } from '@tanstack/react-query';
import { History, LogIn, RotateCcw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/AsyncState';
import { useAuth } from '../features/auth/AuthContext';
import { useCart } from '../features/cart/CartContext';
import { getMyOrders, repeatOrderItems } from '../features/orders/orderApi';
import { getErrorMessage } from '../lib/errors';
import { formatDate, formatMoney } from '../lib/format';
import type { TrackingOrder } from '../types/domain';

export function CustomerOrdersPage() {
  const { user } = useAuth();
  const { replace } = useCart();
  const navigate = useNavigate();
  const orders = useQuery({
    queryKey: ['my-orders', user?.id],
    queryFn: getMyOrders,
    enabled: Boolean(user),
  });
  if (!user)
    return (
      <main className="center-page">
        <LogIn />
        <h1>Inicia sesión para ver tus pedidos</h1>
        <p>Usa el mismo celular con el que compras.</p>
        <Link className="primary-button" to="/">
          Volver a la tienda
        </Link>
      </main>
    );
  if (orders.isLoading)
    return (
      <main className="content-page">
        <LoadingState />
      </main>
    );
  if (orders.error)
    return (
      <main className="content-page">
        <ErrorState message={getErrorMessage(orders.error)} />
      </main>
    );
  if (!orders.data?.length)
    return (
      <main className="content-page">
        <EmptyState
          title="Aún no tienes pedidos"
          message="Cuando compres, tu historial aparecerá aquí."
          action={
            <Link className="inline-button" to="/">
              Ir a la tienda
            </Link>
          }
        />
      </main>
    );
  const repeat = (order: TrackingOrder) => {
    const items = repeatOrderItems(order);
    if (items.length) replace(items);
    navigate('/#datos-entrega');
  };
  return (
    <main className="content-page">
      <div className="page-heading">
        <History />
        <div>
          <p className="eyebrow eyebrow--wine">Tu cuenta</p>
          <h1>Mis pedidos</h1>
          <p>Consulta detalles, seguimiento y vuelve a pedir.</p>
        </div>
      </div>
      <div className="order-history-grid">
        {orders.data.map((order) => (
          <article className="order-history-card" key={order.order_id}>
            <div>
              <span>{formatDate(order.created_at)}</span>
              <strong>{order.order_number}</strong>
            </div>
            <p>{order.items.map((item) => `${item.quantity} ${item.name}`).join(' · ')}</p>
            <div>
              <span className="status-pill">{order.status}</span>
              <strong>{formatMoney(order.total)}</strong>
            </div>
            <div className="history-actions">
              <Link to={`/seguir/${order.tracking_token}`}>Ver seguimiento</Link>
              <button type="button" onClick={() => repeat(order)}>
                <RotateCcw /> Repetir
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
