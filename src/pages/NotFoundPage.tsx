import { Home, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="center-page">
      <SearchX />
      <h1>Esta página no existe</h1>
      <p>El enlace puede estar incompleto o haber cambiado.</p>
      <Link className="primary-button" to="/">
        <Home /> Volver al inicio
      </Link>
    </main>
  );
}
