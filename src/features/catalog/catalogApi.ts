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

export const getCatalog = async (): Promise<Product[]> => {
  if (!isSupabaseConfigured || !supabase) {
    if (env.demoMode) return demoProducts;
    throw new AppError(
      'La tienda aún no está conectada. Configura Supabase para publicar el catálogo.',
      'SUPABASE_NOT_CONFIGURED',
    );
  }

  const { data, error } = await supabase.rpc('get_catalog_prices');
  if (error) throw new AppError('No pudimos cargar los productos.', error.code, error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapProduct);
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
      .select('id,name,description')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('delivery_methods')
      .select('id,name,description,fee')
      .eq('is_active', true)
      .order('sort_order'),
  ]);
  if (payments.error) throw payments.error;
  if (deliveries.error) throw deliveries.error;
  return {
    paymentMethods: (payments.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
    })),
    deliveryMethods: (deliveries.data ?? []).map((row) => ({
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
