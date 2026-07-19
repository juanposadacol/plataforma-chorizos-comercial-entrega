import { describe, expect, it } from 'vitest';
import {
  addBogotaDays,
  bogotaMondayIndex,
  formatBogotaDateParts,
  getBogotaDateParts,
} from '../../lib/format';
import { getDateRange } from './utils';

// Regresión para el bug reportado: el tablero mostraba $0 en "ventas de hoy/ayer/
// semana/mes" y el reporte "Ventas por día" ubicaba una venta entregada el
// 18/07/2026 (hora Colombia) en el 17/07/2026. La causa raíz combinada era:
//   (a) getDateRange() calculaba los límites del día usando new Date() + setHours(),
//       que dependen de la zona horaria del navegador/SO, no de América/Bogota;
//   (b) el tablero leía order.total (undefined) en vez de order.total_amount.
// Estas pruebas fijan una fecha de referencia explícita y verifican que los límites
// de "hoy"/"ayer"/"semana"/"mes" siempre se calculan en América/Bogota,
// independientemente de la hora UTC exacta o del reloj del sistema que ejecute el test.

describe('getBogotaDateParts — lectura de fecha calendario en América/Bogota', () => {
  it('un timestamp UTC de madrugada pertenece al día anterior en Bogotá', () => {
    // 2026-07-19T02:00:00Z = 2026-07-18T21:00:00-05:00 (Bogotá)
    const reference = new Date('2026-07-19T02:00:00.000Z');
    expect(getBogotaDateParts(reference)).toEqual({ year: 2026, month: 7, day: 18 });
  });

  it('un timestamp UTC de la tarde pertenece al mismo día en Bogotá', () => {
    // 2026-07-19T15:26:10Z = 2026-07-19T10:26:10-05:00 (Bogotá)
    const reference = new Date('2026-07-19T15:26:10.000Z');
    expect(getBogotaDateParts(reference)).toEqual({ year: 2026, month: 7, day: 19 });
  });
});

describe('getDateRange("today") — no debe desplazar la venta a otro día', () => {
  // Escenario real: PED-00000001 se entregó el 2026-07-18T23:33:32Z, que en Bogotá
  // es 2026-07-18T18:33:32 (el mismo día calendario). Si "ahora" también cae ese
  // mismo día en Bogotá, el pedido debe quedar dentro del rango de "hoy".
  const deliveredAtUtc = new Date('2026-07-18T23:33:32.462Z');
  const sameDayReferenceUtc = new Date('2026-07-18T23:50:00.000Z'); // 18:50 Bogotá

  it('incluye una entrega tardía del mismo día calendario en Bogotá', () => {
    const range = getDateRange('today', sameDayReferenceUtc);
    expect(deliveredAtUtc >= range.from && deliveredAtUtc <= range.to).toBe(true);
  });

  it('excluye una entrega del día calendario Bogotá anterior', () => {
    // "Ahora" se mueve a la mañana siguiente en Bogotá: la entrega de ayer no es "hoy".
    const nextDayReferenceUtc = new Date('2026-07-19T15:26:10.000Z'); // 10:26 Bogotá, 19 jul
    const range = getDateRange('today', nextDayReferenceUtc);
    expect(deliveredAtUtc >= range.from && deliveredAtUtc <= range.to).toBe(false);
  });

  it('esa misma entrega sí aparece como "ayer" cuando hoy avanzó un día', () => {
    const nextDayReferenceUtc = new Date('2026-07-19T15:26:10.000Z');
    const range = getDateRange('yesterday', nextDayReferenceUtc);
    expect(deliveredAtUtc >= range.from && deliveredAtUtc <= range.to).toBe(true);
  });

  it('un timestamp UTC de madrugada que cae en el día Bogotá anterior no cuenta como "hoy"', () => {
    // 02:00 UTC del 19 es 21:00 del 18 en Bogotá — si "hoy" (referencia) es el 19,
    // esa entrega pertenece al 18 y no debe contarse en el rango de "hoy".
    const lateUtcButPreviousBogotaDay = new Date('2026-07-19T02:00:00.000Z');
    const referenceStillJuly19 = new Date('2026-07-19T20:00:00.000Z'); // 15:00 Bogotá, 19 jul
    const range = getDateRange('today', referenceStillJuly19);
    expect(
      lateUtcButPreviousBogotaDay >= range.from && lateUtcButPreviousBogotaDay <= range.to,
    ).toBe(false);
  });
});

describe('getDateRange("week") — la semana inicia el lunes en Bogotá', () => {
  it('el límite inferior de la semana actual es un lunes en Bogotá', () => {
    const reference = new Date('2026-07-19T15:26:10.000Z'); // domingo 19 jul 2026 en Bogotá
    const range = getDateRange('week', reference);
    expect(bogotaMondayIndex(getBogotaDateParts(range.from))).toBe(0);
    expect(formatBogotaDateParts(getBogotaDateParts(range.from))).toBe('2026-07-13');
  });

  it('una entrega del lunes de esa semana queda dentro del rango', () => {
    const reference = new Date('2026-07-19T15:26:10.000Z');
    const range = getDateRange('week', reference);
    const mondayDelivery = new Date('2026-07-13T14:00:00.000Z'); // lunes, mediodía Bogotá
    expect(mondayDelivery >= range.from && mondayDelivery <= range.to).toBe(true);
  });

  it('una entrega del domingo anterior (fuera de la semana) queda excluida', () => {
    const reference = new Date('2026-07-19T15:26:10.000Z');
    const range = getDateRange('week', reference);
    const previousSunday = new Date('2026-07-12T14:00:00.000Z');
    expect(previousSunday >= range.from && previousSunday <= range.to).toBe(false);
  });
});

describe('getDateRange("month") — el mes inicia el día 1 en Bogotá', () => {
  it('el límite inferior del mes actual es el día 1 en Bogotá', () => {
    const reference = new Date('2026-07-19T15:26:10.000Z');
    const range = getDateRange('month', reference);
    expect(formatBogotaDateParts(getBogotaDateParts(range.from))).toBe('2026-07-01');
  });

  it('"mes anterior" cubre el mes calendario completo previo', () => {
    const reference = new Date('2026-07-19T15:26:10.000Z');
    const range = getDateRange('lastMonth', reference);
    expect(formatBogotaDateParts(getBogotaDateParts(range.from))).toBe('2026-06-01');
    expect(formatBogotaDateParts(getBogotaDateParts(range.to))).toBe('2026-06-30');
  });
});

describe('addBogotaDays — aritmética de fechas sin desfases', () => {
  it('retrocede correctamente a través de un límite de mes', () => {
    expect(addBogotaDays({ year: 2026, month: 7, day: 1 }, -1)).toEqual({
      year: 2026,
      month: 6,
      day: 30,
    });
  });

  it('avanza correctamente a través de un límite de año', () => {
    expect(addBogotaDays({ year: 2025, month: 12, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
  });
});
