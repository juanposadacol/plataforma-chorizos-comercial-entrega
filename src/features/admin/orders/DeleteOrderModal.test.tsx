// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DeleteOrderModal } from './DeleteOrderModal';
import {
  canDeleteOrderPermanently,
  describeOrderDeletionError,
  orderLooksPurgeable,
} from '../utils';
import type { AdminOrder } from '../types';

afterEach(cleanup);

const invokeAdminRpc = vi.hoisted(() => vi.fn());
vi.mock('../adminService', () => ({ invokeAdminRpc }));

const ORDER: AdminOrder = {
  id: 'order-1',
  order_number: 'PED-0000012',
  customer_name: 'María Gómez',
  status: 'new',
  payment_status: 'pending',
  total_amount: 34600,
  amount_paid: 0,
  created_at: '2026-07-29T15:06:30.983041+00:00',
} as AdminOrder;

const typeConfirmation = (value: string) =>
  fireEvent.change(screen.getByLabelText(/Escribe PED-0000012 para confirmar/i), {
    target: { value },
  });

const deleteButton = () => screen.getByRole('button', { name: /eliminar definitivamente/i });

describe('11. visibilidad del botón según el rol', () => {
  it('solo el superadministrador puede eliminar definitivamente', () => {
    expect(canDeleteOrderPermanently(['superadmin'])).toBe(true);
    expect(canDeleteOrderPermanently(['superadmin', 'admin'])).toBe(true);
  });

  it('la interfaz oculta el botón a cualquier otro rol, incluido admin', () => {
    // `admin` NO alcanza: la RPC exige has_role('superadmin'), no is_admin().
    expect(canDeleteOrderPermanently(['admin'])).toBe(false);
    expect(canDeleteOrderPermanently(['vendedor'])).toBe(false);
    expect(canDeleteOrderPermanently(['bodega'])).toBe(false);
    expect(canDeleteOrderPermanently(['contabilidad'])).toBe(false);
    expect(canDeleteOrderPermanently(['admin', 'vendedor', 'contabilidad'])).toBe(false);
    expect(canDeleteOrderPermanently([])).toBe(false);
  });

  it('la papelera solo se ofrece para pedidos elegibles', () => {
    expect(orderLooksPurgeable({ status: 'new', payment_status: 'pending' })).toBe(true);
    expect(orderLooksPurgeable({ status: 'pending_confirmation', payment_status: 'pending' })).toBe(
      true,
    );
    expect(orderLooksPurgeable({ status: 'delivered', payment_status: 'pending' })).toBe(false);
    expect(orderLooksPurgeable({ status: 'confirmed', payment_status: 'pending' })).toBe(false);
    expect(orderLooksPurgeable({ status: 'cancelled', payment_status: 'pending' })).toBe(false);
    expect(orderLooksPurgeable({ status: 'new', payment_status: 'paid' })).toBe(false);
    expect(orderLooksPurgeable({ status: 'new', payment_status: 'partial' })).toBe(false);
    expect(
      orderLooksPurgeable({ status: 'new', payment_status: 'pending', amount_paid: 1000 }),
    ).toBe(false);
    expect(
      orderLooksPurgeable({
        status: 'new',
        payment_status: 'pending',
        delivered_at: '2026-07-01T00:00:00Z',
      }),
    ).toBe(false);
  });
});

describe('DeleteOrderModal', () => {
  beforeEach(() => {
    invokeAdminRpc.mockReset();
    invokeAdminRpc.mockResolvedValue({ deleted: true, reservations_released: 1 });
  });

  it('muestra el título, la advertencia y los datos del pedido', () => {
    render(<DeleteOrderModal open order={ORDER} onClose={vi.fn()} onDeleted={vi.fn()} />);

    expect(screen.getByText('Eliminar pedido definitivamente')).toBeInTheDocument();
    expect(
      screen.getByText(/Esta acción no se puede deshacer.*inventario reservado será liberado/s),
    ).toBeInTheDocument();
    expect(screen.getByText('#PED-0000012')).toBeInTheDocument();
    expect(screen.getByText('María Gómez')).toBeInTheDocument();
    expect(screen.getByText(/\$\s*34\.600/)).toBeInTheDocument();
    expect(screen.getByText('Nuevo')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
  });

  it('mantiene el botón deshabilitado mientras el texto no coincida', () => {
    render(<DeleteOrderModal open order={ORDER} onClose={vi.fn()} onDeleted={vi.fn()} />);

    expect(deleteButton()).toBeDisabled();

    typeConfirmation('PED-000001');
    expect(deleteButton()).toBeDisabled();

    typeConfirmation('ped-0000012');
    expect(deleteButton()).toBeDisabled();

    typeConfirmation('PED-0000013');
    expect(deleteButton()).toBeDisabled();

    typeConfirmation('PED-0000012');
    expect(deleteButton()).toBeEnabled();
  });

  it('no llama a la RPC si el texto no coincide', () => {
    render(<DeleteOrderModal open order={ORDER} onClose={vi.fn()} onDeleted={vi.fn()} />);
    typeConfirmation('otra cosa');
    fireEvent.click(deleteButton());
    expect(invokeAdminRpc).not.toHaveBeenCalled();
  });

  it('envía el id y la confirmación exactos a delete_order_permanently', async () => {
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    render(<DeleteOrderModal open order={ORDER} onClose={onClose} onDeleted={onDeleted} />);

    typeConfirmation('  PED-0000012  ');
    fireEvent.click(deleteButton());

    await waitFor(() => expect(invokeAdminRpc).toHaveBeenCalledOnce());
    expect(invokeAdminRpc).toHaveBeenCalledWith('delete_order_permanently', {
      p_order_id: 'order-1',
      p_confirmation: 'PED-0000012',
    });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('order-1'));
    expect(onClose).toHaveBeenCalled();
  });

  // 12. Requisito explícito: doble clic no debe ejecutar dos eliminaciones.
  it('12. un doble clic no ejecuta dos eliminaciones', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    invokeAdminRpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve;
        }),
    );

    render(<DeleteOrderModal open order={ORDER} onClose={vi.fn()} onDeleted={vi.fn()} />);
    typeConfirmation('PED-0000012');

    const button = deleteButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(invokeAdminRpc).toHaveBeenCalledOnce();
    // El botón queda deshabilitado y muestra el estado de carga.
    expect(screen.getByRole('button', { name: /eliminando/i })).toBeDisabled();

    resolveRpc({ deleted: true });
    await waitFor(() => expect(invokeAdminRpc).toHaveBeenCalledOnce());
  });

  it('no cierra el modal mientras la operación está en curso', () => {
    invokeAdminRpc.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    render(<DeleteOrderModal open order={ORDER} onClose={onClose} onDeleted={vi.fn()} />);

    typeConfirmation('PED-0000012');
    fireEvent.click(deleteButton());

    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cerrar$/i }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('mantiene el modal abierto y muestra el error si la RPC falla', async () => {
    invokeAdminRpc.mockRejectedValue(new Error('STATUS_NOT_ELIGIBLE: ...'));
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(<DeleteOrderModal open order={ORDER} onClose={onClose} onDeleted={onDeleted} />);

    typeConfirmation('PED-0000012');
    fireEvent.click(deleteButton());

    await waitFor(() =>
      expect(
        screen.getByText('Solo se pueden eliminar pedidos en estado Nuevo o Por confirmar.'),
      ).toBeInTheDocument(),
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Se puede reintentar: el botón vuelve a estar disponible.
    expect(deleteButton()).toBeEnabled();
  });
});

describe('mensajes de error: nunca se muestra el detalle interno de PostgreSQL', () => {
  const cases: Array<[string, string]> = [
    ['ORDER_NOT_FOUND: El pedido no existe', 'El pedido ya no existe. Actualiza la lista.'],
    [
      'NOT_AUTHENTICATED: Se requiere una sesión activa',
      'Tu sesión expiró. Vuelve a iniciar sesión.',
    ],
    [
      'NOT_AUTHORIZED: Solo un superadministrador…',
      'Solo un superadministrador puede eliminar pedidos definitivamente.',
    ],
    ['CONFIRMATION_MISMATCH: …', 'El número escrito no coincide con el del pedido.'],
    ['STATUS_NOT_ELIGIBLE: …', 'Solo se pueden eliminar pedidos en estado Nuevo o Por confirmar.'],
    ['ORDER_HAS_PAYMENT: …', 'El pedido tiene pagos registrados y no puede eliminarse.'],
    ['ORDER_HAS_FULFILLMENT: …', 'El pedido tiene entrega, despacho o devolución registrada.'],
    ['ORDER_HAS_ACCOUNTING: …', 'El pedido tiene gastos o movimientos de caja asociados.'],
    ['INVENTORY_NOT_REVERSIBLE: …', 'El inventario del pedido no se puede revertir.'],
    ['ORDER_LOCKED: …', 'Otra persona está modificando este pedido. Intenta de nuevo.'],
  ];

  it.each(cases)('traduce %s', (raw, expected) => {
    expect(describeOrderDeletionError(raw)).toBe(expected);
  });

  it('un error desconocido de PostgreSQL no se filtra a la interfaz', () => {
    const crudo =
      'ERROR: update or delete on table "orders" violates foreign key constraint ' +
      '"payments_order_id_fkey" on table "payments" (SQLSTATE 23503)';
    const mostrado = describeOrderDeletionError(crudo);

    expect(mostrado).toBe('No fue posible eliminar el pedido.');
    expect(mostrado).not.toContain('SQLSTATE');
    expect(mostrado).not.toContain('foreign key');
    expect(mostrado).not.toContain('orders');
  });
});
