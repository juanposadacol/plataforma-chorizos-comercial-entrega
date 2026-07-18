import type { Supplier } from '../../features/admin/types';
import { formatMoney, firstText } from '../../features/admin/utils';
import {
  ResourceManager,
  type ResourceField,
} from '../../features/admin/components/ResourceManager';
import { PageHeader, StatusBadge, type TableColumn } from '../../features/admin/components/AdminUi';

export function SuppliersPage() {
  const fields: ResourceField[] = [
    { key: 'name', label: 'Nombre o razón social', required: true },
    { key: 'tax_id', label: 'Documento o NIT' },
    { key: 'contact_name', label: 'Persona de contacto' },
    { key: 'phone', label: 'Teléfono', type: 'tel' },
    { key: 'email', label: 'Correo', type: 'email' },
    { key: 'address', label: 'Dirección', fullWidth: true },
    {
      key: 'payment_terms',
      label: 'Condición de pago',
      type: 'select',
      defaultValue: 'cash',
      options: [
        { value: 'cash', label: 'Contado' },
        { value: 'credit', label: 'Crédito' },
        { value: 'mixed', label: 'Mixto' },
      ],
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
      ],
    },
  ];
  const columns: TableColumn<Supplier>[] = [
    {
      key: 'supplier',
      header: 'Proveedor',
      render: (supplier) => (
        <div>
          <p className="font-bold">{supplier.name}</p>
          <p className="text-xs text-artisan-muted">{firstText(supplier, 'tax_id') || 'Sin NIT'}</p>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contacto',
      render: (supplier) => (
        <div>
          <p>{supplier.contact_name || '—'}</p>
          <p className="text-xs text-artisan-muted">{supplier.phone || supplier.email || ''}</p>
        </div>
      ),
    },
    {
      key: 'terms',
      header: 'Condición',
      render: (supplier) => (
        <span className="capitalize">
          {supplier.payment_terms || 'Contado'}
          {supplier.credit_days ? ` · ${supplier.credit_days} días` : ''}
        </span>
      ),
    },
    {
      key: 'balance',
      header: 'Saldo',
      render: (supplier) => (
        <span className="font-black text-wine">{formatMoney(supplier.balance)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (supplier) => (
        <StatusBadge
          status={
            (supplier as Supplier & { status?: string }).status ??
            (supplier.active === false ? 'inactive' : 'active')
          }
        />
      ),
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="Abastecimiento"
        title="Proveedores"
        description="Administra contactos, condiciones de pago y saldos para mantener trazabilidad de cada compra."
      />
      <ResourceManager
        table="suppliers"
        columns={columns}
        fields={fields}
        createLabel="Nuevo proveedor"
        modalTitle="Proveedor"
        emptyTitle="Aún no hay proveedores"
        emptyDescription="Registra el primer proveedor antes de crear una compra."
        searchPlaceholder="Buscar por nombre, NIT, contacto o teléfono…"
        orderBy="name"
        statusField="status"
        activeValue="active"
        inactiveValue="inactive"
      />
    </>
  );
}
export default SuppliersPage;
