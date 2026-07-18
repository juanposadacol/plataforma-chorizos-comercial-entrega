import { Link } from 'react-router-dom';
import type { Customer, PriceList } from '../types';
import { formatAdminDate, formatMoney, firstText, toNumber } from '../utils';
import { useAdminData } from '../useAdminData';
import { ResourceManager, type ResourceField } from '../components/ResourceManager';
import { StatusBadge, type TableColumn } from '../components/AdminUi';

export function CustomerTable() {
  const { data: priceLists } = useAdminData<PriceList>('price_lists', {
    orderBy: 'name',
    ascending: true,
    limit: 100,
  });
  const fields: ResourceField[] = [
    {
      key: 'full_name',
      label: 'Nombre completo',
      required: true,
      placeholder: 'Nombre o razón social',
    },
    { key: 'phone', label: 'Celular', type: 'tel', required: true, placeholder: '300 000 0000' },
    { key: 'whatsapp', label: 'WhatsApp', type: 'tel', placeholder: 'Si es diferente al celular' },
    { key: 'email', label: 'Correo', type: 'email', placeholder: 'cliente@correo.com' },
    {
      key: 'document_type',
      label: 'Tipo de documento',
      type: 'select',
      options: [
        { value: 'CC', label: 'Cédula' },
        { value: 'NIT', label: 'NIT' },
        { value: 'CE', label: 'Cédula de extranjería' },
        { value: 'other', label: 'Otro' },
      ],
    },
    { key: 'document_number', label: 'Número de documento' },
    { key: 'address', label: 'Dirección principal', fullWidth: true },
    { key: 'neighborhood', label: 'Barrio' },
    { key: 'municipality', label: 'Municipio' },
    {
      key: 'price_list_id',
      label: 'Lista de precios',
      type: 'select',
      required: true,
      options: priceLists.map((list) => ({ value: list.id, label: list.name })),
    },
    {
      key: 'classification',
      label: 'Clasificación',
      type: 'select',
      defaultValue: 'new',
      options: [
        { value: 'new', label: 'Nuevo' },
        { value: 'public', label: 'Público' },
        { value: 'recurring', label: 'Recurrente' },
        { value: 'wholesale', label: 'Mayorista' },
        { value: 'distributor', label: 'Distribuidor' },
        { value: 'vip', label: 'VIP' },
        { value: 'inactive', label: 'Inactivo' },
        { value: 'delinquent', label: 'Moroso' },
      ],
    },
    {
      key: 'payment_terms',
      label: 'Condición de pago',
      type: 'select',
      defaultValue: 'cash',
      options: [
        { value: 'cash', label: 'Contado' },
        { value: 'credit', label: 'Crédito' },
      ],
    },
    {
      key: 'credit_limit',
      label: 'Cupo de crédito',
      type: 'number',
      min: 0,
      step: 1000,
      defaultValue: 0,
    },
    {
      key: 'credit_days',
      label: 'Días de crédito',
      type: 'number',
      min: 0,
      step: 1,
      defaultValue: 0,
    },
    { key: 'notes', label: 'Observaciones', type: 'textarea', fullWidth: true },
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      defaultValue: 'active',
      required: true,
      options: [
        { value: 'active', label: 'Activo' },
        { value: 'inactive', label: 'Inactivo' },
        { value: 'blocked', label: 'Bloqueado' },
      ],
    },
  ];
  const columns: TableColumn<Customer>[] = [
    {
      key: 'customer',
      header: 'Cliente',
      render: (customer) => (
        <div>
          <Link
            to={`/admin/clientes/${customer.id}`}
            className="font-bold text-wine hover:underline"
          >
            {firstText(customer, 'full_name', 'name') || 'Sin nombre'}
          </Link>
          <p className="text-xs text-artisan-muted">{customer.phone}</p>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Ubicación',
      render: (customer) => (
        <div>
          <p>{customer.municipality || '—'}</p>
          <p className="text-xs text-artisan-muted">
            {customer.neighborhood || customer.address || ''}
          </p>
        </div>
      ),
    },
    {
      key: 'classification',
      header: 'Clasificación',
      render: (customer) => (
        <span className="capitalize">
          {(customer.classification ?? 'público').replaceAll('_', ' ')}
        </span>
      ),
    },
    {
      key: 'balance',
      header: 'Saldo',
      render: (customer) => (
        <span
          className={
            toNumber(customer.outstanding_balance) > 0
              ? 'font-black text-wine'
              : 'text-artisan-muted'
          }
        >
          {formatMoney(customer.outstanding_balance)}
        </span>
      ),
    },
    {
      key: 'lastPurchase',
      header: 'Última compra',
      render: (customer) => formatAdminDate(customer.last_purchase_at),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (customer) => (
        <StatusBadge
          status={customer.status ?? (customer.active === false ? 'inactive' : 'active')}
        />
      ),
    },
  ];
  return (
    <ResourceManager
      table="customers"
      columns={columns}
      fields={fields}
      createLabel="Nuevo cliente"
      modalTitle="Cliente"
      modalDescription="La lista de precios solo puede asignarse desde administración."
      emptyTitle="Aún no hay clientes"
      emptyDescription="Los compradores nuevos se registrarán aquí al guardar su primer pedido."
      searchPlaceholder="Buscar por nombre, documento o celular…"
      statusField="status"
      activeValue="active"
      inactiveValue="inactive"
      realtime
    />
  );
}
