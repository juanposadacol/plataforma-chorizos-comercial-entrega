import { describe, expect, it } from 'vitest';
import { lineAmounts, purchaseTotals, unitCostFromPaid } from './purchaseMath';

describe('costo unitario de compra', () => {
  it('divide el valor pagado entre la cantidad', () =>
    expect(unitCostFromPaid(120000, 10)).toBe(12000));

  it('redondea a dos decimales', () => expect(unitCostFromPaid(10000, 3)).toBe(3333.33));

  it('no divide por cero', () => expect(unitCostFromPaid(10000, 0)).toBe(0));

  it('respeta la restricción subtotal = round(cantidad × costo unitario, 2)', () => {
    const amounts = lineAmounts({
      quantity: '3',
      paid_amount: '10000',
      discount_amount: '0',
      tax_amount: '0',
    });
    expect(amounts.unitCost).toBe(3333.33);
    expect(amounts.subtotal).toBe(9999.99);
    expect(amounts.total).toBe(9999.99);
  });

  it('aplica descuento e impuesto sobre el subtotal', () => {
    const amounts = lineAmounts({
      quantity: '10',
      paid_amount: '100000',
      discount_amount: '5000',
      tax_amount: '1900',
    });
    expect(amounts.unitCost).toBe(10000);
    expect(amounts.subtotal).toBe(100000);
    expect(amounts.total).toBe(96900);
  });

  it('suma las líneas conservando la identidad total = subtotal − descuento + impuesto', () => {
    const totals = purchaseTotals([
      { quantity: '10', paid_amount: '100000', discount_amount: '5000', tax_amount: '0' },
      { quantity: '4', paid_amount: '48000', discount_amount: '0', tax_amount: '1000' },
    ]);
    expect(totals.subtotal).toBe(148000);
    expect(totals.discount).toBe(5000);
    expect(totals.tax).toBe(1000);
    expect(totals.total).toBe(144000);
  });
});
