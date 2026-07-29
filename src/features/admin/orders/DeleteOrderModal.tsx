import { useId, useState, type FormEvent } from 'react';
import { Trash2, TriangleAlert } from 'lucide-react';
import type { AdminOrder } from '../types';
import { orderTotal } from '../types';
import {
  describeOrderDeletionError,
  firstText,
  formatMoney,
  orderStatusLabels,
  paymentStatusLabels,
} from '../utils';
import { Button, inputClass, labelClass, Modal } from '../components/AdminUi';
import { invokeAdminRpc } from '../adminService';

interface Props {
  open: boolean;
  order: AdminOrder;
  onClose: () => void;
  /** Recibe el id eliminado para retirarlo de la tabla y refrescar métricas. */
  onDeleted: (orderId: string) => Promise<void> | void;
}

export function DeleteOrderModal({ open, order, onClose, onDeleted }: Props) {
  const orderNumber = firstText(order, 'order_number', 'consecutive') || order.id.slice(0, 8);
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmationId = useId();

  // El servidor compara contra `order_number` con btrim, así que se acepta el
  // mismo margen aquí y nada más: ni mayúsculas distintas ni coincidencia parcial.
  const matches = confirmation.trim() === orderNumber;

  const handleClose = () => {
    // Durante la operación el modal no se cierra, ni por el botón ni por el fondo.
    if (deleting) return;
    setError(null);
    setConfirmation('');
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    // Guardia de reentrancia: un segundo clic o un Enter repetido no dispara una
    // segunda eliminación mientras la primera está en vuelo.
    if (deleting || !matches) return;
    setDeleting(true);
    setError(null);
    try {
      await invokeAdminRpc('delete_order_permanently', {
        p_order_id: order.id,
        p_confirmation: confirmation.trim(),
      });
      await onDeleted(order.id);
      setConfirmation('');
      onClose();
    } catch (caught) {
      setError(
        describeOrderDeletionError(caught instanceof Error ? caught.message : String(caught)),
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal open={open} title="Eliminar pedido definitivamente" onClose={handleClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div
          className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>
            Esta acción no se puede deshacer. El pedido será eliminado de la operación y el
            inventario reservado será liberado.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-xl bg-artisan-paper p-4 text-sm">
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Pedido</p>
            <p className="mt-1 font-black">#{orderNumber}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Cliente</p>
            <p className="mt-1 font-semibold">
              {firstText(order, 'customer_name_snapshot', 'customer_name') || '—'}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Total</p>
            <p className="mt-1 font-black">{formatMoney(orderTotal(order))}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Estado</p>
            <p className="mt-1 font-semibold">{orderStatusLabels[order.status] ?? order.status}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs font-bold uppercase text-artisan-muted">Pago</p>
            <p className="mt-1 font-semibold">
              {paymentStatusLabels[order.payment_status] ?? order.payment_status}
            </p>
          </div>
        </div>

        <label>
          <span className={labelClass}>Escribe {orderNumber} para confirmar</span>
          <input
            id={confirmationId}
            className={inputClass}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={orderNumber}
            autoComplete="off"
            disabled={deleting}
            aria-label={`Escribe ${orderNumber} para confirmar`}
          />
        </label>

        {error && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-artisan-line pt-4">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={deleting}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" disabled={deleting || !matches}>
            <Trash2 className="h-4 w-4" />
            {deleting ? 'Eliminando…' : 'Eliminar definitivamente'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
