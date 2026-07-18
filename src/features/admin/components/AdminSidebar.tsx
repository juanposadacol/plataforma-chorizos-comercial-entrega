import { ChevronLeft, PanelLeftClose, Store, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';
import { adminNavigation } from './adminNavigation';

export function AdminSidebar({
  open,
  collapsed,
  onClose,
  onToggleCollapsed,
}: {
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Cerrar menú"
          className="fixed inset-0 z-30 bg-artisan-ink/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex flex-col bg-wine-dark text-white shadow-2xl transition-all duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          collapsed ? 'lg:w-[84px]' : 'lg:w-72',
          open ? 'w-[min(88vw,320px)] translate-x-0' : 'w-[min(88vw,320px)] -translate-x-full',
        )}
      >
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-artisan-gold text-wine-dark shadow-lg">
            <Store className="h-6 w-6" />
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-bold">El Rey del Chorizo</p>
              <p className="text-xs text-white/60">Administración comercial</p>
            </div>
          )}
          <button
            type="button"
            aria-label="Cerrar menú"
            className="ml-auto grid h-9 w-9 place-items-center rounded-xl text-white/70 hover:bg-white/10 lg:hidden"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav
          className="flex-1 space-y-1 overflow-y-auto px-3 py-4"
          aria-label="Navegación administrativa"
        >
          {adminNavigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                clsx(
                  'group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                  isActive
                    ? 'bg-artisan-cream text-wine-dark shadow-sm'
                    : 'text-white/75 hover:bg-white/10 hover:text-white',
                  collapsed && 'lg:justify-center',
                )
              }
            >
              <Icon className="h-[19px] w-[19px] shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-white/10 p-3 lg:block">
          <button
            type="button"
            className={clsx(
              'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/10 hover:text-white',
              collapsed && 'justify-center',
            )}
            onClick={onToggleCollapsed}
          >
            {collapsed ? (
              <ChevronLeft className="h-5 w-5 rotate-180" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
            {!collapsed && <span>Contraer menú</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
