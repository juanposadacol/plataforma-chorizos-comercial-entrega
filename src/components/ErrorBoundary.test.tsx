// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ErrorBoundary } from './ErrorBoundary';

// Vitest here doesn't run with `globals: true`, so Testing Library's automatic
// afterEach(cleanup) detection doesn't kick in — register it explicitly so each
// `it()` starts from an empty DOM instead of accumulating renders.
afterEach(cleanup);

function Boom(): never {
  throw new Error('boom — technical detail that must never reach the user');
}

describe('ErrorBoundary — H-14: ninguna ruta pública debe quedar en blanco', () => {
  it('muestra una interfaz de recuperación en vez de una pantalla en blanco', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Ocurrió un error inesperado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('nunca muestra el mensaje técnico del error al usuario', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.queryByText(/boom — technical detail/i)).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it('ofrece una acción de salida segura configurable (ruta pública → volver a la tienda)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary backHref="/" backLabel="Volver a la tienda">
        <Boom />
      </ErrorBoundary>,
    );
    const link = screen.getByRole('link', { name: 'Volver a la tienda' });
    expect(link).toHaveAttribute('href', '/');
    spy.mockRestore();
  });

  it('conserva el destino por defecto del panel admin cuando no se pasan props', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const link = screen.getByRole('link', { name: 'Volver a pedidos' });
    expect(link).toHaveAttribute('href', '/admin/pedidos');
    spy.mockRestore();
  });

  it('sin error, renderiza los hijos normalmente', () => {
    render(
      <ErrorBoundary>
        <p>Contenido normal</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Contenido normal')).toBeInTheDocument();
  });

  it('"Reintentar" permite recuperarse sin recargar la página', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    function MaybeBoom() {
      if (shouldThrow) throw new Error('boom');
      return <p>Recuperado</p>;
    }
    const { rerender } = render(
      <ErrorBoundary>
        <MaybeBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Ocurrió un error inesperado')).toBeInTheDocument();
    shouldThrow = false;
    screen.getByRole('button', { name: /reintentar/i }).click();
    rerender(
      <ErrorBoundary>
        <MaybeBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Recuperado')).toBeInTheDocument();
    spy.mockRestore();
  });
});
