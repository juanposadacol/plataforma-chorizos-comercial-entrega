/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Copy, Edit3, History, Plus, Power, Save, Tags } from 'lucide-react';
import type {
  AdminProduct,
  Customer,
  CustomerProductPrice,
  PriceList,
  ProductPrice,
} from '../types';
import { insertRecord, updateRecord, upsertRecords } from '../adminService';
import { useAdminData } from '../useAdminData';
import { firstText, formatAdminDate, formatMoney, matchesSearch, toNumber } from '../utils';
import {
  Button,
  EmptyState,
  ErrorState,
  inputClass,
  labelClass,
  LoadingState,
  Modal,
  panelClass,
  SearchField,
  SectionTitle,
  StatusBadge,
  type TableColumn,
} from '../components/AdminUi';
import { ResourceManager, type ResourceField } from '../components/ResourceManager';

type PricingTab = 'lists' | 'specials' | 'volume' | 'history';
interface QuantityTier extends Record<string, unknown> {
  id: string;
  product_id: string;
  price_list_id: string;
  min_quantity: number;
  max_quantity?: number | null;
  unit_price: number;
  valid_from?: string | null;
  valid_until?: string | null;
  status?: string;
  active?: boolean;
}
interface AuditEntry extends Record<string, unknown> {
  id: string;
  entity_type?: string;
  action: string;
  old_values?: unknown;
  new_values?: unknown;
  created_at: string;
}

export function PriceListEditor() {
  const [tab, setTab] = useState<PricingTab>('lists');
  const listsState = useAdminData<PriceList>(
    'price_lists',
    { orderBy: 'name', ascending: true, limit: 100 },
    true,
  );
  const productsState = useAdminData<AdminProduct>(
    'products',
    { orderBy: 'name', ascending: true, limit: 1000 },
    true,
  );
  const pricesState = useAdminData<ProductPrice>(
    'product_prices',
    { orderBy: 'created_at', limit: 3000 },
    true,
  );
  const customersState = useAdminData<Customer>('customers', {
    orderBy: 'full_name',
    ascending: true,
    limit: 1000,
  });
  const historyState = useAdminData<AuditEntry>('audit_logs', {
    orderBy: 'created_at',
    limit: 100,
  });
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [draftPrices, setDraftPrices] = useState<Record<string, string>>({});
  const [listModal, setListModal] = useState(false);
  const [editingList, setEditingList] = useState<PriceList | null>(null);
  const [listForm, setListForm] = useState({
    name: '',
    code: '',
    description: '',
    is_public: false,
    is_active: true,
    valid_from: '',
    valid_until: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && listsState.data[0]) setSelectedId(listsState.data[0].id);
  }, [listsState.data, selectedId]);

  useEffect(() => {
    const values: Record<string, string> = {};
    pricesState.data
      .filter((price) => price.price_list_id === selectedId && price.active !== false)
      .forEach((price) => {
        values[price.product_id] = String(price.price);
      });
    setDraftPrices(values);
  }, [pricesState.data, selectedId]);

  const selectedList = listsState.data.find((list) => list.id === selectedId);
  const filteredProducts = useMemo(
    () => productsState.data.filter((product) => matchesSearch(product, search)),
    [productsState.data, search],
  );
  const notify = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 4000);
  };

  const openList = (list?: PriceList) => {
    setEditingList(list ?? null);
    setListForm({
      name: list?.name ?? '',
      code: list?.code ?? '',
      description: list?.description ?? '',
      is_public: list?.is_public ?? false,
      is_active: list?.is_active ?? list?.active ?? true,
      valid_from: list?.valid_from ?? '',
      valid_until: list?.valid_until ?? '',
    });
    setError(null);
    setListModal(true);
  };
  const saveList = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      ...listForm,
      description: listForm.description || null,
      valid_from: listForm.valid_from || null,
      valid_until: listForm.valid_until || null,
    };
    try {
      if (editingList) await updateRecord('price_lists', editingList.id, payload);
      else {
        const created = await insertRecord<PriceList>('price_lists', payload);
        setSelectedId(created.id);
      }
      setListModal(false);
      notify('Lista de precios guardada.');
      await listsState.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar la lista.');
    } finally {
      setSaving(false);
    }
  };
  const toggleList = async (list: PriceList) => {
    setError(null);
    try {
      await updateRecord('price_lists', list.id, {
        is_active: !(list.is_active ?? list.active ?? true),
      });
      notify('Estado de la lista actualizado sin borrar su historial.');
      await listsState.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cambiar el estado.');
    }
  };
  const duplicateList = async (list: PriceList) => {
    setSaving(true);
    setError(null);
    try {
      const created = await insertRecord<PriceList>('price_lists', {
        name: `${list.name} (copia)`,
        code: `${list.code ?? 'LISTA'}-COPIA-${Date.now().toString().slice(-4)}`,
        description: list.description,
        is_public: false,
        is_active: true,
      });
      const sourcePrices = pricesState.data.filter(
        (price) => price.price_list_id === list.id && price.active !== false,
      );
      if (sourcePrices.length)
        await upsertRecords(
          'product_prices',
          sourcePrices.map((price) => ({
            price_list_id: created.id,
            product_id: price.product_id,
            price: price.price,
            valid_from: price.valid_from,
            valid_until: price.valid_until,
            active: true,
          })),
          'price_list_id,product_id',
        );
      setSelectedId(created.id);
      notify('Lista duplicada con todos sus precios.');
      await Promise.all([listsState.reload(), pricesState.reload()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible duplicar la lista.');
    } finally {
      setSaving(false);
    }
  };
  const saveMatrix = async () => {
    if (!selectedId) return;
    const rows = productsState.data
      .filter((product) => draftPrices[product.id] !== undefined && draftPrices[product.id] !== '')
      .map((product) => ({
        price_list_id: selectedId,
        product_id: product.id,
        price: Number(draftPrices[product.id]),
        active: true,
      }));
    setSaving(true);
    setError(null);
    try {
      await upsertRecords('product_prices', rows, 'price_list_id,product_id');
      notify(`${rows.length} precios actualizados.`);
      await pricesState.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar los precios.');
    } finally {
      setSaving(false);
    }
  };

  const customerOptions = customersState.data.map((customer) => ({
    value: customer.id,
    label: `${firstText(customer, 'full_name', 'name')} · ${customer.phone}`,
  }));
  const productOptions = productsState.data.map((product) => ({
    value: product.id,
    label: `${product.name} · ${product.sku}`,
  }));
  const listOptions = listsState.data.map((list) => ({ value: list.id, label: list.name }));
  const specialFields: ResourceField[] = [
    {
      key: 'customer_id',
      label: 'Cliente',
      type: 'select',
      required: true,
      options: customerOptions,
    },
    {
      key: 'product_id',
      label: 'Producto',
      type: 'select',
      required: true,
      options: productOptions,
    },
    { key: 'price', label: 'Precio especial', type: 'number', required: true, min: 0, step: 50 },
    { key: 'valid_from', label: 'Vigente desde', type: 'date', required: true },
    { key: 'valid_until', label: 'Vigente hasta', type: 'date' },
    { key: 'notes', label: 'Observación', type: 'textarea', fullWidth: true },
    { key: 'active', label: 'Activo', type: 'checkbox', defaultValue: true },
  ];
  const specialColumns: TableColumn<CustomerProductPrice>[] = [
    {
      key: 'customer',
      header: 'Cliente',
      render: (price) =>
        customerOptions.find((option) => option.value === price.customer_id)?.label ??
        price.customer_id.slice(0, 8),
    },
    {
      key: 'product',
      header: 'Producto',
      render: (price) =>
        productOptions.find((option) => option.value === price.product_id)?.label ??
        price.product_id.slice(0, 8),
    },
    {
      key: 'price',
      header: 'Precio',
      render: (price) => <span className="font-black text-wine">{formatMoney(price.price)}</span>,
    },
    {
      key: 'validity',
      header: 'Vigencia',
      render: (price) =>
        `${formatAdminDate(price.valid_from)} – ${formatAdminDate(price.valid_until)}`,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (price) => <StatusBadge status={price.active === false ? 'inactive' : 'active'} />,
    },
  ];
  const tierFields: ResourceField[] = [
    { key: 'price_list_id', label: 'Lista', type: 'select', required: true, options: listOptions },
    {
      key: 'product_id',
      label: 'Producto',
      type: 'select',
      required: true,
      options: productOptions,
    },
    {
      key: 'min_quantity',
      label: 'Cantidad mínima',
      type: 'number',
      required: true,
      min: 1,
      step: 1,
    },
    { key: 'max_quantity', label: 'Cantidad máxima', type: 'number', min: 1, step: 1 },
    {
      key: 'unit_price',
      label: 'Precio unitario',
      type: 'number',
      required: true,
      min: 0,
      step: 50,
    },
    { key: 'valid_from', label: 'Vigente desde', type: 'date' },
    { key: 'valid_until', label: 'Vigente hasta', type: 'date' },
    {
      key: 'active',
      label: 'Activo',
      type: 'checkbox',
      defaultValue: false,
      help: 'La función puede permanecer desactivada hasta que el negocio decida usarla.',
    },
  ];
  const tierColumns: TableColumn<QuantityTier>[] = [
    {
      key: 'list',
      header: 'Lista',
      render: (tier) =>
        listOptions.find((option) => option.value === tier.price_list_id)?.label ?? '—',
    },
    {
      key: 'product',
      header: 'Producto',
      render: (tier) =>
        productOptions.find((option) => option.value === tier.product_id)?.label ?? '—',
    },
    {
      key: 'range',
      header: 'Cantidad',
      render: (tier) => `${tier.min_quantity} – ${tier.max_quantity || 'en adelante'}`,
    },
    {
      key: 'price',
      header: 'Precio',
      render: (tier) => <span className="font-black">{formatMoney(tier.unit_price)}</span>,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (tier) => <StatusBadge status={tier.active ? 'active' : 'inactive'} />,
    },
  ];
  const tabs: Array<{ id: PricingTab; label: string }> = [
    { id: 'lists', label: 'Listas de precios' },
    { id: 'specials', label: 'Precios especiales' },
    { id: 'volume', label: 'Precios por volumen' },
    { id: 'history', label: 'Historial' },
  ];

  if (listsState.loading || productsState.loading || pricesState.loading)
    return (
      <div className={panelClass}>
        <LoadingState label="Cargando reglas comerciales…" />
      </div>
    );
  const mainError = listsState.error || productsState.error || pricesState.error;
  if (mainError)
    return (
      <div className={panelClass}>
        <ErrorState
          message={mainError}
          onRetry={() =>
            void Promise.all([listsState.reload(), productsState.reload(), pricesState.reload()])
          }
        />
      </div>
    );
  return (
    <>
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-artisan-line bg-white p-1.5 shadow-sm print:hidden">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold transition ${tab === item.id ? 'bg-wine text-white' : 'text-artisan-muted hover:bg-artisan-paper hover:text-wine'}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {message && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {tab === 'lists' && (
        <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
          <aside className={`${panelClass} overflow-hidden`}>
            <SectionTitle
              title="Listas"
              action={
                <button
                  type="button"
                  aria-label="Crear lista"
                  className="grid h-9 w-9 place-items-center rounded-xl bg-wine text-white"
                  onClick={() => openList()}
                >
                  <Plus className="h-4 w-4" />
                </button>
              }
            />
            {listsState.data.length ? (
              <div className="divide-y divide-artisan-line">
                {listsState.data.map((list) => (
                  <div
                    key={list.id}
                    className={`p-4 transition ${selectedId === list.id ? 'bg-wine/5' : 'hover:bg-artisan-cream'}`}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-2 text-left"
                      onClick={() => setSelectedId(list.id)}
                    >
                      <div>
                        <p className="font-bold text-artisan-ink">{list.name}</p>
                        <p className="mt-0.5 text-xs uppercase tracking-wide text-artisan-muted">
                          {list.code}
                        </p>
                      </div>
                      <StatusBadge
                        status={(list.is_active ?? list.active ?? true) ? 'active' : 'inactive'}
                      />
                    </button>
                    <div className="mt-3 flex gap-1">
                      <button
                        type="button"
                        className="grid h-8 w-8 place-items-center rounded-lg hover:bg-artisan-paper"
                        onClick={() => openList(list)}
                        aria-label="Editar lista"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        className="grid h-8 w-8 place-items-center rounded-lg hover:bg-artisan-paper"
                        onClick={() => void duplicateList(list)}
                        aria-label="Duplicar lista"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="grid h-8 w-8 place-items-center rounded-lg hover:bg-artisan-paper"
                        onClick={() => void toggleList(list)}
                        aria-label="Cambiar estado"
                      >
                        <Power className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Sin listas"
                description="Crea la lista pública para empezar."
                action={
                  <Button onClick={() => openList()}>
                    <Plus className="h-4 w-4" />
                    Crear lista
                  </Button>
                }
              />
            )}
          </aside>
          <section className={`${panelClass} overflow-hidden`}>
            <SectionTitle
              title={selectedList ? `Precios · ${selectedList.name}` : 'Precios por producto'}
              description="Los cambios se aplican al cálculo seguro del servidor; no alteran pedidos anteriores."
              action={
                <Button disabled={!selectedId || saving} onClick={() => void saveMatrix()}>
                  <Save className="h-4 w-4" />
                  {saving ? 'Guardando…' : 'Guardar precios'}
                </Button>
              }
            />
            <div className="border-b border-artisan-line p-4">
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder="Buscar producto o SKU…"
              />
            </div>
            {!selectedList ? (
              <EmptyState
                title="Selecciona una lista"
                description="Elige una lista para consultar y actualizar sus precios."
              />
            ) : filteredProducts.length ? (
              <div className="max-h-[680px] divide-y divide-artisan-line overflow-y-auto">
                {filteredProducts.map((product) => (
                  <label
                    key={product.id}
                    className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_180px] sm:items-center"
                  >
                    <div>
                      <p className="font-bold">{product.name}</p>
                      <p className="text-xs text-artisan-muted">
                        {product.sku} · Público {formatMoney(product.public_price)}
                      </p>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-artisan-muted">
                        $
                      </span>
                      <input
                        className={`${inputClass} pl-7 text-right font-black`}
                        type="number"
                        min="0"
                        step="50"
                        value={draftPrices[product.id] ?? ''}
                        onChange={(event) =>
                          setDraftPrices((current) => ({
                            ...current,
                            [product.id]: event.target.value,
                          }))
                        }
                        placeholder={String(toNumber(product.public_price))}
                        aria-label={`Precio de ${product.name}`}
                      />
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Sin productos"
                description="Agrega productos al catálogo antes de configurar la lista."
              />
            )}
          </section>
        </div>
      )}
      {tab === 'specials' && (
        <ResourceManager
          table="customer_product_prices"
          columns={specialColumns}
          fields={specialFields}
          createLabel="Nuevo precio especial"
          modalTitle="Precio especial"
          modalDescription="Esta regla tiene prioridad sobre la lista asignada al cliente."
          emptyTitle="Sin precios especiales"
          emptyDescription="Crea excepciones únicamente para acuerdos comerciales específicos."
          searchPlaceholder="Buscar cliente, producto o valor…"
          statusField="active"
          realtime
        />
      )}
      {tab === 'volume' && (
        <ResourceManager
          table="quantity_price_tiers"
          columns={tierColumns}
          fields={tierFields}
          createLabel="Nueva regla por volumen"
          modalTitle="Regla por volumen"
          modalDescription="Las reglas desactivadas quedan preparadas sin afectar el cálculo actual."
          emptyTitle="Sin reglas por volumen"
          emptyDescription="Configura rangos de cantidad cuando quieras habilitar esta modalidad."
          searchPlaceholder="Buscar lista, producto o cantidad…"
          statusField="active"
        />
      )}
      {tab === 'history' && (
        <div className={`${panelClass} overflow-hidden`}>
          <SectionTitle
            title="Historial de cambios"
            description="Trazabilidad de listas, precios y acuerdos especiales."
          />
          {historyState.loading ? (
            <LoadingState />
          ) : historyState.error ? (
            <ErrorState message={historyState.error} onRetry={() => void historyState.reload()} />
          ) : historyState.data.length ? (
            <div className="divide-y divide-artisan-line">
              {historyState.data
                .filter(
                  (entry) =>
                    !entry.entity_type ||
                    [
                      'price_lists',
                      'product_prices',
                      'customer_product_prices',
                      'quantity_price_tiers',
                    ].includes(entry.entity_type),
                )
                .map((entry) => (
                  <article key={entry.id} className="flex gap-3 p-5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-artisan-paper text-wine">
                      <History className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-bold capitalize">{entry.action.replaceAll('_', ' ')}</p>
                      <p className="text-sm text-artisan-muted">
                        {entry.entity_type?.replaceAll('_', ' ') || 'Configuración comercial'} ·{' '}
                        {formatAdminDate(entry.created_at, true)}
                      </p>
                    </div>
                  </article>
                ))}
            </div>
          ) : (
            <EmptyState
              title="Sin cambios registrados"
              description="Las modificaciones auditadas aparecerán aquí."
            />
          )}
        </div>
      )}
      <Modal
        open={listModal}
        title={editingList ? 'Editar lista de precios' : 'Nueva lista de precios'}
        description="Las listas usadas en pedidos se desactivan; nunca se eliminan físicamente."
        onClose={() => !saving && setListModal(false)}
      >
        <form onSubmit={saveList} className="space-y-4">
          <label>
            <span className={labelClass}>Nombre *</span>
            <input
              className={inputClass}
              required
              value={listForm.name}
              onChange={(event) =>
                setListForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label>
            <span className={labelClass}>Código *</span>
            <input
              className={inputClass}
              required
              value={listForm.code}
              onChange={(event) =>
                setListForm((current) => ({
                  ...current,
                  code: event.target.value.toUpperCase().replaceAll(' ', '_'),
                }))
              }
            />
          </label>
          <label>
            <span className={labelClass}>Descripción</span>
            <textarea
              className={`${inputClass} min-h-20`}
              value={listForm.description}
              onChange={(event) =>
                setListForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelClass}>Vigente desde</span>
              <input
                type="date"
                className={inputClass}
                value={listForm.valid_from}
                onChange={(event) =>
                  setListForm((current) => ({ ...current, valid_from: event.target.value }))
                }
              />
            </label>
            <label>
              <span className={labelClass}>Vigente hasta</span>
              <input
                type="date"
                min={listForm.valid_from}
                className={inputClass}
                value={listForm.valid_until}
                onChange={(event) =>
                  setListForm((current) => ({ ...current, valid_until: event.target.value }))
                }
              />
            </label>
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-artisan-line bg-white p-3">
            <input
              type="checkbox"
              className="h-4 w-4 accent-wine"
              checked={listForm.is_public}
              onChange={(event) =>
                setListForm((current) => ({ ...current, is_public: event.target.checked }))
              }
            />
            <span className="text-sm font-semibold">
              Lista pública predeterminada para clientes nuevos
            </span>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-artisan-line bg-white p-3">
            <input
              type="checkbox"
              className="h-4 w-4 accent-wine"
              checked={listForm.is_active}
              onChange={(event) =>
                setListForm((current) => ({ ...current, is_active: event.target.checked }))
              }
            />
            <span className="text-sm font-semibold">Lista activa</span>
          </label>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-artisan-line pt-4">
            <Button type="button" variant="secondary" onClick={() => setListModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              <Tags className="h-4 w-4" />
              {saving ? 'Guardando…' : 'Guardar lista'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
