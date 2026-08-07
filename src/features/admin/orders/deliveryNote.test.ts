import { describe, expect, it } from 'vitest';
import {
  buildDeliveryNote,
  deliveryNoteFilename,
  deliveryNoteNumber,
  deliveryNoteRows,
  deliveryNoteTotals,
} from './deliveryNote';
import type { AdminOrder, AdminOrderItem } from '../types';

const ORDER = {
  id: '0f5f2d1e-1111-4222-8333-444455556666',
  order_number: 'PED-00000017',
  customer_name_snapshot: 'JUAN',
  customer_phone_snapshot: '3013350356',
  delivery_address: 'Calle 10 # 20-30',
  neighborhood: 'El Playón',
  municipality: 'Medellín',
  status: 'delivered',
  payment_status: 'partial',
  subtotal_amount: 105000,
  discount_amount: 5000,
  delivery_amount: 6000,
  total_amount: 106000,
  amount_paid: 40000,
  customer_notes: 'Presentación: Chorizo Argentino x4 (3 unidades)',
  created_at: '2026-08-06T19:34:00-05:00',
} as AdminOrder;

const ITEMS = [
  {
    id: 'item-1',
    order_id: ORDER.id,
    product_name: 'Chorizo Argentino',
    sku: 'CHO-ARG',
    quantity: 4,
    unit_price: 16000,
    subtotal_amount: 64000,
  },
  {
    id: 'item-2',
    order_id: ORDER.id,
    product_name: 'Chorizo Jalapeño',
    sku: 'CHO-JAL',
    quantity: 3,
    unit_price: 16000,
    subtotal_amount: 48000,
  },
] as AdminOrderItem[];

describe('comprobante de entrega', () => {
  it('identifica el pedido por su consecutivo', () => {
    expect(deliveryNoteNumber(ORDER)).toBe('PED-00000017');
    expect(deliveryNoteFilename(ORDER)).toBe('comprobante-entrega-PED-00000017.pdf');
  });

  it('cae al id corto cuando el pedido no tiene consecutivo', () => {
    const sinNumero = { ...ORDER, order_number: undefined, consecutive: undefined } as AdminOrder;
    expect(deliveryNoteNumber(sinNumero)).toBe('0f5f2d1e');
  });

  it('lista una fila por producto con cantidad, precio y subtotal', () => {
    const rows = deliveryNoteRows(ITEMS);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.slice(0, 3)).toEqual(['Chorizo Argentino', 'CHO-ARG', '4']);
    expect(rows[1]?.[0]).toBe('Chorizo Jalapeño');
  });

  it('imprime el saldo que el cliente debe al firmar', () => {
    const totals = Object.fromEntries(deliveryNoteTotals(ORDER));
    expect(totals['TOTAL']).toMatch(/106\.000/);
    expect(totals['Pagado']).toMatch(/40\.000/);
    expect(totals['Saldo por cobrar']).toMatch(/66\.000/);
    expect(totals['Descuento']).toMatch(/^- /);
  });

  it('omite la línea de descuento cuando no hay descuento', () => {
    const labels = deliveryNoteTotals({ ...ORDER, discount_amount: 0 }).map(([label]) => label);
    expect(labels).not.toContain('Descuento');
  });

  it('genera un PDF de una página con el pedido y el espacio de firmas', () => {
    const doc = buildDeliveryNote({ order: ORDER, items: ITEMS, businessName: 'Chorizos Tulio' });
    expect(doc.getNumberOfPages()).toBe(1);
    const text = doc.output();
    expect(text).toContain('%PDF');
    expect(deliveryNoteFilename(ORDER)).toContain('PED-00000017');
  });
});
