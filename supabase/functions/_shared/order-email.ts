/**
 * Contrato del correo de confirmación de pedido.
 *
 * Este módulo es lógica pura —sin `Deno`, sin `npm:`— justamente para poder
 * ejercitarlo desde las pruebas del proyecto: es el que decide qué datos viajan
 * a Google Apps Script y con qué valores por defecto, que es donde se cometen
 * los errores que el cliente termina viendo en su bandeja.
 *
 * El secreto compartido viaja en el CUERPO y no en una cabecera porque un Web
 * App de Apps Script no expone las cabeceras de la petición a `doPost(e)`.
 */

/** Texto exigido por el negocio cuando el pedido no trae observaciones. */
export const NO_NOTES_TEXT = 'Sin observaciones';

export const DEFAULT_BUSINESS_NAME = 'Chorizos Granja Las Marías';

export interface OrderEmailItem {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface OrderEmailPayload {
  /** Identifica el envío: Apps Script lo usa para no repetir un correo. */
  deliveryId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  items: OrderEmailItem[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  address: string;
  requestedDate: string;
  notes: string;
  businessName: string;
}

/**
 * Validación deliberadamente conservadora: un correo con espacios, sin arroba o
 * sin punto en el dominio no se intenta enviar, para no gastar reintentos ni
 * ensuciar la bandeja de rebotes.
 */
export const isDeliverableEmail = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 254 &&
  /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(value.trim());

const text = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
};

const money = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toItems = (value: unknown): OrderEmailItem[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const item = (row ?? {}) as Record<string, unknown>;
      return {
        name: text(item.name ?? item.product_name, 'Producto'),
        quantity: money(item.quantity),
        unitPrice: money(item.unit_price ?? item.unitPrice),
        subtotal: money(item.subtotal ?? item.subtotal_amount),
      };
    })
    .filter((item) => item.quantity > 0);
};

/**
 * Normaliza lo que devuelve `build_order_email_payload` en la base de datos.
 * Devuelve `null` cuando falta algo sin lo cual el correo no tiene sentido
 * (destinatario inválido o pedido sin número): eso se marca como fallo NO
 * reintentable, porque reintentarlo daría el mismo resultado.
 */
export const normalizeOrderEmailPayload = (
  raw: unknown,
  context: { deliveryId: string; recipient?: string; businessName?: string },
): OrderEmailPayload | null => {
  const source = (raw ?? {}) as Record<string, unknown>;
  const email = text(source.customer_email ?? context.recipient);
  const orderNumber = text(source.order_number);
  if (!isDeliverableEmail(email) || !orderNumber) return null;

  const items = toItems(source.items);
  return {
    deliveryId: context.deliveryId,
    orderNumber,
    customerName: text(source.customer_name, 'Cliente'),
    customerEmail: email.trim(),
    items,
    subtotal: money(source.subtotal_amount),
    discount: money(source.discount_amount),
    deliveryFee: money(source.delivery_amount),
    total: money(source.total_amount),
    address: text(source.delivery_address, 'Por confirmar'),
    requestedDate: text(source.requested_delivery_date, 'Por confirmar'),
    // Requisito explícito del negocio.
    notes: text(source.customer_notes, NO_NOTES_TEXT),
    businessName: text(context.businessName, DEFAULT_BUSINESS_NAME),
  };
};

/**
 * Cuerpo exacto que recibe el Web App de Apps Script. El secreto se agrega aquí
 * y nunca se registra: los `console.log` del worker imprimen solo códigos.
 */
export const appsScriptRequestBody = (payload: OrderEmailPayload, secret: string): string =>
  JSON.stringify({ secret, ...payload });
