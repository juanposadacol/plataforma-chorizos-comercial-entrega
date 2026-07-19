import { useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { AdminOrder } from '../types';
import { orderAmountPaid, orderBalance, orderTotal } from '../types';
import { canDeliverViaCombinedAction, firstText, formatMoney } from '../utils';
import { Button, inputClass, labelClass, Modal } from '../components/AdminUi';
import { invokeAdminRpc } from '../adminService';
import { usePaymentMethods } from '../usePaymentMethods';
import { useAuth } from '../../auth/AuthContext';

interface Props {
  open: boolean;
  order: AdminOrder;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export function DeliverAndPayModal({ open, order, onClose, onSuccess }: Props) {
  // H-03: pagado/saldo siempre se leen de orders.amount_paid/total_amount — la
  // única fuente autoritativa, mantenida por register_payment/deliver_and_pay_order
  // en el servidor. Nunca se re-derivan sumando un array de pagos local (esa suma
  // podía llegar vacía, desactualizada o con un filtro de estado distinto).
  const totalAmount = orderTotal(order);
  const approvedPaid = orderAmountPaid(order);
  const balance = orderBalance(order);

  const { access } = useAuth();
  const { methods: paymentMethods } = usePaymentMethods();
  // Stores the UUID of the selected method; falls back to first available when empty.
  const [methodId, setMethodId] = useState('');
  const resolvedMethodId = methodId || (paymentMethods[0]?.id ?? '');
  const [amount, setAmount] = useState(String(balance > 0 ? Math.round(balance) : 0));
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // H-05: generada una sola vez por apertura del modal (una vez por "operación" en
  // curso) y NUNCA regenerada mientras haya un intento pendiente o se reintente
  // tras un error — así un reintento de red no puede registrar un segundo pago.
  // Como este componente se monta de nuevo cada vez que se abre (ver OrdersTable/
  // OrderDetailPage: `{condition && <DeliverAndPayModal .../>}`), una nueva llave
  // se genera automáticamente al iniciar una nueva operación (pedido distinto,
  // reapertura tras éxito o cancelación) sin necesidad de lógica adicional.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const alreadyDelivered = order.status === 'delivered';
  const alreadyPaid = order.payment_status === 'paid';
  // H-13: contabilidad y vendedor pueden pagar cualquier pedido, pero ninguno
  // de los dos puede disparar el paso de entrega de esta acción combinada —
  // solo superadmin/admin, igual que exige el servidor (transition_order_status
  // ya bloquea a un vendedor sin rol de bodega de avanzar más allá de
  // 'confirmed'). Si el pedido ya está entregado no aplica: solo se
  // registrará el pago.
  const canDeliver = alreadyDelivered || canDeliverViaCombinedAction(access.roles);

  const handleClose = () => {
    if (!saving) {
      setError(null);
      onClose();
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return; // Guardia extra contra doble envío por reentrancia.
    const payAmount = Number(amount);
    if (payAmount < 0) {
      setError('El valor no puede ser negativo.');
      return;
    }
    if (payAmount > balance) {
      setError('El valor supera el saldo pendiente.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await invokeAdminRpc('deliver_and_pay_order', {
        p_order_id: order.id,
        p_payment_method_id: resolvedMethodId,
        p_amount: payAmount > 0 ? payAmount : null,
        p_reference: reference || null,
        p_notes: 'Entregado y pagado desde el panel de administración',
        p_idempotency_key: idempotencyKey,
      });
      await onSuccess();
      onClose();
    } catch (caught) {
      // No se regenera idempotencyKey aquí: un reintento (mismo timeout, mismo
      // error) debe reutilizar la misma llave para que el servidor lo trate como
      // el mismo intento, nunca como un pago nuevo.
      setError(caught instanceof Error ? caught.message : 'No fue posible completar la acción.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="Marcar como entregado y pagado" onClose={handleClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-artisan-paper p-4 text-sm">
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Pedido</p>
            <p className="mt-1 font-black">
              #{firstText(order, 'order_number', 'consecutive') || order.id.slice(0, 8)}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Cliente</p>
            <p className="mt-1 font-semibold">
              {firstText(order, 'customer_name_snapshot', 'customer_name') || '—'}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Total</p>
            <p className="mt-1 font-black">{formatMoney(totalAmount)}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Ya pagado</p>
            <p className="mt-1 font-semibold text-emerald-700">{formatMoney(approvedPaid)}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs font-bold uppercase text-artisan-muted">Saldo pendiente</p>
            <p className="mt-1 font-black text-wine">{formatMoney(balance)}</p>
          </div>
        </div>

        {alreadyDelivered && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            Este pedido ya está marcado como entregado. Se registrará únicamente el pago.
          </div>
        )}

        {!canDeliver && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Tu rol solo puede registrar pagos de pedidos ya entregados. Pide a un administrador o
            a bodega que marque la entrega primero, o usa "Registrar pago" en Pagos y cartera una
            vez entregado.
          </div>
        )}

        {balance > 0 && !alreadyPaid && (
          <>
            <label>
              <span className={labelClass}>Método de pago</span>
              <select
                className={inputClass}
                value={resolvedMethodId}
                onChange={(event) => setMethodId(event.target.value)}
              >
                {paymentMethods.length === 0 && (
                  <option value="">Cargando métodos…</option>
                )}
                {paymentMethods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelClass}>Valor a pagar</span>
              <input
                type="number"
                min="0"
                max={balance}
                step="1"
                className={inputClass}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <p className="mt-1 text-xs text-artisan-muted">
                Deja en 0 para registrar solo la entrega sin pago.
              </p>
            </label>
            <label>
              <span className={labelClass}>Referencia (opcional)</span>
              <input
                className={inputClass}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Número de transacción o comprobante"
              />
            </label>
          </>
        )}

        {alreadyPaid && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            Este pedido ya está totalmente pagado. Se registrará únicamente la entrega.
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div>
        )}

        <div className="flex justify-end gap-2 border-t border-artisan-line pt-4">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving || !canDeliver}>
            <CheckCircle2 className="h-4 w-4" />
            {saving
              ? 'Procesando…'
              : !canDeliver
                ? 'Sin permiso para entregar'
                : alreadyPaid
                  ? 'Marcar como entregado'
                  : balance === 0
                    ? 'Marcar como entregado'
                    : 'Entregar y pagar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

