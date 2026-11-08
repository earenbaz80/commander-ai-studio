/**
 * Navegador integrado del Workbench.
 *
 * No usa iframe: se engancha a la misma sesión de Playwright que usan las
 * herramientas del agente. El servidor manda frames JPEG por SSE y aquí se
 * convierten clics, teclado y scroll en acciones reales sobre esa página.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Circle,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react';
import { useBrowserSessionFeed } from '../../hooks/useBrowserSessionFeed';
import { useBrowserRecording } from '../../hooks/useBrowserRecording';
import { formatMediaTime } from '../../artifacts/utils';
import type { Language } from '../../i18n/translations';
import { deText } from '../../i18n/de';
import {
  captureBrowserSessionScreenshot,
  listBrowserSessions,
  sendBrowserInput,
  type BrowserInput,
  type BrowserSessionInfo,
} from '../../utils/browserSessionApi';

const QUICK_LINKS = [
  { label: 'Dev Server', url: 'http://localhost:3001' },
  { label: 'Vite', url: 'http://localhost:5173' },
];

const KEY_NAMES = new Set([
  'Enter',
  'Backspace',
  'Tab',
  'Escape',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

function withScheme(value: string): string {
  const target = value.trim();
  if (!target) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `http://${target}`;
}

function sessionOptionLabel(session: BrowserSessionInfo): string {
  const page = session.page.title || session.page.url || session.root;
  return `${session.id} · ${page}`;
}

/** Baja al disco un contenido base64 que ya viajó desde el servidor. */
function downloadBase64File(data: string, mimeType: string, filename: string): void {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL?.(objectUrl), 1_000);
}

export const BrowserView: React.FC<{ projectPath: string; lang?: Language }> = ({
  projectPath,
  lang = 'es',
}) => {
  const L = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [sessions, setSessions] = useState<BrowserSessionInfo[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [captureFullPage, setCaptureFullPage] = useState(false);
  const feed = useBrowserSessionFeed(projectPath, {
    create: true,
    sessionId: selectedSessionId || undefined,
  });
  const { setSession } = feed;
  const [url, setUrl] = useState('http://localhost:3001');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const viewerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelDelta = useRef({ x: 0, y: 0 });

  const session = feed.session;
  const frame = feed.frame;
  const recorder = useBrowserRecording(projectPath, session, frame);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listBrowserSessions());
    } catch {
      /* el selector es best-effort: no debe tumbar el visor */
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
    const timer = setInterval(() => void refreshSessions(), 5_000);
    return () => clearInterval(timer);
  }, [refreshSessions]);

  useEffect(() => {
    if (session?.id) void refreshSessions();
  }, [session?.id, refreshSessions]);

  useEffect(() => {
    const currentUrl = session?.page.url;
    if (currentUrl && currentUrl !== 'about:blank') setUrl(currentUrl);
  }, [session?.page.url]);

  useEffect(() => () => {
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
  }, []);

  const runInput = useCallback(
    async (input: BrowserInput, nextStatus: string) => {
      if (!session || busy) return;
      setBusy(true);
      setError('');
      setStatus(nextStatus);
      try {
        const updated = await sendBrowserInput(session.id, input);
        setSession(updated);
        if (updated.page.url && updated.page.url !== 'about:blank') setUrl(updated.page.url);
      } catch (e: any) {
        setError(String(e?.message || e).slice(0, 300));
      } finally {
        setBusy(false);
        setStatus('');
      }
    },
    [session, busy, setSession],
  );

  const navigate = useCallback(
    (value: string) => {
      const target = withScheme(value);
      if (!target) return;
      setUrl(target);
      void runInput({ action: 'navigate', url: target }, 'Navegando…');
    },
    [runInput],
  );

  const captureScreenshot = async () => {
    if (!session || capturing) return;
    setCapturing(true);
    setError('');
    setStatus(
      captureFullPage
        ? L('Capturando página completa…', 'Capturing full page…')
        : L('Capturando pantalla…', 'Taking screenshot…'),
    );
    try {
      const shot = await captureBrowserSessionScreenshot(session.id, captureFullPage);
      downloadBase64File(
        shot.data,
        shot.mimeType,
        `navegador-${session.id}-${Date.now()}${captureFullPage ? '-completa' : ''}.png`,
      );
      setStatus(L('Captura descargada', 'Screenshot downloaded'));
    } catch (e: any) {
      setError(String(e?.message || e).slice(0, 300));
    } finally {
      setCapturing(false);
      setStatus('');
    }
  };

  /** El frame que ya está en pantalla: mismo JPEG del SSE, sin recapturar. */
  const downloadFrame = useCallback(() => {
    if (!frame) return;
    const extension = frame.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    downloadBase64File(
      frame.data,
      frame.mimeType,
      `navegador-${session?.id || 'frame'}-frame-${frame.seq}.${extension}`,
    );
  }, [frame, session?.id]);

  const sendScroll = useCallback(() => {
    const { x, y } = wheelDelta.current;
    wheelDelta.current = { x: 0, y: 0 };
    if (x || y) void runInput({ action: 'scroll', deltaX: x, deltaY: y }, 'Desplazando…');
  }, [runInput]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!session || busy) return;
    event.preventDefault();
    wheelDelta.current.x += event.deltaX;
    wheelDelta.current.y += event.deltaY;
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(sendScroll, 120);
  };

  const handleClick = (event: React.MouseEvent<HTMLImageElement>) => {
    viewerRef.current?.focus();
    const image = imageRef.current;
    if (!image || !frame || !session || busy) return;

    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.min(rect.width / frame.width, rect.height / frame.height);
    if (!Number.isFinite(scale) || scale <= 0) return;

    const left = rect.left + (rect.width - frame.width * scale) / 2;
    const top = rect.top + (rect.height - frame.height * scale) / 2;
    const x = Math.round((event.clientX - left) / scale);
    const y = Math.round((event.clientY - top) / scale);
    if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
    void runInput({ action: 'click', x, y }, 'Clic…');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!session || busy) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      void runInput({ action: 'type', text: event.key }, 'Escribiendo…');
      return;
    }
    if (KEY_NAMES.has(event.key)) {
      event.preventDefault();
      void runInput({ action: 'key', key: event.key }, 'Tecla…');
    }
  };

  /**
   * Alt+← / Alt+→: mismo historial real que los botones. Se escucha en la
   * ventana porque el foco puede estar en cualquier control del panel, pero se
   * ignora dentro de campos de texto para no pisar el movimiento del cursor.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!session || busy) return;
      const goingBack = event.key === 'ArrowLeft';
      if (goingBack ? !session.page.canGoBack : !session.page.canGoForward) return;
      event.preventDefault();
      void runInput(
        { action: goingBack ? 'back' : 'forward' },
        goingBack ? 'Atrás…' : 'Adelante…',
      );
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, busy, runInput]);

  const sessionUrl = session?.page.url || '';
  const activeUrl = sessionUrl && sessionUrl !== 'about:blank' ? sessionUrl : '';
  const connectedLabel = feed.loading
    ? 'Abriendo sesión…'
    : feed.error
      ? feed.error
      : feed.connected
        ? 'En vivo'
        : session
          ? 'Reconectando…'
          : 'Sin sesión';
  const actorLabel = session?.lastActor === 'agent' ? 'Agente' : session?.lastActor === 'user' ? 'Usuario' : '—';
  const selectorSessions = session && !sessions.some((candidate) => candidate.id === session.id)
    ? [session, ...sessions]
    : sessions;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 p-1.5 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] shrink-0">
        <button
          onClick={() => void runInput({ action: 'back' }, 'Atrás…')}
          disabled={!session || busy || !session.page.canGoBack}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded disabled:opacity-30 shrink-0"
          title={L('Atrás', 'Back')}
          aria-keyshortcuts="Alt+ArrowLeft"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => void runInput({ action: 'forward' }, 'Adelante…')}
          disabled={!session || busy || !session.page.canGoForward}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded disabled:opacity-30 shrink-0"
          title={L('Adelante', 'Forward')}
          aria-keyshortcuts="Alt+ArrowRight"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => void runInput({ action: 'reload' }, 'Recargando…')}
          disabled={!session || busy}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded disabled:opacity-30 shrink-0"
          title={L('Recargar', 'Reload')}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
        <Globe className="w-3.5 h-3.5 text-[var(--nc-text-accent)] shrink-0 ml-1" />
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              navigate(url);
            }
          }}
          placeholder="https://…"
          spellCheck={false}
          aria-label={L('URL del navegador', 'Browser URL')}
          className="flex-1 bg-[var(--nc-bg-deep)] text-[11px] font-mono text-[var(--nc-text)] px-2 py-1 rounded border border-[var(--nc-border-dark)] outline-none focus:border-[var(--nc-border-light)] placeholder:text-[var(--nc-text)]/30"
        />
        <button
          onClick={() => navigate(url)}
          disabled={!session || busy}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded disabled:opacity-30 shrink-0"
          title={L('Ir', 'Go')}
        >
          <Play className="w-3.5 h-3.5" />
        </button>
        {activeUrl && (
          <a
            href={activeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded shrink-0"
            title={L('Abrir en pestaña del navegador', 'Open in browser tab')}
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <select
          value={captureFullPage ? 'full' : 'viewport'}
          onChange={(event) => setCaptureFullPage(event.target.value === 'full')}
          disabled={!session || capturing}
          aria-label={L('Área de captura', 'Capture area')}
          title={L('Área de captura', 'Capture area')}
          className="bg-[var(--nc-bg-deep)] text-[9px] font-mono text-[var(--nc-text)] px-1 py-0.5 rounded border border-[var(--nc-border-dark)] outline-none focus:border-[var(--nc-border-light)] disabled:opacity-40 shrink-0"
        >
          <option value="viewport">{L('Ventana', 'Viewport')}</option>
          <option value="full">{L('Página completa', 'Full page')}</option>
        </select>
        <button
          onClick={() => void captureScreenshot()}
          disabled={!session || capturing}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded disabled:opacity-30 shrink-0"
          title={L('Capturar pantalla', 'Take screenshot')}
        >
          {capturing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={downloadFrame}
          disabled={!frame}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded disabled:opacity-30 shrink-0"
          title={L('Descargar frame actual', 'Download current frame')}
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        <button
          data-testid="browser-record"
          onClick={() => (recorder.recording ? void recorder.stop() : recorder.start())}
          disabled={!session || recorder.saving}
          className={`p-1 rounded disabled:opacity-30 shrink-0 ${recorder.recording ? 'text-red-300 bg-red-500/15' : 'text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)]'}`}
          title={recorder.recording ? L('Detener grabación', 'Stop recording') : L('Grabar navegador', 'Record browser')}
          aria-label={recorder.recording ? L('Detener grabación', 'Stop recording') : L('Grabar navegador', 'Record browser')}
          aria-pressed={recorder.recording}
        >
          {recorder.saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : recorder.recording ? (
            <Square className="w-3.5 h-3.5 fill-current" />
          ) : (
            <Circle className="w-3.5 h-3.5 fill-red-500 text-red-400" />
          )}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-1.5 py-1 border-b border-[var(--nc-border-dark)] shrink-0">
        <span className="text-[9px] font-mono text-[var(--nc-text)]/50 shrink-0">
          {L('Sesión', 'Session')}
        </span>
        <select
          value={selectedSessionId || session?.id || ''}
          onChange={(event) => {
            const nextId = event.target.value;
            setSelectedSessionId(nextId);
            setStatus(nextId ? L('Cambiando de sesión…', 'Switching session…') : '');
          }}
          disabled={selectorSessions.length === 0 || recorder.recording || recorder.saving}
          aria-label={L('Sesión del navegador', 'Browser session')}
          className="max-w-[45%] bg-[var(--nc-bg-deep)] text-[9px] font-mono text-[var(--nc-text)] px-1 py-0.5 rounded border border-[var(--nc-border-dark)] outline-none focus:border-[var(--nc-border-light)] disabled:opacity-40"
        >
          <option value="">{L('Sesión actual', 'Current session')}</option>
          {selectorSessions.map((item) => (
            <option key={item.id} value={item.id}>{sessionOptionLabel(item)}</option>
          ))}
        </select>
        {QUICK_LINKS.map((link) => (
          <button
            key={link.url}
            onClick={() => navigate(link.url)}
            disabled={!session || busy}
            className="text-[10px] font-mono px-1.5 py-0.5 bg-[var(--nc-bg-deep)] text-[var(--nc-text)] border border-[var(--nc-border-dark)] rounded hover:bg-[var(--nc-bg-hover)] disabled:opacity-30"
          >
            {link.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2 min-w-0 text-[10px] font-mono text-[var(--nc-text)]/50">
          {recorder.recording && (
            <span data-testid="browser-recording-status" className="flex items-center gap-1 text-red-300 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              REC {formatMediaTime(recorder.elapsedMs)} · {recorder.frameCount}f
            </span>
          )}
          {!recorder.recording && recorder.savedId && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('commander:open-workbench-tab', { detail: { tab: 'artifacts' } }))}
              className="text-[var(--nc-text-accent)] hover:underline shrink-0"
              title={L('Ver artifact guardado', 'View saved artifact')}
            >
              {L('Grabación guardada', 'Recording saved')} · {L('Ver', 'View')}
            </button>
          )}
          <span className="truncate">{status || connectedLabel}</span>
        </span>
      </div>

      <div
        ref={viewerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        className="flex-1 min-h-0 bg-[var(--nc-bg-deep)] relative flex items-center justify-center overflow-hidden outline-none focus:ring-1 focus:ring-[var(--nc-text-accent)]/50"
      >
        {frame ? (
          <img
            ref={imageRef}
            src={`data:${frame.mimeType};base64,${frame.data}`}
            alt={L('Navegador Playwright', 'Playwright browser')}
            draggable={false}
            onClick={handleClick}
            className="max-w-full max-h-full object-contain cursor-crosshair select-none"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-center p-4">
            {feed.loading ? (
              <Loader2 className="w-7 h-7 text-[var(--nc-text-accent)] animate-spin" />
            ) : (
              <Globe className="w-7 h-7 text-[var(--nc-text)]/30" />
            )}
            <p className="text-[11px] font-mono text-[var(--nc-text)]/50 max-w-[260px]">
              {feed.loading
                ? 'Abriendo la sesión de Playwright…'
                : 'La sesión está abierta, esperando el primer frame.'}
            </p>
          </div>
        )}
        {!feed.connected && session && !feed.loading && (
          <div className="absolute top-2 right-2 px-2 py-1 text-[9px] font-mono bg-[var(--nc-bg-panel)] border border-[var(--nc-text-accent)] text-[var(--nc-text-accent)]">
            Reconectando…
          </div>
        )}
      </div>

      {(error || feed.error || recorder.error) && (
        <div className="px-2 py-1 border-t border-[var(--nc-danger)] text-[10px] font-mono text-[var(--nc-danger)]">
          {error || feed.error || recorder.error}
        </div>
      )}

      <div className="flex items-center gap-2 px-2 py-1 border-t border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] text-[9px] font-mono text-[var(--nc-text)]/60 shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full ${feed.connected ? 'bg-emerald-400' : 'bg-[var(--nc-text-accent)]'}`} />
        <span>{session ? `Sesión ${session.id}` : 'Sin sesión'}</span>
        <span>·</span>
        <span>{actorLabel}</span>
        <span>·</span>
        <span>1280×800</span>
        <span className="ml-auto">{frame ? `frame ${frame.seq}` : 'sin frame'}</span>
      </div>
    </div>
  );
};

export default BrowserView;
