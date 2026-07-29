import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderRequest } from '../../types/domain';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('../../lib/env', () => ({
  env: {
    supabaseUrl: 'https://proyecto.supabase.co',
    supabaseAnonKey: 'sb_publishable_valor-inerte-de-prueba',
    appUrl: 'http://localhost:5173',
    demoMode: false,
  },
  isSupabaseConfigured: true,
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke } },
  isSupabaseConfigured: true,
}));

const { createOrder, sanitizeOrderPayload } = await import('./orderApi');

const REQUEST: OrderRequest = {
  idempotency_key: '6f9619ff-8b86-4011-b42d-00cf4fc964ff',
  customer: { name: '  María Gómez  ', phone: '+573001112233' },
  items: [{ product_id: 'producto-1', quantity: 2 }],
  delivery: {
    address: '  Calle 1 #2-3  ',
    neighborhood: ' El Centro ',
    municipality: ' Pasto ',
    delivery_method_id: 'entrega-1',
    requested_date: '2026-08-01',
  },
  payment_method_id: 'pago-1',
  notes: '  Después de las 4  ',
};

/** Respuesta de error de la Edge Function tal como la entrega supabase-js. */
const httpError = (status: number, body: unknown) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }),
});

afterEach(() => {
  invoke.mockReset();
  vi.restoreAllMocks();
});

describe('createOrder — conserva el code y el message del backend', () => {
  it('7. ORIGIN_NOT_ALLOWED llega íntegro al usuario', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(403, {
        error: {
          code: 'ORIGIN_NOT_ALLOWED',
          message: 'Este sitio no está autorizado para crear pedidos.',
        },
      }),
    });

    await expect(createOrder(REQUEST)).rejects.toMatchObject({
      code: 'ORIGIN_NOT_ALLOWED',
      message: 'Este sitio no está autorizado para crear pedidos.',
    });
  });

  it('METHOD_NOT_ALLOWED ya no llega sin mensaje', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(405, {
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Este recurso solo acepta solicitudes POST.',
        },
      }),
    });

    await expect(createOrder(REQUEST)).rejects.toMatchObject({
      code: 'METHOD_NOT_ALLOWED',
      message: 'Este recurso solo acepta solicitudes POST.',
    });
  });

  it('6b. INVALID_SESSION conserva su mensaje', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(401, {
        error: { code: 'INVALID_SESSION', message: 'La sesión no es válida.' },
      }),
    });

    await expect(createOrder(REQUEST)).rejects.toMatchObject({
      code: 'INVALID_SESSION',
      message: 'La sesión no es válida.',
    });
  });

  it('INTERNAL_ERROR no expone detalles internos de PostgreSQL', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(500, {
        error: { code: 'INTERNAL_ERROR', message: 'No fue posible crear el pedido.' },
      }),
    });

    await expect(createOrder(REQUEST)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'No fue posible crear el pedido.',
    });
  });

  it('un fallo de red o CORS se distingue de un rechazo del servidor', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to send a request', context: {} },
    });

    await expect(createOrder(REQUEST)).rejects.toMatchObject({
      code: 'NETWORK_OR_CORS_ERROR',
    });
  });

  it('un cuerpo que no es JSON no rompe el manejo del error', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        name: 'FunctionsHttpError',
        message: 'non-2xx',
        context: new Response('<html>502</html>', { status: 502 }),
      },
    });

    await expect(createOrder(REQUEST)).rejects.toMatchObject({
      code: 'CREATE_ORDER_FAILED',
    });
  });

  it('un cliente ya registrado recibe la invitación a iniciar sesión', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(403, {
        error: { code: 'CUSTOMER_NOT_AUTHORIZED', message: 'Cliente registrado.' },
      }),
    });

    await expect(createOrder(REQUEST)).rejects.toMatchObject({
      code: 'CUSTOMER_NOT_AUTHORIZED',
      message: expect.stringContaining('Inicia sesión'),
    });
  });
});

describe('createOrder — el registro de errores no filtra datos sensibles', () => {
  it('solo registra código y estado, nunca datos del cliente', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    invoke.mockResolvedValue({
      data: null,
      error: httpError(403, {
        error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Este sitio no está autorizado.' },
      }),
    });

    await expect(createOrder(REQUEST)).rejects.toThrow();

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('ORIGIN_NOT_ALLOWED');
    expect(logged).not.toContain('573001112233');
    expect(logged).not.toContain('María');
    expect(logged).not.toContain('Calle 1');
    expect(logged).not.toContain('sb_publishable_');
  });
});

describe('sanitizeOrderPayload — el navegador nunca envía importes', () => {
  it('8e. descarta cualquier campo de precio inyectado desde el cliente', () => {
    const manipulado = {
      ...REQUEST,
      total: 1,
      items: [{ product_id: 'producto-1', quantity: 2, unit_price: 1, discount: 99 }],
    } as unknown as OrderRequest;

    const limpio = sanitizeOrderPayload(manipulado);

    expect(limpio).not.toHaveProperty('total');
    expect(limpio.items[0]).toEqual({ product_id: 'producto-1', quantity: 2 });
    expect(JSON.stringify(limpio)).not.toContain('unit_price');
    expect(JSON.stringify(limpio)).not.toContain('discount');
  });

  it('normaliza los textos antes de enviarlos', () => {
    const limpio = sanitizeOrderPayload(REQUEST);

    expect(limpio.customer.name).toBe('María Gómez');
    expect(limpio.delivery.address).toBe('Calle 1 #2-3');
    expect(limpio.delivery.neighborhood).toBe('El Centro');
    expect(limpio.notes).toBe('Después de las 4');
  });
});
