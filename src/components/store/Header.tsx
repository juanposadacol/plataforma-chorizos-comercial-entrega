import { LogOut, Menu, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';

interface HeaderProps {
  businessName: string;
}

/**
 * El comprador no inicia sesión: se identifica escribiendo su celular en el
 * checkout. Por eso el menú solo ofrece la tienda; "Administración" y "Salir"
 * aparecen únicamente cuando hay una sesión del personal.
 */
export function Header({ businessName }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const { user, access, signOut } = useAuth();
  return (
    <header className="topbar">
      <Link className="brand" to="/" aria-label={`${businessName}, inicio`}>
        <span className="brand-mark" aria-hidden="true">
          CA
        </span>
        <span>
          <strong>{businessName}</strong>
          <small>Pedidos artesanales y seguros</small>
        </span>
      </Link>
      <button
        className="icon-button mobile-nav-button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={open}
      >
        {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>
      <nav
        className={open ? 'main-nav main-nav--open' : 'main-nav'}
        aria-label="Navegación principal"
      >
        <NavLink to="/" onClick={() => setOpen(false)}>
          Tienda
        </NavLink>
        {access.isStaff && (
          <NavLink to="/admin" onClick={() => setOpen(false)}>
            <ShieldCheck aria-hidden="true" /> Administración
          </NavLink>
        )}
        {user && (
          <button className="nav-auth" onClick={() => void signOut()}>
            <LogOut aria-hidden="true" /> Salir
          </button>
        )}
      </nav>
    </header>
  );
}
