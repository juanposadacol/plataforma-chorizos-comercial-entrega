import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, PackageCheck, Plus, Save, Trash2 } from 'lucide-react';
import type { AdminProduct, Purchase, Supplier } from '../../features/admin/types';
import { insertRecord, invokeAdminRpc, upsertRecords } from '../../features/admin/adminService';
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

interface PurchaseLine {
  key: string;
  product_id: string;
  quantity: string;
  unit_cost: string;
  discount_amount: string;
  tax_amount: string;
}
const emptyLine = (): PurchaseLine => ({
  key: crypto.randomUUID(),
  product_id: '',
  quantity: '1',
  unit_cost: '',
  discount_amount: '0',
  tax_amount: '0',
});

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
  const productsState = useAdminData<AdminProduct>('products', {
    orderBy: 'name',
    ascending: true,
    limit: 1000,
  });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    supplier_id: '',
    purchase_date: new Date().toISOString().slice(0, 10),
    invoice_number: '',
    amount_paid: '0',
    due_date: '',
    notes: '',
  });
  const [lines, setLines] = useState<PurchaseLine[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [receiving, setReceiving] = useState<string | null>(null);
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
  const totals = useMemo(
    () =>
      lines.reduce(
        (acc, line) => {
          const base = toNumber(line.quantity) * toNumber(line.unit_cost);
          acc.subtotal += base;
          acc.discount += toNumber(line.discount_amount);
          acc.tax += toNumber(line.tax_amount);
          return acc;
        },
        { subtotal: 0, discount: 0, tax: 0 },
      ),
    [lines],
  );
  const grandTotal = totals.subtotal - totals.discount + totals.tax;

  const openCreate = () => {
    setForm({
      supplier_id: '',
      purchase_date: new Date().toISOString().slice(0, 10),
      invoice_number: '',
      amount_paid: '0',
      due_date: '',
      notes: '',
    });
    setLines([emptyLine()]);
    setError(null);
    setModalOpen(true);
  };
  const updateLine = (key: string, field: keyof Omit<PurchaseLine, 'key'>, value: string) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, [field]: value } : line)),
    );

  const savePurchase = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !lines.length ||
      lines.some(
        (line) => !line.product_id || toNumber(line.quantity) <= 0 || toNumber(line.unit_cost) < 0,
      )
    ) {
      setError('Completa al menos un producto con cantidad y costo válidos.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const purchase = await insertRecord<Purchase>('purchases', {
        supplier_id: form.supplier_id,
        purchase_date: form.purchase_date,
        invoice_number: form.invoice_number || null,
        status: 'draft',
        subtotal_amount: totals.subtotal,
        discount_amount: totals.discount,
        tax_amount: totals.tax,
        total_amount: grandTotal,
        paid_amount: Number(form.amount_paid || 0),
        balance_amount: Math.max(0, grandTotal - Number(form.amount_paid || 0)),
        due_date: form.due_date || null,
        notes: form.notes || null,
      });
      await upsertRecords(
        'purchase_items',
        lines.map((line) => ({
          purchase_id: purchase.id,
          product_id: line.product_id,
          quantity: Number(line.quantity),
          unit_cost: Number(line.unit_cost),
          discount_amount: Number(line.discount_amount || 0),
          tax_amount: Number(line.tax_amount || 0),
          subtotal:
            toNumber(line.quantity) * toNumber(line.unit_cost) -
            toNumber(line.discount_amount) +
            toNumber(line.tax_amount),
        })),
      );
      setModalOpen(false);
      setSuccess(
        'Compra creada en borrador. Recíbela cuando la mercancía entre físicamente a bodega.',
      );
      window.setTimeout(() => setSuccess(null), 4500);
      await purchasesState.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar la compra.');
    } finally {
      setSaving(false);
    }
  };

  const receive = async (purchase: Purchase) => {
    if (
      !window.confirm(
        `¿Confirmas que la compra ${firstText(purchase, 'purchase_number', 'consecutive')} fue recibida? Esta acción incrementará inventario y actualizará costos.`,
      )
    )
      return;
    setReceiving(purchase.id);
    setError(null);
    try {
      await invokeAdminRpc('receive_purchase', { p_purchase_id: purchase.id });
      setSuccess(
        'Compra recibida: inventario, costo promedio y cuenta por pagar fueron actualizados.',
      );
      window.setTimeout(() => setSuccess(null), 4500);
      await purchasesState.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible recibir la compra.');
    } finally {
      setReceiving(null);
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
                received: 'Recibida',
                cancelled: 'Cancelada',
              } as Record<string, string>
            )[purchase.status]
          }
        />
      ),
    },
    {
      key: 'actions',
      header: 'Acción',
      render: (purchase) =>
        purchase.status !== 'received' && purchase.status !== 'cancelled' ? (
          <Button
            variant="secondary"
            className="min-h-9 px-3 py-1.5"
            disabled={receiving === purchase.id}
            onClick={() => void receive(purchase)}
          >
            <PackageCheck className="h-4 w-4" />
            {receiving === purchase.id ? 'Recibiendo…' : 'Recibir'}
          </Button>
        ) : (
          <span className="text-xs text-artisan-muted">Cerrada</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Abastecimiento"
        title="Compras"
        description="Registra facturas de proveedor y recibe mercancía de forma transaccional para actualizar kardex, costo promedio y cuentas por pagar."
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
          <option value="ordered">Ordenada</option>
          <option value="partial">Parcial</option>
          <option value="received">Recibida</option>
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
            description="Crea una compra para documentar el abastecimiento y su costo real."
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
        title="Nueva compra"
        description="Guarda el documento en borrador. El inventario solo cambia al usar la acción Recibir."
        onClose={() => !saving && setModalOpen(false)}
        size="xl"
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
          <div className="overflow-hidden rounded-2xl border border-artisan-line bg-white">
            <div className="flex items-center justify-between border-b border-artisan-line bg-artisan-paper/60 px-4 py-3">
              <h3 className="font-bold">Productos</h3>
              <Button
                type="button"
                variant="secondary"
                className="min-h-9"
                onClick={() => setLines((current) => [...current, emptyLine()])}
              >
                <Plus className="h-4 w-4" />
                Agregar línea
              </Button>
            </div>
            <div className="divide-y divide-artisan-line">
              {lines.map((line, index) => (
                <div
                  key={line.key}
                  className="grid gap-3 p-4 lg:grid-cols-[2fr_repeat(4,1fr)_40px]"
                >
                  <label>
                    <span className={labelClass}>Producto {index + 1}</span>
                    <select
                      required
                      className={inputClass}
                      value={line.product_id}
                      onChange={(event) => updateLine(line.key, 'product_id', event.target.value)}
                    >
                      <option value="">Selecciona</option>
                      {productsState.data.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} · {product.sku}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className={labelClass}>Cantidad</span>
                    <input
                      required
                      type="number"
                      min="0.001"
                      step="0.001"
                      className={inputClass}
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, 'quantity', event.target.value)}
                    />
                  </label>
                  <label>
                    <span className={labelClass}>Costo unitario</span>
                    <input
                      required
                      type="number"
                      min="0"
                      step="50"
                      className={inputClass}
                      value={line.unit_cost}
                      onChange={(event) => updateLine(line.key, 'unit_cost', event.target.value)}
                    />
                  </label>
                  <label>
                    <span className={labelClass}>Descuento</span>
                    <input
                      type="number"
                      min="0"
                      step="50"
                      className={inputClass}
                      value={line.discount_amount}
                      onChange={(event) =>
                        updateLine(line.key, 'discount_amount', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span className={labelClass}>Impuesto</span>
                    <input
                      type="number"
                      min="0"
                      step="50"
                      className={inputClass}
                      value={line.tax_amount}
                      onChange={(event) => updateLine(line.key, 'tax_amount', event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label="Quitar producto"
                    disabled={lines.length === 1}
                    className="mt-6 grid h-10 w-10 place-items-center rounded-xl text-red-700 hover:bg-red-50 disabled:opacity-30"
                    onClick={() =>
                      setLines((current) => current.filter((item) => item.key !== line.key))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
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
                  <span className={labelClass}>Valor pagado</span>
                  <input
                    type="number"
                    min="0"
                    step="100"
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
                <dt className="text-white/65">Subtotal</dt>
                <dd>{formatMoney(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/65">Descuentos</dt>
                <dd>− {formatMoney(totals.discount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/65">Impuestos</dt>
                <dd>{formatMoney(totals.tax)}</dd>
              </div>
              <div className="flex justify-between border-t border-white/15 pt-3 text-lg font-black">
                <dt>Total</dt>
                <dd className="text-artisan-gold">{formatMoney(grandTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/65">Saldo</dt>
                <dd className="font-bold">
                  {formatMoney(Math.max(0, grandTotal - Number(form.amount_paid || 0)))}
                </dd>
              </div>
            </dl>
          </div>
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
