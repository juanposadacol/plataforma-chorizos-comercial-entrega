import { demoDeliveryMethods, demoPaymentMethods, demoProducts } from '../../data/demoCatalog';
import { AppError } from '../../lib/errors';
import { env, isSupabaseConfigured } from '../../lib/env';
import { supabase } from '../../lib/supabase';
import type { Product, PublicSettings, SelectOption } from '../../types/domain';

const mapProduct = (row: Record<string, unknown>): Product => ({
  id: String(row.id),
  sku: String(row.sku ?? ''),
  slug: String(row.slug ?? row.id),
  name: String(row.name ?? ''),
  short_description: String(row.short_description ?? ''),
  category_id: row.category_id ? String(row.category_id) : null,
  category_name: String(row.category_name ?? 'Chorizos artesanales'),
  image_url: String(row.image_url ?? '/assets/santa-rosano.png'),
  public_price: Number(row.public_price ?? 0),
  effective_price: Number(row.effective_price ?? row.public_price ?? 0),
  stock_available: Number(row.stock_available ?? 0),
  unit: String(row.unit ?? 'paquete'),
  presentation: String(row.presentation ?? ''),
  is_featured: Boolean(row.is_featured),
  allow_backorder: Boolean(row.allow_backorder),
  price_source: (row.price_source as Product['price_source']) ?? 'public',
});

/**
 * Catálogo con el precio que se va a cobrar. Si se pasa un celular, el servidor
 * resuelve la condición comercial de ese cliente (precio acordado, lista o
 * volumen) para que el precio acordado se vea en la tienda y no solo en el
 * total del pedido. Un celular desconocido devuelve el catálogo público.
 */
export const getCatalog = async (phone?: string): Promise<Product[]> => {
  if (!isSupabaseConfigured || !supabase) {
    if (env.demoMode) return demoProducts;
    throw new AppError(
      'La tienda aún no está conectada. Configura Supabase para publicar el catálogo.',
      'SUPABASE_NOT_CONFIGURED',
    );
  }

  const { data, error } = phone
    ? await supabase.rpc('get_catalog_prices_for_phone', { p_phone: phone })
    : await supabase.rpc('get_catalog_prices');
  if (error) throw new AppError('No pudimos cargar los productos.', error.code, error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapProduct);
};

/** La tienda solo ofrece efectivo y transferencia. */
const ALLOWED_PAYMENT_CODES = ['efectivo', 'transferencia'];
const ALLOWED_PAYMENT_NAMES = /^(efectivo|transferencia)/i;
/** La tienda ya no ofrece recoger en el negocio: todo se entrega a domicilio. */
const EXCLUDED_DELIVERY_CODES = ['recoger'];
const EXCLUDED_DELIVERY_NAMES = /recog|retir|tienda|negocio|punto de venta/i;

const isAllowedPayment = (row: { code?: unknown; name?: unknown }) => {
  const code = String(row.code ?? '').toLowerCase();
  if (code) return ALLOWED_PAYMENT_CODES.includes(code);
  return ALLOWED_PAYMENT_NAMES.test(String(row.name ?? ''));
};

const isAllowedDelivery = (row: { code?: unknown; name?: unknown }) => {
  const code = String(row.code ?? '').toLowerCase();
  if (code) return !EXCLUDED_DELIVERY_CODES.includes(code);
  return !EXCLUDED_DELIVERY_NAMES.test(String(row.name ?? ''));
};

export const getCheckoutOptions = async (): Promise<{
  paymentMethods: SelectOption[];
  deliveryMethods: SelectOption[];
}> => {
  if (!isSupabaseConfigured || !supabase) {
    return env.demoMode
      ? { paymentMethods: demoPaymentMethods, deliveryMethods: demoDeliveryMethods }
      : { paymentMethods: [], deliveryMethods: [] };
  }

  const [payments, deliveries] = await Promise.all([
    supabase
      .from('payment_methods')
      .select('id,code,name,description')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('delivery_methods')
      .select('id,code,name,description,fee')
      .eq('is_active', true)
      .order('sort_order'),
  ]);
  if (payments.error) throw payments.error;
  if (deliveries.error) throw deliveries.error;
  return {
    paymentMethods: (payments.data ?? []).filter(isAllowedPayment).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
    })),
    deliveryMethods: (deliveries.data ?? []).filter(isAllowedDelivery).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      fee: Number(row.fee ?? 0),
    })),
  };
};

export const getPublicSettings = async (): Promise<PublicSettings> => {
  const defaults: PublicSettings = {
    businessName: 'Chorizos Artesanales',
    whatsappNumber: null,
    currency: 'COP',
    timezone: 'America/Bogota',
    minimumOrder: 0,
    privacyPolicy: '',
    terms: '',
  };
  if (!isSupabaseConfigured || !supabase) return defaults;
  const { data } = await supabase.rpc('get_public_settings');
  const value = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!value) return defaults;
  return {
    businessName: String(value.business_name ?? defaults.businessName),
    whatsappNumber: value.whatsapp_number ? String(value.whatsapp_number) : null,
    currency: 'COP',
    timezone: 'America/Bogota',
    minimumOrder: Number(value.minimum_order ?? 0),
    privacyPolicy: String(value.privacy_policy ?? ''),
    terms: String(value.terms ?? ''),
  };
};
