import React, { useState, useEffect, useRef } from 'react';
import type { ParameterConfig } from '../types/studio';
import { useBrowserSessionFeed } from '../hooks/useBrowserSessionFeed';
import type { BrowserConsoleEntry, BrowserNetworkEntry } from '../utils/browserSessionApi';
import type { Language } from '../i18n/translations';
import { deText } from '../i18n/de';

/**
 * Vistas del banco de trabajo: preview, consola y monitor de red.
 *
 * El preview sigue siendo la vista rápida de un HTML/URL. La consola y la red
 * ya no simulan nada: leen los eventos de la sesión real de Playwright que
 * comparten el agente y el panel Navegador.
 */

const PREVIEW_EMPTY_HINT = 'Enter a URL or load local HTML';

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function consoleLevel(type: string): 'log' | 'error' | 'warn' | 'info' {
  if (type === 'error' || type === 'pageerror') return 'error';
  if (type === 'warning' || type === 'warn') return 'warn';
  if (type === 'info') return 'info';
  return 'log';
}

export const LivePreview: React.FC<{
  projectPath: string;
  selectedModel: string;
  parameters: ParameterConfig;
}> = () => {
  const [previewUrl, setPreviewUrl] = useState<string>('http://localhost:3001');
  const [, setIsLoading] = useState(false);
  const [previewContent] = useState<string>('');
  const [mode, setMode] = useState<'iframe' | 'local'>('iframe');
  const reloadKey = useRef(0);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center gap-2 p-2 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)]">
        <span className="text-[10px] font-mono text-[var(--nc-text)] flex-1 truncate">{mode === 'iframe' ? 'Iframe Preview' : 'Local HTML Preview'}</span>
        <input
          type="text"
          value={previewUrl}
          onChange={(e) => setPreviewUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setMode('iframe')}
          placeholder="http://localhost:3001"
          className="flex-1 bg-[var(--nc-bg-deep)] text-[10px] font-mono text-[var(--nc-text)] px-2 py-1 rounded border border-[var(--nc-border-dark)] outline-none focus:border-[var(--nc-border-light)]"
        />
        <button
          onClick={() => { setMode(mode === 'iframe' ? 'local' : 'iframe'); reloadKey.current += 1; }}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded"
          title={mode === 'iframe' ? 'Switch to Local HTML' : 'Switch to Iframe'}
        >
          {mode === 'iframe' ? '📁' : '🌐'}
        </button>
        <button
          onClick={() => { reloadKey.current += 1; }}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded"
          title="Reload"
        >
          ↻
        </button>
      </div>
      <div className="flex-1 relative bg-white">
        {mode === 'local' && previewContent ? (
          <iframe
            key={`local-${reloadKey.current}`}
            srcDoc={previewContent}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            className="w-full h-full border-0 bg-white"
          />
        ) : previewUrl ? (
          <iframe
            key={`iframe-${previewUrl}-${reloadKey.current}`}
            src={previewUrl}
            className="w-full h-full border-0 bg-white"
            onLoad={() => setIsLoading(false)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-4 text-[var(--nc-text)]/50">
            <span className="text-[11px] font-mono">{PREVIEW_EMPTY_HINT}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export const LiveConsole: React.FC<{
  projectPath: string;
  selectedModel: string;
  lang?: Language;
}> = ({ projectPath, lang = 'es' }) => {
  const L = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);
  const { session, consoleEntries, connected, loading, error, clearLogs } = useBrowserSessionFeed(projectPath);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof logsEndRef.current?.scrollIntoView === 'function') {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleEntries]);

  const typeClasses: Record<'log' | 'error' | 'warn' | 'info', string> = {
    log: 'text-[var(--nc-text)]',
    error: 'text-[var(--nc-danger)]',
    warn: 'text-[var(--nc-text-accent)]',
    info: 'text-emerald-300',
  };

  const connectionLabel = loading ? 'Conectando…' : error ? error : connected ? 'En vivo' : session ? 'Reconectando…' : 'Sin sesión';

  return (
    <div className="flex flex-col h-full bg-[var(--nc-bg-panel)]">
      <div className="flex items-center gap-2 p-2 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)]">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : session ? 'bg-[var(--nc-text-accent)]' : 'bg-[var(--nc-danger)]'}`} />
        <span className="text-[10px] font-mono text-[var(--nc-text)]">
          {session ? `Live Console · ${session.id}` : 'Live Console'}
        </span>
        <span className="text-[9px] font-mono text-[var(--nc-text)]/50">{connectionLabel}</span>
        <div className="flex-1" />
        <button
          onClick={clearLogs}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded text-[10px]"
          title={L('Limpiar consola', 'Clear console')}
        >
          🗑
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[10px]">
        {consoleEntries.length === 0 ? (
          <div className="text-center text-[var(--nc-text)]/40 py-8">
            {session ? 'No hay mensajes de consola todavía.' : 'Abre el panel Navegador para iniciar una sesión.'}
          </div>
        ) : (
          consoleEntries.map((entry: BrowserConsoleEntry) => {
            const level = consoleLevel(entry.type);
            return (
              <div key={entry.seq} className="flex gap-2 text-[var(--nc-text)]">
                <span className="shrink-0 text-[var(--nc-text)]/50">{timeOf(entry.ts)}</span>
                <span className={`shrink-0 ${typeClasses[level]}`}>
                  {level === 'error' ? '✗' : level === 'warn' ? '⚠' : level === 'info' ? 'ℹ' : '▶'}
                </span>
                <span className={`whitespace-pre-wrap break-words ${typeClasses[level]}`}>
                  {entry.text}
                  {entry.url ? <span className="ml-1 text-[var(--nc-text)]/40">{entry.url}{entry.line ? `:${entry.line}` : ''}</span> : null}
                </span>
              </div>
            );
          })
        )}
        <div ref={logsEndRef} />
      </div>

      <div className="px-2 py-1 border-t border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] text-[9px] font-mono text-[var(--nc-text)]/40">
        {L('Eventos reales de Playwright · sólo lectura', 'Real Playwright events · read only')}
      </div>
    </div>
  );
};

export const NetworkMonitor: React.FC<{ projectPath: string; lang?: Language }> = ({
  projectPath,
  lang = 'es',
}) => {
  const L = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);
  const { session, networkEntries, connected, loading, error, clearLogs } = useBrowserSessionFeed(projectPath);
  const [filter, setFilter] = useState<'all' | 'xhr' | 'fetch'>('all');

  const requests = filter === 'all'
    ? networkEntries
    : networkEntries.filter((entry) => entry.resourceType === filter);
  const connectionLabel = loading ? 'Conectando…' : error ? error : connected ? 'En vivo' : session ? 'Reconectando…' : 'Sin sesión';

  return (
    <div className="flex flex-col h-full bg-[var(--nc-bg-panel)]">
      <div className="flex items-center gap-2 p-2 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)]">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : session ? 'bg-[var(--nc-text-accent)]' : 'bg-[var(--nc-danger)]'}`} />
        <span className="text-[10px] font-mono text-[var(--nc-text-accent)]">{L('Network Monitor', 'Network Monitor')}</span>
        <span className="text-[9px] font-mono text-[var(--nc-text)]/50">{connectionLabel}</span>
        <div className="flex-1" />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'all' | 'xhr' | 'fetch')}
          className="bg-[var(--nc-bg-panel)] text-[var(--nc-text)] text-[9px] px-1 py-0.5 rounded border border-[var(--nc-border-dark)] outline-none"
        >
          <option value="all">All</option>
          <option value="xhr">XHR</option>
          <option value="fetch">Fetch</option>
        </select>
        <button
          onClick={clearLogs}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded text-[10px]"
          title={L('Limpiar red', 'Clear network')}
        >
          🗑
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[9px]">
        {requests.length === 0 ? (
          <div className="text-center text-[var(--nc-text)]/40 py-8">
            {session ? 'No hay peticiones de red todavía.' : 'Abre el panel Navegador para iniciar una sesión.'}
          </div>
        ) : (
          requests.slice().reverse().map((entry: BrowserNetworkEntry) => (
            <div key={entry.seq} className="flex gap-2 px-1 py-0.5 bg-[var(--nc-bg-panel)] rounded border border-[var(--nc-border-dark)] hover:border-[var(--nc-border-light)] transition-colors">
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold ${entry.method === 'GET' ? 'bg-emerald-400/20 text-emerald-300' : entry.method === 'POST' ? 'bg-cyan-400/20 text-cyan-300' : entry.method === 'DELETE' ? 'bg-red-400/20 text-red-300' : 'bg-yellow-400/20 text-yellow-300'}`}>
                {entry.method}
              </span>
              <span className="flex-1 truncate text-[var(--nc-text)]" title={entry.url}>{entry.url}</span>
              <span className={`shrink-0 font-bold ${entry.kind === 'failed' ? 'text-[var(--nc-danger)]' : entry.status && entry.status >= 400 ? 'text-[var(--nc-danger)]' : 'text-emerald-300'}`}>
                {entry.kind === 'failed' ? 'ERR' : entry.status ?? '—'}
              </span>
              <span className="shrink-0 text-[var(--nc-text)]/60">{entry.durationMs}ms</span>
              <span className="shrink-0 text-[var(--nc-text)]/50">{timeOf(entry.ts)}</span>
            </div>
          ))
        )}
      </div>

      <div className="px-2 py-1 border-t border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] text-[9px] font-mono text-[var(--nc-text)]/40">
        {L('Eventos reales de Playwright · sin bodies ni cabeceras', 'Real Playwright events · no bodies or headers')}
      </div>
    </div>
  );
};
