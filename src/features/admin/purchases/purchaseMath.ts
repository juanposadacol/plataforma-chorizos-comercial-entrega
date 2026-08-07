import { toNumber } from '../utils';

export const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * El negocio registra lo que efectivamente pagó por la línea y cuántas unidades
 * recibió; de ahí sale el costo unitario real de esa semana, que es el que
 * alimenta el costo promedio y la utilidad.
 */
export const unitCostFromPaid = (paid: number, quantity: number): number =>
  quantity > 0 ? round2(paid / quantity) : 0;

export interface PurchaseLineInput {
  quantity: unknown;
  paid_amount: unknown;
  discount_amount: unknown;
  tax_amount: unknown;
}

export interface PurchaseLineAmounts {
  quantity: number;
  unitCost: number;
  /** `purchase_items` exige subtotal_amount = round(quantity * unit_cost, 2). */
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export const lineAmounts = (line: PurchaseLineInput): PurchaseLineAmounts => {
  const quantity = toNumber(line.quantity);
  const paid = toNumber(line.paid_amount);
  const discount = toNumber(line.discount_amount);
  const tax = toNumber(line.tax_amount);
  const unitCost = unitCostFromPaid(paid, quantity);
  const subtotal = round2(quantity * unitCost);
  return { quantity, unitCost, subtotal, discount, tax, total: round2(subtotal - discount + tax) };
};

export interface PurchaseTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export const purchaseTotals = (lines: PurchaseLineInput[]): PurchaseTotals => {
  const totals = lines.reduce(
    (acc, line) => {
      const amounts = lineAmounts(line);
      acc.subtotal = round2(acc.subtotal + amounts.subtotal);
      acc.discount = round2(acc.discount + amounts.discount);
      acc.tax = round2(acc.tax + amounts.tax);
      return acc;
    },
    { subtotal: 0, discount: 0, tax: 0 },
  );
  return { ...totals, total: round2(totals.subtotal - totals.discount + totals.tax) };
};
