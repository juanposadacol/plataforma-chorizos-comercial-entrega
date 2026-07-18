import { useMemo, useState } from 'react';
import { Bell, CheckCheck, ExternalLink, MessageCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AdminNotification } from '../../features/admin/types';
import { invokeAdminRpc, updateRecord } from '../../features/admin/adminService';
import { useAdminData } from '../../features/admin/useAdminData';
import { formatAdminDate, matchesSearch } from '../../features/admin/utils';
import {
  Button,
  EmptyState,
  ErrorState,
  ExportCsvButton,
  inputClass,
  LoadingState,
  PageHeader,
  panelClass,
  SearchField,
  StatusBadge,
} from '../../features/admin/components/AdminUi';

interface Delivery extends Record<string, unknown> {
  id: string;
  notification_id: string;
  channel: string;
  recipient?: string;
  status: string;
  attempts?: number;
  error_message?: string | null;
  external_id?: string | null;
  sent_at?: string | null;
  created_at: string;
}

export function NotificationsPage() {
  const notificationsState = useAdminData<AdminNotification>(
    'notifications',
    { orderBy: 'created_at', limit: 1000 },
    true,
  );
  const deliveriesState = useAdminData<Delivery>(
    'notification_deliveries',
    { orderBy: 'created_at', limit: 2000 },
    true,
  );
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const deliveryByNotification = useMemo(() => {
    const map = new Map<string, Delivery[]>();
    deliveriesState.data.forEach((delivery) =>
      map.set(delivery.notification_id, [...(map.get(delivery.notification_id) ?? []), delivery]),
    );
    return map;
  }, [deliveriesState.data]);
  const filtered = useMemo(
    () =>
      notificationsState.data.filter(
        (notification) =>
          matchesSearch(notification, search) &&
          (filter === 'all' ||
            (filter === 'unread'
              ? !notification.is_read
              : filter === 'read'
                ? notification.is_read
                : (deliveryByNotification.get(notification.id) ?? []).some(
                    (delivery) => delivery.status === filter,
                  ))),
      ),
    [deliveryByNotification, filter, notificationsState.data, search],
  );
  const unread = notificationsState.data.filter((notification) => !notification.is_read).length;
  const failed = deliveriesState.data.filter((delivery) => delivery.status === 'failed').length;
  const pending = deliveriesState.data.filter((delivery) =>
    ['pending', 'queued', 'processing'].includes(delivery.status),
  ).length;

  const markRead = async (notification: AdminNotification) => {
    if (notification.is_read) return;
    setWorking(notification.id);
    setError(null);
    try {
      await updateRecord('notifications', notification.id, { is_read: true });
      await notificationsState.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible marcar la notificación.');
    } finally {
      setWorking(null);
    }
  };
  const markAllRead = async () => {
    setWorking('all');
    setError(null);
    try {
      await Promise.all(
        notificationsState.data
          .filter((item) => !item.is_read)
          .map((item) => updateRecord('notifications', item.id, { is_read: true })),
      );
      setMessage('Todas las notificaciones quedaron marcadas como leídas.');
      window.setTimeout(() => setMessage(null), 4000);
      await notificationsState.reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'No fue posible actualizar las notificaciones.',
      );
    } finally {
      setWorking(null);
    }
  };
  const retry = async (notificationId: string) => {
    setWorking(notificationId);
    setError(null);
    try {
      await invokeAdminRpc('retry_notification_delivery', { p_notification_id: notificationId });
      setMessage(
        'Reintento programado. El pedido permanece guardado aunque WhatsApp tarde o falle.',
      );
      window.setTimeout(() => setMessage(null), 4500);
      await deliveriesState.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible programar el reintento.');
    } finally {
      setWorking(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Comunicaciones"
        title="Notificaciones"
        description="Revisa eventos internos y el estado de entrega por WhatsApp. Los pedidos permanecen seguros aunque el proveedor de mensajería falle."
        actions={
          <>
            <ExportCsvButton filename="notificaciones" rows={filtered} />
            <Button
              variant="secondary"
              disabled={!unread || working === 'all'}
              onClick={() => void markAllRead()}
            >
              <CheckCheck className="h-4 w-4" />
              Marcar todas leídas
            </Button>
          </>
        }
      />
      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <section className="grid gap-3 sm:grid-cols-3">
        <article className={`${panelClass} flex items-center gap-4 p-5`}>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-wine/10 text-wine">
            <Bell className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">Sin leer</p>
            <p className="font-display text-2xl font-bold">{unread}</p>
          </div>
        </article>
        <article className={`${panelClass} flex items-center gap-4 p-5`}>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-800">
            <RefreshCw className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
              En proceso
            </p>
            <p className="font-display text-2xl font-bold">{pending}</p>
          </div>
        </article>
        <article className={`${panelClass} flex items-center gap-4 p-5`}>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-red-100 text-red-800">
            <MessageCircle className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">Fallidas</p>
            <p className="font-display text-2xl font-bold">{failed}</p>
          </div>
        </article>
      </section>
      <div className="flex flex-col gap-3 sm:flex-row">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Buscar título, mensaje, tipo o pedido…"
        />
        <select
          className={`${inputClass} w-auto`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">Todas</option>
          <option value="unread">Sin leer</option>
          <option value="read">Leídas</option>
          <option value="pending">Entrega pendiente</option>
          <option value="sent">Enviadas</option>
          <option value="failed">Fallidas</option>
        </select>
      </div>
      <section className={`${panelClass} overflow-hidden`}>
        {notificationsState.loading || deliveriesState.loading ? (
          <LoadingState />
        ) : notificationsState.error || deliveriesState.error ? (
          <ErrorState
            message={notificationsState.error || deliveriesState.error || ''}
            onRetry={() =>
              void Promise.all([notificationsState.reload(), deliveriesState.reload()])
            }
          />
        ) : filtered.length ? (
          <div className="divide-y divide-artisan-line">
            {filtered.map((notification) => {
              const deliveries = deliveryByNotification.get(notification.id) ?? [];
              const retryable = deliveries.some((delivery) =>
                ['failed', 'pending'].includes(delivery.status),
              );
              return (
                <article
                  key={notification.id}
                  className={`p-5 transition ${notification.is_read ? 'bg-white' : 'bg-wine/[0.035]'}`}
                  onClick={() => void markRead(notification)}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <span
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${notification.is_read ? 'bg-artisan-paper text-artisan-muted' : 'bg-wine text-white'}`}
                    >
                      <Bell className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-bold text-artisan-ink">{notification.title}</h2>
                        {!notification.is_read && <span className="h-2 w-2 rounded-full bg-wine" />}
                        <span className="text-xs text-artisan-muted">
                          {formatAdminDate(notification.created_at, true)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-artisan-muted">
                        {notification.body ?? notification.message ?? 'Sin detalle'}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {deliveries.length ? (
                          deliveries.map((delivery) => (
                            <span
                              key={delivery.id}
                              title={delivery.error_message ?? undefined}
                              className="inline-flex items-center gap-1 rounded-full bg-artisan-paper px-2.5 py-1 text-xs"
                            >
                              <MessageCircle className="h-3 w-3" />
                              {delivery.channel}: <StatusBadge status={delivery.status} />
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-artisan-muted">Notificación interna</span>
                        )}
                      </div>
                    </div>
                    <div
                      className="flex shrink-0 gap-2"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {retryable && (
                        <Button
                          variant="secondary"
                          className="min-h-9 px-3"
                          disabled={working === notification.id}
                          onClick={() => void retry(notification.id)}
                        >
                          <RotateCcw className="h-4 w-4" />
                          Reintentar
                        </Button>
                      )}
                      {notification.order_id && (
                        <Link
                          to={`/admin/pedidos/${notification.order_id}`}
                          className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-wine px-3 py-2 text-sm font-bold text-white hover:bg-wine-dark"
                        >
                          Ver pedido <ExternalLink className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="Sin notificaciones"
            description="Los nuevos pedidos, alertas de inventario y entregas de WhatsApp aparecerán aquí."
          />
        )}
      </section>
    </>
  );
}
export default NotificationsPage;
