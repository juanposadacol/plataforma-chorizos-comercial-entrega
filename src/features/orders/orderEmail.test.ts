import { describe, expect, it } from 'vitest';
import {
  appsScriptRequestBody,
  classifyAppsScriptOutcome,
  isDeliverableEmail,
  normalizeOrderEmailPayload,
  NO_NOTES_TEXT,
} from '../../../supabase/functions/_shared/order-email';
import { checkoutSchema } from './checkoutSchema';
import { sanitizeOrderPayload } from './orderApi';
import type { OrderRequest } from '../../types/domain';

// Lógica pura de la Edge Function `process-email-outbox`: decide qué viaja a
// Google Apps Script. Se mantiene sin `Deno` para poder ejercitarla aquí.

const RAW = {
  order_number: 'PED-00000019',
  customer_name: 'JUAN',
  customer_email: 'juan@correo.com',
  delivery_address: 'Calle 10 # 20-30, El Playón, Medellín',
  requested_delivery_date: '10/08/2026',
  customer_notes: 'Presentación: Chorizo Argentino x4 (3 unidades)',
  subtotal_amount: 100000,
  discount_amount: 0,
  delivery_amount: 5000,
  total_amount: 105000,
  items: [
    { name: 'Chorizo Argentino', quantity: 4, unit_price: 16000, subtotal: 64000 },
    { name: 'Chorizo Jalapeño', quantity: 2, unit_price: 16000, subtotal: 32000 },
  ],
};

const CONTEXT = { deliveryId: 'delivery-1', recipient: 'juan@correo.com' };

describe('correo de confirmación: qué se le envía al comprador', () => {
  it('lleva los datos reales del pedido', () => {
    const payload = normalizeOrderEmailPayload(RAW, CONTEXT);

    expect(payload).toMatchObject({
      orderNumber: 'PED-00000019',
      customerName: 'JUAN',
      customerEmail: 'juan@correo.com',
      total: 105000,
      address: 'Calle 10 # 20-30, El Playón, Medellín',
      requestedDate: '10/08/2026',
      businessName: 'Chorizos Granja Las Marías',
    });
    expect(payload?.items).toHaveLength(2);
    expect(payload?.items[0]).toEqual({
      name: 'Chorizo Argentino',
      quantity: 4,
      unitPrice: 16000,
      subtotal: 64000,
    });
  });

  // Requisito explícito del negocio.
  it('muestra «Sin observaciones» cuando el pedido no trae ninguna', () => {
    expect(normalizeOrderEmailPayload({ ...RAW, customer_notes: null }, CONTEXT)?.notes).toBe(
      NO_NOTES_TEXT,
    );
    expect(normalizeOrderEmailPayload({ ...RAW, customer_notes: '   ' }, CONTEXT)?.notes).toBe(
      NO_NOTES_TEXT,
    );
    expect(normalizeOrderEmailPayload(RAW, CONTEXT)?.notes).toContain('Presentación');
  });

  it('no intenta enviar sin destinatario utilizable ni sin número de pedido', () => {
    expect(normalizeOrderEmailPayload({ ...RAW, customer_email: null }, { deliveryId: 'd' })).toBe(
      null,
    );
    expect(
      normalizeOrderEmailPayload({ ...RAW, customer_email: 'sin-arroba' }, { deliveryId: 'd' }),
    ).toBe(null);
    expect(normalizeOrderEmailPayload({ ...RAW, order_number: '' }, CONTEXT)).toBe(null);
    expect(normalizeOrderEmailPayload(null, CONTEXT)).toBe(null);
  });

  it('usa el destinatario de la fila del outbox si el pedido no guardó correo', () => {
    const payload = normalizeOrderEmailPayload({ ...RAW, customer_email: null }, CONTEXT);
    expect(payload?.customerEmail).toBe('juan@correo.com');
  });

  it('tolera datos incompletos sin romperse', () => {
    const payload = normalizeOrderEmailPayload(
      { order_number: 'PED-1', customer_email: 'a@b.co', items: 'no-es-lista' },
      { deliveryId: 'd' },
    );
    expect(payload?.items).toEqual([]);
    expect(payload?.total).toBe(0);
    expect(payload?.customerName).toBe('Cliente');
    expect(payload?.address).toBe('Por confirmar');
  });

  it('el cuerpo que recibe Apps Script incluye el secreto y el envío', () => {
    const payload = normalizeOrderEmailPayload(RAW, CONTEXT);
    const body = JSON.parse(appsScriptRequestBody(payload!, 'secreto-compartido'));

    expect(body.secret).toBe('secreto-compartido');
    // deliveryId es lo que permite a Apps Script descartar un reintento.
    expect(body.deliveryId).toBe('delivery-1');
    expect(body.orderNumber).toBe('PED-00000019');
  });
});

describe('cuando Gmail o Apps Script fallan', () => {
  // La garantía del negocio: para cuando este worker corre, `create_order` ya
  // hizo commit. Lo único que decide esta clasificación es el destino de la
  // fila del outbox; el pedido ya está guardado pase lo que pase.
  it('un envío correcto se marca enviado y no se reintenta', () => {
    expect(classifyAppsScriptOutcome(200, { ok: true, messageId: 'delivery-1' })).toEqual({
      ok: true,
      retryable: false,
      externalId: 'delivery-1',
      duplicated: false,
    });
  });

  it('Google caído o saturado deja el envío pendiente de reintento', () => {
    for (const status of [429, 500, 502, 503]) {
      const outcome = classifyAppsScriptOutcome(status, { ok: false });
      expect(outcome.ok).toBe(false);
      // Pendiente, no perdido: el pedido sigue existiendo y el correo vuelve a
      // intentarse en la siguiente pasada del worker.
      expect(outcome.retryable).toBe(true);
    }
  });

  it('un secreto o unos datos equivocados no se reintentan en vano', () => {
    for (const status of [400, 401, 403, 404]) {
      const outcome = classifyAppsScriptOutcome(status, { ok: false, error: 'unauthorized' });
      expect(outcome.ok).toBe(false);
      expect(outcome.retryable).toBe(false);
    }
  });

  it('un 200 con ok:false tampoco se toma por enviado', () => {
    // Apps Script responde SIEMPRE 200; el veredicto real está en el cuerpo.
    const outcome = classifyAppsScriptOutcome(200, { ok: false, error: 'invalid_payload' });
    expect(outcome.ok).toBe(false);
    expect(outcome.retryable).toBe(false);
  });

  it('un reintento que Apps Script ya había enviado cuenta como éxito', () => {
    // Tercera defensa contra duplicados: el comprador ya tiene su correo, así
    // que la fila se cierra en vez de reintentarse para siempre.
    const outcome = classifyAppsScriptOutcome(200, { ok: true, duplicated: true });
    expect(outcome).toMatchObject({ ok: true, retryable: false, duplicated: true });
  });

  it('un duplicado reportado con estado de error tampoco se reintenta', () => {
    expect(classifyAppsScriptOutcome(500, { duplicated: true })).toMatchObject({
      ok: true,
      retryable: false,
    });
  });
});

describe('isDeliverableEmail', () => {
  it('acepta correos usables', () => {
    expect(isDeliverableEmail('juan@correo.com')).toBe(true);
    expect(isDeliverableEmail('juan.perez+pedidos@mi-dominio.com.co')).toBe(true);
  });

  it('rechaza lo que Gmail no podría entregar', () => {
    for (const value of ['', 'juan', 'juan@correo', 'juan @correo.com', 'a@b.c', null, 42]) {
      expect(isDeliverableEmail(value)).toBe(false);
    }
    expect(isDeliverableEmail(`${'a'.repeat(250)}@correo.com`)).toBe(false);
  });
});

describe('el correo en el checkout', () => {
  const VALID = {
    customerName: 'María Gómez',
    customerPhone: '3013350356',
    address: 'Calle 10 # 20-30',
    neighborhood: 'El Playón',
    municipality: 'Medellín',
    deliveryMethodId: '11111111-1111-4111-8111-111111111111',
    paymentMethodId: '22222222-2222-4222-8222-222222222222',
    requestedDate: '2026-08-10',
    notes: '',
  };

  // Sin correo el pedido debe poder crearse igual: exigirlo dejaría sin comprar
  // a quien no tiene o no quiere darlo.
  it('es opcional: vacío es válido', () => {
    expect(checkoutSchema.safeParse({ ...VALID, customerEmail: '' }).success).toBe(true);
  });

  it('si se escribe, debe tener forma de correo', () => {
    expect(checkoutSchema.safeParse({ ...VALID, customerEmail: 'juan@correo.com' }).success).toBe(
      true,
    );
    expect(checkoutSchema.safeParse({ ...VALID, customerEmail: 'juan' }).success).toBe(false);
  });

  it('viaja al servidor solo cuando el comprador lo escribió', () => {
    const base: OrderRequest = {
      idempotency_key: '00000000-0000-4000-8000-000000000001',
      customer: { name: ' Juan ', phone: '3013350356' },
      items: [{ product_id: '33333333-3333-4333-8333-333333333333', quantity: 1 }],
      delivery: {
        address: 'Calle 10',
        neighborhood: 'Centro',
        municipality: 'Medellín',
        delivery_method_id: '11111111-1111-4111-8111-111111111111',
        requested_date: '2026-08-10',
      },
      payment_method_id: '22222222-2222-4222-8222-222222222222',
    };

    expect(sanitizeOrderPayload(base).customer).not.toHaveProperty('email');
    expect(
      sanitizeOrderPayload({ ...base, customer: { ...base.customer, email: '  ' } }).customer,
    ).not.toHaveProperty('email');
    expect(
      sanitizeOrderPayload({
        ...base,
        customer: { ...base.customer, email: ' juan@correo.com ' },
      }).customer.email,
    ).toBe('juan@correo.com');
  });
});
