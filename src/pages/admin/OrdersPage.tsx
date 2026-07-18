import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { OrdersTable } from '../../features/admin/orders/OrdersTable';
import { PageHeader } from '../../features/admin/components/AdminUi';

export function OrdersPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operación"
        title="Pedidos"
        description="Confirma, prepara, despacha y entrega cada pedido sin perder su historial ni sus reservas de inventario."
        actions={
          <Link
            to="/"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-wine px-4 py-2 text-sm font-bold text-white transition hover:bg-wine-dark"
          >
            <ExternalLink className="h-4 w-4" />
            Crear pedido desde la tienda
          </Link>
        }
      />
      <OrdersTable />
    </>
  );
}

export default OrdersPage;
