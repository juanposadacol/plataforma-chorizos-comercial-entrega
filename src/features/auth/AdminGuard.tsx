import { LoaderCircle, ShieldAlert } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function AdminGuard() {
  const { user, loading, access } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <main className="center-page">
        <LoaderCircle className="animate-spin" />
        <h1>Verificando acceso</h1>
      </main>
    );
  if (!user) return <Navigate to="/admin/acceso" replace state={{ from: location.pathname }} />;
  if (user.user_metadata?.must_change_password === true) {
    return <Navigate to="/admin/acceso?mode=first-login" replace />;
  }
  if (!access.isStaff)
    return (
      <main className="center-page">
        <ShieldAlert />
        <h1>Acceso restringido</h1>
        <p>Tu cuenta de cliente no tiene permisos administrativos.</p>
        <a className="primary-button" href="/">
          Volver a la tienda
        </a>
      </main>
    );
  return <Outlet />;
}
