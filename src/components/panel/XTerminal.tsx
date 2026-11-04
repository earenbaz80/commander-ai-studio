import { deText } from '../../i18n/de';
/**
 * Terminal persistente real (P3) para el Workbench.
 *
 * A diferencia de `TerminalView` (que ejecuta comando por comando via
 * `shell.run`), aqui se abre una shell interactiva MANTENIDA viva mediante
 * un WebSocket contra `/ws/terminal` (backend Express). El cwd, variables de
 * entorno y programas interactivos (vim, REPLs...) persisten entre teclas.
 *
 * Frontend: xterm.js + FitAddon. Streaming bidireccional crudo.
 * Si el WebSocket no esta disponible (backend caido), muestra reintentar.
 *
 * Estilo retro Norton (fondo azul, texto cyan, acentos amarillos).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { Wifi, WifiOff, RefreshCw, Maximize2 } from 'lucide-react';
import { Language } from '../../i18n/translations';

interface XTerminalProps {
  projectPath?: string;
  lang?: Language;
}

type ConnState = 'connecting' | 'open' | 'closed' | 'error';

export const XTerminal: React.FC<XTerminalProps> = ({ projectPath = '', lang = 'es' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [nonce, setNonce] = useState(0); // para forzar reconexion
  // Shell elegida en la barra de estado; el servidor valida contra su lista
  // cerrada (`?shell=`), así que aquí sólo se ofrecen las soportadas.
  const shells = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent)
    ? ['cmd', 'powershell', 'pwsh']
    : ['bash', 'sh', 'zsh'];
  const [shell, setShell] = useState(() => {
    try {
      return window.localStorage.getItem('commander.terminal.shell') || shells[0];
    } catch {
      return shells[0];
    }
  });

  const t = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // --- Crea el terminal xterm con tema retro Norton ---
    const term = new Terminal({
      fontFamily: '"Courier New", ui-monospace, monospace',
      fontSize: 12,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      theme: {
        background: '#000d1a',
        foreground: '#00ffff',
        cursor: '#ffff55',
        selectionBackground: '#00ffff40',
        black: '#000000',
        red: '#ff5555',
        green: '#55ff55',
        yellow: '#ffff55',
        blue: '#5555ff',
        magenta: '#ff55ff',
        cyan: '#00ffff',
        white: '#ffffff',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      fit.fit();
    } catch {
      /* contenedor aun sin tamano */
    }
    term.focus();

    termRef.current = term;
    fitRef.current = fit;

    // --- Conecta al WebSocket de la terminal ---
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = proto + '//' + window.location.host + '/ws/terminal?shell=' + encodeURIComponent(shell);
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      setConn('error');
      return () => {
        term.dispose();
      };
    }
    wsRef.current = ws;
    setConn('connecting');

    const sendResize = (cols: number, rows: number) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    };

    ws.onopen = () => {
      setConn('open');
      const dir = projectPath || '.';
      term.write('\x1b[32mOK ' + t('Conectado', 'Connected') + '\x1b[0m\r\n');
      term.write(t('directorio', 'directory') + ': ' + dir + '\r\n');
      sendResize(term.cols, term.rows);
    };

    ws.onmessage = (e) => {
      const data = e.data;
      if (typeof data === 'string') term.write(data);
      else if (data instanceof Blob) data.text().then((txt) => term.write(txt));
    };

    ws.onerror = () => {
      setConn('error');
      term.write('\r\n\x1b[31m[' + t('error de conexion', 'connection error') + ']\x1b[0m\r\n');
    };

    ws.onclose = () => {
      setConn('closed');
      term.write('\r\n\x1b[33m[' + t('desconectado', 'disconnected') + ']\x1b[0m\r\n');
    };

    // --- Entrada del teclado -> WS ---
    const onData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    // --- Resize del terminal -> WS (best-effort COLUMNS/LINES) ---
    const onResize = term.onResize(({ cols, rows }) => {
      sendResize(cols, rows);
    });

    // --- Ajuste al contenedor con ResizeObserver ---
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignorar */
      }
    });
    ro.observe(container);

    return () => {
      onData.dispose();
      onResize.dispose();
      ro.disconnect();
      try {
        ws.close();
      } catch {
        /* ignorar */
      }
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, nonce, shell]);

  const reconnect = () => {
    setConn('connecting');
    setNonce((n) => n + 1);
  };

  const statusColor =
    conn === 'open' ? 'text-[var(--nc-success)]' : conn === 'error' ? 'text-[var(--nc-danger)]' : 'text-[var(--nc-text-accent)]';
  const statusText =
    conn === 'open'
      ? t('conectado', 'connected')
      : conn === 'connecting'
        ? t('conectando...', 'connecting...')
        : conn === 'error'
          ? t('error', 'error')
          : t('desconectado', 'disconnected');

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--nc-bg-deep)]">
      {/* Barra de estado */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] shrink-0 text-[10px] font-mono">
        {conn === 'open' ? (
          <Wifi className="w-3 h-3 text-[var(--nc-success)]" />
        ) : (
          <WifiOff className="w-3 h-3 text-[#ff9966]" />
        )}
        <span className={'font-bold uppercase ' + statusColor}>{statusText}</span>
        {projectPath && (
          <span className="text-[var(--nc-text)]/40 truncate ml-2" title={projectPath}>
            {projectPath}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <select
            value={shell}
            onChange={(e) => {
              const nueva = e.target.value;
              setShell(nueva);
              try {
                window.localStorage.setItem('commander.terminal.shell', nueva);
              } catch {
                /* sin almacenamiento: la elección dura la sesión */
              }
            }}
            className="bg-[var(--nc-bg-deep)] text-[var(--nc-text)] border border-[var(--nc-border-dark)] text-[10px] font-mono px-1 py-0.5 rounded"
            title={t('Shell de esta terminal', 'Shell for this terminal')}
          >
            {shells.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={() => fitRef.current?.fit()}
            className="p-1 text-[var(--nc-text)]/70 hover:text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded"
            title={t('Ajustar tamano', 'Fit to size')}
          >
            <Maximize2 className="w-3 h-3" />
          </button>
          <button
            onClick={reconnect}
            className="p-1 text-[var(--nc-text)]/70 hover:text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded"
            title={t('Reconectar', 'Reconnect')}
          >
            <RefreshCw className={'w-3 h-3 ' + (conn === 'connecting' ? 'animate-spin' : '')} />
          </button>
        </div>
      </div>

      {/* Contenedor de xterm */}
      <div ref={containerRef} className="flex-1 min-h-0 p-1" onClick={() => termRef.current?.focus()} />

      {conn === 'error' && (
        <div className="px-2 py-1 text-[9px] text-[#ff9966] bg-[#330000]/40 border-t border-[var(--nc-danger)]/30">
          {t(
            'No se pudo conectar al backend de terminal. Esta corriendo el servidor Express (puerto 3000)?',
            'Could not reach the terminal backend. Is the Express server (port 3000) running?'
          )}
        </div>
      )}
    </div>
  );
};

export default XTerminal;
