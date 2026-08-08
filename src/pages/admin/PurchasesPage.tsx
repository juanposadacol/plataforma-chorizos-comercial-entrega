import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Plus, Save } from 'lucide-react';
import type { Purchase, Supplier } from '../../features/admin/types';
import { invokeAdminRpc } from '../../features/admin/adminService';
import { round2 } from '../../features/admin/purchases/purchaseMath';
import { useAdminData } from '../../features/admin/useAdminData';
import {
  firstText,
  formatAdminDate,
  formatMoney,
  matchesSearch,
  toNumber,
} from '../../features/admin/utils';
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

/**
 * Compras de carne. El negocio no compra chorizos terminados: compra carne, y de
 * cada compra sale un número de chorizos. Por eso la compra no lleva líneas por
 * producto ni descuentos ni impuestos: lo que aporta es el costo por unidad
 * —valor pagado ÷ chorizos obtenidos— que el servidor aplica a todo el catálogo.
 */
const emptyForm = {
  supplier_id: '',
  purchase_date: new Date().toISOString().slice(0, 10),
  invoice_number: '',
  input_quantity: '',
  amount: '',
  yield_units: '',
  amount_paid: '0',
  due_date: '',
  notes: '',
};

export function PurchasesPage() {
  const purchasesState = useAdminData<Purchase>(
    'purchases',
    { orderBy: 'created_at', limit: 1000 },
    true,
  );
  const suppliersState = useAdminData<Supplier>('suppliers', {
    orderBy: 'name',
    ascending: true,
    limit: 500,
  });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const supplierById = useMemo(
    () => new Map(suppliersState.data.map((supplier) => [supplier.id, supplier])),
    [suppliersState.data],
  );
  const filtered = useMemo(
    () =>
      purchasesState.data.filter(
        (purchase) =>
          (status === 'all' || purchase.status === status) &&
          (matchesSearch(purchase, search) ||
            matchesSearch(supplierById.get(purchase.supplier_id ?? '') ?? { id: '' }, search)),
      ),
    [purchasesState.data, search, status, supplierById],
  );

  const total = round2(toNumber(form.amount));
  const yieldUnits = toNumber(form.yield_units);
  // El dato que justifica toda la pantalla.
  const unitCost = yieldUnits > 0 ? round2(total / yieldUnits) : 0;
  const paidToSupplier = Math.min(round2(toNumber(form.amount_paid)), total);

  const openCreate = () => {
    setForm({ ...emptyForm, purchase_date: new Date().toISOString().slice(0, 10) });
    setError(null);
    setModalOpen(true);
  };

  const savePurchase = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.supplier_id || toNumber(form.input_quantity) <= 0 || total <= 0 || yieldUnits <= 0) {
      setError('Completa proveedor, kilos de carne, valor pagado y chorizos obtenidos.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = (await invokeAdminRpc('register_meat_purchase', {
        p_supplier_id: form.supplier_id,
        p_purchase_date: form.purchase_date,
        p_input_quantity: toNumber(form.input_quantity),
        p_amount: total,
        p_yield_units: yieldUnits,
        p_invoice_number: form.invoice_number || null,
        p_paid_amount: paidToSupplier,
        p_due_date: form.due_date || null,
        p_notes: form.notes || null,
      })) as { unit_cost?: number } | null;
      setModalOpen(false);
      setSuccess(
        `Compra registrada. El costo por chorizo quedó en ${formatMoney(result?.unit_cost ?? unitCost)} y se aplicó a todos los productos.`,
      );
      window.setTimeout(() => setSuccess(null), 5000);
      await purchasesState.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar la compra.');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<Purchase>[] = [
    {
      key: 'number',
      header: 'Compra',
      render: (purchase) => (
        <div>
          <p className="font-black text-wine">
            #{firstText(purchase, 'purchase_number', 'consecutive') || purchase.id.slice(0, 8)}
          </p>
          <p className="text-xs text-artisan-muted">
            {formatAdminDate(purchase.purchase_date ?? purchase.created_at)}
          </p>
        </div>
      ),
    },
    {
      key: 'supplier',
      header: 'Proveedor',
      render: (purchase) => (
        <div>
          <p className="font-bold">
            {supplierById.get(purchase.supplier_id ?? '')?.name ??
              (firstText(purchase, 'supplier_name') || '—')}
          </p>
          <p className="text-xs text-artisan-muted">
            {purchase.invoice_number ? `Factura ${purchase.invoice_number}` : 'Sin factura'}
          </p>
        </div>
      ),
    },
    {
      key: 'meat',
      header: 'Carne',
      render: (purchase) =>
        purchase.input_quantity ? (
          <span className="font-semibold">{toNumber(purchase.input_quantity)} kg</span>
        ) : (
          <span className="text-artisan-muted">—</span>
        ),
    },
    {
      key: 'yield',
      header: 'Chorizos',
      render: (purchase) =>
        purchase.yield_units ? (
          <span className="font-semibold">{toNumber(purchase.yield_units)}</span>
        ) : (
          <span className="text-artisan-muted">—</span>
        ),
    },
    {
      key: 'unitCost',
      header: 'Costo por chorizo',
      render: (purchase) =>
        purchase.unit_cost_result ? (
          <span className="font-black text-wine">{formatMoney(purchase.unit_cost_result)}</span>
        ) : (
          <span className="text-artisan-muted">—</span>
        ),
    },
    {
      key: 'total',
      header: 'Total',
      render: (purchase) => (
        <span className="font-black">{formatMoney(purchase.total_amount ?? purchase.total)}</span>
      ),
    },
    {
      key: 'balance',
      header: 'Saldo',
      render: (purchase) => (
        <span
          className={
            toNumber(purchase.balance_amount ?? purchase.balance) > 0
              ? 'font-black text-wine'
              : 'text-emerald-700'
          }
        >
          {formatMoney(purchase.balance_amount ?? purchase.balance)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (purchase) => (
        <StatusBadge
          status={purchase.status}
          label={
            (
              {
                draft: 'Borrador',
                ordered: 'Ordenada',
                partial: 'Parcial',
                received: 'Registrada',
                cancelled: 'Cancelada',
              } as Record<string, string>
            )[purchase.status]
          }
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Abastecimiento"
        title="Compras de carne"
        description="Registra cuánta carne se compró, cuánto se pagó y cuántos chorizos salieron. Con eso el sistema fija el costo por chorizo que usan la utilidad y los reportes."
        actions={
          <>
            <ExportCsvButton filename="compras" rows={filtered} />
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Nueva compra
            </Button>
          </>
        }
      />
      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {success}
        </div>
      )}
      {error && !modalOpen && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Buscar compra, factura o proveedor…"
        />
        <select
          className={`${inputClass} w-auto`}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">Todos los estados</option>
          <option value="draft">Borrador</option>
          <option value="received">Registrada</option>
          <option value="cancelled">Cancelada</option>
        </select>
      </div>
      <section className={`${panelClass} overflow-hidden`}>
        {purchasesState.loading ? (
          <LoadingState />
        ) : purchasesState.error ? (
          <ErrorState message={purchasesState.error} onRetry={() => void purchasesState.reload()} />
        ) : filtered.length ? (
          <DataTable rows={filtered} columns={columns} getRowKey={(purchase) => purchase.id} />
        ) : (
          <EmptyState
            title="Sin compras registradas"
            description="Registra la compra de carne para que el costo por chorizo salga de lo que realmente pagaste."
            action={
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Nueva compra
              </Button>
            }
          />
        )}
      </section>
      <Modal
        open={modalOpen}
        title="Nueva compra de carne"
        description="El costo por chorizo se calcula solo y queda como costo de todos los productos."
        onClose={() => !saving && setModalOpen(false)}
        size="lg"
      >
        <form onSubmit={savePurchase} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label>
              <span className={labelClass}>Proveedor *</span>
              <select
                required
                className={inputClass}
                value={form.supplier_id}
                onChange={(event) =>
                  setForm((current) => ({ ...current, supplier_id: event.target.value }))
                }
              >
                <option value="">Selecciona proveedor</option>
                {suppliersState.data.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelClass}>Fecha *</span>
              <input
                required
                type="date"
                className={inputClass}
                value={form.purchase_date}
                onChange={(event) =>
                  setForm((current) => ({ ...current, purchase_date: event.target.value }))
                }
              />
            </label>
            <label>
              <span className={labelClass}>Número de factura</span>
              <input
                className={inputClass}
                value={form.invoice_number}
                onChange={(event) =>
                  setForm((current) => ({ ...current, invoice_number: event.target.value }))
                }
              />
            </label>
          </div>

          <div className="grid gap-4 rounded-2xl border border-artisan-line bg-white p-4 sm:grid-cols-3">
            <label>
              <span className={labelClass}>Carne comprada (kg) *</span>
              <input
                required
                type="number"
                min="0.001"
                step="0.001"
                className={inputClass}
                value={form.input_quantity}
                placeholder="300"
                onChange={(event) =>
                  setForm((current) => ({ ...current, input_quantity: event.target.value }))
                }
              />
            </label>
            <label>
              <span className={labelClass}>Valor pagado *</span>
              <input
                required
                type="number"
                min="1"
                step="100"
                className={inputClass}
                value={form.amount}
                placeholder="3000000"
                onChange={(event) =>
                  setForm((current) => ({ ...current, amount: event.target.value }))
                }
              />
            </label>
            <label>
              <span className={labelClass}>Chorizos obtenidos *</span>
              <input
                required
                type="number"
                min="1"
                step="1"
                className={inputClass}
                value={form.yield_units}
                placeholder="630"
                onChange={(event) =>
                  setForm((current) => ({ ...current, yield_units: event.target.value }))
                }
              />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              <label>
                <span className={labelClass}>Observaciones</span>
                <textarea
                  className={`${inputClass} min-h-24`}
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className={labelClass}>Abono al proveedor</span>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    max={total}
                    className={inputClass}
                    value={form.amount_paid}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, amount_paid: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span className={labelClass}>Vencimiento</span>
                  <input
                    type="date"
                    min={form.purchase_date}
                    className={inputClass}
                    value={form.due_date}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, due_date: event.target.value }))
                    }
                  />
                </label>
              </div>
            </div>
            <dl className="space-y-3 rounded-2xl bg-wine-dark p-5 text-sm text-white">
              <div className="flex justify-between">
                <dt className="text-white/65">Total pagado</dt>
                <dd>{formatMoney(total)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/65">Chorizos</dt>
                <dd>{yieldUnits || '—'}</dd>
              </div>
              <div
                className="flex justify-between border-t border-white/15 pt-3 text-lg font-black"
                aria-live="polite"
              >
                <dt>Costo por chorizo</dt>
                <dd className="text-artisan-gold">{formatMoney(unitCost)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/65">Saldo al proveedor</dt>
                <dd className="font-bold">{formatMoney(round2(total - paidToSupplier))}</dd>
              </div>
            </dl>
          </div>
          <p className="text-xs text-artisan-muted">
            Al guardar, ese costo por chorizo queda como costo de todos los productos activos y con
            él se calcula la utilidad. La compra no cambia las existencias: el stock se sigue
            manejando en Inventario.
          </p>
          {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          <div className="flex justify-end gap-2 border-t border-artisan-line pt-4">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Guardando…' : 'Guardar compra'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
export default PurchasesPage;
