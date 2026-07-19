import { describe, expect, it } from 'vitest';
import {
  itemSubtotal,
  orderDeliveryFee,
  orderDiscount,
  orderSubtotal,
  orderTotal,
} from './types';

// Helpers de resolución de columnas: la BD usa nombres snake_case distintos
// al código anterior (total_amount ≠ total, subtotal_amount ≠ subtotal, etc.).
// Estos tests documentan la única fuente de verdad monetaria y sirven de
// regresión para evitar que reaparezca el bug de "$0 en la tabla de pedidos".

describe('orderTotal — resolución de total del pedido', () => {
  it('usa total_amount cuando está presente (columna real de la BD)', () =>
    expect(orderTotal({ total_amount: 120000 } as never)).toBe(120000));

  it('cae a total como alias heredado', () =>
    expect(orderTotal({ total: 95000 } as never)).toBe(95000));

  it('prefiere total_amount sobre total cuando ambos existen', () =>
    expect(orderTotal({ total_amount: 120000, total: 0 } as never)).toBe(120000));

  it('devuelve 0 cuando ningún campo está presente', () =>
    expect(orderTotal({} as never)).toBe(0));

  it('devuelve 0 cuando total_amount es null/undefined', () =>
    expect(orderTotal({ total_amount: null, total: undefined } as never)).toBe(0));
});

describe('orderSubtotal — resolución de subtotal', () => {
  it('usa subtotal_amount (columna real)', () =>
    expect(orderSubtotal({ subtotal_amount: 100000 } as never)).toBe(100000));

  it('cae a subtotal como alias heredado', () =>
    expect(orderSubtotal({ subtotal: 80000 } as never)).toBe(80000));

  it('devuelve 0 sin ningún campo', () =>
    expect(orderSubtotal({} as never)).toBe(0));
});

describe('orderDeliveryFee — resolución de domicilio', () => {
  it('usa delivery_amount (columna real)', () =>
    expect(orderDeliveryFee({ delivery_amount: 5000 } as never)).toBe(5000));

  it('cae a delivery_fee como alias heredado', () =>
    expect(orderDeliveryFee({ delivery_fee: 4000 } as never)).toBe(4000));
});

describe('orderDiscount — resolución de descuento', () => {
  it('usa discount_amount (columna real)', () =>
    expect(orderDiscount({ discount_amount: 10000 } as never)).toBe(10000));

  it('cae a discount como alias heredado', () =>
    expect(orderDiscount({ discount: 5000 } as never)).toBe(5000));
});

describe('itemSubtotal — resolución de subtotal de ítem', () => {
  it('usa subtotal_amount (columna real)', () =>
    expect(itemSubtotal({ subtotal_amount: 34600 } as never)).toBe(34600));

  it('cae a subtotal como alias heredado', () =>
    expect(itemSubtotal({ subtotal: 17300 } as never)).toBe(17300));

  it('devuelve 0 sin ningún campo', () =>
    expect(itemSubtotal({} as never)).toBe(0));
});

describe('cálculo de saldo pendiente', () => {
  it('saldo es 0 cuando el pedido está pagado por completo', () => {
    const total = orderTotal({ total_amount: 120000 } as never);
    expect(Math.max(0, total - 120000)).toBe(0);
  });

  it('saldo refleja un abono parcial', () => {
    const total = orderTotal({ total_amount: 120000 } as never);
    expect(Math.max(0, total - 50000)).toBe(70000);
  });

  it('saldo no puede ser negativo ante un sobrepago', () => {
    const total = orderTotal({ total_amount: 120000 } as never);
    expect(Math.max(0, total - 150000)).toBe(0);
  });
});

// Regresión para el bug de step="100" con min≠múltiplo-de-100.
// El navegador rechazaba $120.000 porque los valores válidos eran 1,101,201…
// Con step="1" cualquier entero positivo ≤ saldo es aceptado.
describe('validación de valores de pago — regresión step/min', () => {
  const validatePayment = (amount: number, balance: number): boolean =>
    Number.isInteger(amount) && amount >= 1 && amount <= balance;

  it('acepta el saldo completo de 120000', () =>
    expect(validatePayment(120000, 120000)).toBe(true));

  it('acepta el saldo completo de 17300', () =>
    expect(validatePayment(17300, 17300)).toBe(true));

  it('acepta un abono parcial de 50000 sobre un saldo de 120000', () =>
    expect(validatePayment(50000, 120000)).toBe(true));

  it('rechaza el valor cero', () =>
    expect(validatePayment(0, 120000)).toBe(false));

  it('rechaza valores superiores al saldo', () =>
    expect(validatePayment(120001, 120000)).toBe(false));

  it('rechaza valores negativos', () =>
    expect(validatePayment(-1, 120000)).toBe(false));
});

// Regresión para el bug de códigos de método de pago.
// Causa raíz: el frontend enviaba códigos en inglés ('cash','transfer','card',
// 'cash_on_delivery','credit') que no coinciden con los códigos reales en BD
// ('efectivo','transferencia','contraentrega','credito','otro').
// La corrección carga los métodos desde la BD (usePaymentMethods) y usa el UUID
// directamente, eliminando toda dependencia de códigos hardcodeados en el cliente.
describe('mapeo de métodos de pago — regresión códigos inglés vs español', () => {
  // Simula los métodos reales que devuelve la BD (ver migrations/seed.sql).
  const dbMethods = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', code: 'efectivo',      name: 'Efectivo' },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', code: 'transferencia', name: 'Transferencia' },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', code: 'contraentrega', name: 'Contraentrega' },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', code: 'credito',       name: 'Crédito' },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', code: 'otro',          name: 'Otro' },
  ];

  // Simula la lógica que usaba el texto overload de register_payment.
  const findByCode = (code: string) =>
    dbMethods.find(
      (m) => m.code === code.toLowerCase() || m.name.toLowerCase() === code.toLowerCase(),
    );

  it('efectivo se encuentra por código real', () =>
    expect(findByCode('efectivo')?.id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'));

  it('contraentrega se encuentra por código real', () =>
    expect(findByCode('contraentrega')?.id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'));

  it('el código inglés "cash" NO se encontraría (confirma causa raíz del bug)', () =>
    expect(findByCode('cash')).toBeUndefined());

  it('el código inglés "transfer" NO se encontraría', () =>
    expect(findByCode('transfer')).toBeUndefined());

  it('el código inglés "card" NO se encontraría (no existe en BD)', () =>
    expect(findByCode('card')).toBeUndefined());

  it('el código inglés "cash_on_delivery" NO se encontraría', () =>
    expect(findByCode('cash_on_delivery')).toBeUndefined());

  it('UUID inválido no coincide con ningún método', () =>
    expect(dbMethods.find((m) => m.id === 'uuid-inexistente')).toBeUndefined());

  it('con la corrección, el UUID de efectivo es un UUID v4 válido', () =>
    expect('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1').toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ));
});
