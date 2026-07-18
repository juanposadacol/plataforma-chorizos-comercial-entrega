import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { DashboardSnapshot } from './types';

export class AdminConfigurationError extends Error {
  constructor() {
    super(
      'Supabase no está configurado. Agrega las variables de entorno para consultar información real.',
    );
    this.name = 'AdminConfigurationError';
  }
}

const getClient = () => {
  if (!isSupabaseConfigured || !supabase) throw new AdminConfigurationError();
  return supabase;
};

const throwIfError = (error: { message?: string } | null) => {
  if (error) throw new Error(error.message || 'No fue posible completar la operación.');
};

export interface FetchOptions {
  select?: string;
  orderBy?: string;
  ascending?: boolean;
  limit?: number;
  eq?: Record<string, string | number | boolean | null>;
  gte?: Record<string, string | number>;
  lte?: Record<string, string | number>;
}

export async function fetchRecords<T>(table: string, options: FetchOptions = {}): Promise<T[]> {
  const client = getClient();
  let query = client.from(table).select(options.select ?? '*');

  Object.entries(options.eq ?? {}).forEach(([column, value]) => {
    query = query.eq(column, value);
  });
  Object.entries(options.gte ?? {}).forEach(([column, value]) => {
    query = query.gte(column, value);
  });
  Object.entries(options.lte ?? {}).forEach(([column, value]) => {
    query = query.lte(column, value);
  });
  if (options.orderBy)
    query = query.order(options.orderBy, { ascending: options.ascending ?? false });
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  throwIfError(error);
  return (data ?? []) as T[];
}

export async function fetchRecord<T>(table: string, id: string, select = '*'): Promise<T | null> {
  const client = getClient();
  const { data, error } = await client.from(table).select(select).eq('id', id).maybeSingle();
  throwIfError(error);
  return data as T | null;
}

export async function insertRecord<T>(table: string, values: Record<string, unknown>): Promise<T> {
  const client = getClient();
  const { data, error } = await client.from(table).insert(values).select().single();
  throwIfError(error);
  return data as T;
}

export async function updateRecord<T>(
  table: string,
  id: string,
  values: Record<string, unknown>,
): Promise<T> {
  const client = getClient();
  const { data, error } = await client.from(table).update(values).eq('id', id).select().single();
  throwIfError(error);
  return data as T;
}

export async function upsertRecords<T>(
  table: string,
  values: Record<string, unknown>[],
  onConflict?: string,
): Promise<T[]> {
  const client = getClient();
  const { data, error } = await client
    .from(table)
    .upsert(values, onConflict ? { onConflict } : undefined)
    .select();
  throwIfError(error);
  return (data ?? []) as T[];
}

export async function softDeleteRecord(table: string, id: string): Promise<void> {
  const client = getClient();
  const { error } = await client
    .from(table)
    .update({ active: false, deleted_at: new Date().toISOString() })
    .eq('id', id);
  throwIfError(error);
}

export async function invokeAdminRpc<T>(name: string, values: Record<string, unknown>): Promise<T> {
  const client = getClient();
  const { data, error } = await client.rpc(name, values);
  throwIfError(error);
  return data as T;
}

export async function invokeAdminFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const client = getClient();
  const { data, error } = await client.functions.invoke(name, { body });
  throwIfError(error);
  return data as T;
}

export async function getDashboardSnapshot(from: Date, to: Date): Promise<DashboardSnapshot> {
  const range = {
    gte: { created_at: from.toISOString() },
    lte: { created_at: to.toISOString() },
  };
  const [orders, orderItems, customers, products, expenses, payments, notifications] =
    await Promise.all([
      fetchRecords('orders', { ...range, orderBy: 'created_at', limit: 1000 }),
      fetchRecords('order_items', { orderBy: 'created_at', limit: 3000 }),
      fetchRecords('customers', { orderBy: 'created_at', limit: 1000 }),
      fetchRecords('products', { orderBy: 'name', ascending: true, limit: 1000 }),
      fetchRecords('expenses', { ...range, orderBy: 'created_at', limit: 1000 }),
      fetchRecords('payments', { ...range, orderBy: 'created_at', limit: 1000 }),
      fetchRecords('notifications', { ...range, orderBy: 'created_at', limit: 300 }),
    ]);
  return {
    orders,
    orderItems,
    customers,
    products,
    expenses,
    payments,
    notifications,
  } as DashboardSnapshot;
}

export async function signOutAdmin(): Promise<void> {
  const client = getClient();
  const { error } = await client.auth.signOut();
  throwIfError(error);
}

export function subscribeToAdminTable(table: string, onChange: () => void): () => void {
  if (!isSupabaseConfigured || !supabase) return () => undefined;
  const client = supabase;
  const channel = client
    .channel(`admin-${table}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
