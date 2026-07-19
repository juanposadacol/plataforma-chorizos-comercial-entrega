import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoadingState } from './components/ui/AsyncState';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AdminGuard } from './features/auth/AdminGuard';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { CustomerOrdersPage } from './pages/CustomerOrdersPage';
import { LegalPage } from './pages/LegalPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderConfirmationPage } from './pages/OrderConfirmationPage';
import { OrderTrackingPage } from './pages/OrderTrackingPage';
import { StorefrontPage } from './pages/StorefrontPage';

const AdminLayout = lazy(() =>
  import('./features/admin/components/AdminLayout').then((m) => ({ default: m.AdminLayout })),
);
const AdminDashboardPage = lazy(() =>
  import('./pages/admin/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })),
);
const OrdersPage = lazy(() =>
  import('./pages/admin/OrdersPage').then((m) => ({ default: m.OrdersPage })),
);
const OrderDetailPage = lazy(() =>
  import('./pages/admin/OrderDetailPage').then((m) => ({ default: m.OrderDetailPage })),
);
const CustomersPage = lazy(() =>
  import('./pages/admin/CustomersPage').then((m) => ({ default: m.CustomersPage })),
);
const CustomerDetailPage = lazy(() =>
  import('./pages/admin/CustomerDetailPage').then((m) => ({ default: m.CustomerDetailPage })),
);
const ProductsPage = lazy(() =>
  import('./pages/admin/ProductsPage').then((m) => ({ default: m.ProductsPage })),
);
const PricingPage = lazy(() =>
  import('./pages/admin/PricingPage').then((m) => ({ default: m.PricingPage })),
);
const InventoryPage = lazy(() =>
  import('./pages/admin/InventoryPage').then((m) => ({ default: m.InventoryPage })),
);
const PurchasesPage = lazy(() =>
  import('./pages/admin/PurchasesPage').then((m) => ({ default: m.PurchasesPage })),
);
const SuppliersPage = lazy(() =>
  import('./pages/admin/SuppliersPage').then((m) => ({ default: m.SuppliersPage })),
);
const PaymentsPage = lazy(() =>
  import('./pages/admin/PaymentsPage').then((m) => ({ default: m.PaymentsPage })),
);
const ExpensesPage = lazy(() =>
  import('./pages/admin/ExpensesPage').then((m) => ({ default: m.ExpensesPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/admin/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const UsersPage = lazy(() =>
  import('./pages/admin/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const NotificationsPage = lazy(() =>
  import('./pages/admin/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

export function App() {
  return (
    <Suspense
      fallback={
        <main className="content-page">
          <LoadingState label="Abriendo módulo…" />
        </main>
      }
    >
      <Routes>
        <Route path="/" element={<StorefrontPage />} />
        <Route path="/pedido-confirmado" element={<OrderConfirmationPage />} />
        <Route path="/seguir" element={<OrderTrackingPage />} />
        <Route path="/seguir/:token" element={<OrderTrackingPage />} />
        <Route path="/mis-pedidos" element={<CustomerOrdersPage />} />
        <Route path="/privacidad" element={<LegalPage />} />
        <Route path="/terminos" element={<LegalPage />} />
        <Route path="/admin/acceso" element={<AdminLoginPage />} />
        <Route path="/admin/login" element={<Navigate to="/admin/acceso" replace />} />
        <Route element={<AdminGuard />}>
          <Route path="/admin" element={<ErrorBoundary><AdminLayout /></ErrorBoundary>}>
            <Route index element={<AdminDashboardPage />} />
            <Route path="pedidos" element={<OrdersPage />} />
            <Route path="pedidos/:id" element={<OrderDetailPage />} />
            <Route path="clientes" element={<CustomersPage />} />
            <Route path="clientes/:id" element={<CustomerDetailPage />} />
            <Route path="productos" element={<ProductsPage />} />
            <Route path="precios" element={<PricingPage />} />
            <Route path="inventario" element={<InventoryPage />} />
            <Route path="compras" element={<PurchasesPage />} />
            <Route path="proveedores" element={<SuppliersPage />} />
            <Route path="pagos" element={<PaymentsPage />} />
            <Route path="gastos" element={<ExpensesPage />} />
            <Route path="reportes" element={<ReportsPage />} />
            <Route path="usuarios" element={<UsersPage />} />
            <Route path="notificaciones" element={<NotificationsPage />} />
            <Route path="configuracion" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
