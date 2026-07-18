import { AppError } from '../../lib/errors';
import { env, isSupabaseConfigured } from '../../lib/env';
import { supabase } from '../../lib/supabase';
import type { OrderRequest, OrderResult, TrackingOrder } from '../../types/domain';

export const sanitizeOrderPayload = (input: OrderRequest): OrderRequest => ({
  idempotency_key: input.idempotency_key,
  customer: { name: input.customer.name.trim(), phone: input.customer.phone },
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
    const context = 'context' in error ? error.context : null;
    if (context instanceof Response) {
      try {
        const payload = (await context.clone().json()) as {
          error?: { code?: string; message?: string };
        };
        code = payload.error?.code ?? code;
        message = payload.error?.message ?? message;
      } catch {
        // La respuesta no era JSON; se conserva el mensaje seguro.
      }
    }
    if (code === 'CUSTOMER_NOT_AUTHORIZED' || code === 'CUSTOMER_AUTH_REQUIRED') {
      message =
        'Este celular ya está registrado. Inicia sesión con el código SMS para usar sus precios.';
    }
    throw new AppError(message, code, error.message);
  }
  if (!data?.order_number)
    throw new AppError('El servidor no confirmó el pedido.', 'INVALID_RESPONSE');
  return data;
};

export const getOrderTracking = async (token: string): Promise<TrackingOrder> => {
  if (!supabase) throw new AppError('Supabase no está configurado.', 'SUPABASE_NOT_CONFIGURED');
  const { data, error } = await supabase.rpc('get_order_tracking', { p_tracking_token: token });
  if (error || !data)
    throw new AppError('No encontramos un pedido con ese enlace.', 'ORDER_NOT_FOUND');
  return (Array.isArray(data) ? data[0] : data) as TrackingOrder;
};

export const getMyOrders = async (): Promise<TrackingOrder[]> => {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_my_orders');
  if (error) throw error;
  return (data ?? []) as TrackingOrder[];
};

export const repeatOrderItems = (
  order: TrackingOrder,
): Array<{ productId: string; quantity: number }> =>
  order.items
    .filter((item) => Boolean(item.product_id))
    .map((item) => ({
      productId: String(item.product_id),
      quantity: Number(item.quantity),
    }));
