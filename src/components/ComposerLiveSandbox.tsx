import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ProjectFile } from './ComposerPlayground';
import { 
  RotateCw, 
  Monitor, 
  Tablet, 
  Smartphone, 
  Terminal, 
  Trash2, 
  AlertTriangle, 
  Code2
} from 'lucide-react';
import { Language } from '../i18n/translations';

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
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
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
        : (window.__AppDefault || (() => React.createElement('div', { className: 'p-4 text-[#ffff55]' }, 'Componente App no exportado')));

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
  }, [appFile, cssFile, reloadKey]);

  const handleRefresh = () => {
    setRuntimeError(null);
    setReloadKey((prev) => prev + 1);
  };

  const handleClearLogs = () => {
    setLogs([]);
    setRuntimeError(null);
  };

  // Device width constraints
  const getDeviceStyle = () => {
    switch (device) {
      case 'mobile':
        return 'w-[375px] h-[667px] shadow-[0px_0px_20px_rgba(0,255,255,0.4)] border-4 border-[#00ffff] rounded-lg';
      case 'tablet':
        return 'w-[768px] h-[1024px] max-h-full shadow-[0px_0px_20px_rgba(0,255,255,0.4)] border-4 border-[#00ffff] rounded-lg';
      default:
        return 'w-full h-full border-2 border-[#00ffff]';
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#000055] font-mono select-none overflow-hidden">
      {/* Sandbox Toolbar */}
      <div className="bg-[#0000aa] border-b-2 border-[#00ffff] p-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[#000080] p-0.5 border border-[#00ffff]">
            <button
              type="button"
              onClick={() => setDevice('desktop')}
              className={`p-1 text-xs font-bold flex items-center gap-1 ${
                device === 'desktop' ? 'bg-[#00ffff] text-black' : 'text-[#00ffff] hover:bg-[#000055]'
              }`}
              title="Vista de Escritorio (100%)"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Desktop</span>
            </button>
            <button
              type="button"
              onClick={() => setDevice('tablet')}
              className={`p-1 text-xs font-bold flex items-center gap-1 ${
                device === 'tablet' ? 'bg-[#00ffff] text-black' : 'text-[#00ffff] hover:bg-[#000055]'
              }`}
              title="Vista de Tablet (768px)"
            >
              <Tablet className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tablet</span>
            </button>
            <button
              type="button"
              onClick={() => setDevice('mobile')}
              className={`p-1 text-xs font-bold flex items-center gap-1 ${
                device === 'mobile' ? 'bg-[#00ffff] text-black' : 'text-[#00ffff] hover:bg-[#000055]'
              }`}
              title="Vista de Móvil (375px)"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Mobile</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            className="nc-button !py-1 !px-2 bg-[#ffff55] text-black hover:bg-white font-bold flex items-center gap-1 text-[11px]"
            title="Recargar y re-compilar sandbox"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>{lang === 'es' ? 'RECARGAR' : lang === 'de' ? 'NEU LADEN' : 'RELOAD'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1 text-[#ffff55]">
            <Code2 className="w-3.5 h-3.5" />
            <span>{appFile ? appFile.name : 'Sin archivo principal'}</span>
          </div>
          <span className="bg-[#004400] text-[#55ff55] border border-[#55ff55] px-1.5 py-0.5 text-[10px] font-bold">
            LIVE SANDBOX ACTIVO
          </span>
        </div>
      </div>

      {/* Main Sandbox Area & Bottom Console */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Sandbox Canvas Container */}
        <div className="flex-1 overflow-auto bg-[#000033] flex items-center justify-center p-2 min-h-0">
          <iframe
            key={reloadKey}
            ref={iframeRef}
            srcDoc={bundleHtml}
            sandbox="allow-scripts allow-modals"
            className={`bg-[#000080] transition-all duration-200 ${getDeviceStyle()}`}
            title="Commander Live Execution Sandbox"
          />
        </div>

        {/* Live Sandbox Console Drawer */}
        <div className="h-36 bg-[#000022] border-t-2 border-[#00ffff] flex flex-col shrink-0">
          <div className="bg-[#000080] px-2 py-1 flex items-center justify-between border-b border-[#00aaaa]">
            <div className="flex items-center gap-1.5 text-[#ffff55] text-[11px] font-bold">
              <Terminal className="w-3.5 h-3.5 text-[#00ffff]" />
              <span>{lang === 'es' ? 'CONSOLA DE EJECUCIÓN EN VIVO (SANDBOX LOGS)' : lang === 'de' ? 'SANDBOX-AUSFÜHRUNGSKONSOLE' : 'SANDBOX EXECUTION CONSOLE'}</span>
              <span className="bg-[#0000aa] text-[#00ffff] px-1 text-[9px] border border-[#00ffff]">
                {logs.length} eventos
              </span>
            </div>
            <button
              type="button"
              onClick={handleClearLogs}
              className="text-[#a8c7fa] hover:text-white p-0.5 text-[10px] flex items-center gap-1"
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
                      ? 'text-[#55ff55]'
                      : 'text-[#00ffff]'
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
