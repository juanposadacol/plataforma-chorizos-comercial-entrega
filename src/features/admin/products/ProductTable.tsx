import type { AdminProduct } from '../types';
import { firstText, formatMoney, toNumber } from '../utils';
import { ResourceManager, type ResourceField } from '../components/ResourceManager';
import { StatusBadge, type TableColumn } from '../components/AdminUi';

export function ProductTable() {
  const fields: ResourceField[] = [
    { key: 'sku', label: 'SKU', required: true, placeholder: 'CHR-SR-001' },
    { key: 'name', label: 'Nombre', required: true, placeholder: 'Santa Rosano' },
    { key: 'slug', label: 'Slug', required: true, placeholder: 'santa-rosano' },
    { key: 'barcode', label: 'Código de barras' },
    { key: 'short_description', label: 'Descripción comercial', type: 'textarea', fullWidth: true },
    {
      key: 'public_price',
      label: 'Precio público',
      type: 'number',
      min: 0,
      step: 50,
      required: true,
    },
    {
      key: 'current_cost',
      label: 'Costo actual',
      type: 'number',
      min: 0,
      step: 50,
      required: true,
      help: 'El historial de pedidos conserva su costo original.',
    },
    { key: 'unit', label: 'Unidad', defaultValue: 'unidad', required: true },
    { key: 'presentation', label: 'Presentación', placeholder: 'Paquete x 5 unidades' },
    {
      key: 'minimum_stock',
      label: 'Stock mínimo',
      type: 'number',
      min: 0,
      step: 1,
      defaultValue: 5,
    },
    { key: 'image_url', label: 'URL de imagen principal', type: 'text', fullWidth: true },
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      defaultValue: 'active',
      required: true,
      options: [
        { value: 'active', label: 'Activo' },
        { value: 'inactive', label: 'Inactivo' },
      ],
    },
    { key: 'featured', label: 'Producto destacado', type: 'checkbox', defaultValue: false },
    {
      key: 'allow_backorder',
      label: 'Permitir venta sin stock',
      type: 'checkbox',
      defaultValue: false,
    },
  ];
  const columns: TableColumn<AdminProduct>[] = [
    {
      key: 'product',
      header: 'Producto',
      render: (product) => (
        <div className="flex items-center gap-3">
          {product.image_url ? (
            <img src={product.image_url} alt="" className="h-11 w-11 rounded-xl object-cover" />
          ) : (
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-artisan-paper font-display text-lg font-bold text-wine">
              {product.name.slice(0, 1)}
            </span>
          )}
          <div>
            <p className="font-bold">{product.name}</p>
            <p className="text-xs text-artisan-muted">{product.sku}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Precio público',
      render: (product) => <span className="font-black">{formatMoney(product.public_price)}</span>,
    },
    { key: 'cost', header: 'Costo', render: (product) => formatMoney(product.current_cost) },
    {
      key: 'stock',
      header: 'Disponible',
      render: (product) => {
        const stock =
          toNumber(product.stock_available ?? product.stock_on_hand ?? product.stock_current) -
          (product.stock_available == null ? toNumber(product.stock_reserved) : 0);
        const low = stock <= toNumber(product.minimum_stock);
        return (
          <div>
            <p className={low ? 'font-black text-red-700' : 'font-black text-emerald-700'}>
              {stock}
            </p>
            <p className="text-xs text-artisan-muted">mín. {toNumber(product.minimum_stock)}</p>
          </div>
        );
      },
    },
    {
      key: 'presentation',
      header: 'Presentación',
      render: (product) => firstText(product, 'presentation', 'unit') || '—',
    },
    {
      key: 'status',
      header: 'Estado',
      render: (product) => (
        <StatusBadge
          status={product.status ?? (product.active === false ? 'inactive' : 'active')}
        />
      ),
    },
  ];
  return (
    <ResourceManager
      table="products"
      columns={columns}
      fields={fields}
      createLabel="Nuevo producto"
      modalTitle="Producto"
      modalDescription="El stock se ajusta únicamente desde movimientos de inventario."
      emptyTitle="Aún no hay productos"
      emptyDescription="Agrega el catálogo para mostrarlo en la tienda y asignarle precios."
      searchPlaceholder="Buscar por nombre, SKU o presentación…"
      orderBy="name"
      statusField="status"
      activeValue="active"
      inactiveValue="inactive"
      realtime
    />
  );
}
