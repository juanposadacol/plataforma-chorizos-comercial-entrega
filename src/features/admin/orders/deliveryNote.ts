import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AdminOrder, AdminOrderItem } from '../types';
import {
  itemSubtotal,
  orderAmountPaid,
  orderBalance,
  orderDeliveryFee,
  orderDiscount,
  orderSubtotal,
  orderTotal,
} from '../types';
import {
  firstText,
  formatAdminDate,
  formatMoney,
  paymentStatusLabels,
  orderStatusLabels,
  toNumber,
} from '../utils';

/**
 * Comprobante de entrega imprimible: el papel que viaja con el domicilio y que
 * el cliente firma al recibir. No es una factura electrónica DIAN — es el
 * soporte interno de entrega, con el detalle del pedido, el saldo y el espacio
 * para las dos firmas.
 */

export interface DeliveryNoteOptions {
  order: AdminOrder;
  items: AdminOrderItem[];
  businessName?: string;
  /** Celular/NIT que se imprime bajo el nombre del negocio. */
  businessContact?: string | null;
}

const WINE: [number, number, number] = [116, 29, 23];
const MUTED: [number, number, number] = [120, 104, 93];
const INK: [number, number, number] = [40, 33, 27];

export const deliveryNoteNumber = (order: AdminOrder): string =>
  firstText(order, 'order_number', 'consecutive') || order.id.slice(0, 8);

export const deliveryNoteFilename = (order: AdminOrder): string =>
  `comprobante-entrega-${deliveryNoteNumber(order).replaceAll(/[^\w-]/g, '')}.pdf`;

/** Filas de la tabla de productos, ya formateadas. Función pura, fácil de probar. */
export const deliveryNoteRows = (items: AdminOrderItem[]): string[][] =>
  items.map((item) => [
    firstText(item, 'product_name', 'name') || 'Producto',
    firstText(item, 'sku') || '—',
    String(toNumber(item.quantity)),
    formatMoney(item.unit_price),
    formatMoney(itemSubtotal(item)),
  ]);

/** Bloque de totales del comprobante, en el orden en que se imprime. */
export const deliveryNoteTotals = (order: AdminOrder): Array<[string, string]> => {
  const discount = orderDiscount(order);
  return [
    ['Subtotal', formatMoney(orderSubtotal(order))],
    ...(discount ? ([['Descuento', `- ${formatMoney(discount)}`]] as Array<[string, string]>) : []),
    ['Domicilio', formatMoney(orderDeliveryFee(order))],
    ['TOTAL', formatMoney(orderTotal(order))],
    ['Pagado', formatMoney(orderAmountPaid(order))],
    ['Saldo por cobrar', formatMoney(orderBalance(order))],
  ];
};

export const buildDeliveryNote = ({
  order,
  items,
  businessName = 'Chorizos Artesanales',
  businessContact,
}: DeliveryNoteOptions): jsPDF => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const number = deliveryNoteNumber(order);

  // Encabezado.
  doc.setTextColor(...WINE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(businessName, margin, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text('Comprobante de entrega', margin, 24);
  if (businessContact) doc.text(businessContact, margin, 29);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...WINE);
  doc.text(`Pedido #${number}`, pageWidth - margin, 18, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`Fecha del pedido: ${formatAdminDate(order.created_at, true)}`, pageWidth - margin, 24, {
    align: 'right',
  });
  doc.text(
    `Entrega: ${formatAdminDate(order.requested_delivery_date ?? order.requested_date)}`,
    pageWidth - margin,
    29,
    { align: 'right' },
  );
  doc.setDrawColor(...WINE);
  doc.setLineWidth(0.6);
  doc.line(margin, 33, pageWidth - margin, 33);

  // Datos del cliente y de la entrega.
  const customer = firstText(order, 'customer_name_snapshot', 'customer_name') || 'Sin nombre';
  const phone = firstText(order, 'customer_phone_snapshot', 'customer_phone') || '—';
  const address = firstText(order, 'delivery_address', 'address') || '—';
  const place = [order.neighborhood, order.municipality].filter(Boolean).join(', ') || '—';
  doc.setTextColor(40, 33, 27);
  doc.setFontSize(10);
  let y = 41;
  const field = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(doc.splitTextToSize(value, pageWidth - margin * 2 - 30) as string[], margin + 28, y);
    y += 6;
  };
  field('Cliente', customer);
  field('Celular', phone);
  field('Dirección', address);
  field('Barrio / Municipio', place);
  field(
    'Estado',
    `${orderStatusLabels[order.status] ?? order.status} · Pago: ${
      paymentStatusLabels[order.payment_status] ?? order.payment_status
    }`,
  );

  // Detalle de productos.
  autoTable(doc, {
    startY: y + 3,
    head: [['Producto', 'SKU', 'Cantidad', 'Vr. unitario', 'Subtotal']],
    body: deliveryNoteRows(items),
    theme: 'grid',
    headStyles: { fillColor: WINE, halign: 'left' },
    styles: { fontSize: 9, cellPadding: 2.4 },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  const table = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
  y = (table?.finalY ?? y + 30) + 8;

  // Totales, alineados a la derecha.
  doc.setFontSize(10);
  for (const [label, value] of deliveryNoteTotals(order)) {
    const strong = label === 'TOTAL';
    doc.setFont('helvetica', strong ? 'bold' : 'normal');
    const [red, green, blue] = strong ? WINE : INK;
    doc.setTextColor(red, green, blue);
    doc.text(label, pageWidth - margin - 45, y, { align: 'right' });
    doc.text(value, pageWidth - margin, y, { align: 'right' });
    y += strong ? 7 : 6;
  }

  // Observaciones (incluyen la presentación elegida por el cliente).
  const notes = String(order.customer_notes ?? '').trim();
  if (notes) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 33, 27);
    doc.setFontSize(9);
    doc.text('Observaciones', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    const wrapped = doc.splitTextToSize(notes, pageWidth - margin * 2) as string[];
    doc.text(wrapped, margin, y + 5);
    y += 5 + wrapped.length * 4.6;
  }

  // Firmas: el cliente firma al recibir; quien entrega también deja constancia.
  y = Math.max(y + 12, doc.internal.pageSize.getHeight() - 52);
  doc.setDrawColor(...MUTED);
  doc.setLineWidth(0.3);
  const columnWidth = (pageWidth - margin * 2 - 14) / 2;
  const signature = (x: number, title: string, hint: string) => {
    doc.line(x, y, x + columnWidth, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(40, 33, 27);
    doc.text(title, x, y + 5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.setFontSize(8);
    doc.text(hint, x, y + 10);
  };
  signature(margin, 'Recibí a satisfacción', 'Firma, nombre y documento del cliente');
  signature(margin + columnWidth + 14, 'Entregado por', 'Firma y nombre de quien entrega');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`Fecha de entrega: ____ / ____ / ________`, margin, y + 18);
  doc.text(
    `Documento generado el ${formatAdminDate(new Date().toISOString(), true)}`,
    pageWidth - margin,
    y + 18,
    { align: 'right' },
  );

  return doc;
};

/** Genera y descarga el comprobante listo para imprimir y firmar. */
export const downloadDeliveryNote = (options: DeliveryNoteOptions): void => {
  buildDeliveryNote(options).save(deliveryNoteFilename(options.order));
};
