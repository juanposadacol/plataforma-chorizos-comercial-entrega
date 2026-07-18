export type AdminRecord = Record<string, unknown> & { id: string };

export type OrderStatus =
  | 'new'
  | 'pending_confirmation'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'dispatched'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export type PaymentStatus =
  'pending' | 'verifying' | 'partial' | 'paid' | 'credit' | 'rejected' | 'refunded';

export interface AdminOrder extends AdminRecord {
  order_number?: string;
  consecutive?: string | number;
  customer_id?: string | null;
  customer_name?: string;
  customer_name_snapshot?: string;
  customer_phone?: string;
  customer_phone_snapshot?: string;
  delivery_address?: string;
  address?: string;
  neighborhood?: string;
  municipality?: string;
  requested_date?: string | null;
  requested_delivery_date?: string | null;
  delivery_method?: string | null;
  payment_method?: string | null;
  status: OrderStatus | string;
  payment_status: PaymentStatus | string;
  subtotal?: number;
  discount?: number;
  discount_amount?: number;
  delivery_fee?: number;
  total: number;
  cost_of_sales?: number;
  cost_total?: number;
  gross_profit?: number;
  customer_notes?: string | null;
  internal_notes?: string | null;
  created_at: string;
  updated_at?: string;
  delivered_at?: string | null;
}

export interface AdminOrderItem extends AdminRecord {
  order_id: string;
  product_id?: string | null;
  sku?: string;
  product_name?: string;
  name?: string;
  quantity: number;
  unit_price: number;
  public_price?: number;
  discount?: number;
  subtotal: number;
  unit_cost?: number;
  total_cost?: number;
  gross_profit?: number;
  image_url?: string | null;
}

export interface Customer extends AdminRecord {
  name?: string;
  full_name?: string;
  document_type?: string | null;
  document_number?: string | null;
  phone: string;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  municipality?: string | null;
  price_list_id?: string | null;
  payment_terms?: string | null;
  credit_limit?: number;
  credit_days?: number;
  outstanding_balance?: number;
  classification?: string;
  active?: boolean;
  status?: string;
  last_purchase_at?: string | null;
  order_count?: number;
  total_purchased?: number;
  created_at?: string;
}

export interface AdminProduct extends AdminRecord {
  sku: string;
  barcode?: string | null;
  name: string;
  slug?: string;
  short_description?: string | null;
  category_id?: string | null;
  brand_id?: string | null;
  image_url?: string | null;
  public_price: number;
  current_cost?: number;
  average_cost?: number;
  unit?: string;
  presentation?: string;
  stock_current?: number;
  stock_on_hand?: number;
  stock_reserved?: number;
  stock_available?: number;
  minimum_stock?: number;
  active?: boolean;
  status?: string;
  is_featured?: boolean;
  featured?: boolean;
  allow_backorder?: boolean;
  created_at?: string;
}

export interface PriceList extends AdminRecord {
  name: string;
  code?: string;
  description?: string | null;
  is_public?: boolean;
  active?: boolean;
  is_active?: boolean;
  valid_from?: string | null;
  valid_until?: string | null;
  created_at?: string;
}

export interface ProductPrice extends AdminRecord {
  price_list_id: string;
  product_id: string;
  price: number;
  valid_from?: string | null;
  valid_until?: string | null;
  active?: boolean;
}

export interface CustomerProductPrice extends AdminRecord {
  customer_id: string;
  product_id: string;
  price: number;
  valid_from?: string | null;
  valid_until?: string | null;
  active?: boolean;
  notes?: string | null;
}

export interface InventoryMovement extends AdminRecord {
  product_id: string;
  movement_type: string;
  quantity: number;
  unit_cost?: number;
  previous_balance?: number;
  new_balance?: number;
  order_id?: string | null;
  purchase_id?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface Supplier extends AdminRecord {
  name: string;
  tax_id?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  payment_terms?: string | null;
  credit_days?: number;
  balance?: number;
  active?: boolean;
  created_at?: string;
}

export interface Purchase extends AdminRecord {
  purchase_number?: string;
  consecutive?: string;
  supplier_id?: string;
  supplier_name?: string;
  purchase_date?: string;
  invoice_number?: string | null;
  status: string;
  total: number;
  total_amount?: number;
  subtotal_amount?: number;
  amount_paid?: number;
  paid_amount?: number;
  balance?: number;
  balance_amount?: number;
  due_date?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface Payment extends AdminRecord {
  order_id?: string;
  customer_id?: string;
  payment_date?: string;
  paid_at?: string;
  amount: number;
  method?: string;
  payment_method_id?: string;
  payment_method_name?: string;
  reference?: string | null;
  status: string;
  notes?: string | null;
  created_at?: string;
}

export interface Expense extends AdminRecord {
  expense_date?: string;
  category_id?: string;
  category_name?: string;
  description: string;
  beneficiary?: string | null;
  amount: number;
  payment_method?: string;
  payment_method_id?: string;
  payment_method_name?: string;
  account?: string | null;
  order_id?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface AdminNotification extends AdminRecord {
  type?: string;
  event_type?: string;
  title: string;
  message?: string;
  body?: string;
  is_read?: boolean;
  status?: string;
  read_at?: string | null;
  order_id?: string | null;
  created_at: string;
}

export interface AdminProfile extends AdminRecord {
  full_name?: string;
  email?: string;
  phone?: string | null;
  active?: boolean;
  created_at?: string;
  roles?: string[];
}

export interface DashboardSnapshot {
  orders: AdminOrder[];
  orderItems: AdminOrderItem[];
  customers: Customer[];
  products: AdminProduct[];
  expenses: Expense[];
  payments: Payment[];
  notifications: AdminNotification[];
}

export interface DateRange {
  from: Date;
  to: Date;
  label: string;
}
