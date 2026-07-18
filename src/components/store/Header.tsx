import { LogIn, LogOut, Menu, PackageSearch, ShieldCheck, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';

interface HeaderProps {
  businessName: string;
  onLogin: () => void;
}

export function Header({ businessName, onLogin }: HeaderProps) {
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
        <NavLink to="/seguir" onClick={() => setOpen(false)}>
          <PackageSearch aria-hidden="true" /> Seguir pedido
        </NavLink>
        {user && (
          <NavLink to="/mis-pedidos" onClick={() => setOpen(false)}>
            <UserRound aria-hidden="true" /> Mis pedidos
          </NavLink>
        )}
        {access.isStaff && (
          <NavLink to="/admin" onClick={() => setOpen(false)}>
            <ShieldCheck aria-hidden="true" /> Administración
          </NavLink>
        )}
        {user ? (
          <button className="nav-auth" onClick={() => void signOut()}>
            <LogOut aria-hidden="true" /> Salir
          </button>
        ) : (
          <button className="nav-auth" onClick={onLogin}>
            <LogIn aria-hidden="true" /> Soy cliente
          </button>
        )}
      </nav>
    </header>
  );
}
