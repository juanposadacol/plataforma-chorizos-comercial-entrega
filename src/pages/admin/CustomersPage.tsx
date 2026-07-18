import { CustomerTable } from '../../features/admin/customers/CustomerTable';
import { PageHeader } from '../../features/admin/components/AdminUi';

export function CustomersPage() {
  return (
    <>
      <PageHeader
        eyebrow="Relaciones comerciales"
        title="Clientes"
        description="Administra datos, clasificación, cupo y lista de precios sin exponer condiciones comerciales al comprador."
      />
      <CustomerTable />
    </>
  );
}
export default CustomersPage;
