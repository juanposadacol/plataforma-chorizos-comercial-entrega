import { useState, type FormEvent } from 'react';
import { Trash2, TriangleAlert } from 'lucide-react';
import type { Customer } from '../types';
import { describeCustomerDeletionError, firstText, formatMoney, toNumber } from '../utils';
import { Button, inputClass, labelClass, Modal } from '../components/AdminUi';
import { invokeAdminRpc } from '../adminService';

interface Props {
  open: boolean;
  customer: Customer;
  onClose: () => void;
  /** Recibe el id eliminado para retirarlo de la tabla. */
  onDeleted: (customerId: string) => Promise<void> | void;
}

export function DeleteCustomerModal({ open, customer, onClose, onDeleted }: Props) {
  const name = firstText(customer, 'full_name', 'name') || 'Sin nombre';
  const phone = String(customer.phone ?? '');
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El servidor compara contra `phone` con btrim: aquí se acepta el mismo margen.
  const matches = confirmation.trim() === phone;

  const handleClose = () => {
    if (deleting) return;
    setError(null);
    setConfirmation('');
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (deleting || !matches) return;
    setDeleting(true);
    setError(null);
    try {
      await invokeAdminRpc('delete_customer_permanently', {
        p_customer_id: customer.id,
        p_confirmation: confirmation.trim(),
      });
      await onDeleted(customer.id);
      setConfirmation('');
      onClose();
    } catch (caught) {
      setError(
        describeCustomerDeletionError(caught instanceof Error ? caught.message : String(caught)),
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal open={open} title="Eliminar cliente definitivamente" onClose={handleClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div
          className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>
            Esta acción no se puede deshacer. Se eliminarán sus datos personales, direcciones y
            precios especiales. Solo es posible si el cliente no tiene pedidos, pagos ni cartera; si
            los tiene, desactívalo en lugar de eliminarlo.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-xl bg-artisan-paper p-4 text-sm">
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Cliente</p>
            <p className="mt-1 font-black">{name}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Celular</p>
            <p className="mt-1 font-semibold">{phone || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Saldo</p>
            <p className="mt-1 font-semibold">{formatMoney(customer.outstanding_balance)}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-artisan-muted">Pedidos</p>
            <p className="mt-1 font-semibold">{toNumber(customer.order_count)}</p>
          </div>
        </div>

        <label>
          <span className={labelClass}>Escribe {phone} para confirmar</span>
          <input
            className={inputClass}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={phone}
            autoComplete="off"
            disabled={deleting}
            aria-label={`Escribe ${phone} para confirmar`}
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
