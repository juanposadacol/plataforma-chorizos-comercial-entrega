import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Boxes, Plus, Save, TriangleAlert } from 'lucide-react';
import type { AdminProduct, InventoryMovement } from '../../features/admin/types';
import { invokeAdminRpc } from '../../features/admin/adminService';
import { useAdminData } from '../../features/admin/useAdminData';
import { formatAdminDate, formatMoney, matchesSearch, toNumber } from '../../features/admin/utils';
import { InventoryAlerts } from '../../features/admin/inventory/InventoryAlerts';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  ExportCsvButton,
  inputClass,
  labelClass,
  LoadingState,
  Modal,
  PageHeader,
  panelClass,
  SearchField,
  StatusBadge,
  type TableColumn,
} from '../../features/admin/components/AdminUi';

const movementLabels: Record<string, string> = {
  initial: 'Inventario inicial',
  purchase: 'Compra',
  reservation: 'Reserva',
  reservation_release: 'Liberación de reserva',
  sale: 'Venta',
  return: 'Devolución',
  positive_adjustment: 'Ajuste positivo',
  negative_adjustment: 'Ajuste negativo',
  damage: 'Daño',
  loss: 'Pérdida',
  supplier_return: 'Devolución a proveedor',
};

export function InventoryPage() {
  const productsState = useAdminData<AdminProduct>(
    'products',
    { orderBy: 'name', ascending: true, limit: 1000 },
    true,
  );
  const movementsState = useAdminData<InventoryMovement>(
    'inventory_movements',
    { orderBy: 'created_at', limit: 2000 },
    true,
  );
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [form, setForm] = useState({
    product_id: '',
    movement_type: 'positive_adjustment',
    quantity: '1',
    unit_cost: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const productById = useMemo(
    () => new Map(productsState.data.map((product) => [product.id, product])),
    [productsState.data],
  );
  const filtered = useMemo(
    () =>
      movementsState.data.filter(
        (movement) =>
          (typeFilter === 'all' || movement.movement_type === typeFilter) &&
          (matchesSearch(movement, search) ||
            matchesSearch(productById.get(movement.product_id) ?? { id: '' }, search)),
      ),
    [movementsState.data, productById, search, typeFilter],
  );
  const totalUnits = productsState.data.reduce(
    (sum, product) => sum + toNumber(product.stock_on_hand ?? product.stock_current),
    0,
  );
  const reserved = productsState.data.reduce(
    (sum, product) => sum + toNumber(product.stock_reserved),
    0,
  );
  const inventoryValue = productsState.data.reduce(
    (sum, product) =>
      sum +
      toNumber(product.stock_on_hand ?? product.stock_current) *
        toNumber(product.average_cost ?? product.current_cost),
    0,
  );
  const lowStock = productsState.data.filter(
    (product) =>
      toNumber(product.stock_available ?? product.stock_on_hand ?? product.stock_current) <=
      toNumber(product.minimum_stock),
  ).length;

  const submitAdjustment = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await invokeAdminRpc('create_inventory_adjustment', {
        p_product_id: form.product_id,
        p_movement_type: form.movement_type,
        p_quantity: Number(form.quantity),
        p_unit_cost: form.unit_cost ? Number(form.unit_cost) : null,
        p_notes: form.notes,
      });
      setAdjustOpen(false);
      setForm({
        product_id: '',
        movement_type: 'positive_adjustment',
        quantity: '1',
        unit_cost: '',
        notes: '',
      });
      setSuccess('Movimiento registrado; el saldo se recalculó de forma transaccional.');
      window.setTimeout(() => setSuccess(null), 4000);
      await Promise.all([productsState.reload(), movementsState.reload()]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'No fue posible registrar el movimiento.',
      );
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<InventoryMovement>[] = [
    {
      key: 'date',
      header: 'Fecha',
      render: (movement) => formatAdminDate(movement.created_at, true),
    },
    {
      key: 'product',
      header: 'Producto',
      render: (movement) => {
        const product = productById.get(movement.product_id);
        return (
          <div>
            <p className="font-bold">{product?.name ?? 'Producto'}</p>
            <p className="text-xs text-artisan-muted">
              {product?.sku ?? movement.product_id.slice(0, 8)}
            </p>
          </div>
        );
      },
    },
    {
      key: 'type',
      header: 'Movimiento',
      render: (movement) => (
        <StatusBadge
          status={
            movement.movement_type.includes('negative') ||
            ['sale', 'damage', 'loss', 'supplier_return'].includes(movement.movement_type)
              ? 'cancelled'
              : 'active'
          }
          label={movementLabels[movement.movement_type] ?? movement.movement_type}
        />
      ),
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      render: (movement) => {
        const outgoing =
          movement.movement_type.includes('negative') ||
          ['sale', 'reservation', 'damage', 'loss', 'supplier_return'].includes(
            movement.movement_type,
          );
        return (
          <span
            className={`inline-flex items-center gap-1 font-black ${outgoing ? 'text-red-700' : 'text-emerald-700'}`}
          >
            {outgoing ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
            {toNumber(movement.quantity)}
          </span>
        );
      },
    },
    {
      key: 'balance',
      header: 'Saldo',
      render: (movement) => <span className="font-black">{toNumber(movement.new_balance)}</span>,
    },
    {
      key: 'cost',
      header: 'Costo unitario',
      render: (movement) => formatMoney(movement.unit_cost),
    },
    {
      key: 'notes',
      header: 'Observación',
      render: (movement) => (
        <span className="line-clamp-2 max-w-xs text-artisan-muted">{movement.notes || '—'}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Bodega"
        title="Inventario y kardex"
        description="Consulta existencias, reservas y movimientos. Todo ajuste crea un registro auditable; el stock nunca se edita directamente."
        actions={
          <>
            <ExportCsvButton filename="kardex" rows={filtered} />
            <Button
              onClick={() => {
                setError(null);
                setAdjustOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Registrar ajuste
            </Button>
          </>
        }
      />
      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {success}
        </div>
      )}
      {error && !adjustOpen && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className={`${panelClass} flex items-center gap-4 p-5`}>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-wine/10 text-wine">
            <Boxes className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
              Unidades en stock
            </p>
            <p className="font-display text-2xl font-bold">{totalUnits}</p>
          </div>
        </article>
        <article className={`${panelClass} flex items-center gap-4 p-5`}>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-100 text-sky-800">
            <Boxes className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
              Reservadas
            </p>
            <p className="font-display text-2xl font-bold">{reserved}</p>
          </div>
        </article>
        <article className={`${panelClass} flex items-center gap-4 p-5`}>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-100 text-emerald-800">
            <ArrowUp className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
              Valor del inventario
            </p>
            <p className="font-display text-xl font-bold">{formatMoney(inventoryValue)}</p>
          </div>
        </article>
        <article className={`${panelClass} flex items-center gap-4 p-5`}>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-800">
            <TriangleAlert className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-artisan-muted">
              Stock bajo
            </p>
            <p className="font-display text-2xl font-bold">{lowStock}</p>
          </div>
        </article>
      </section>
      <InventoryAlerts products={productsState.data} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Buscar producto, SKU u observación…"
        />
        <select
          className={`${inputClass} w-auto`}
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="all">Todos los movimientos</option>
          {Object.entries(movementLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <section className={`${panelClass} overflow-hidden`}>
        {productsState.loading || movementsState.loading ? (
          <LoadingState />
        ) : productsState.error || movementsState.error ? (
          <ErrorState
            message={productsState.error || movementsState.error || ''}
            onRetry={() => void Promise.all([productsState.reload(), movementsState.reload()])}
          />
        ) : filtered.length ? (
          <DataTable rows={filtered} columns={columns} getRowKey={(movement) => movement.id} />
        ) : (
          <EmptyState
            title="Sin movimientos"
            description="Los movimientos de compras, reservas, ventas y ajustes aparecerán aquí."
          />
        )}
      </section>
      <Modal
        open={adjustOpen}
        title="Registrar ajuste de inventario"
        description="La operación se procesa en el servidor y conserva los saldos anterior y posterior."
        onClose={() => !saving && setAdjustOpen(false)}
      >
        <form onSubmit={submitAdjustment} className="space-y-4">
          <label>
            <span className={labelClass}>Producto *</span>
            <select
              required
              className={inputClass}
              value={form.product_id}
              onChange={(event) =>
                setForm((current) => ({ ...current, product_id: event.target.value }))
              }
            >
              <option value="">Selecciona un producto</option>
              {productsState.data.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · {product.sku}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>Tipo de movimiento *</span>
            <select
              required
              className={inputClass}
              value={form.movement_type}
              onChange={(event) =>
                setForm((current) => ({ ...current, movement_type: event.target.value }))
              }
            >
              <option value="positive_adjustment">Ajuste positivo</option>
              <option value="negative_adjustment">Ajuste negativo</option>
              <option value="damage">Daño</option>
              <option value="loss">Pérdida</option>
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelClass}>Cantidad *</span>
              <input
                required
                type="number"
                min="0.001"
                step="0.001"
                className={inputClass}
                value={form.quantity}
                onChange={(event) =>
                  setForm((current) => ({ ...current, quantity: event.target.value }))
                }
              />
            </label>
            <label>
              <span className={labelClass}>Costo unitario</span>
              <input
                type="number"
                min="0"
                step="50"
                className={inputClass}
                value={form.unit_cost}
                onChange={(event) =>
                  setForm((current) => ({ ...current, unit_cost: event.target.value }))
                }
              />
            </label>
          </div>
          <label>
            <span className={labelClass}>Motivo u observación *</span>
            <textarea
              required
              className={`${inputClass} min-h-24`}
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, notes: event.target.value }))
              }
              placeholder="Explica por qué se realiza el ajuste…"
            />
          </label>
          {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          <div className="flex justify-end gap-2 border-t border-artisan-line pt-4">
            <Button type="button" variant="secondary" onClick={() => setAdjustOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Registrando…' : 'Registrar movimiento'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
export default InventoryPage;
