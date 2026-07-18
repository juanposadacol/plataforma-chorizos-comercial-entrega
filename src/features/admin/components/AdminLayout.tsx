import { useState } from 'react';
import { Bell, LogOut, Menu, Store } from 'lucide-react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';
import { signOutAdmin } from '../adminService';
import { useAdminData } from '../useAdminData';
import type { AdminNotification } from '../types';

export function AdminLayout() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const { data: notifications } = useAdminData<AdminNotification>(
    'notifications',
    { orderBy: 'created_at', limit: 50 },
    true,
  );
  const unread = notifications.filter(
    (item) => item.is_read !== true && !item.read_at && item.status !== 'read',
  ).length;

  const handleLogout = async () => {
    setSigningOut(true);
    setLogoutError(null);
    try {
      await signOutAdmin();
      navigate('/admin/login', { replace: true });
    } catch (caught) {
      setLogoutError(caught instanceof Error ? caught.message : 'No fue posible cerrar la sesión.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-artisan-cream text-artisan-ink lg:flex">
      <AdminSidebar
        open={menuOpen}
        collapsed={collapsed}
        onClose={() => setMenuOpen(false)}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
      />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-artisan-line bg-artisan-cream/95 px-4 backdrop-blur sm:px-6 lg:px-8 print:hidden">
          <button
            type="button"
            aria-label="Abrir menú"
            className="grid h-10 w-10 place-items-center rounded-xl border border-artisan-line bg-white text-wine shadow-sm lg:hidden"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link
            to="/"
            className="hidden items-center gap-2 text-sm font-bold text-artisan-muted transition hover:text-wine sm:flex"
          >
            <Store className="h-4 w-4" /> Ver tienda
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/admin/notificaciones"
              className="relative grid h-10 w-10 place-items-center rounded-xl border border-artisan-line bg-white text-artisan-muted hover:text-wine"
              aria-label={`${unread} notificaciones sin leer`}
            >
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-wine px-1 text-[10px] font-black text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
            <div className="hidden border-l border-artisan-line pl-3 sm:block">
              <p className="text-sm font-bold">Equipo administrativo</p>
              <p className="text-xs text-artisan-muted">Sesión protegida</p>
            </div>
            <button
              type="button"
              disabled={signingOut}
              onClick={handleLogout}
              className="grid h-10 w-10 place-items-center rounded-xl text-artisan-muted hover:bg-artisan-paper hover:text-wine"
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>
        {logoutError && (
          <div className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:mx-6 lg:mx-8">
            {logoutError}
          </div>
        )}
        <main className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
