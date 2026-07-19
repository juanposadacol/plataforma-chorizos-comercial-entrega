// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DeliverAndPayModal } from './DeliverAndPayModal';
import type { AdminOrder } from '../types';

// Vitest here doesn't run with `globals: true`, so Testing Library's automatic
// afterEach(cleanup) detection doesn't kick in — register it explicitly so each
// `it()` starts from an empty DOM instead of accumulating renders.
afterEach(cleanup);

const invokeAdminRpc = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('../adminService', () => ({ invokeAdminRpc }));
vi.mock('../usePaymentMethods', () => ({
  usePaymentMethods: () => ({
    methods: [{ id: 'method-1', code: 'efectivo', name: 'Efectivo', requires_reference: false }],
    loading: false,
  }),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: useAuthMock }));

const baseOrder: AdminOrder = {
  id: 'order-1',
  order_number: 'PED-00000099',
  status: 'confirmed',
  payment_status: 'pending',
  total_amount: 120000,
  amount_paid: 50000,
  created_at: '2026-07-18T15:06:30.983041+00:00',
} as AdminOrder;

describe('DeliverAndPayModal', () => {
  beforeEach(() => {
    invokeAdminRpc.mockReset();
    useAuthMock.mockReturnValue({ access: { isStaff: true, roles: ['superadmin'], permissions: [] } });
  });

  // H-03: el modal ya no recibe un array `payments` — el saldo se lee siempre de
  // order.amount_paid/total_amount. Con amount_paid=50000 y total=120000, el
  // saldo mostrado debe ser exactamente 70000, sin importar qué pagos existan.
  it('H-03: calcula "ya pagado" y "saldo" desde order.amount_paid/total_amount, no de un array de pagos', () => {
    render(<DeliverAndPayModal open order={baseOrder} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByText(/\$\s*50\.000/)).toBeInTheDocument(); // Ya pagado
    expect(screen.getByText(/\$\s*70\.000/)).toBeInTheDocument(); // Saldo pendiente
  });

  // H-05: un reintento (p. ej. tras un timeout) debe reutilizar exactamente la
  // misma llave de idempotencia que el primer intento, nunca una nueva.
  it('H-05: reutiliza la misma p_idempotency_key en un reintento tras un error', async () => {
    invokeAdminRpc
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce({ payment_id: 'pay-1' });

    render(<DeliverAndPayModal open order={baseOrder} onClose={vi.fn()} onSuccess={vi.fn()} />);

    const submit = () => fireEvent.click(screen.getByRole('button', { name: /entregar y pagar/i }));

    submit();
    await waitFor(() => expect(invokeAdminRpc).toHaveBeenCalledTimes(1));
    await screen.findByText('Network timeout');

    submit();
    await waitFor(() => expect(invokeAdminRpc).toHaveBeenCalledTimes(2));

    const firstCallKey = invokeAdminRpc.mock.calls.at(0)?.[1]?.p_idempotency_key;
    const secondCallKey = invokeAdminRpc.mock.calls.at(1)?.[1]?.p_idempotency_key;
    expect(firstCallKey).toBeDefined();
    expect(secondCallKey).toBe(firstCallKey);
  });

  it('H-05: siempre envía p_idempotency_key a deliver_and_pay_order', async () => {
    invokeAdminRpc.mockResolvedValueOnce({ payment_id: 'pay-1' });
    render(<DeliverAndPayModal open order={baseOrder} onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /entregar y pagar/i }));
    await waitFor(() => expect(invokeAdminRpc).toHaveBeenCalledTimes(1));
    const call = invokeAdminRpc.mock.calls.at(0);
    expect(call?.[0]).toBe('deliver_and_pay_order');
    expect(call?.[1]?.p_idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  // H-13: contabilidad sola no puede disparar el paso de entrega de un pedido
  // que todavía no está entregado — el envío debe quedar bloqueado y explicado.
  it('H-13: bloquea el envío para un usuario solo-contabilidad en un pedido no entregado', () => {
    useAuthMock.mockReturnValue({
      access: { isStaff: true, roles: ['contabilidad'], permissions: [] },
    });
    render(<DeliverAndPayModal open order={baseOrder} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByRole('button', { name: /sin permiso para entregar/i })).toBeDisabled();
    expect(screen.getByText(/solo puede registrar pagos de pedidos ya entregados/i)).toBeInTheDocument();
  });

  it('H-13: contabilidad sí puede registrar el pago de un pedido ya entregado', () => {
    useAuthMock.mockReturnValue({
      access: { isStaff: true, roles: ['contabilidad'], permissions: [] },
    });
    const delivered = { ...baseOrder, status: 'delivered' } as AdminOrder;
    render(<DeliverAndPayModal open order={delivered} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.queryByText(/solo puede registrar pagos de pedidos ya entregados/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sin permiso para entregar/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /entregar y pagar/i })).not.toBeDisabled();
  });

  // vendedor por sí solo tampoco puede entregar: transition_order_status ya
  // bloquea a un vendedor puro de avanzar más allá de 'confirmed' (verificado
  // en vivo con una prueba envuelta en ROLLBACK), así que la acción combinada
  // no debe ofrecérsela para un pedido que aún no está entregado.
  it('H-13: vendedor por sí solo también queda bloqueado en un pedido no entregado', () => {
    useAuthMock.mockReturnValue({ access: { isStaff: true, roles: ['vendedor'], permissions: [] } });
    render(<DeliverAndPayModal open order={baseOrder} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByRole('button', { name: /sin permiso para entregar/i })).toBeDisabled();
  });

  it('H-13: admin puede entregar y pagar un pedido no entregado', () => {
    useAuthMock.mockReturnValue({ access: { isStaff: true, roles: ['admin'], permissions: [] } });
    render(<DeliverAndPayModal open order={baseOrder} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByRole('button', { name: /entregar y pagar/i })).not.toBeDisabled();
  });
});
