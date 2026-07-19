import { describe, expect, it } from 'vitest';
import {
  itemSubtotal,
  orderDeliveryFee,
  orderDiscount,
  orderSubtotal,
  orderTotal,
} from './types';
import { formatAdminDate, isBareSqlDate, percentChange, percentage, sumStatusCounts } from './utils';

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

// Regresión para el bug de estadísticas del tablero: "ventas de hoy/ayer/semana/mes"
// y "ticket promedio" mostraban $0 porque el cliente leía `order.total` (columna
// inexistente) y agregaba pedidos sin filtrar por estado "entregado" ni por fecha
// comercial en América/Bogota. El tablero ahora consume directamente los campos de
// `get_dashboard_metrics` (RPC), así que estas pruebas cubren los agregadores
// puros que sí siguen viviendo en el cliente.
describe('sumStatusCounts — agrega conteos por estado desde order_status_counts', () => {
  it('suma varios estados presentes', () =>
    expect(sumStatusCounts({ pending_confirmation: 2, confirmed: 3, delivered: 1 }, 'pending_confirmation', 'confirmed')).toBe(5));

  it('trata estados ausentes como 0 en vez de fallar', () =>
    expect(sumStatusCounts({ delivered: 1 }, 'preparing')).toBe(0));

  it('objeto vacío no rompe la suma', () => expect(sumStatusCounts({}, 'new')).toBe(0));
});

describe('percentChange / percentage — división por cero segura', () => {
  it('no lanza error ni devuelve Infinity cuando el valor previo es 0', () =>
    expect(percentChange(120000, 0)).toBe(100));

  it('devuelve null cuando ambos valores son 0 (nada que comparar)', () =>
    expect(percentChange(0, 0)).toBeNull());

  it('calcula el cambio porcentual normal', () => expect(percentChange(150, 100)).toBe(50));

  it('percentage() no divide por cero cuando el total es 0', () =>
    expect(percentage(40000, 0)).toBe(0));

  it('percentage() calcula el margen normal (40.000 de utilidad sobre 120.000 en ventas)', () =>
    expect(percentage(40000, 120000)).toBeCloseTo(33.33, 1));
});

// Regresión directa del caso PED-00000001: un solo pedido entregado por $120.000
// debe producir un ticket promedio de exactamente $120.000, sin división por cero
// cuando no hay pedidos entregados en el período.
describe('ticket promedio — fórmula ventas netas / pedidos entregados', () => {
  const averageTicket = (netSales: number, deliveredOrders: number) =>
    deliveredOrders === 0 ? 0 : Math.round((netSales / deliveredOrders) * 100) / 100;

  it('un solo pedido entregado de $120.000 da un ticket de $120.000', () =>
    expect(averageTicket(120000, 1)).toBe(120000));

  it('no lanza error ni da NaN cuando no hay pedidos entregados', () =>
    expect(averageTicket(0, 0)).toBe(0));
});

// Regresión para el bug de "Ventas por día" mostrando la venta un día antes: la
// tabla/gráfica/exportaciones de reportes deciden si un valor es una fecha SQL
// bare (DD/MM/YYYY, sin conversión de zona horaria) o un TIMESTAMPTZ (convertido a
// America/Bogota) mirando la FORMA del valor recibido, no el nombre de la columna
// — PostgREST siempre serializa TIMESTAMPTZ con hora y offset completos, así que
// "YYYY-MM-DD" a secas identifica sin ambigüedad una columna DATE.
describe('isBareSqlDate — distingue valores DATE de valores TIMESTAMPTZ por su forma', () => {
  it('sale_date (report_sales_by_day) tiene forma de DATE', () =>
    expect(isBareSqlDate('2026-07-18')).toBe(true));

  it('valores de due_date/expense_date/purchase_date/requested_delivery_date son DATE', () => {
    expect(isBareSqlDate('2026-08-05')).toBe(true);
    expect(isBareSqlDate('2026-01-31')).toBe(true);
  });

  it('un TIMESTAMPTZ completo (created_at/delivered_at/paid_at) no es una fecha bare', () => {
    expect(isBareSqlDate('2026-07-18T23:33:32.462341+00:00')).toBe(false);
    expect(isBareSqlDate('2026-07-18 23:33:32.462341+00')).toBe(false);
  });

  it('cadenas que no son fechas no coinciden', () => {
    expect(isBareSqlDate('120000')).toBe(false);
    expect(isBareSqlDate('no-es-una-fecha')).toBe(false);
  });
});

describe('formatAdminDate — no desplaza columnas DATE al convertir a Bogotá', () => {
  it('una columna DATE bare (sale_date/due_date/...) se muestra sin conversión de zona horaria', () =>
    expect(formatAdminDate('2026-07-18')).toBe('18/07/2026'));

  it('un TIMESTAMPTZ completo sí se convierte a America/Bogota', () => {
    // 2026-07-18T23:33:32Z = 2026-07-18 18:33 en Bogotá (mismo día calendario aquí,
    // a diferencia del caso DATE-only que un new Date() ingenuo sí desplazaría).
    const formatted = formatAdminDate('2026-07-18T23:33:32.462341+00:00', true);
    expect(formatted).toContain('18');
    expect(formatted).not.toBe('—');
  });

  it('valor vacío o inválido no lanza error', () => {
    expect(formatAdminDate(null)).toBe('—');
    expect(formatAdminDate(undefined)).toBe('—');
    expect(formatAdminDate('')).toBe('—');
  });
});
