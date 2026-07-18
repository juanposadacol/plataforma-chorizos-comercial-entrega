export interface PriceRule {
  price: number;
  active: boolean;
  min?: number;
  max?: number | null;
}

export interface PriceContext {
  publicPrice: number;
  listPrice?: number | null;
  special?: PriceRule | null;
  volume?: PriceRule[];
  volumeEnabled?: boolean;
}

export interface ResolvedPrice {
  amount: number;
  source: 'special' | 'volume' | 'list' | 'public';
}

export function resolvePrice(context: PriceContext, quantity = 1): ResolvedPrice {
  if (context.special?.active) return { amount: context.special.price, source: 'special' };
  if (context.volumeEnabled) {
    const tier = (context.volume ?? [])
      .filter(
        (rule) =>
          rule.active && quantity >= (rule.min ?? 1) && (rule.max == null || quantity <= rule.max),
      )
      .sort((a, b) => (b.min ?? 0) - (a.min ?? 0))[0];
    if (tier) return { amount: tier.price, source: 'volume' };
  }
  if (context.listPrice != null) return { amount: context.listPrice, source: 'list' };
  return { amount: context.publicPrice, source: 'public' };
}

export class InventoryLedger {
  private stock = new Map<string, { onHand: number; reserved: number; averageCost: number }>();

  set(productId: string, onHand: number, reserved = 0, averageCost = 0) {
    this.stock.set(productId, { onHand, reserved, averageCost });
  }

  get(productId: string) {
    const row = this.stock.get(productId) ?? { onHand: 0, reserved: 0, averageCost: 0 };
    return { ...row, available: row.onHand - row.reserved };
  }

  reserve(productId: string, quantity: number): boolean {
    const row = this.stock.get(productId);
    if (!row || quantity <= 0 || row.onHand - row.reserved < quantity) return false;
    row.reserved += quantity;
    return true;
  }

  cancel(productId: string, quantity: number) {
    const row = this.stock.get(productId);
    if (!row || row.reserved < quantity) throw new Error('Reserva inválida');
    row.reserved -= quantity;
  }

  deliver(productId: string, quantity: number) {
    const row = this.stock.get(productId);
    if (!row || row.reserved < quantity || row.onHand < quantity)
      throw new Error('Inventario inválido');
    row.reserved -= quantity;
    row.onHand -= quantity;
  }

  receive(productId: string, quantity: number, unitCost: number) {
    const row = this.stock.get(productId) ?? { onHand: 0, reserved: 0, averageCost: 0 };
    const newOnHand = row.onHand + quantity;
    row.averageCost =
      newOnHand === 0 ? 0 : (row.onHand * row.averageCost + quantity * unitCost) / newOnHand;
    row.onHand = newOnHand;
    this.stock.set(productId, row);
  }
}

export interface FinancialOrder {
  id: string;
  customerId: string;
  status: 'delivered' | 'cancelled' | 'returned' | 'new';
  gross: number;
  discount: number;
  returns: number;
  cost: number;
  items: Array<{ productId: string; quantity: number; revenue: number; cost: number }>;
}

export const financialMetrics = (orders: FinancialOrder[], expenses: number) => {
  const delivered = orders.filter((order) => order.status === 'delivered');
  const netSales = delivered.reduce(
    (sum, order) => sum + order.gross - order.discount - order.returns,
    0,
  );
  const costOfSales = delivered.reduce((sum, order) => sum + order.cost, 0);
  const grossProfit = netSales - costOfSales;
  return {
    netSales,
    costOfSales,
    grossProfit,
    grossMargin: netSales ? (grossProfit / netSales) * 100 : 0,
    netProfit: grossProfit - expenses,
    averageTicket: delivered.length ? netSales / delivered.length : 0,
  };
};

export const productRanking = (orders: FinancialOrder[]) => {
  const totals = new Map<string, { quantity: number; revenue: number }>();
  orders
    .filter((order) => order.status === 'delivered')
    .forEach((order) =>
      order.items.forEach((item) => {
        const current = totals.get(item.productId) ?? { quantity: 0, revenue: 0 };
        current.quantity += item.quantity;
        current.revenue += item.revenue;
        totals.set(item.productId, current);
      }),
    );
  return [...totals.entries()]
    .map(([productId, value]) => ({ productId, ...value }))
    .sort((a, b) => b.quantity - a.quantity);
};

export const customerRanking = (orders: FinancialOrder[]) => {
  const totals = new Map<string, number>();
  orders
    .filter((order) => order.status === 'delivered')
    .forEach((order) =>
      totals.set(
        order.customerId,
        (totals.get(order.customerId) ?? 0) + order.gross - order.discount - order.returns,
      ),
    );
  return [...totals.entries()]
    .map(([customerId, total]) => ({ customerId, total }))
    .sort((a, b) => b.total - a.total);
};

export const paymentBalance = (original: number, payments: number[]) =>
  Math.max(0, original - payments.reduce((sum, value) => sum + value, 0));

export const canViewCustomer = (
  actor: { role: string; customerId?: string },
  targetCustomerId: string,
) => actor.role !== 'customer' || actor.customerId === targetCustomerId;
export const canAccessAdmin = (roles: string[]) =>
  roles.some((role) => ['superadmin', 'admin', 'sales', 'warehouse', 'accounting'].includes(role));

export const persistThenNotify = async <T>(
  persist: () => Promise<T>,
  notify: (record: T) => Promise<void>,
) => {
  const record = await persist();
  try {
    await notify(record);
    return { record, notification: 'sent' as const };
  } catch {
    return { record, notification: 'failed' as const };
  }
};
