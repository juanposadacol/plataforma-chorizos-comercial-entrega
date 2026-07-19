import { useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { AdminOrder, Payment } from '../types';
import { orderTotal } from '../types';
import { firstText, formatMoney, toNumber } from '../utils';
import { Button, inputClass, labelClass, Modal } from '../components/AdminUi';
import { invokeAdminRpc } from '../adminService';
import { usePaymentMethods } from '../usePaymentMethods';

interface Props {
  open: boolean;
  order: AdminOrder;
  payments: Payment[];
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export function DeliverAndPayModal({ open, order, payments, onClose, onSuccess }: Props) {
  const totalAmount = orderTotal(order);
  const approvedPaid = payments
    .filter((p) => p.status === 'approved' && !p.deleted_at)
    .reduce((sum, p) => sum + toNumber(p.amount), 0);
  const balance = Math.max(0, totalAmount - approvedPaid);

  const { methods: paymentMethods } = usePaymentMethods();
  // Stores the UUID of the selected method; falls back to first available when empty.
  const [methodId, setMethodId] = useState('');
  const resolvedMethodId = methodId || (paymentMethods[0]?.id ?? '');
  const [amount, setAmount] = useState(String(balance > 0 ? Math.round(balance) : 0));
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (!saving) {
      setError(null);
      onClose();
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
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
      });
      await onSuccess();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible completar la acción.');
    } finally {
      setSaving(false);
    }
  };

  const alreadyDelivered = order.status === 'delivered';
  const alreadyPaid = order.payment_status === 'paid';

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
          <Button type="submit" disabled={saving}>
            <CheckCircle2 className="h-4 w-4" />
            {saving
              ? 'Procesando…'
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

