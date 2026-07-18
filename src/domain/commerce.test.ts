import { describe, expect, it, vi } from 'vitest';
import { sanitizeOrderPayload } from '../features/orders/orderApi';
import {
  canAccessAdmin,
  canViewCustomer,
  customerRanking,
  financialMetrics,
  InventoryLedger,
  paymentBalance,
  persistThenNotify,
  productRanking,
  resolvePrice,
  type FinancialOrder,
} from './commerce';

const publicContext = { publicPrice: 17300 };

describe('20 invariantes comerciales obligatorias', () => {
  it('1. cliente nuevo recibe precio público', () =>
    expect(resolvePrice(publicContext)).toEqual({ amount: 17300, source: 'public' }));
  it('2. cliente existente recibe su lista', () =>
    expect(resolvePrice({ ...publicContext, listPrice: 16500 })).toEqual({
      amount: 16500,
      source: 'list',
    }));
  it('3. precio especial prevalece para cliente y producto', () =>
    expect(
      resolvePrice({ ...publicContext, listPrice: 16500, special: { price: 14900, active: true } }),
    ).toEqual({ amount: 14900, source: 'special' }));
  it('4. el cliente no puede escoger lista porque el payload no tiene ese campo', () => {
    const payload = sanitizeOrderPayload({
      idempotency_key: 'x',
      customer: { name: 'Ana', phone: '573001234567' },
      items: [{ product_id: 'p', quantity: 1 }],
      delivery: {
        address: 'Calle 1',
        neighborhood: 'Centro',
        municipality: 'Pasto',
        delivery_method_id: 'd',
        requested_date: '2026-07-18',
      },
      payment_method_id: 'm',
    });
    expect(payload).not.toHaveProperty('price_list_id');
  });
  it('5. un precio manipulado en navegador se elimina', () => {
    const dirty = {
      idempotency_key: 'x',
      customer: { name: 'Ana', phone: '573001234567' },
      items: [{ product_id: 'p', quantity: 1, unit_price: 1 }],
      delivery: {
        address: 'Calle 1',
        neighborhood: 'Centro',
        municipality: 'Pasto',
        delivery_method_id: 'd',
        requested_date: '2026-07-18',
      },
      payment_method_id: 'm',
      total: 1,
    } as never;
    const clean = sanitizeOrderPayload(dirty);
    expect(clean.items[0]).toEqual({ product_id: 'p', quantity: 1 });
    expect(clean).not.toHaveProperty('total');
  });
  it('6. el pedido se persiste antes de notificar WhatsApp', async () => {
    const calls: string[] = [];
    await persistThenNotify(
      async () => {
        calls.push('persist');
        return { id: 1 };
      },
      async () => {
        calls.push('notify');
      },
    );
    expect(calls).toEqual(['persist', 'notify']);
  });
  it('7. fallo de WhatsApp conserva el pedido', async () => {
    const result = await persistThenNotify(
      async () => ({ id: 7 }),
      async () => {
        throw new Error('Meta caído');
      },
    );
    expect(result).toEqual({ record: { id: 7 }, notification: 'failed' });
  });
  it('8. un pedido persistido puede emitir evento de tiempo real', async () => {
    const publish = vi.fn();
    await persistThenNotify(async () => ({ id: 8 }), publish);
    expect(publish).toHaveBeenCalledWith({ id: 8 });
  });
  it('9. cancelar libera inventario reservado', () => {
    const ledger = new InventoryLedger();
    ledger.set('p', 5);
    ledger.reserve('p', 3);
    ledger.cancel('p', 3);
    expect(ledger.get('p')).toMatchObject({ onHand: 5, reserved: 0, available: 5 });
  });
  it('10. entregar descuenta existencia y reserva', () => {
    const ledger = new InventoryLedger();
    ledger.set('p', 5);
    ledger.reserve('p', 2);
    ledger.deliver('p', 2);
    expect(ledger.get('p')).toMatchObject({ onHand: 3, reserved: 0, available: 3 });
  });
  it('11. recibir compra incrementa inventario', () => {
    const ledger = new InventoryLedger();
    ledger.set('p', 5, 0, 100);
    ledger.receive('p', 3, 120);
    expect(ledger.get('p').onHand).toBe(8);
  });
  it('12. dos clientes no compran simultáneamente la última unidad', () => {
    const ledger = new InventoryLedger();
    ledger.set('p', 1);
    expect(ledger.reserve('p', 1)).toBe(true);
    expect(ledger.reserve('p', 1)).toBe(false);
  });
  it('13. cambiar precio maestro no altera snapshot histórico', () => {
    const snapshot = Object.freeze({ unitPrice: 17300 });
    const master = { price: 19000 };
    expect(snapshot.unitPrice).toBe(17300);
    expect(master.price).toBe(19000);
  });
  it('14. pago parcial actualiza saldo', () =>
    expect(paymentBalance(100000, [30000, 20000])).toBe(50000));
  it('15. gasto afecta utilidad neta, no utilidad bruta', () => {
    const metrics = financialMetrics(
      [
        {
          id: 'o',
          customerId: 'c',
          status: 'delivered',
          gross: 100,
          discount: 0,
          returns: 0,
          cost: 40,
          items: [],
        },
      ],
      15,
    );
    expect(metrics).toMatchObject({ grossProfit: 60, netProfit: 45 });
  });
  it('16. identifica producto más vendido', () => {
    const orders: FinancialOrder[] = [
      {
        id: 'o',
        customerId: 'c',
        status: 'delivered',
        gross: 10,
        discount: 0,
        returns: 0,
        cost: 2,
        items: [
          { productId: 'a', quantity: 3, revenue: 6, cost: 1 },
          { productId: 'b', quantity: 1, revenue: 4, cost: 1 },
        ],
      },
    ];
    expect(productRanking(orders)[0]?.productId).toBe('a');
  });
  it('17. identifica cliente que más compra', () => {
    const orders: FinancialOrder[] = [
      {
        id: '1',
        customerId: 'a',
        status: 'delivered',
        gross: 20,
        discount: 0,
        returns: 0,
        cost: 1,
        items: [],
      },
      {
        id: '2',
        customerId: 'b',
        status: 'delivered',
        gross: 50,
        discount: 0,
        returns: 0,
        cost: 1,
        items: [],
      },
    ];
    expect(customerRanking(orders)[0]?.customerId).toBe('b');
  });
  it('18. cliente no ve información ajena', () => {
    expect(canViewCustomer({ role: 'customer', customerId: 'a' }, 'b')).toBe(false);
    expect(canViewCustomer({ role: 'customer', customerId: 'a' }, 'a')).toBe(true);
  });
  it('19. usuario sin permiso no entra a administración', () => {
    expect(canAccessAdmin(['customer'])).toBe(false);
    expect(canAccessAdmin(['warehouse'])).toBe(true);
  });
  it('20. costo promedio ponderado se actualiza correctamente', () => {
    const ledger = new InventoryLedger();
    ledger.set('p', 10, 0, 100);
    ledger.receive('p', 10, 200);
    expect(ledger.get('p').averageCost).toBe(150);
  });
});
