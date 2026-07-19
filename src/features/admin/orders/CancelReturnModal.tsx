import { useState, type FormEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AdminOrder } from '../types';
import { orderTotal } from '../types';
import { firstText, formatAdminDate, formatMoney } from '../utils';
import { Button, inputClass, labelClass, Modal } from '../components/AdminUi';

interface Props {
  open: boolean;
  order: AdminOrder;
  targetStatus: 'cancelled' | 'returned';
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

const config = {
  cancelled: {
    title: 'Cancelar pedido',
    actionLabel: 'Cancelar pedido',
    effectNote:
      'Se liberará el inventario reservado. Si existe un pago pendiente de devolución, deberá gestionarse por separado en el módulo de Pagos y cartera.',
  },
  returned: {
    title: 'Registrar devolución',
    actionLabel: 'Confirmar devolución',
    effectNote:
      'El inventario entregado se reintegrará al stock disponible. Si el cliente pagó, el reembolso deberá registrarse manualmente en el módulo de Pagos y cartera.',
  },
} as const;

export function CancelReturnModal({ open, order, targetStatus, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { title, actionLabel, effectNote } = config[targetStatus];

  const handleClose = () => {
    if (!saving) {
      setReason('');
      setError(null);
      onClose();
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) {
      setError('El motivo es obligatorio.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason('');
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible completar la acción.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title={title} onClose={handleClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="text-sm text-amber-900">
              <p className="font-bold">Esta acción no se puede deshacer directamente.</p>
              <p className="mt-1">{effectNote}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-xl bg-artisan-paper p-4 text-sm">
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Pedido</p>
            <p className="mt-1 font-black">
              #{firstText(order, 'order_number', 'consecutive') || order.id.slice(0, 8)}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Total</p>
            <p className="mt-1 font-black">{formatMoney(orderTotal(order))}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Cliente</p>
            <p className="mt-1 font-semibold">
              {firstText(order, 'customer_name_snapshot', 'customer_name') || '—'}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Creado</p>
            <p className="mt-1 font-semibold">{formatAdminDate(order.created_at, true)}</p>
          </div>
        </div>

        <label>
          <span className={labelClass}>
            Motivo <span className="text-red-600">*</span>
          </span>
          <textarea
            required
            className={`${inputClass} min-h-24`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              targetStatus === 'cancelled'
                ? 'Describe el motivo de la cancelación…'
                : 'Describe el motivo de la devolución e indica si la mercancía fue reintegrada…'
            }
          />
        </label>

        {error && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div>
        )}

        <div className="flex justify-end gap-2 border-t border-artisan-line pt-4">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={saving}>
            Volver
          </Button>
          <Button type="submit" variant="danger" disabled={saving || !reason.trim()}>
            {saving ? 'Procesando…' : actionLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
