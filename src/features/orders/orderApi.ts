import { AppError } from '../../lib/errors';
import { env, isSupabaseConfigured } from '../../lib/env';
import { supabase } from '../../lib/supabase';
import type { OrderRequest, OrderResult } from '../../types/domain';

export const sanitizeOrderPayload = (input: OrderRequest): OrderRequest => ({
  idempotency_key: input.idempotency_key,
  customer: {
    name: input.customer.name.trim(),
    phone: input.customer.phone,
    // Un correo vacío no viaja: el esquema del servidor lo rechazaría por forma.
    ...(input.customer.email?.trim() ? { email: input.customer.email.trim() } : {}),
  },
  items: input.items.map(({ product_id, quantity }) => ({ product_id, quantity })),
  delivery: {
    address: input.delivery.address.trim(),
    neighborhood: input.delivery.neighborhood.trim(),
    municipality: input.delivery.municipality.trim(),
    delivery_method_id: input.delivery.delivery_method_id,
    requested_date: input.delivery.requested_date,
  },
  payment_method_id: input.payment_method_id,
  notes: input.notes?.trim() || undefined,
});

export const createOrder = async (request: OrderRequest): Promise<OrderResult> => {
  if (!isSupabaseConfigured || !supabase) {
    if (env.demoMode) {
      throw new AppError(
        'El modo demostración no crea pedidos. Conecta Supabase para confirmar una compra.',
        'DEMO_READ_ONLY',
      );
    }
    throw new AppError('Supabase no está configurado.', 'SUPABASE_NOT_CONFIGURED');
  }
  const { data, error } = await supabase.functions.invoke<OrderResult>('create-order', {
    body: sanitizeOrderPayload(request),
  });
  if (error) {
    let code = 'CREATE_ORDER_FAILED';
    let message = 'No pudimos crear el pedido.';
    let status: number | null = null;
    const context = 'context' in error ? error.context : null;
    if (context instanceof Response) {
      status = context.status;
      try {
        const payload = (await context.clone().json()) as {
          error?: { code?: string; message?: string };
        };
        code = payload.error?.code ?? code;
        message = payload.error?.message ?? message;
      } catch {
        // La respuesta no era JSON; se conserva el mensaje seguro.
      }
    } else {
      // Sin `Response` la petición nunca llegó a completarse: CORS o red. El
      // navegador ya registró el detalle real en la consola.
      code = 'NETWORK_OR_CORS_ERROR';
      message = 'No pudimos contactar al servidor. Revisa tu conexión e intenta de nuevo.';
    }
    // La tienda ya no pide clave ni código: el celular es la identificación. Si
    // el servidor todavía rechaza por sesión (base sin la migración
    // 202608070009), el mensaje no puede mandar a un acceso que ya no existe.
    if (code === 'CUSTOMER_NOT_AUTHORIZED' || code === 'CUSTOMER_AUTH_REQUIRED') {
      message =
        'No pudimos usar ese celular para el pedido. Comunícate con el negocio para confirmarlo.';
    }
    // Solo en desarrollo, y solo código y estado: nunca tokens, datos del
    // cliente ni el cuerpo del pedido.
    if (import.meta.env.DEV) {
      console.warn('[createOrder] rechazado', { code, status });
    }
    throw new AppError(message, code, error.message);
  }
  if (!data?.order_number)
    throw new AppError('El servidor no confirmó el pedido.', 'INVALID_RESPONSE');
  return data;
};
