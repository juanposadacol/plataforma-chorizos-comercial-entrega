import type { Product, SelectOption } from '../types/domain';

/**
 * Solo para presentación local con VITE_ENABLE_DEMO_DATA=true.
 * Producción siempre consulta Supabase y nunca crea pedidos desde estos datos.
 */
export const demoProducts: Product[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    sku: 'CHO-SR-500',
    slug: 'santa-rosano',
    name: 'Santa Rosano',
    short_description: 'Receta artesanal tradicional, 500 g y 4 unidades.',
    category_id: null,
    category_name: 'Chorizos artesanales',
    image_url: '/assets/santa-rosano.png',
    public_price: 17300,
    effective_price: 17300,
    stock_available: 24,
    unit: 'paquete',
    presentation: '500 g · 4 unidades',
    is_featured: true,
    allow_backorder: false,
    price_source: 'public',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    sku: 'CHO-AR-500',
    slug: 'argentino',
    name: 'Argentino',
    short_description: 'Perfil especiado de inspiración argentina, 500 g.',
    category_id: null,
    category_name: 'Chorizos artesanales',
    image_url: '/assets/argentino.png',
    public_price: 17300,
    effective_price: 17300,
    stock_available: 18,
    unit: 'paquete',
    presentation: '500 g · 4 unidades',
    is_featured: true,
    allow_backorder: false,
    price_source: 'public',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    sku: 'CHO-JA-500',
    slug: 'jalapeno',
    name: 'Jalapeño',
    short_description: 'Picante equilibrado con especias naturales, 500 g.',
    category_id: null,
    category_name: 'Chorizos artesanales',
    image_url: '/assets/jalapeno.png',
    public_price: 17300,
    effective_price: 17300,
    stock_available: 12,
    unit: 'paquete',
    presentation: '500 g · 4 unidades',
    is_featured: true,
    allow_backorder: false,
    price_source: 'public',
  },
];

export const demoPaymentMethods: SelectOption[] = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', name: 'Efectivo' },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', name: 'Transferencia' },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', name: 'Contraentrega' },
];

export const demoDeliveryMethods: SelectOption[] = [
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', name: 'Domicilio', fee: 0 },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', name: 'Recoger en el negocio', fee: 0 },
];
