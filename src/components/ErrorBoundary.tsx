import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Título del estado de error. Por defecto, el mensaje genérico del panel admin. */
  title?: string;
  /**
   * Texto de ayuda mostrado al usuario. Nunca se muestra `error.message` ni
   * ningún detalle técnico — solo este texto fijo, comprensible en español.
   */
  description?: string;
  /** Destino del enlace de salida segura (p. ej. "/" en la tienda, "/admin/pedidos" en el panel). */
  backHref?: string;
  /** Texto del enlace de salida segura. */
  backLabel?: string;
}

interface State {
  hasError: boolean;
}

/**
 * Límite de error de React (H-14). No muestra stack traces ni el mensaje técnico
 * del error al usuario final — siempre un texto fijo en español, con una acción
 * para reintentar (reset local) y una acción segura de salida (navegación real,
 * para garantizar un árbol limpio incluso si el error dejó estado inconsistente).
 * El detalle técnico solo se registra en consola en desarrollo (`import.meta.env.DEV`).
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const {
        title = 'Ocurrió un error inesperado',
        description = 'Algo no salió como esperábamos. Puedes intentarlo de nuevo o volver a un lugar seguro.',
        backHref = '/admin/pedidos',
        backLabel = 'Volver a pedidos',
      } = this.props;
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-red-100 text-red-700">
            <AlertCircle className="h-7 w-7" />
          </span>
          <div>
            <h2 className="font-display text-2xl font-bold text-artisan-ink">{title}</h2>
            <p className="mt-2 max-w-md text-sm text-artisan-muted">{description}</p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 rounded-xl bg-wine px-5 py-2.5 text-sm font-bold text-white hover:bg-wine-dark"
            >
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </button>
            <a
              href={backHref}
              className="inline-flex items-center gap-2 rounded-xl border border-artisan-line bg-white px-5 py-2.5 text-sm font-bold text-artisan-ink hover:bg-artisan-paper"
            >
              {backLabel}
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
