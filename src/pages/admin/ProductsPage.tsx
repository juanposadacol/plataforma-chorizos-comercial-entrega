import { ProductTable } from '../../features/admin/products/ProductTable';
import { PageHeader } from '../../features/admin/components/AdminUi';

export function ProductsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Catálogo"
        title="Productos"
        description="Gestiona la oferta comercial, precios públicos, costos, imágenes y mínimos de inventario."
      />
      <ProductTable />
    </>
  );
}
export default ProductsPage;
