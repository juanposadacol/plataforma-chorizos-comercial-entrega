-- Core commercial schema for Plataforma Chorizos.
-- Money uses numeric(16,2), quantities numeric(16,3), and all business timestamps
-- are timestamptz. Application display timezone is configured as America/Bogota.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

set search_path = public, extensions, pg_temp;

create type public.customer_status as enum ('active', 'inactive', 'blocked', 'delinquent');
create type public.customer_classification as enum ('new', 'public', 'recurring', 'wholesale', 'distributor', 'vip', 'inactive', 'delinquent');
create type public.product_status as enum ('draft', 'active', 'inactive', 'discontinued');
create type public.order_status as enum ('new', 'pending_confirmation', 'confirmed', 'preparing', 'ready', 'dispatched', 'delivered', 'cancelled', 'returned');
create type public.order_payment_status as enum ('pending', 'under_review', 'partial', 'paid', 'credit', 'rejected', 'refunded');
create type public.order_channel as enum ('web', 'pwa', 'admin', 'phone', 'whatsapp', 'other');
create type public.payment_record_status as enum ('pending', 'under_review', 'approved', 'rejected', 'cancelled', 'refunded');
create type public.purchase_status as enum ('draft', 'ordered', 'partially_received', 'received', 'cancelled', 'returned');
create type public.inventory_movement_type as enum ('initial', 'purchase', 'reservation', 'reservation_release', 'sale', 'customer_return', 'positive_adjustment', 'negative_adjustment', 'damage', 'loss', 'supplier_return');
create type public.inventory_reservation_status as enum ('active', 'released', 'fulfilled', 'expired', 'cancelled');
create type public.receivable_status as enum ('pending', 'partial', 'paid', 'overdue', 'cancelled', 'written_off');
create type public.payable_status as enum ('pending', 'partial', 'paid', 'overdue', 'cancelled');
create type public.cash_movement_type as enum ('income', 'expense', 'transfer_in', 'transfer_out', 'adjustment');
create type public.notification_channel as enum ('in_app', 'whatsapp', 'email', 'sms', 'push');
create type public.notification_status as enum ('pending', 'processing', 'sent', 'retrying', 'manual_required', 'failed', 'cancelled');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prevent_hard_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%s records are immutable; use status/soft-delete fields', tg_table_name);
end;
$$;

create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
  select regexp_replace(p_phone, '[^0-9]', '', 'g');
$$;

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 140),
  phone text,
  email text,
  avatar_url text,
  locale text not null default 'es-CO',
  timezone text not null default 'America/Bogota',
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint profiles_phone_check check (phone is null or public.normalize_phone(phone) ~ '^[1-9][0-9]{9,14}$')
);

create table public.user_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (profile_id, role_id),
  constraint user_roles_expiry_check check (expires_at is null or expires_at > assigned_at)
);

create index user_roles_role_idx on public.user_roles(role_id, profile_id);

create or replace function public.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.profile_id
    where ur.profile_id = auth.uid()
      and r.code = p_role
      and r.is_active
      and r.deleted_at is null
      and p.is_active
      and p.deleted_at is null
      and (ur.expires_at is null or ur.expires_at > now())
  );
$$;

create or replace function public.has_any_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.profile_id
    where ur.profile_id = auth.uid()
      and r.code = any(p_roles)
      and r.is_active
      and r.deleted_at is null
      and p.is_active
      and p.deleted_at is null
      and (ur.expires_at is null or ur.expires_at > now())
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select public.has_any_role(array['superadmin', 'admin']::text[]);
$$;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  image_url text,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null
);

create unique index categories_slug_uq on public.categories(slug) where deleted_at is null;

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  logo_url text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null
);

create unique index brands_slug_uq on public.brands(slug) where deleted_at is null;

create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (char_length(name) between 2 and 100),
  description text,
  is_public boolean not null default false,
  is_active boolean not null default true,
  valid_from date not null default current_date,
  valid_until date,
  currency char(3) not null default 'COP' check (currency ~ '^[A-Z]{3}$'),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint price_lists_dates_check check (valid_until is null or valid_until >= valid_from)
);

create unique index price_lists_code_uq on public.price_lists(code) where deleted_at is null;
create unique index one_public_price_list_uq on public.price_lists((is_public)) where is_public and deleted_at is null;

create or replace function public.default_public_price_list_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select pl.id
  from public.price_lists pl
  where pl.is_public and pl.is_active and pl.deleted_at is null
    and pl.valid_from <= current_date
    and (pl.valid_until is null or pl.valid_until >= current_date)
  order by pl.created_at
  limit 1;
$$;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null check (char_length(sku) between 1 and 80),
  barcode text,
  name text not null check (char_length(name) between 2 and 160),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  short_description text,
  description text,
  category_id uuid references public.categories(id) on delete restrict,
  brand_id uuid references public.brands(id) on delete restrict,
  main_image_url text,
  public_price numeric(16,2) not null default 0 check (public_price >= 0),
  current_cost numeric(16,2) not null default 0 check (current_cost >= 0),
  average_cost numeric(16,2) not null default 0 check (average_cost >= 0),
  unit text not null default 'package' check (char_length(unit) between 1 and 40),
  presentation text,
  stock_on_hand numeric(16,3) not null default 0,
  stock_reserved numeric(16,3) not null default 0 check (stock_reserved >= 0),
  stock_available numeric(16,3) generated always as (stock_on_hand - stock_reserved) stored,
  minimum_stock numeric(16,3) not null default 0 check (minimum_stock >= 0),
  track_inventory boolean not null default true,
  allow_backorder boolean not null default false,
  status public.product_status not null default 'draft',
  is_featured boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint products_stock_check check (
    not track_inventory
    or allow_backorder
    or (stock_on_hand >= 0 and stock_reserved <= stock_on_hand)
  )
);

create unique index products_sku_uq on public.products(lower(sku)) where deleted_at is null;
create unique index products_slug_uq on public.products(slug) where deleted_at is null;
create unique index products_barcode_uq on public.products(barcode) where barcode is not null and deleted_at is null;
create index products_catalog_idx on public.products(status, is_featured, sort_order) where deleted_at is null;
create index products_category_idx on public.products(category_id, status) where deleted_at is null;
create index products_low_stock_idx on public.products(stock_available, minimum_stock) where track_inventory and status = 'active' and deleted_at is null;

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  sku text not null check (char_length(sku) between 1 and 80),
  name text not null check (char_length(name) between 1 and 120),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  public_price numeric(16,2) check (public_price is null or public_price >= 0),
  current_cost numeric(16,2) check (current_cost is null or current_cost >= 0),
  average_cost numeric(16,2) check (average_cost is null or average_cost >= 0),
  stock_on_hand numeric(16,3) not null default 0,
  stock_reserved numeric(16,3) not null default 0 check (stock_reserved >= 0),
  stock_available numeric(16,3) generated always as (stock_on_hand - stock_reserved) stored,
  minimum_stock numeric(16,3) not null default 0 check (minimum_stock >= 0),
  allow_backorder boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint product_variants_identity_uq unique (id, product_id),
  constraint product_variants_stock_check check (allow_backorder or (stock_on_hand >= 0 and stock_reserved <= stock_on_hand))
);

create unique index product_variants_sku_uq on public.product_variants(lower(sku)) where deleted_at is null;
create index product_variants_product_idx on public.product_variants(product_id, sort_order) where deleted_at is null;

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid,
  storage_path text not null,
  public_url text,
  alt_text text,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint product_images_variant_fk foreign key (variant_id, product_id)
    references public.product_variants(id, product_id) on delete restrict
);

create unique index product_images_path_uq on public.product_images(storage_path) where deleted_at is null;
create unique index one_primary_product_image_uq on public.product_images(product_id) where is_primary and variant_id is null and deleted_at is null;
create unique index one_primary_variant_image_uq on public.product_images(variant_id) where is_primary and variant_id is not null and deleted_at is null;

create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references public.price_lists(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid,
  unit_price numeric(16,2) not null check (unit_price >= 0),
  valid_from date not null default current_date,
  valid_until date,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint product_prices_dates_check check (valid_until is null or valid_until >= valid_from),
  constraint product_prices_variant_fk foreign key (variant_id, product_id)
    references public.product_variants(id, product_id) on delete restrict
);

create unique index product_prices_version_uq on public.product_prices(
  price_list_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), valid_from
) where deleted_at is null;
create index product_prices_lookup_idx on public.product_prices(price_list_id, product_id, variant_id, valid_from, valid_until)
  where is_active and deleted_at is null;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null check (char_length(full_name) between 2 and 140),
  document_type text,
  document_number text,
  phone text not null,
  whatsapp_phone text,
  email text,
  price_list_id uuid not null default public.default_public_price_list_id() references public.price_lists(id) on delete restrict,
  payment_terms text not null default 'cash' check (payment_terms in ('cash', 'credit', 'mixed', 'cash_on_delivery')),
  credit_limit numeric(16,2) not null default 0 check (credit_limit >= 0),
  credit_days integer not null default 0 check (credit_days between 0 and 3650),
  outstanding_balance numeric(16,2) not null default 0 check (outstanding_balance >= 0),
  status public.customer_status not null default 'active',
  classification public.customer_classification not null default 'new',
  pin_hash text,
  pin_changed_at timestamptz,
  pin_failed_attempts smallint not null default 0 check (pin_failed_attempts >= 0),
  pin_locked_until timestamptz,
  last_purchase_at timestamptz,
  order_count integer not null default 0 check (order_count >= 0),
  total_purchased numeric(16,2) not null default 0 check (total_purchased >= 0),
  total_paid numeric(16,2) not null default 0 check (total_paid >= 0),
  average_ticket numeric(16,2) not null default 0 check (average_ticket >= 0),
  favorite_product_id uuid references public.products(id) on delete set null,
  favorite_category_id uuid references public.categories(id) on delete set null,
  notes text,
  internal_notes text,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint customers_phone_check check (public.normalize_phone(phone) ~ '^[1-9][0-9]{9,14}$'),
  constraint customers_whatsapp_check check (whatsapp_phone is null or public.normalize_phone(whatsapp_phone) ~ '^[1-9][0-9]{9,14}$'),
  constraint customers_pin_hash_check check (pin_hash is null or char_length(pin_hash) >= 40),
  constraint customers_marketing_consent_check check (not marketing_consent or marketing_consent_at is not null)
);

create unique index customers_phone_uq on public.customers(public.normalize_phone(phone)) where deleted_at is null;
create unique index customers_document_uq on public.customers(document_type, document_number)
  where document_number is not null and deleted_at is null;
create index customers_name_idx on public.customers(lower(full_name)) where deleted_at is null;
create index customers_price_list_idx on public.customers(price_list_id, status) where deleted_at is null;
create index customers_last_purchase_idx on public.customers(last_purchase_at desc nulls last) where deleted_at is null;

create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select c.id
  from public.customers c
  where c.auth_user_id = auth.uid() and c.deleted_at is null
  limit 1;
$$;

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  label text not null default 'Principal' check (char_length(label) between 1 and 60),
  recipient_name text,
  recipient_phone text,
  address_line text not null check (char_length(address_line) between 4 and 300),
  neighborhood text,
  municipality text,
  department text,
  postal_code text,
  delivery_instructions text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint customer_addresses_lat_check check (latitude is null or latitude between -90 and 90),
  constraint customer_addresses_lng_check check (longitude is null or longitude between -180 and 180),
  constraint customer_addresses_recipient_phone_check check (
    recipient_phone is null or public.normalize_phone(recipient_phone) ~ '^[1-9][0-9]{9,14}$'
  )
);

create index customer_addresses_customer_idx on public.customer_addresses(customer_id, is_primary) where deleted_at is null;
create unique index one_primary_customer_address_uq on public.customer_addresses(customer_id) where is_primary and deleted_at is null;

create table public.customer_product_prices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid,
  unit_price numeric(16,2) not null check (unit_price >= 0),
  valid_from date not null default current_date,
  valid_until date,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint customer_product_prices_dates_check check (valid_until is null or valid_until >= valid_from),
  constraint customer_product_prices_variant_fk foreign key (variant_id, product_id)
    references public.product_variants(id, product_id) on delete restrict
);

create unique index customer_product_prices_version_uq on public.customer_product_prices(
  customer_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), valid_from
) where deleted_at is null;
create index customer_product_prices_lookup_idx on public.customer_product_prices(customer_id, product_id, variant_id, valid_from, valid_until)
  where is_active and deleted_at is null;

create table public.quantity_price_tiers (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references public.price_lists(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid,
  minimum_quantity numeric(16,3) not null check (minimum_quantity > 0),
  maximum_quantity numeric(16,3),
  unit_price numeric(16,2) not null check (unit_price >= 0),
  valid_from date not null default current_date,
  valid_until date,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint quantity_price_tiers_quantity_check check (maximum_quantity is null or maximum_quantity >= minimum_quantity),
  constraint quantity_price_tiers_dates_check check (valid_until is null or valid_until >= valid_from),
  constraint quantity_price_tiers_variant_fk foreign key (variant_id, product_id)
    references public.product_variants(id, product_id) on delete restrict
);

create index quantity_price_tiers_lookup_idx on public.quantity_price_tiers(price_list_id, product_id, variant_id, minimum_quantity)
  where is_active and deleted_at is null;

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text,
  requires_reference boolean not null default false,
  allows_credit boolean not null default false,
  instructions text,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index payment_methods_code_uq on public.payment_methods(code) where deleted_at is null;

create table public.delivery_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  name text not null check (char_length(name) between 2 and 80),
  description text,
  base_fee numeric(16,2) not null default 0 check (base_fee >= 0),
  free_from_amount numeric(16,2) check (free_from_amount is null or free_from_amount >= 0),
  estimated_minutes_min integer check (estimated_minutes_min is null or estimated_minutes_min >= 0),
  estimated_minutes_max integer check (estimated_minutes_max is null or estimated_minutes_max >= estimated_minutes_min),
  requires_address boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index delivery_methods_code_uq on public.delivery_methods(code) where deleted_at is null;

create sequence public.order_number_seq as bigint start with 1 increment by 1 no cycle;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('PED-' || lpad(nextval('public.order_number_seq')::text, 8, '0')),
  idempotency_key uuid not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  customer_name text not null check (char_length(customer_name) between 2 and 140),
  customer_phone text not null,
  customer_email text,
  customer_document text,
  customer_address_id uuid references public.customer_addresses(id) on delete set null,
  delivery_address text not null check (char_length(delivery_address) between 4 and 300),
  neighborhood text,
  municipality text,
  department text,
  delivery_instructions text,
  delivery_method_id uuid not null references public.delivery_methods(id) on delete restrict,
  delivery_method_name text not null,
  payment_method_id uuid not null references public.payment_methods(id) on delete restrict,
  payment_method_name text not null,
  requested_delivery_date date,
  channel public.order_channel not null default 'web',
  status public.order_status not null default 'new',
  payment_status public.order_payment_status not null default 'pending',
  currency char(3) not null default 'COP' check (currency ~ '^[A-Z]{3}$'),
  subtotal_amount numeric(16,2) not null default 0 check (subtotal_amount >= 0),
  discount_amount numeric(16,2) not null default 0 check (discount_amount >= 0),
  delivery_amount numeric(16,2) not null default 0 check (delivery_amount >= 0),
  tax_amount numeric(16,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(16,2) not null default 0 check (total_amount >= 0),
  amount_paid numeric(16,2) not null default 0 check (amount_paid >= 0),
  sales_cost numeric(16,2) not null default 0 check (sales_cost >= 0),
  gross_profit numeric(16,2) not null default 0,
  customer_notes text,
  internal_notes text,
  cancellation_reason text,
  source_order_id uuid references public.orders(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  dispatched_by uuid references public.profiles(id) on delete set null,
  delivered_by uuid references public.profiles(id) on delete set null,
  cancelled_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  preparation_started_at timestamptz,
  ready_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  version integer not null default 1 check (version > 0),
  constraint orders_customer_phone_check check (public.normalize_phone(customer_phone) ~ '^[1-9][0-9]{9,14}$'),
  constraint orders_amounts_check check (total_amount = subtotal_amount - discount_amount + delivery_amount + tax_amount),
  constraint orders_discount_check check (discount_amount <= subtotal_amount),
  constraint orders_paid_check check (amount_paid <= total_amount),
  constraint orders_requested_date_check check (requested_delivery_date is null or requested_delivery_date >= created_at::date)
);

create index orders_customer_idx on public.orders(customer_id, created_at desc) where deleted_at is null;
create index orders_status_idx on public.orders(status, created_at desc) where deleted_at is null;
create index orders_payment_status_idx on public.orders(payment_status, created_at desc) where deleted_at is null;
create index orders_requested_delivery_idx on public.orders(requested_delivery_date, status) where deleted_at is null;
create index orders_created_idx on public.orders(created_at desc) where deleted_at is null;

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid,
  sku text not null,
  product_name text not null,
  variant_name text,
  image_url text,
  unit text not null,
  quantity numeric(16,3) not null check (quantity > 0),
  unit_price numeric(16,2) not null check (unit_price >= 0),
  public_unit_price numeric(16,2) not null check (public_unit_price >= 0),
  subtotal_amount numeric(16,2) not null check (subtotal_amount >= 0),
  discount_amount numeric(16,2) not null default 0 check (discount_amount >= 0),
  total_amount numeric(16,2) not null check (total_amount >= 0),
  unit_cost numeric(16,2) not null default 0 check (unit_cost >= 0),
  total_cost numeric(16,2) not null default 0 check (total_cost >= 0),
  gross_profit numeric(16,2) not null default 0,
  price_source text not null check (price_source in ('customer_special', 'quantity_tier', 'price_list', 'public')),
  price_list_id uuid references public.price_lists(id) on delete restrict,
  price_list_name text,
  product_price_id uuid references public.product_prices(id) on delete restrict,
  customer_product_price_id uuid references public.customer_product_prices(id) on delete restrict,
  quantity_price_tier_id uuid references public.quantity_price_tiers(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint order_items_variant_fk foreign key (variant_id, product_id)
    references public.product_variants(id, product_id) on delete restrict,
  constraint order_items_subtotal_check check (subtotal_amount = round(quantity * unit_price, 2)),
  constraint order_items_total_check check (total_amount = subtotal_amount - discount_amount),
  constraint order_items_discount_check check (discount_amount <= subtotal_amount),
  constraint order_items_cost_check check (total_cost = round(quantity * unit_cost, 2)),
  constraint order_items_profit_check check (gross_profit = total_amount - total_cost)
);

create unique index order_items_product_uq on public.order_items(
  order_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where deleted_at is null;
create index order_items_product_idx on public.order_items(product_id, created_at desc) where deleted_at is null;

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  previous_status public.order_status,
  new_status public.order_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text,
  notes text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint order_status_history_transition_check check (previous_status is null or previous_status <> new_status)
);

create index order_status_history_order_idx on public.order_status_history(order_id, created_at desc);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  document_type text,
  document_number text,
  contact_name text,
  phone text,
  email text,
  address text,
  municipality text,
  payment_terms text not null default 'cash' check (payment_terms in ('cash', 'credit', 'mixed')),
  credit_days integer not null default 0 check (credit_days between 0 and 3650),
  outstanding_balance numeric(16,2) not null default 0 check (outstanding_balance >= 0),
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint suppliers_phone_check check (phone is null or public.normalize_phone(phone) ~ '^[1-9][0-9]{9,14}$')
);

create unique index suppliers_document_uq on public.suppliers(document_type, document_number)
  where document_number is not null and deleted_at is null;
create index suppliers_name_idx on public.suppliers(lower(name)) where deleted_at is null;

create sequence public.purchase_number_seq as bigint start with 1 increment by 1 no cycle;

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_number text not null unique default ('COM-' || lpad(nextval('public.purchase_number_seq')::text, 8, '0')),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  purchase_date date not null default current_date,
  invoice_number text,
  status public.purchase_status not null default 'draft',
  currency char(3) not null default 'COP' check (currency ~ '^[A-Z]{3}$'),
  subtotal_amount numeric(16,2) not null default 0 check (subtotal_amount >= 0),
  discount_amount numeric(16,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(16,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(16,2) not null default 0 check (total_amount >= 0),
  paid_amount numeric(16,2) not null default 0 check (paid_amount >= 0),
  balance_amount numeric(16,2) not null default 0 check (balance_amount >= 0),
  due_date date,
  receipt_url text,
  notes text,
  received_at timestamptz,
  received_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint purchases_amounts_check check (total_amount = subtotal_amount - discount_amount + tax_amount),
  constraint purchases_discount_check check (discount_amount <= subtotal_amount),
  constraint purchases_paid_check check (paid_amount <= total_amount),
  constraint purchases_balance_check check (balance_amount = total_amount - paid_amount),
  constraint purchases_due_date_check check (due_date is null or due_date >= purchase_date),
  constraint purchases_received_at_check check (status not in ('received', 'partially_received') or received_at is not null)
);

create unique index purchases_supplier_invoice_uq on public.purchases(supplier_id, invoice_number)
  where invoice_number is not null and deleted_at is null;
create index purchases_supplier_idx on public.purchases(supplier_id, purchase_date desc) where deleted_at is null;
create index purchases_status_idx on public.purchases(status, purchase_date desc) where deleted_at is null;
create index purchases_due_idx on public.purchases(due_date, status) where balance_amount > 0 and deleted_at is null;

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid,
  sku text not null,
  product_name text not null,
  quantity numeric(16,3) not null check (quantity > 0),
  received_quantity numeric(16,3) not null default 0 check (received_quantity >= 0),
  unit_cost numeric(16,2) not null check (unit_cost >= 0),
  subtotal_amount numeric(16,2) not null check (subtotal_amount >= 0),
  discount_amount numeric(16,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(16,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(16,2) not null check (total_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint purchase_items_variant_fk foreign key (variant_id, product_id)
    references public.product_variants(id, product_id) on delete restrict,
  constraint purchase_items_received_check check (received_quantity <= quantity),
  constraint purchase_items_subtotal_check check (subtotal_amount = round(quantity * unit_cost, 2)),
  constraint purchase_items_total_check check (total_amount = subtotal_amount - discount_amount + tax_amount),
  constraint purchase_items_discount_check check (discount_amount <= subtotal_amount)
);

create unique index purchase_items_product_uq on public.purchase_items(
  purchase_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where deleted_at is null;
create index purchase_items_product_idx on public.purchase_items(product_id, created_at desc) where deleted_at is null;

create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid,
  quantity numeric(16,3) not null check (quantity > 0),
  status public.inventory_reservation_status not null default 'active',
  expires_at timestamptz,
  released_at timestamptz,
  fulfilled_at timestamptz,
  release_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint inventory_reservations_variant_fk foreign key (variant_id, product_id)
    references public.product_variants(id, product_id) on delete restrict,
  constraint inventory_reservations_terminal_dates_check check (
    (status <> 'released' or released_at is not null)
    and (status <> 'fulfilled' or fulfilled_at is not null)
  )
);

create unique index active_inventory_reservation_uq on public.inventory_reservations(order_item_id)
  where status = 'active' and deleted_at is null;
create index inventory_reservations_product_idx on public.inventory_reservations(product_id, variant_id, status)
  where deleted_at is null;
create index inventory_reservations_expiry_idx on public.inventory_reservations(expires_at)
  where status = 'active' and expires_at is not null and deleted_at is null;

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid,
  movement_type public.inventory_movement_type not null,
  quantity numeric(16,3) not null check (quantity > 0),
  unit_cost numeric(16,2) check (unit_cost is null or unit_cost >= 0),
  stock_on_hand_before numeric(16,3) not null,
  stock_on_hand_after numeric(16,3) not null,
  stock_reserved_before numeric(16,3) not null check (stock_reserved_before >= 0),
  stock_reserved_after numeric(16,3) not null check (stock_reserved_after >= 0),
  order_id uuid references public.orders(id) on delete restrict,
  order_item_id uuid references public.order_items(id) on delete restrict,
  purchase_id uuid references public.purchases(id) on delete restrict,
  purchase_item_id uuid references public.purchase_items(id) on delete restrict,
  reservation_id uuid references public.inventory_reservations(id) on delete restrict,
  performed_by uuid references public.profiles(id) on delete set null,
  notes text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint inventory_movements_variant_fk foreign key (variant_id, product_id)
    references public.product_variants(id, product_id) on delete restrict,
  constraint inventory_movements_reference_check check (
    order_id is not null or purchase_id is not null or movement_type in ('initial', 'positive_adjustment', 'negative_adjustment', 'damage', 'loss')
  )
);

create index inventory_movements_product_idx on public.inventory_movements(product_id, variant_id, occurred_at desc);
create index inventory_movements_order_idx on public.inventory_movements(order_id, occurred_at desc) where order_id is not null;
create index inventory_movements_purchase_idx on public.inventory_movements(purchase_id, occurred_at desc) where purchase_id is not null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  paid_at timestamptz not null default now(),
  amount numeric(16,2) not null check (amount > 0),
  currency char(3) not null default 'COP' check (currency ~ '^[A-Z]{3}$'),
  payment_method_id uuid not null references public.payment_methods(id) on delete restrict,
  payment_method_name text not null,
  reference text,
  receipt_url text,
  status public.payment_record_status not null default 'pending',
  notes text,
  recorded_by uuid references public.profiles(id) on delete set null,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint payments_verification_check check (status <> 'approved' or (verified_by is not null and verified_at is not null))
);

create index payments_order_idx on public.payments(order_id, paid_at desc) where deleted_at is null;
create index payments_customer_idx on public.payments(customer_id, paid_at desc) where deleted_at is null;
create index payments_status_idx on public.payments(status, paid_at desc) where deleted_at is null;
create unique index payments_reference_uq on public.payments(payment_method_id, reference)
  where reference is not null and status <> 'cancelled' and deleted_at is null;

create table public.accounts_receivable (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  original_amount numeric(16,2) not null check (original_amount > 0),
  paid_amount numeric(16,2) not null default 0 check (paid_amount >= 0),
  balance_amount numeric(16,2) not null check (balance_amount >= 0),
  due_date date not null,
  status public.receivable_status not null default 'pending',
  written_off_amount numeric(16,2) not null default 0 check (written_off_amount >= 0),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint accounts_receivable_amounts_check check (
    balance_amount = original_amount - paid_amount - written_off_amount
    and paid_amount + written_off_amount <= original_amount
  )
);

create index accounts_receivable_customer_idx on public.accounts_receivable(customer_id, status, due_date) where deleted_at is null;
create index accounts_receivable_due_idx on public.accounts_receivable(due_date, status)
  where status in ('pending', 'partial', 'overdue') and deleted_at is null;

create table public.accounts_payable (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  purchase_id uuid not null unique references public.purchases(id) on delete restrict,
  original_amount numeric(16,2) not null check (original_amount > 0),
  paid_amount numeric(16,2) not null default 0 check (paid_amount >= 0),
  balance_amount numeric(16,2) not null check (balance_amount >= 0),
  due_date date not null,
  status public.payable_status not null default 'pending',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint accounts_payable_amounts_check check (balance_amount = original_amount - paid_amount and paid_amount <= original_amount)
);

create index accounts_payable_supplier_idx on public.accounts_payable(supplier_id, status, due_date) where deleted_at is null;
create index accounts_payable_due_idx on public.accounts_payable(due_date, status)
  where status in ('pending', 'partial', 'overdue') and deleted_at is null;

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (char_length(name) between 2 and 100),
  description text,
  parent_id uuid references public.expense_categories(id) on delete restrict,
  is_operating_expense boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint expense_categories_not_self_check check (parent_id is null or parent_id <> id)
);

create unique index expense_categories_code_uq on public.expense_categories(code) where deleted_at is null;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  description text not null check (char_length(description) between 2 and 500),
  beneficiary text,
  amount numeric(16,2) not null check (amount > 0),
  currency char(3) not null default 'COP' check (currency ~ '^[A-Z]{3}$'),
  payment_method_id uuid references public.payment_methods(id) on delete restrict,
  payment_method_name text,
  order_id uuid references public.orders(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  receipt_url text,
  status text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint expenses_approval_check check (status <> 'posted' or approved_at is not null)
);

create index expenses_date_idx on public.expenses(expense_date desc, status) where deleted_at is null;
create index expenses_category_idx on public.expenses(category_id, expense_date desc) where deleted_at is null;
create index expenses_order_idx on public.expenses(order_id) where order_id is not null and deleted_at is null;

create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (char_length(name) between 2 and 100),
  account_type text not null check (account_type in ('cash', 'bank', 'digital_wallet', 'clearing', 'other')),
  currency char(3) not null default 'COP' check (currency ~ '^[A-Z]{3}$'),
  opening_balance numeric(16,2) not null default 0,
  current_balance numeric(16,2) not null default 0,
  bank_name text,
  masked_account_number text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null
);

create unique index cash_accounts_code_uq on public.cash_accounts(code) where deleted_at is null;

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_account_id uuid not null references public.cash_accounts(id) on delete restrict,
  movement_type public.cash_movement_type not null,
  amount numeric(16,2) not null check (amount > 0),
  balance_before numeric(16,2) not null,
  balance_after numeric(16,2) not null,
  occurred_at timestamptz not null default now(),
  description text not null,
  reference text,
  order_id uuid references public.orders(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  purchase_id uuid references public.purchases(id) on delete restrict,
  expense_id uuid references public.expenses(id) on delete restrict,
  transfer_pair_id uuid references public.cash_movements(id) on delete restrict,
  performed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint cash_movements_reference_check check (
    payment_id is not null or purchase_id is not null or expense_id is not null
    or movement_type in ('transfer_in', 'transfer_out', 'adjustment')
  )
);

create index cash_movements_account_idx on public.cash_movements(cash_account_id, occurred_at desc) where deleted_at is null;
create index cash_movements_order_idx on public.cash_movements(order_id, occurred_at desc) where order_id is not null and deleted_at is null;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  title text not null check (char_length(title) between 1 and 180),
  body text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  order_id uuid references public.orders(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  recipient_profile_id uuid references public.profiles(id) on delete restrict,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  deleted_at timestamptz,
  constraint notifications_read_check check (not is_read or read_at is not null)
);

create index notifications_profile_idx on public.notifications(recipient_profile_id, is_read, created_at desc) where deleted_at is null;
create index notifications_order_idx on public.notifications(order_id, created_at desc) where order_id is not null and deleted_at is null;
create index notifications_event_idx on public.notifications(event_type, created_at desc) where deleted_at is null;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete restrict,
  channel public.notification_channel not null,
  status public.notification_status not null default 'pending',
  recipient text not null,
  provider text,
  template_name text,
  template_language text,
  template_parameters jsonb,
  message_text text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 100),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  external_id text,
  provider_response jsonb,
  last_error text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint notification_deliveries_template_parameters_check check (
    template_parameters is null or jsonb_typeof(template_parameters) = 'array'
  ),
  constraint notification_deliveries_attempts_check check (attempt_count <= max_attempts),
  constraint notification_deliveries_sent_check check (status <> 'sent' or sent_at is not null)
);

create index notification_deliveries_outbox_idx on public.notification_deliveries(channel, status, next_attempt_at, created_at)
  where status in ('pending', 'retrying') and deleted_at is null;
create index notification_deliveries_lock_idx on public.notification_deliveries(locked_at)
  where status = 'processing' and deleted_at is null;
create unique index notification_deliveries_external_uq on public.notification_deliveries(provider, external_id)
  where external_id is not null and deleted_at is null;

create table public.whatsapp_settings (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Principal',
  provider text not null default 'meta_cloud' check (provider in ('meta_cloud', 'authorized_provider', 'manual')),
  business_phone text,
  administrator_phone text,
  phone_number_id text,
  business_account_id text,
  access_token_secret_name text,
  api_version text not null default 'v23.0',
  administrator_template_name text,
  customer_template_name text,
  template_language text not null default 'es_CO',
  fallback_manual_enabled boolean not null default true,
  automatic_enabled boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  constraint whatsapp_settings_business_phone_check check (
    business_phone is null or public.normalize_phone(business_phone) ~ '^[1-9][0-9]{9,14}$'
  ),
  constraint whatsapp_settings_admin_phone_check check (
    administrator_phone is null or public.normalize_phone(administrator_phone) ~ '^[1-9][0-9]{9,14}$'
  ),
  constraint whatsapp_settings_automatic_check check (
    not automatic_enabled
    or (provider <> 'manual' and phone_number_id is not null and access_token_secret_name is not null)
  )
);

create unique index one_active_whatsapp_settings_uq on public.whatsapp_settings((is_active))
  where is_active and deleted_at is null;

create table public.app_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  value jsonb not null,
  description text,
  is_public boolean not null default false,
  is_secret_reference boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_settings_secret_public_check check (not (is_public and is_secret_reference))
);

create unique index app_settings_key_uq on public.app_settings(key) where deleted_at is null;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action ~ '^[A-Z][A-Z0-9_]{1,49}$'),
  entity_name text not null check (entity_name ~ '^[a-z][a-z0-9_]{1,79}$'),
  record_id uuid,
  old_values jsonb,
  new_values jsonb,
  reason text,
  request_id text,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs(entity_name, record_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_user_id, created_at desc) where actor_user_id is not null;
create index audit_logs_created_idx on public.audit_logs(created_at desc);

create table public.request_rate_limits (
  bucket text not null,
  subject_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (bucket, subject_hash, window_started_at)
);

create index request_rate_limits_cleanup_idx on public.request_rate_limits(window_started_at);

-- Composite identity constraints prevent cross-customer/order/purchase references.
alter table public.customer_addresses
  add constraint customer_addresses_identity_customer_uq unique (id, customer_id);
alter table public.orders
  add constraint orders_identity_customer_uq unique (id, customer_id);
alter table public.order_items
  add constraint order_items_identity_order_uq unique (id, order_id);
alter table public.purchase_items
  add constraint purchase_items_identity_purchase_uq unique (id, purchase_id);

alter table public.orders
  add constraint orders_address_customer_fk
  foreign key (customer_address_id, customer_id)
  references public.customer_addresses(id, customer_id) on delete restrict;
alter table public.payments
  add constraint payments_order_customer_fk
  foreign key (order_id, customer_id)
  references public.orders(id, customer_id) on delete restrict;
alter table public.accounts_receivable
  add constraint accounts_receivable_order_customer_fk
  foreign key (order_id, customer_id)
  references public.orders(id, customer_id) on delete restrict;
alter table public.inventory_reservations
  add constraint inventory_reservations_item_order_fk
  foreign key (order_item_id, order_id)
  references public.order_items(id, order_id) on delete restrict;
alter table public.inventory_movements
  add constraint inventory_movements_item_order_fk
  foreign key (order_item_id, order_id)
  references public.order_items(id, order_id) on delete restrict;
alter table public.inventory_movements
  add constraint inventory_movements_purchase_item_fk
  foreign key (purchase_item_id, purchase_id)
  references public.purchase_items(id, purchase_id) on delete restrict;

-- Prevent overlapping active prices and quantity tiers for the same scope.
alter table public.product_prices
  add constraint product_prices_no_overlap
  exclude using gist (
    price_list_id with =,
    product_id with =,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(valid_from, valid_until, '[]') with &&
  ) where (is_active and deleted_at is null);

alter table public.customer_product_prices
  add constraint customer_product_prices_no_overlap
  exclude using gist (
    customer_id with =,
    product_id with =,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(valid_from, valid_until, '[]') with &&
  ) where (is_active and deleted_at is null);

alter table public.quantity_price_tiers
  add constraint quantity_price_tiers_no_overlap
  exclude using gist (
    price_list_id with =,
    product_id with =,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(valid_from, valid_until, '[]') with &&,
    numrange(minimum_quantity, maximum_quantity, '[]') with &&
  ) where (is_active and deleted_at is null);

create or replace function public.set_order_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_record_id uuid;
  v_reason text;
begin
  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new);
  end if;

  -- PIN hashes are authentication material and must never be copied to audit payloads.
  if tg_table_name = 'customers' then
    v_old := v_old - 'pin_hash';
    v_new := v_new - 'pin_hash';
  end if;

  v_record_id := coalesce(
    nullif(v_new ->> 'id', '')::uuid,
    nullif(v_old ->> 'id', '')::uuid
  );
  v_reason := nullif(current_setting('app.audit_reason', true), '');

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_name,
    record_id,
    old_values,
    new_values,
    reason,
    metadata
  ) values (
    auth.uid(),
    tg_op,
    tg_table_name,
    v_record_id,
    v_old,
    v_new,
    v_reason,
    jsonb_build_object('schema', tg_table_schema, 'trigger', tg_name)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.guard_managed_balances()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_changed boolean := false;
begin
  if tg_table_name in ('products', 'product_variants') then
    if tg_op = 'INSERT' then
      v_changed := new.stock_on_hand <> 0 or new.stock_reserved <> 0;
    else
      v_changed := new.stock_on_hand is distinct from old.stock_on_hand
        or new.stock_reserved is distinct from old.stock_reserved;
    end if;
  elsif tg_table_name = 'cash_accounts' then
    if tg_op = 'INSERT' then
      v_changed := new.current_balance <> new.opening_balance;
    else
      v_changed := new.current_balance is distinct from old.current_balance;
    end if;
  end if;

  if v_changed and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception using
      errcode = '42501',
      message = format('%s balances may only be changed by trusted transactional functions', tg_table_name);
  end if;
  return new;
end;
$$;

create or replace function public.prevent_immutable_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%s is append-only', tg_table_name);
end;
$$;

-- Maintain updated_at consistently. Order version is also incremented for optimistic locking.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'roles', 'profiles', 'categories', 'brands', 'price_lists', 'products',
    'product_variants', 'product_images', 'product_prices', 'customers',
    'customer_addresses', 'customer_product_prices', 'quantity_price_tiers',
    'payment_methods', 'delivery_methods', 'order_items', 'suppliers',
    'purchases', 'purchase_items', 'inventory_reservations', 'payments',
    'accounts_receivable', 'accounts_payable', 'expense_categories', 'expenses',
    'cash_accounts', 'notification_deliveries', 'whatsapp_settings', 'app_settings',
    'request_rate_limits'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      v_table || '_set_updated_at', v_table
    );
  end loop;
end;
$$;

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_order_updated_at();

create trigger products_guard_managed_stock
before insert or update on public.products
for each row execute function public.guard_managed_balances();

create trigger product_variants_guard_managed_stock
before insert or update on public.product_variants
for each row execute function public.guard_managed_balances();

create trigger cash_accounts_guard_managed_balance
before insert or update on public.cash_accounts
for each row execute function public.guard_managed_balances();

-- Business records are retired/voided, never physically removed.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'categories', 'brands', 'price_lists', 'products', 'product_variants',
    'product_images', 'product_prices', 'customers', 'customer_addresses',
    'customer_product_prices', 'quantity_price_tiers', 'payment_methods',
    'delivery_methods', 'orders', 'order_items', 'suppliers', 'purchases',
    'purchase_items', 'inventory_reservations', 'payments', 'accounts_receivable',
    'accounts_payable', 'expense_categories', 'expenses', 'cash_accounts',
    'cash_movements', 'notifications', 'notification_deliveries',
    'whatsapp_settings', 'app_settings'
  ]
  loop
    execute format(
      'create trigger %I before delete on public.%I for each row execute function public.prevent_hard_delete()',
      v_table || '_prevent_hard_delete', v_table
    );
  end loop;
end;
$$;

create trigger order_status_history_immutable
before update or delete on public.order_status_history
for each row execute function public.prevent_immutable_mutation();

create trigger inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function public.prevent_immutable_mutation();

create trigger cash_movements_immutable
before update or delete on public.cash_movements
for each row execute function public.prevent_immutable_mutation();

create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function public.prevent_immutable_mutation();

-- Audit the entities whose changes affect authorization, prices, orders, stock or money.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'user_roles', 'price_lists', 'product_prices', 'customer_product_prices',
    'quantity_price_tiers', 'products', 'customers', 'orders', 'order_items',
    'order_status_history', 'payments', 'purchases', 'purchase_items',
    'inventory_reservations', 'inventory_movements', 'expenses',
    'accounts_receivable', 'accounts_payable', 'cash_movements',
    'whatsapp_settings', 'app_settings'
  ]
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_log()',
      v_table || '_audit', v_table
    );
  end loop;
end;
$$;

-- Public/customer projections intentionally omit costs, margins, PIN hashes and internal notes.
create view public.store_products
with (security_barrier = true)
as
select
  p.id,
  p.sku,
  p.name,
  p.slug,
  p.short_description,
  p.description,
  p.category_id,
  c.name as category_name,
  c.slug as category_slug,
  p.brand_id,
  b.name as brand_name,
  p.main_image_url,
  p.public_price,
  p.unit,
  p.presentation,
  p.is_featured,
  p.sort_order,
  p.track_inventory,
  p.allow_backorder,
  case when not p.track_inventory or p.allow_backorder then true else p.stock_available > 0 end as is_available,
  case when p.track_inventory then greatest(p.stock_available, 0) else null end as available_quantity
from public.products p
left join public.categories c on c.id = p.category_id and c.deleted_at is null
left join public.brands b on b.id = p.brand_id and b.deleted_at is null
where p.status = 'active' and p.deleted_at is null;

create view public.public_app_settings
with (security_barrier = true)
as
select s.key, s.value, s.description, s.updated_at
from public.app_settings s
where s.is_public and not s.is_secret_reference and s.deleted_at is null;

create view public.customer_self
with (security_barrier = true)
as
select
  c.id,
  c.full_name,
  c.document_type,
  c.document_number,
  c.phone,
  c.whatsapp_phone,
  c.email,
  c.payment_terms,
  c.credit_limit,
  c.credit_days,
  c.outstanding_balance,
  c.status,
  c.classification,
  c.last_purchase_at,
  c.order_count,
  c.total_purchased,
  c.total_paid,
  c.average_ticket,
  c.created_at,
  c.updated_at
from public.customers c
where c.auth_user_id = auth.uid() and c.deleted_at is null;

create view public.customer_orders
with (security_barrier = true)
as
select
  o.id,
  o.order_number,
  o.customer_id,
  o.customer_name,
  o.customer_phone,
  o.delivery_address,
  o.neighborhood,
  o.municipality,
  o.delivery_method_name,
  o.payment_method_name,
  o.requested_delivery_date,
  o.channel,
  o.status,
  o.payment_status,
  o.currency,
  o.subtotal_amount,
  o.discount_amount,
  o.delivery_amount,
  o.tax_amount,
  o.total_amount,
  o.amount_paid,
  o.customer_notes,
  o.confirmed_at,
  o.dispatched_at,
  o.delivered_at,
  o.cancelled_at,
  o.created_at,
  o.updated_at
from public.orders o
join public.customers c on c.id = o.customer_id
where c.auth_user_id = auth.uid() and o.deleted_at is null and c.deleted_at is null;

create view public.customer_order_items
with (security_barrier = true)
as
select
  oi.id,
  oi.order_id,
  oi.product_id,
  oi.variant_id,
  oi.sku,
  oi.product_name,
  oi.variant_name,
  oi.image_url,
  oi.unit,
  oi.quantity,
  oi.unit_price,
  oi.public_unit_price,
  oi.subtotal_amount,
  oi.discount_amount,
  oi.total_amount,
  oi.price_source,
  oi.created_at
from public.order_items oi
join public.orders o on o.id = oi.order_id
join public.customers c on c.id = o.customer_id
where c.auth_user_id = auth.uid()
  and oi.deleted_at is null
  and o.deleted_at is null
  and c.deleted_at is null;

create view public.store_product_variants
with (security_barrier = true)
as
select
  v.id,
  v.product_id,
  v.sku,
  v.name,
  v.attributes,
  coalesce(v.public_price, p.public_price) as public_price,
  v.sort_order,
  case when not p.track_inventory or v.allow_backorder then true else v.stock_available > 0 end as is_available,
  case when p.track_inventory then greatest(v.stock_available, 0) else null end as available_quantity
from public.product_variants v
join public.products p on p.id = v.product_id
where v.is_active and v.deleted_at is null and p.status = 'active' and p.deleted_at is null;

create view public.store_product_images
with (security_barrier = true)
as
select i.id, i.product_id, i.variant_id, i.public_url, i.alt_text, i.sort_order, i.is_primary
from public.product_images i
join public.products p on p.id = i.product_id
where i.deleted_at is null and p.status = 'active' and p.deleted_at is null;

create view public.customer_payments
with (security_barrier = true)
as
select
  p.id,
  p.order_id,
  p.paid_at,
  p.amount,
  p.currency,
  p.payment_method_name,
  p.reference,
  p.status,
  p.created_at,
  p.updated_at
from public.payments p
join public.customers c on c.id = p.customer_id
where c.auth_user_id = auth.uid() and c.deleted_at is null and p.deleted_at is null;

create view public.customer_receivables
with (security_barrier = true)
as
select
  ar.id,
  ar.order_id,
  ar.original_amount,
  ar.paid_amount,
  ar.balance_amount,
  ar.due_date,
  ar.status,
  ar.created_at,
  ar.updated_at,
  ar.closed_at
from public.accounts_receivable ar
join public.customers c on c.id = ar.customer_id
where c.auth_user_id = auth.uid() and c.deleted_at is null and ar.deleted_at is null;

create index orders_delivered_reporting_idx on public.orders(delivered_at, customer_id)
  where status = 'delivered' and deleted_at is null;
create index orders_cancelled_reporting_idx on public.orders(cancelled_at)
  where status = 'cancelled' and deleted_at is null;
create index orders_returned_reporting_idx on public.orders(returned_at)
  where status = 'returned' and deleted_at is null;
create index order_items_reporting_idx on public.order_items(product_id, order_id, quantity, total_amount)
  where deleted_at is null;
create index purchases_received_reporting_idx on public.purchases(received_at, supplier_id)
  where status = 'received' and deleted_at is null;
create index payments_approved_reporting_idx on public.payments(paid_at, customer_id, amount)
  where status = 'approved' and deleted_at is null;

-- Row Level Security is enabled on every base table. Service-role operations bypass
-- RLS; browser sessions receive only the policies below.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'roles', 'profiles', 'user_roles', 'categories', 'brands', 'price_lists',
    'products', 'product_variants', 'product_images', 'product_prices', 'customers',
    'customer_addresses', 'customer_product_prices', 'quantity_price_tiers',
    'payment_methods', 'delivery_methods', 'orders', 'order_items',
    'order_status_history', 'suppliers', 'purchases', 'purchase_items',
    'inventory_reservations', 'inventory_movements', 'payments',
    'accounts_receivable', 'accounts_payable', 'expense_categories', 'expenses',
    'cash_accounts', 'cash_movements', 'notifications', 'notification_deliveries',
    'whatsapp_settings', 'app_settings', 'audit_logs', 'request_rate_limits'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
  end loop;
end;
$$;

-- Superadministrators and administrators manage all mutable business tables.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'roles', 'profiles', 'user_roles', 'categories', 'brands', 'price_lists',
    'products', 'product_variants', 'product_images', 'product_prices', 'customers',
    'customer_addresses', 'customer_product_prices', 'quantity_price_tiers',
    'payment_methods', 'delivery_methods', 'orders', 'order_items',
    'order_status_history', 'suppliers', 'purchases', 'purchase_items',
    'inventory_reservations', 'inventory_movements', 'payments',
    'accounts_receivable', 'accounts_payable', 'expense_categories', 'expenses',
    'cash_accounts', 'cash_movements', 'notifications', 'notification_deliveries',
    'whatsapp_settings', 'app_settings'
  ]
  loop
    execute format(
      'create policy administrators_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      v_table
    );
  end loop;
end;
$$;

create policy profile_owner_read
on public.profiles for select to authenticated
using (id = auth.uid() and deleted_at is null);

create policy user_roles_owner_read
on public.user_roles for select to authenticated
using (profile_id = auth.uid());

create policy active_categories_public_read
on public.categories for select to anon, authenticated
using (is_active and deleted_at is null);

create policy active_brands_public_read
on public.brands for select to anon, authenticated
using (is_active and deleted_at is null);

create policy active_payment_methods_public_read
on public.payment_methods for select to anon, authenticated
using (is_active and deleted_at is null);

create policy active_delivery_methods_public_read
on public.delivery_methods for select to anon, authenticated
using (is_active and deleted_at is null);

create policy customer_addresses_owner_read
on public.customer_addresses for select to authenticated
using (customer_id = public.current_customer_id() and deleted_at is null);

create policy customer_addresses_owner_insert
on public.customer_addresses for insert to authenticated
with check (customer_id = public.current_customer_id() and deleted_at is null);

create policy customer_addresses_owner_update
on public.customer_addresses for update to authenticated
using (customer_id = public.current_customer_id() and deleted_at is null)
with check (customer_id = public.current_customer_id());

create policy notifications_owner_read
on public.notifications for select to authenticated
using (
  deleted_at is null
  and (
    recipient_profile_id = auth.uid()
    or customer_id = public.current_customer_id()
  )
);

-- Operational staff can read fulfillment data. Mutations that affect prices,
-- totals or stock are performed by trusted database functions/service-role code.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'categories', 'brands', 'products', 'product_variants', 'product_images',
    'customers', 'customer_addresses', 'payment_methods', 'delivery_methods',
    'orders', 'order_items', 'order_status_history', 'notifications'
  ]
  loop
    execute format(
      'create policy operational_staff_read on public.%I for select to authenticated using (public.has_any_role(array[''vendedor'', ''bodega'', ''contabilidad'']::text[]))',
      v_table
    );
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'price_lists', 'product_prices', 'customer_product_prices', 'quantity_price_tiers'
  ]
  loop
    execute format(
      'create policy commercial_staff_read on public.%I for select to authenticated using (public.has_any_role(array[''vendedor'', ''contabilidad'']::text[]))',
      v_table
    );
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'suppliers', 'purchases', 'purchase_items', 'inventory_reservations', 'inventory_movements'
  ]
  loop
    execute format(
      'create policy warehouse_staff_read on public.%I for select to authenticated using (public.has_any_role(array[''bodega'', ''contabilidad'']::text[]))',
      v_table
    );
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'payments', 'accounts_receivable', 'accounts_payable', 'expense_categories',
    'expenses', 'cash_accounts', 'cash_movements'
  ]
  loop
    execute format(
      'create policy accounting_staff_read on public.%I for select to authenticated using (public.has_role(''contabilidad''))',
      v_table
    );
    execute format(
      'create policy accounting_staff_insert on public.%I for insert to authenticated with check (public.has_role(''contabilidad''))',
      v_table
    );
    execute format(
      'create policy accounting_staff_update on public.%I for update to authenticated using (public.has_role(''contabilidad'')) with check (public.has_role(''contabilidad''))',
      v_table
    );
  end loop;
end;
$$;

create policy audit_logs_admin_read
on public.audit_logs for select to authenticated
using (public.is_admin());

create policy request_rate_limits_admin_read
on public.request_rate_limits for select to authenticated
using (public.is_admin());

-- Explicit grants: SQL privileges and RLS must both allow a browser operation.
grant usage on schema public to anon, authenticated, service_role;

grant select on public.categories, public.brands, public.payment_methods, public.delivery_methods to anon;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'roles', 'profiles', 'user_roles', 'categories', 'brands', 'price_lists',
    'products', 'product_variants', 'product_images', 'product_prices', 'customers',
    'customer_addresses', 'customer_product_prices', 'quantity_price_tiers',
    'payment_methods', 'delivery_methods', 'orders', 'order_items',
    'order_status_history', 'suppliers', 'purchases', 'purchase_items',
    'inventory_reservations', 'inventory_movements', 'payments',
    'accounts_receivable', 'accounts_payable', 'expense_categories', 'expenses',
    'cash_accounts', 'cash_movements', 'notifications', 'notification_deliveries',
    'whatsapp_settings', 'app_settings', 'audit_logs'
  ]
  loop
    execute format('grant select, insert, update, delete on table public.%I to authenticated', v_table);
    execute format('grant all privileges on table public.%I to service_role', v_table);
  end loop;
end;
$$;

-- Even authorized staff never receive the stored PIN hash through PostgREST.
revoke select on table public.customers from authenticated;
grant select (
  id, auth_user_id, full_name, document_type, document_number, phone,
  whatsapp_phone, email, price_list_id, payment_terms, credit_limit,
  credit_days, outstanding_balance, status, classification, pin_changed_at,
  pin_failed_attempts, pin_locked_until, last_purchase_at, order_count,
  total_purchased, total_paid, average_ticket, favorite_product_id,
  favorite_category_id, notes, internal_notes, marketing_consent,
  marketing_consent_at, created_by, updated_by, created_at, updated_at,
  deleted_at, deleted_by
) on public.customers to authenticated;

grant select, insert, update, delete on public.request_rate_limits to service_role;
grant usage, select on sequence public.order_number_seq, public.purchase_number_seq to authenticated, service_role;

revoke all on public.store_products, public.store_product_variants, public.store_product_images,
  public.public_app_settings, public.customer_self, public.customer_orders,
  public.customer_order_items, public.customer_payments, public.customer_receivables
  from public, anon, authenticated;

grant select on public.store_products, public.store_product_variants, public.store_product_images,
  public.public_app_settings to anon, authenticated;
grant select on public.customer_self, public.customer_orders, public.customer_order_items,
  public.customer_payments, public.customer_receivables to authenticated;

revoke all on function public.set_updated_at() from public;
revoke all on function public.set_order_updated_at() from public;
revoke all on function public.prevent_hard_delete() from public;
revoke all on function public.prevent_immutable_mutation() from public;
revoke all on function public.write_audit_log() from public;
revoke all on function public.guard_managed_balances() from public;
revoke all on function public.has_role(text) from public;
revoke all on function public.has_any_role(text[]) from public;
revoke all on function public.is_admin() from public;
revoke all on function public.current_customer_id() from public;
revoke all on function public.default_public_price_list_id() from public;

grant execute on function public.has_role(text), public.has_any_role(text[]),
  public.is_admin(), public.current_customer_id(), public.default_public_price_list_id()
  to authenticated, service_role;

-- Realtime is best-effort here so the same migration also works in plain PostgreSQL.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
    ) then
      alter publication supabase_realtime add table public.orders;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end;
$$;

commit;
