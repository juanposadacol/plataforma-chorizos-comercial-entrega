import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-red-100 text-red-700">
            <AlertCircle className="h-7 w-7" />
          </span>
          <div>
            <h2 className="font-display text-2xl font-bold text-artisan-ink">
              Ocurrió un error inesperado
            </h2>
            <p className="mt-2 max-w-md text-sm text-artisan-muted">
              {this.state.error.message || 'El módulo encontró un problema al renderizarse.'}
            </p>
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
              href="/admin/pedidos"
              className="inline-flex items-center gap-2 rounded-xl border border-artisan-line bg-white px-5 py-2.5 text-sm font-bold text-artisan-ink hover:bg-artisan-paper"
            >
              Volver a pedidos
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
