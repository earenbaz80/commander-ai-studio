import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ProjectFile } from './ComposerPlayground';
import { 
  RotateCw, 
  Terminal, 
  Trash2, 
  AlertTriangle, 
  Code2
} from 'lucide-react';
import { Language } from '../i18n/translations';
import { DeviceSelect } from './preview/DeviceSelect';
import { DEFAULT_DEVICE_ID, findDevice } from '../data/previewDevices';

interface ComposerLiveSandboxProps {
  files: ProjectFile[];
  lang?: Language;
}

interface SandboxConsoleLog {
  id: string;
  type: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: string;
}

export const ComposerLiveSandbox: React.FC<ComposerLiveSandboxProps> = ({
  files,
  lang = 'es',
}) => {
  const [device, setDevice] = useState<string>(DEFAULT_DEVICE_ID);
  const [logs, setLogs] = useState<SandboxConsoleLog[]>([]);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Find relevant files
  const appFile = useMemo(() => {
    return (
      files.find((f) => f.name === 'src/App.tsx' || f.name === 'src/App.jsx' || f.name === 'src/App.js') ||
      files.find((f) => f.name.endsWith('.tsx') || f.name.endsWith('.jsx')) ||
      files[0]
    );
  }, [files]);

  const cssFile = useMemo(() => {
    return files.find((f) => f.name.endsWith('.css'));
  }, [files]);

  const getActiveCode = (file?: ProjectFile) => {
    if (!file) return '';
    return file.proposedContent !== undefined ? file.proposedContent : file.originalContent;
  };

  // Listen to sandbox messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.source === 'commander-sandbox') {
        const { type, message } = event.data;
        if (type === 'error') {
          setRuntimeError(message);
        }
        setLogs((prev) => [
          ...prev.slice(-100), // keep last 100 logs
          {
            id: Math.random().toString(),
            type: type || 'log',
            message: typeof message === 'object' ? JSON.stringify(message, null, 2) : String(message),
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Generate complete HTML bundle for the sandboxed iframe
  const bundleHtml = useMemo(() => {
    const rawCode = getActiveCode(appFile);
    const rawCss = getActiveCode(cssFile);

    // Clean import statements for browser-side Babel execution
    let cleanedCode = rawCode
      .replace(/import\s+React(?:\s*,\s*\{[^}]*\})?\s+from\s+['"][^'"]+['"];?/g, '')
      .replace(/import\s+.*?\s+from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+default\s+/g, 'window.__AppDefault = ')
      .replace(/export\s+function\s+App/g, 'function App')
      .replace(/export\s+const\s+App/g, 'const App');

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Commander Live Preview Sandbox</title>
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- React 18 UMD -->
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <!-- Babel Standalone for real in-browser JSX/TSX compilation -->
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #000080;
      color: #00ffff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    ${rawCss}
  </style>
</head>
<body>
  <div id="root"></div>

  <script>
    // Intercept console logs and errors to send to parent Commander Studio
    const sendLog = (type, message) => {
      try {
        window.parent.postMessage({
          source: 'commander-sandbox',
          type,
          message
        }, '*');
      } catch (e) {}
    };

    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    console.log = (...args) => {
      origLog(...args);
      sendLog('log', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };
    console.warn = (...args) => {
      origWarn(...args);
      sendLog('warn', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };
    console.error = (...args) => {
      origError(...args);
      sendLog('error', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };

    window.onerror = (msg, url, line, col, error) => {
      sendLog('error', msg + ' (línea ' + line + ')');
      return false;
    };
  </script>

  <script type="text/babel" data-presets="react,typescript">
    try {
      const { useState, useEffect, useMemo, useRef, useCallback } = React;
      
      ${cleanedCode}

      const TargetComponent = typeof App !== 'undefined' 
        ? App 
        : (window.__AppDefault || (() => React.createElement('div', { className: 'p-4 text-[var(--nc-text-accent)]' }, 'Componente App no exportado')));

      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(React.createElement(TargetComponent));
      sendLog('info', '✓ Renderizado de la aplicación montado con éxito.');
    } catch (err) {
      console.error('Error de ejecución en Sandbox: ' + err.message);
      document.getElementById('root').innerHTML = '<div style="color: #ff5555; padding: 16px; font-family: monospace;"><strong>Error de compilación / ejecución:</strong><br>' + err.message + '</div>';
    }
  </script>
</body>
</html>`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appFile, cssFile, reloadKey]);

  const handleRefresh = () => {
    setRuntimeError(null);
    setReloadKey((prev) => prev + 1);
  };

  const handleClearLogs = () => {
    setLogs([]);
    setRuntimeError(null);
  };

  // El viewport del iframe es el del aparato elegido, no el del panel: así las
  // media queries del CSS se comportan como en ese móvil o tablet de verdad.
  const viewport = findDevice(device);
  const frameStyle: React.CSSProperties =
    viewport.width > 0
      ? { width: viewport.width, height: viewport.height, flexShrink: 0 }
      : { width: '100%', height: '100%' };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--nc-bg-deep)] font-mono select-none overflow-hidden">
      {/* Sandbox Toolbar */}
      <div className="bg-[var(--nc-bg-main)] border-b-2 border-[var(--nc-border-light)] p-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <DeviceSelect value={viewport.id} onChange={setDevice} lang={lang} testId="sandbox-device" />

          <button
            type="button"
            onClick={handleRefresh}
            className="nc-button !py-1 !px-2 bg-[var(--nc-active-bg)] text-black hover:bg-white font-bold flex items-center gap-1 text-[11px]"
            title="Recargar y re-compilar sandbox"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>{lang === 'es' ? 'RECARGAR' : lang === 'de' ? 'NEU LADEN' : 'RELOAD'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1 text-[var(--nc-text-accent)]">
            <Code2 className="w-3.5 h-3.5" />
            <span>{appFile ? appFile.name : 'Sin archivo principal'}</span>
          </div>
          <span className="bg-[#004400] text-[var(--nc-success)] border border-[var(--nc-success)] px-1.5 py-0.5 text-[10px] font-bold">
            LIVE SANDBOX ACTIVO
          </span>
        </div>
      </div>

      {/* Main Sandbox Area & Bottom Console */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Sandbox Canvas Container */}
        <div className="flex-1 overflow-auto bg-[var(--nc-bg-deep)] flex p-2 min-h-0">
          <iframe
            key={reloadKey}
            ref={iframeRef}
            srcDoc={bundleHtml}
            sandbox="allow-scripts allow-modals"
            style={frameStyle}
            className="bg-[var(--nc-bg-panel)] border-4 border-[var(--nc-border-light)] rounded-lg shadow-[0_0_20px_rgba(0,255,255,0.35)] block m-auto"
            title="Commander Live Execution Sandbox"
          />
        </div>

        {/* Live Sandbox Console Drawer */}
        <div className="h-36 bg-[var(--nc-bg-deep)] border-t-2 border-[var(--nc-border-light)] flex flex-col shrink-0">
          <div className="bg-[var(--nc-bg-panel)] px-2 py-1 flex items-center justify-between border-b border-[var(--nc-border-mid)]">
            <div className="flex items-center gap-1.5 text-[var(--nc-text-accent)] text-[11px] font-bold">
              <Terminal className="w-3.5 h-3.5 text-[var(--nc-text)]" />
              <span>{lang === 'es' ? 'CONSOLA DE EJECUCIÓN EN VIVO (SANDBOX LOGS)' : lang === 'de' ? 'SANDBOX-AUSFÜHRUNGSKONSOLE' : 'SANDBOX EXECUTION CONSOLE'}</span>
              <span className="bg-[var(--nc-bg-main)] text-[var(--nc-text)] px-1 text-[9px] border border-[var(--nc-border-light)]">
                {logs.length} eventos
              </span>
            </div>
            <button
              type="button"
              onClick={handleClearLogs}
              className="text-[var(--nc-text)] hover:text-white p-0.5 text-[10px] flex items-center gap-1"
              title="Limpiar consola"
            >
              <Trash2 className="w-3 h-3" />
              <span>{lang === 'es' ? 'LIMPIAR' : lang === 'de' ? 'LEEREN' : 'CLEAR'}</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 space-y-1 font-mono text-[10px]">
            {runtimeError && (
              <div className="bg-[#440000] border border-red-500 text-red-200 p-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                <span className="font-bold">{runtimeError}</span>
              </div>
            )}
            {logs.length === 0 ? (
              <div className="text-[#5555aa] italic p-1">
                {lang === 'es' ? 'Esperando eventos o salidas de console.log()...' : lang === 'de' ? 'Warte auf console.log()-Ausgabe...' : 'Waiting for console.log() output...'}
              </div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className={`flex items-start gap-1.5 leading-tight ${
                    log.type === 'error'
                      ? 'text-red-400 bg-[#330000]'
                      : log.type === 'warn'
                      ? 'text-yellow-300'
                      : log.type === 'info'
                      ? 'text-[var(--nc-success)]'
                      : 'text-[var(--nc-text)]'
                  }`}
                >
                  <span className="text-[#888888] select-none shrink-0">[{log.timestamp}]</span>
                  <span className="shrink-0 font-bold">[{log.type.toUpperCase()}]:</span>
                  <span className="break-all whitespace-pre-wrap">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
