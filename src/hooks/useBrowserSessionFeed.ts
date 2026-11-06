import { useCallback, useEffect, useRef, useState } from 'react';
import {
  browserSessionStreamUrl,
  ensureBrowserSession,
  getBrowserSession,
  getBrowserSessionById,
  type BrowserConsoleEntry,
  type BrowserFrame,
  type BrowserNetworkEntry,
  type BrowserSessionInfo,
} from '../utils/browserSessionApi';

export interface BrowserSessionFeed {
  session: BrowserSessionInfo | null;
  frame: BrowserFrame | null;
  consoleEntries: BrowserConsoleEntry[];
  networkEntries: BrowserNetworkEntry[];
  connected: boolean;
  loading: boolean;
  error: string;
  clearLogs: () => void;
  setSession: (session: BrowserSessionInfo) => void;
}

function mergeBySeq<T extends { seq: number }>(current: T[], entry: T, limit = 200): T[] {
  if (!entry || typeof entry.seq !== 'number') return current;
  if (current.some((item) => item.seq === entry.seq)) return current;
  const next = [...current, entry];
  next.sort((a, b) => a.seq - b.seq);
  return next.slice(-limit);
}

/**
 * Se engancha a la sesión que ya existe para el proyecto. Con `create` la abre
 * si hace falta (panel Navegador); sin `create` espera a que alguien la abra
 * (consola/red), sin arrancar Chromium por su cuenta.
 */
export function useBrowserSessionFeed(
  projectPath: string,
  options: { create?: boolean; sessionId?: string } = {},
): BrowserSessionFeed {
  const create = options.create === true;
  const sessionId = options.sessionId?.trim() || '';
  const [session, setSessionState] = useState<BrowserSessionInfo | null>(null);
  const [frame, setFrame] = useState<BrowserFrame | null>(null);
  const [consoleEntries, setConsoleEntries] = useState<BrowserConsoleEntry[]>([]);
  const [networkEntries, setNetworkEntries] = useState<BrowserNetworkEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const currentId = useRef('');

  const applySession = useCallback((next: BrowserSessionInfo) => {
    if (currentId.current && currentId.current !== next.id) {
      setFrame(null);
      setConsoleEntries([]);
      setNetworkEntries([]);
    }
    currentId.current = next.id;
    setSessionState(next);
  }, []);

  const setSession = useCallback(
    (next: BrowserSessionInfo) => applySession(next),
    [applySession],
  );

  const clearLogs = useCallback(() => {
    setConsoleEntries([]);
    setNetworkEntries([]);
  }, []);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    currentId.current = '';
    setSessionState(null);
    setFrame(null);
    setConsoleEntries([]);
    setNetworkEntries([]);
    setConnected(false);
    setLoading(true);
    setError('');

    function scheduleRetry(): void {
      if (disposed) return;
      retry = setTimeout(() => {
        retry = null;
        void connect();
      }, 3_000);
    }

    async function connect(): Promise<void> {
      try {
        const next = sessionId
          ? await getBrowserSessionById(sessionId)
          : create
            ? await ensureBrowserSession(projectPath)
            : await getBrowserSession(projectPath);
        if (disposed) return;
        if (!next) {
          setLoading(false);
          scheduleRetry();
          return;
        }

        applySession(next);
        setLoading(false);
        setError('');

        if (typeof EventSource === 'undefined') {
          setError('El streaming de la sesión no está disponible en este entorno');
          return;
        }

        const eventSource = new EventSource(browserSessionStreamUrl(next.id));
        source = eventSource;
        eventSource.addEventListener('open', () => {
          if (!disposed) setConnected(true);
        });
        eventSource.addEventListener('snapshot', (event: Event) => {
          if (disposed) return;
          try {
            const data = JSON.parse((event as MessageEvent).data);
            if (data?.session) applySession(data.session);
            setConnected(true);
          } catch {
            /* evento malformado */
          }
        });
        eventSource.addEventListener('frame', (event: Event) => {
          if (disposed) return;
          try {
            const data = JSON.parse((event as MessageEvent).data);
            if (data?.frame) setFrame(data.frame);
          } catch {
            /* evento malformado */
          }
        });
        eventSource.addEventListener('console', (event: Event) => {
          if (disposed) return;
          try {
            const data = JSON.parse((event as MessageEvent).data);
            if (data?.entry) setConsoleEntries((current) => mergeBySeq(current, data.entry));
          } catch {
            /* evento malformado */
          }
        });
        eventSource.addEventListener('network', (event: Event) => {
          if (disposed) return;
          try {
            const data = JSON.parse((event as MessageEvent).data);
            if (data?.entry) setNetworkEntries((current) => mergeBySeq(current, data.entry));
          } catch {
            /* evento malformado */
          }
        });
        eventSource.addEventListener('navigation', (event: Event) => {
          if (disposed) return;
          try {
            const data = JSON.parse((event as MessageEvent).data);
            if (data?.state) {
              setSessionState((current) =>
                current
                  ? {
                      ...current,
                      page: data.state,
                      lastSeq: Number(data.seq) || current.lastSeq,
                    }
                  : current,
              );
            }
          } catch {
            /* evento malformado */
          }
        });
        eventSource.addEventListener('status', (event: Event) => {
          if (disposed) return;
          try {
            const data = JSON.parse((event as MessageEvent).data);
            if (data?.status === 'closed') {
              setConnected(false);
              setError('La sesión del navegador se cerró');
              setSessionState((current) => (current ? { ...current, status: 'closed' } : current));
              eventSource.close();
            }
          } catch {
            /* evento malformado */
          }
        });
        eventSource.onerror = () => {
          if (!disposed) setConnected(false);
        };
      } catch (e: any) {
        if (disposed) return;
        setLoading(false);
        setError(String(e?.message || e).slice(0, 300));
      }
    }

    void connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      source?.close();
      source = null;
    };
  }, [projectPath, create, sessionId, applySession]);

  return {
    session,
    frame,
    consoleEntries,
    networkEntries,
    connected,
    loading,
    error,
    clearLogs,
    setSession,
  };
}
