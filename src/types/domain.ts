export type UUID = string;

export interface Category {
  id: UUID;
  name: string;
  slug: string;
}

export interface Product {
  id: UUID;
  sku: string;
  slug: string;
  name: string;
  short_description: string;
  category_id: UUID | null;
  category_name: string;
  image_url: string;
  public_price: number;
  effective_price: number;
  stock_available: number;
  unit: string;
  presentation: string;
  is_featured: boolean;
  allow_backorder: boolean;
  price_source?: 'special' | 'volume' | 'list' | 'public';
}

export interface CartItem {
  productId: UUID;
  quantity: number;
}

export interface CheckoutValues {
  customerName: string;
  customerPhone: string;
  address: string;
  neighborhood: string;
  municipality: string;
  deliveryMethodId: UUID;
  paymentMethodId: UUID;
  requestedDate: string;
  notes: string;
  privacyAccepted: boolean;
}

export interface OrderRequest {
  idempotency_key: string;
  customer: {
    name: string;
    phone: string;
  };
  items: Array<{ product_id: UUID; quantity: number }>;
  delivery: {
    address: string;
    neighborhood: string;
    municipality: string;
    delivery_method_id: UUID;
    requested_date: string;
  };
  payment_method_id: UUID;
  notes?: string;
}

export interface OrderResult {
  order_id: UUID;
  order_number: string;
  tracking_token: string;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  total: number;
  status: string;
  payment_status: string;
  manual_whatsapp_url?: string | null;
  notification_status?: string;
}

export interface TrackingOrder extends OrderResult {
  created_at: string;
  requested_date: string | null;
  customer_name: string;
  items: Array<{
    product_id?: UUID;
    name: string;
    sku: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    image_url?: string | null;
  }>;
  history: Array<{ status: string; created_at: string; note?: string | null }>;
}

export interface SelectOption {
  id: UUID;
  name: string;
  description?: string | null;
  fee?: number;
}

export interface PublicSettings {
  businessName: string;
  whatsappNumber: string | null;
  currency: 'COP';
  timezone: 'America/Bogota';
  minimumOrder: number;
  privacyPolicy: string;
  terms: string;
}

export interface StaffAccess {
  isStaff: boolean;
  roles: string[];
  permissions: string[];
}
