import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Play, 
  RotateCw, 
  Monitor, 
  Tablet, 
  Smartphone, 
  ExternalLink, 
  Copy, 
  Check, 
  Terminal, 
  FileCode,
  Download
} from 'lucide-react';
import { Language } from '../i18n/translations';

export interface ChatCodeSnippet {
  id: string;
  code: string;
  language: string;
  sourceMessageId?: string;
  sourceRole?: string;
  title?: string;
}

interface ChatLiveAppViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  snippets: ChatCodeSnippet[];
  initialSnippetIndex?: number;
  onSendToComposer?: (code: string, language: string) => void;
  lang?: Language;
}

interface ConsoleMessage {
  id: string;
  type: 'log' | 'warn' | 'error' | 'info';
  message: string;
  time: string;
}

export const ChatLiveAppViewerModal: React.FC<ChatLiveAppViewerModalProps> = ({
  isOpen,
  onClose,
  snippets,
  initialSnippetIndex = 0,
  onSendToComposer,
  lang = 'es',
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialSnippetIndex);
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [reloadKey, setReloadKey] = useState(0);
  const [logs, setLogs] = useState<ConsoleMessage[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCurrentIndex(initialSnippetIndex);
  }, [initialSnippetIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Listen to sandbox messages from the iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.source === 'commander-chat-sandbox') {
        const { type, message } = event.data;
        setLogs((prev) => [
          ...prev.slice(-100),
          {
            id: Math.random().toString(),
            type: type || 'log',
            message: typeof message === 'object' ? JSON.stringify(message, null, 2) : String(message),
            time: new Date().toLocaleTimeString(),
          },
        ]);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const activeSnippet = snippets[currentIndex] || snippets[0];

  // Synthesize running HTML document
  const bundledHtml = useMemo(() => {
    if (!activeSnippet) return '';
    let code = (activeSnippet.code || '').trim();
    const rawLang = (activeSnippet.language || 'html').toLowerCase();

    // Strip wrapping markdown code fences if present
    if (code.startsWith('```')) {
      code = code.replace(/^```[a-zA-Z0-9_\-+]*\r?\n/, '').replace(/\r?\n```$/, '').trim();
    }

    // Interceptor to capture console logs, polyfill storage, and display in modal console
    const interceptorScript = `
<script>
  (function() {
    try {
      if (!window.localStorage) {
        window.localStorage = { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {}, clear: function() {} };
      }
    } catch(e) {
      try {
        Object.defineProperty(window, 'localStorage', {
          value: { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {}, clear: function() {} },
          writable: true
        });
      } catch(err) {}
    }

    function send(type, args) {
      try {
        var str = Array.from(args).map(function(a) {
          if (a === null) return 'null';
          if (a === undefined) return 'undefined';
          if (typeof a === 'object') {
            try { return JSON.stringify(a); } catch(e) { return String(a); }
          }
          return String(a);
        }).join(' ');
        window.parent.postMessage({
          source: 'commander-chat-sandbox',
          type: type,
          message: str
        }, '*');
      } catch(e) {}
    }

    var origL = console.log, origW = console.warn, origE = console.error;
    console.log = function() { origL.apply(console, arguments); send('log', arguments); };
    console.warn = function() { origW.apply(console, arguments); send('warn', arguments); };
    console.error = function() { origE.apply(console, arguments); send('error', arguments); };

    window.addEventListener('error', function(e) {
      if (e && e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
        console.warn('[Live Viewer]: Resource notice for:', e.target.src || e.target.href);
        e.stopPropagation();
      }
    }, true);

    window.onerror = function(msg, url, line, col, err) {
      var msgStr = String(msg || '');
      // Suppress cross-origin "Script error." which browsers generate for external CDNs (Tailwind, Babel, fonts)
      if (msgStr.indexOf('Script error') !== -1 || (!line && !col && !url)) {
        console.warn('[Live Viewer]: Cross-origin script event intercepted:', msgStr);
        return true;
      }
      send('error', [msgStr + (line ? ' (Línea ' + line + ')' : '')]);
      var errEl = document.getElementById('commander-err-banner');
      if (!errEl && document.body) {
        errEl = document.createElement('div');
        errEl.id = 'commander-err-banner';
        errEl.style = 'position:fixed;bottom:10px;left:10px;right:10px;background:#990000;color:#ffff55;border:2px solid #ffff55;padding:10px 14px;font-family:monospace;font-size:12px;z-index:999999;box-shadow:0 4px 16px rgba(0,0,0,0.8);border-radius:4px;display:flex;justify-content:space-between;align-items:center;';
        document.body.appendChild(errEl);
      }
      if (errEl) {
        errEl.innerHTML = '<div style="flex:1;">⚠️ <strong>Error en Ejecución:</strong> ' + msgStr + (line ? ' (Línea ' + line + ')' : '') + '</div><button onclick="this.parentElement.remove()" style="background:#ffff55;color:#000;border:none;padding:4px 8px;font-weight:bold;cursor:pointer;margin-left:8px;font-family:monospace;font-size:11px;">CERRAR ✕</button>';
      }
      return false;
    };

    window.onunhandledrejection = function(e) {
      console.warn('[Live Viewer Unhandled Rejection]:', e.reason);
      send('warn', ['Promesa no manejada: ' + (e.reason ? (e.reason.message || e.reason) : '')]);
    };
  })();
</script>`;

    // 1. Direct Complete HTML document
    if (code.includes('<!DOCTYPE') || code.includes('<html') || code.includes('<body')) {
      if (code.includes('<head>')) {
        return code.replace('<head>', '<head>' + interceptorScript);
      }
      return interceptorScript + code;
    }

    // 2. SVG Vector Graphic
    if (rawLang === 'svg' || code.trim().startsWith('<svg')) {
      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${interceptorScript}
  <style>
    body { margin: 0; padding: 24px; background: #0b0c10; display: flex; justify-content: center; align-items: center; min-height: 80vh; }
    svg { max-width: 100%; max-height: 80vh; filter: drop-shadow(0 0 12px rgba(0,255,255,0.3)); }
  </style>
</head>
<body>
  ${code}
</body>
</html>`;
    }

    // 3. React / JSX / TSX Component
    const isReact = rawLang.includes('react') || rawLang.includes('jsx') || rawLang.includes('tsx') || 
                    code.includes('import React') || code.includes('function App') || code.includes('const App') ||
                    code.includes('useState') || code.includes('useEffect') || code.includes('return (') ||
                    /function\s+[A-Z]/.test(code) || /const\s+[A-Z][a-zA-Z0-9_]*\s*=\s*\(/.test(code);

    if (isReact) {
      // Clean imports and exports
      let cleaned = code
        .replace(/import\s+React(?:\s*,\s*\{[^}]*\})?\s+from\s+['"][^'"]+['"];?/g, '')
        .replace(/import\s+.*?from\s+['"][^'"]+['"];?/g, '')
        .replace(/export\s+default\s+function\s+([A-Za-z0-9_]+)/g, 'function $1\nwindow.__AppDefault = $1;')
        .replace(/export\s+default\s+const\s+([A-Za-z0-9_]+)/g, 'const $1')
        .replace(/export\s+default\s+([A-Za-z0-9_]+);?/g, 'window.__AppDefault = $1;')
        .replace(/export\s+default\s+/g, 'window.__AppDefault = ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+const\s+/g, 'const ');

      // Find all component function names declared
      const declaredComponents: string[] = [];
      const funcMatches = code.matchAll(/(?:function|const)\s+([A-Z][a-zA-Z0-9_]*)/g);
      for (const m of funcMatches) {
        if (!['React', 'ReactDOM', 'Babel'].includes(m[1])) {
          declaredComponents.push(m[1]);
        }
      }

      // Extract all JSX capitalized tag names (e.g. <Filter, <Shield, <Badge) to auto-polyfill missing icons/components
      const jsxTagMatches = Array.from(code.matchAll(/<([A-Z][a-zA-Z0-9_]*)/g)).map(m => m[1]);
      const uniqueTags = Array.from(new Set(jsxTagMatches)).filter(t => !['React', 'Fragment', 'App'].includes(t));

      return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Commander Live Preview</title>
  ${interceptorScript}
  <script src="https://cdn.tailwindcss.com" crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js" crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js" crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.24.7/babel.min.js" crossorigin="anonymous"></script>
  <style>
    body { margin: 0; padding: 0; background-color: #0f1015; color: #f0f2f5; font-family: system-ui, -apple-system, sans-serif; min-height: 100vh; }
    #root { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root">
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#00ffff;background:#000044;">
      <div>⏳ Cargando aplicación React y compilando componentes...</div>
    </div>
  </div>

  <script>
    // Universal Lucide icon generator so ANY icon component in JSX works smoothly
    (function() {
      function makeIcon(name) {
        return function(props) {
          props = props || {};
          var size = props.size || props.width || 20;
          var color = props.color || 'currentColor';
          var strokeWidth = props.strokeWidth || 2;
          var n = (name || '').toLowerCase();
          var path = "M12 2v20M2 12h20";
          if (n.indexOf('play') !== -1) path = "M5 3l14 9-14 9V3z";
          else if (n.indexOf('search') !== -1) path = "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z";
          else if (n.indexOf('check') !== -1) path = "M20 6L9 17l-5-5";
          else if (n.indexOf('x') !== -1 || n.indexOf('close') !== -1) path = "M18 6L6 18M6 6l12 12";
          else if (n.indexOf('trash') !== -1) path = "M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2";
          else if (n.indexOf('heart') !== -1) path = "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z";
          else if (n.indexOf('sparkl') !== -1 || n.indexOf('star') !== -1) path = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";
          else if (n.indexOf('user') !== -1) path = "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z";
          else if (n.indexOf('settings') !== -1) path = "M12 15a3 3 0 100-6 3 3 0 000 6zm7.4 1.5l-1.5-2.6 1-1.7-1.4-1.4-1.7 1-2.6-1.5V8.5h-2v1.8l-2.6 1.5-1.7-1-1.4 1.4 1 1.7-1.5 2.6H4.5v2h1.8l1.5 2.6-1 1.7 1.4 1.4 1.7-1 2.6 1.5v1.8h2v-1.8l2.6-1.5 1.7 1 1.4-1.4-1-1.7 1.5-2.6h1.8v-2h-1.8z";
          else if (n.indexOf('arrow') !== -1 && n.indexOf('right') !== -1) path = "M5 12h14M12 5l7 7-7 7";
          else if (n.indexOf('arrow') !== -1 && n.indexOf('left') !== -1) path = "M19 12H5M12 19l-7-7 7-7";
          else if (n.indexOf('refresh') !== -1 || n.indexOf('reload') !== -1) path = "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15";
          else if (n.indexOf('copy') !== -1) path = "M8 4v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2h-8a2 2 0 00-2 2z M16 20v2a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h2";
          else if (n.indexOf('moon') !== -1) path = "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z";
          else if (n.indexOf('sun') !== -1) path = "M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42M12 17a5 5 0 100-10 5 5 0 000 10z";
          else if (n.indexOf('plus') !== -1) path = "M12 5v14M5 12h14";
          else if (n.indexOf('minus') !== -1) path = "M5 12h14";

          return React.createElement('svg', {
            xmlns: 'http://www.w3.org/2000/svg',
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: n.indexOf('play') !== -1 ? color : 'none',
            stroke: color,
            strokeWidth: strokeWidth,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            className: (props.className || '') + ' inline-block align-middle',
            style: props.style
          }, React.createElement('path', { d: path }));
        };
      }

      var icons = ['Play','Pause','Search','Heart','Star','Trash','Trash2','Plus','Minus','Check','CheckCheck','X','RefreshCw','RotateCw','Edit','Edit3','Copy','Volume2','VolumeX','Mic','MicOff','User','Settings','Globe','Terminal','Code','Code2','ArrowRight','ArrowLeft','ArrowUp','ArrowDown','ChevronDown','ChevronUp','ChevronRight','ChevronLeft','Menu','Moon','Sun','ShoppingCart','Download','Upload','AlertCircle','Info','HelpCircle','Layers','ExternalLink','Sparkles','Eye','EyeOff','Home','Folder','File','FileText','Send','Share','Bell','Lock','Unlock','Key','Cpu','Zap','MessageSquare','MessageCircle','Paperclip','Smile','Bookmark','Maximize','Minimize'];
      var dynamicTags = ${JSON.stringify(uniqueTags)};
      dynamicTags.forEach(function(tag) {
        if (icons.indexOf(tag) === -1) icons.push(tag);
      });
      icons.forEach(function(name) {
        window[name] = makeIcon(name);
      });
    })();
  </script>

  <script type="text/babel" data-presets="react,typescript">
    (function() {
      try {
        const { useState, useEffect, useMemo, useRef, useCallback, useContext, createContext } = React;
        
        ${cleaned}

        let TargetComponent = null;
        if (typeof App !== 'undefined') {
          TargetComponent = App;
        } else if (window.__AppDefault) {
          TargetComponent = window.__AppDefault;
        } else {
          // Discover by detected function components
          ${declaredComponents.map(n => `if (!TargetComponent && typeof ${n} !== 'undefined') TargetComponent = ${n};`).join('\n          ')}
        }

        if (!TargetComponent) {
          // Fallback discovery: any function starting with uppercase letter
          const keys = Object.keys(window).filter(k => /^[A-Z]/.test(k) && typeof window[k] === 'function');
          for (let i = keys.length - 1; i >= 0; i--) {
            if (!['React', 'ReactDOM', 'Babel'].includes(keys[i])) {
              TargetComponent = window[keys[i]];
              break;
            }
          }
        }

        const rootEl = document.getElementById('root');
        if (TargetComponent && rootEl) {
          const root = ReactDOM.createRoot(rootEl);
          root.render(React.createElement(TargetComponent));
        } else if (rootEl) {
          rootEl.innerHTML = '<div style="color:#ffff55;padding:24px;font-family:monospace;background:#000080;border:2px solid #00ffff;margin:20px;">' +
            '<h3>⚠️ Componente React detectado</h3>' +
            '<p>Se compiló el código React. Si no se visualiza la interfaz principal, asegúrate de nombrar la función principal como <code>App</code>.</p>' +
            '</div>';
        }
      } catch (err) {
        console.error('Error al ejecutar componente React:', err);
        const rootEl = document.getElementById('root');
        if (rootEl) {
          rootEl.innerHTML = '<div style="color:#ff6b6b;padding:24px;font-family:monospace;background:#1a1a24;border:2px solid #ff6b6b;margin:20px;">' +
            '<h3 style="margin-top:0;">⚠️ Error en Componente React:</h3>' +
            '<pre style="white-space:pre-wrap;color:#ff9999;">' + err.message + '</pre>' +
            '</div>';
        }
      }
    })();
  </script>
</body>
</html>`;
    }

    // 4. Vanilla HTML + CSS + JS snippet
    const isHtmlBlock = code.includes('<div') || code.includes('<h1') || code.includes('<p') || 
                        code.includes('<button') || code.includes('<style') || code.includes('<canvas') ||
                        code.includes('<table') || code.includes('<form') || code.includes('<span');

    const htmlBodyContent = isHtmlBlock 
      ? code 
      : `<div id="app" class="p-4"><div class="text-[#ffff55] font-mono text-sm">▶ Script ejecutado: Revisa los logs en la consola inferior</div></div><script>${code}</script>`;

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${interceptorScript}
  <script src="https://cdn.tailwindcss.com" crossorigin="anonymous"></script>
  <style>
    body { background-color: #0e0f14; color: #e3e2e6; font-family: system-ui, sans-serif; padding: 16px; margin: 0; }
  </style>
</head>
<body>
  ${htmlBodyContent}
</body>
</html>`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSnippet, reloadKey]);

  if (!isOpen) return null;

  const handleCopyCode = () => {
    if (!activeSnippet) return;
    navigator.clipboard.writeText(activeSnippet.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInNewWindow = () => {
    // El HTML generado nunca se abre como documento de primer nivel (compartiría origen con la app):
    // se muestra dentro de un iframe sandboxed.
    const escaped = bundledHtml.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const wrapper = `<!DOCTYPE html><html><body style="margin:0"><iframe sandbox="allow-scripts allow-forms allow-modals" srcdoc="${escaped}" style="border:0;width:100vw;height:100vh"></iframe></body></html>`;
    const blob = new Blob([wrapper], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const handleDownloadHtml = () => {
    const blob = new Blob([bundledHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSnippet?.title || 'commander-app'}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getDeviceStyle = () => {
    switch (device) {
      case 'mobile':
        return 'w-[390px] h-[780px] max-h-[82vh] border-4 border-[#00ffff] rounded-2xl shadow-[0_0_25px_rgba(0,255,255,0.4)] my-auto';
      case 'tablet':
        return 'w-[768px] h-[950px] max-h-[84vh] border-4 border-[#00ffff] rounded-xl shadow-[0_0_25px_rgba(0,255,255,0.4)] my-auto';
      default:
        return 'w-full h-full border border-[#00ffff]/40';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex flex-col p-2 sm:p-4 font-mono select-none">
      {/* Modal Main Frame */}
      <div className="nc-panel flex-1 flex flex-col bg-[#000080] border-2 border-[#00ffff] shadow-[12px_12px_0px_#000055] overflow-hidden">
        
        {/* Top Retro Norton Title Bar */}
        <div className="nc-header px-3 py-1.5 flex items-center justify-between border-b-2 border-black shrink-0">
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4 text-black fill-black" />
            <span className="font-bold text-black text-xs sm:text-sm tracking-wider uppercase">
              {lang === 'es' ? 'VISOR DE APP EN VIVO • EJECUCIÓN DIRECTA DEL CHAT' : lang === 'de' ? 'LIVE-APP-VIEWER • ECHTZEIT-RUNNER' : 'LIVE APP VIEWER • REALTIME RUNNER'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setReloadKey((prev) => prev + 1)}
              className="nc-button !px-2 !py-0.5 text-xs bg-[#00aaaa] text-black font-bold flex items-center gap-1 hover:bg-[#00ffff]"
              title={lang === 'es' ? "Reiniciar / Recargar App" : lang === 'de' ? 'App neu laden' : "Reload App"}
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{lang === 'es' ? 'Recargar' : lang === 'de' ? 'Neu laden' : 'Reload'}</span>
            </button>

            <button
              type="button"
              onClick={handleOpenInNewWindow}
              className="nc-button !px-2 !py-0.5 text-xs bg-[#0000aa] text-[#00ffff] font-bold flex items-center gap-1 hover:bg-[#0000ff]"
              title={lang === 'es' ? "Abrir en Pestaña / Ventana Externa" : lang === 'de' ? 'In neuem Fenster öffnen' : "Open in new window"}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{lang === 'es' ? 'Pestaña' : lang === 'de' ? 'Neuer Tab' : 'New Tab'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="nc-button !px-2.5 !py-0.5 text-xs bg-red-600 text-white font-bold hover:bg-red-500 ml-1"
              title="Cerrar Visor (ESC)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Subbar: Device Switcher & Snippet Selector */}
        <div className="bg-[#0000aa] border-b-2 border-[#00ffff] px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0 text-white text-xs">
          {/* Device Responsive Controls */}
          <div className="flex items-center gap-1 bg-[#000080] p-0.5 border border-[#00ffff]">
            <button
              type="button"
              onClick={() => setDevice('desktop')}
              className={`px-2 py-0.5 font-bold flex items-center gap-1 text-xs ${
                device === 'desktop' ? 'bg-[#00ffff] text-black' : 'text-[#00ffff] hover:bg-[#0000aa]'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Desktop</span>
            </button>
            <button
              type="button"
              onClick={() => setDevice('tablet')}
              className={`px-2 py-0.5 font-bold flex items-center gap-1 text-xs ${
                device === 'tablet' ? 'bg-[#00ffff] text-black' : 'text-[#00ffff] hover:bg-[#0000aa]'
              }`}
            >
              <Tablet className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tablet (768px)</span>
            </button>
            <button
              type="button"
              onClick={() => setDevice('mobile')}
              className={`px-2 py-0.5 font-bold flex items-center gap-1 text-xs ${
                device === 'mobile' ? 'bg-[#00ffff] text-black' : 'text-[#00ffff] hover:bg-[#0000aa]'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Móvil (390px)</span>
            </button>
          </div>

          {/* Snippet Tabs Selector (if chat produced multiple snippets) */}
          {snippets.length > 1 && (
            <div className="flex items-center gap-1 overflow-x-auto max-w-md py-0.5">
              <span className="text-[11px] text-[#ffff55] font-bold shrink-0">
                {lang === 'es' ? 'Archivos / Snippets:' : lang === 'de' ? 'Snippets:' : 'Snippets:'}
              </span>
              {snippets.map((snip, idx) => (
                <button
                  key={snip.id || idx}
                  type="button"
                  onClick={() => {
                    setCurrentIndex(idx);
                    setReloadKey((prev) => prev + 1);
                  }}
                  className={`px-2 py-0.5 text-[11px] border truncate max-w-[140px] font-bold ${
                    currentIndex === idx 
                      ? 'bg-[#ffff55] text-black border-white' 
                      : 'bg-[#000080] text-[#00ffff] border-[#00ffff]/40 hover:border-[#00ffff]'
                  }`}
                  title={snip.title || `Código ${idx + 1}`}
                >
                  {snip.title || `Snippet #${idx + 1} (${snip.language})`}
                </button>
              ))}
            </div>
          )}

          {/* Secondary Actions */}
          <div className="flex items-center gap-1.5 ml-auto">
            {onSendToComposer && activeSnippet && (
              <button
                type="button"
                onClick={() => onSendToComposer(activeSnippet.code, activeSnippet.language)}
                className="nc-button !px-2 !py-0.5 text-xs bg-[#00aaaa] text-black hover:bg-[#00ffff] font-bold flex items-center gap-1"
                title="Editar este código en el editor multi-archivo Commander Composer"
              >
                <FileCode className="w-3.5 h-3.5" />
                <span className="hidden md:inline">{lang === 'es' ? 'Abrir en Composer' : lang === 'de' ? 'Composer' : 'Composer'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDownloadHtml}
              className="nc-button !px-2 !py-0.5 text-xs bg-[#000080] text-[#00ffff] hover:text-white font-bold flex items-center gap-1 border-[#00ffff]"
              title="Descargar archivo HTML autónomo"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{lang === 'es' ? 'Descargar' : lang === 'de' ? 'Exportieren' : 'Export'}</span>
            </button>

            <button
              type="button"
              onClick={handleCopyCode}
              className="nc-button !px-2 !py-0.5 text-xs bg-[#000080] text-[#00ffff] font-bold flex items-center gap-1 border-[#00ffff]"
              title="Copiar código fuente"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? (lang === 'es' ? 'Copiado' : lang === 'de' ? 'Kopiert' : 'Copied') : (lang === 'es' ? 'Copiar' : lang === 'de' ? 'Kopieren' : 'Copy')}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowConsole(!showConsole)}
              className={`nc-button !px-2 !py-0.5 text-xs flex items-center gap-1 ${
                showConsole ? 'nc-active' : 'bg-[#000080] text-[#ffff55]'
              }`}
              title="Mostrar u ocultar consola de ejecución"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Consola ({logs.length})</span>
            </button>
          </div>
        </div>

        {/* Viewport & Sandbox Container */}
        <div className="flex-1 min-h-0 bg-[#000044] flex flex-col items-center justify-center p-2 sm:p-4 overflow-hidden relative">
          <iframe
            key={reloadKey}
            srcDoc={bundledHtml}
            sandbox="allow-scripts allow-forms allow-modals"
            title="Chat Live Sandbox"
            className={`bg-white transition-all duration-200 ${getDeviceStyle()}`}
          />
        </div>

        {/* Bottom Expandable Sandbox Console Drawer */}
        {showConsole && (
          <div className="h-44 shrink-0 bg-[#000033] border-t-2 border-[#00ffff] flex flex-col font-mono text-xs">
            <div className="bg-[#0000aa] px-3 py-1 flex items-center justify-between text-[#ffff55] font-bold border-b border-black">
              <div className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#00ffff]" />
                <span>CONSOLA DEL VISOR EN VIVO ({logs.length} EVENTOS)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLogs([])}
                  className="text-[10px] text-red-300 hover:text-white"
                >
                  [LIMPIAR CONSOLA]
                </button>
                <button
                  type="button"
                  onClick={() => setShowConsole(false)}
                  className="text-[10px] text-[#00ffff] hover:text-white"
                >
                  [OCULTAR ▲]
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-black/60 text-[11px]">
              {logs.length === 0 ? (
                <div className="text-gray-400 italic p-2">
                  No hay mensajes de consola. Los logs de <code>console.log()</code> y errores de la app se mostrarán aquí.
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2 leading-relaxed font-mono">
                    <span className="text-gray-500 shrink-0 text-[10px]">{log.time}</span>
                    <span
                      className={`font-bold shrink-0 text-[10px] uppercase px-1 rounded ${
                        log.type === 'error'
                          ? 'bg-red-900 text-red-200'
                          : log.type === 'warn'
                          ? 'bg-yellow-900 text-yellow-200'
                          : 'bg-blue-900 text-cyan-200'
                      }`}
                    >
                      {log.type}
                    </span>
                    <span
                      className={`break-all ${
                        log.type === 'error'
                          ? 'text-red-400 font-bold'
                          : log.type === 'warn'
                          ? 'text-yellow-300'
                          : 'text-gray-200'
                      }`}
                    >
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
