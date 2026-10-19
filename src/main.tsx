import { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ChatStoreProvider } from './stores/chatStore';
import { UIStoreProvider } from './stores/uiStore';
import './index.css';
import { registerServiceWorker } from './serviceWorkerRegistration';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Commander AI Studio Crash]:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-[#000080] text-white font-mono p-8 flex flex-col justify-center items-center select-none z-50">
          <div className="max-w-xl w-full bg-[#0000aa] border-4 border-[#ff5555] p-6 shadow-2xl space-y-4">
            <div className="bg-[#aa0000] text-white text-center font-bold py-1 px-3 uppercase tracking-wider text-sm">
              *** ERROR CRÍTICO DEL SISTEMA (EXCEPTION CAUGHT) ***
            </div>
            <p className="text-xs text-[#ffff55] leading-relaxed">
              Ocurrió un error inesperado al renderizar la interfaz de Commander AI Studio:
            </p>
            <div className="bg-black/60 border border-[#ff5555]/50 p-3 text-[11px] text-[#ffaaaa] overflow-x-auto max-h-48 whitespace-pre-wrap font-mono">
              {this.state.error?.message || 'Error desconocido'}
              {'\n\n'}
              {this.state.error?.stack}
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  try {
                    localStorage.removeItem('ai_studio_selected_model');
                    localStorage.removeItem('ai_studio_theme');
                  } catch {}
                  window.location.reload();
                }}
                className="flex-1 bg-[#ff5555] hover:bg-white text-black font-bold py-2 text-xs uppercase transition-colors"
              >
                Limpiar Caché y Reiniciar
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-[#00ffff] hover:bg-white text-black font-bold py-2 text-xs uppercase transition-colors"
              >
                Reintentar Carga
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ChatStoreProvider>
      <UIStoreProvider>
        <App />
      </UIStoreProvider>
    </ChatStoreProvider>
  </ErrorBoundary>
);

// Register Service Worker for offline core assets and UI templates
registerServiceWorker();
