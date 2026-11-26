/**
 * Pantalla PWA de sesión del dispositivo emparejado (F3): chat, plan y
 * aprobaciones sobre el cliente del lease (`src/pair/pairLeaseClient.ts`).
 *
 * Vive en `/pair/session` y se monta sola, como `/pair`, para que el móvil
 * emparejado tenga la sesión completa sin el resto de la SPA. Toma la sesión de
 * `?sessionId=` o del formulario.
 *
 * Las tres escrituras van firmadas con el `seq` del lease y el servidor las
 * somete a las mismas guardas que el escritorio:
 * - el turno de chat, con `sendMessage()`;
 * - la decisión de una aprobación, con `resolveApproval()`: aprobar aplica el
 *   diff, y `allow-session` repite el permiso para la misma tool y objetivo;
 * - reclamar o liberar el control, con las rutas del lease.
 *
 * Sin control confirmado (`canWrite`) el compositor y los botones de decisión
 * quedan desactivados. El 409 del servidor (`LEASE_HELD`, `LEASE_STALE`) no se
 * traduce ni se resume: se pinta como `CÓDIGO · mensaje`, porque es la señal de
 * que hay que pedir el traspaso en vez de insistir.
 *
 * El estado se lee al entrar y después se sigue por el **stream SSE** de la
 * sesión (`GET /api/agent/sessions/:id/stream`) con `Last-Event-ID`, no por
 * polling: si la red cae, el cliente reconecta desde el último `seq` visto, el
 * servidor reemite lo que falte o manda un `resync` con el estado completo, y
 * la pantalla recupera turnos, plan y aprobaciones sin recargar la página. Un
 * `gone` cierra la sesión y no se reintenta.
 *
 * Una aprobación ya decidida en esta pantalla se recuerda en `decided`: aunque
 * un `resync` atrasado la volviera a listar, no se ofrece otra vez y no se
 * reenvía la decisión. La idempotencia del servidor sigue siendo la última
 * palabra.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { deText } from '../../i18n/de';
import type { Language } from '../../i18n/translations';
import type {
  ApprovalRequestV2,
  SessionPlanItemV2,
  SessionTurnV2,
} from '../../agent/sessionTypes';
import {
  createPairLeaseClient,
  type PairLeaseClient,
  type PairLeaseClientState,
} from '../../pair/pairLeaseClient';
import { PairSessionStream, type PairStreamStatus } from '../../pair/pairSessionStream';

export interface PairSessionScreenProps {
  /** Para enlaces internos y tests; si falta se lee `?sessionId=` de la URL. */
  sessionId?: string;
  /** Idioma de la pantalla; por defecto espanol, como el resto de la app. */
  lang?: Language;
  /** Base del backoff de reconexión del stream; 0 deja un solo intento (tests). */
  streamRetryMs?: number;
}

type Translate = (es: string, en: string) => string;

function translate(lang: Language, es: string, en: string): string {
  return lang === 'es' ? es : lang === 'de' ? deText(en) : en;
}

function readSessionFromUrl(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('sessionId')?.trim() ?? '';
}

/** Lo que el servidor devuelve con `success: true` en GET/POST de sesión. */
interface SessionView {
  id?: string;
  status?: string;
  turns?: SessionTurnV2[];
  plan?: SessionPlanItemV2[];
  pendingApproval?: ApprovalRequestV2 | null;
  pendingApprovals?: ApprovalRequestV2[];
}

function pendingFromState(state: SessionView | null): ApprovalRequestV2[] {
  if (!state) return [];
  const list =
    Array.isArray(state.pendingApprovals) && state.pendingApprovals.length > 0
      ? state.pendingApprovals
      : state.pendingApproval
        ? [state.pendingApproval]
        : [];
  return list.filter((item) => item && typeof item.id === 'string' && item.id.length > 0);
}

function ownerLabel(id: string | null | undefined, L: Translate): string {
  if (!id || id === 'desktop') return L('el escritorio', 'the desktop');
  return id;
}

function leaseLine(state: PairLeaseClientState | null, L: Translate): string {
  if (!state) return L('Leyendo el control…', 'Reading control…');
  if (state.canWrite) return L('Escribís esta sesión', 'You write this session');
  if (state.mine) return L('El control es de este dispositivo, falta confirmarlo', 'This device holds control; it is not confirmed yet');
  return `${L('Sólo lectura · control de', 'Read only · control held by')} ${ownerLabel(state.lease?.deviceId, L)}`;
}

function turnClass(role: SessionTurnV2['role']): string {
  if (role === 'user') return 'border-[var(--nc-text-accent)] text-[var(--nc-text)]';
  if (role === 'assistant') return 'border-[var(--nc-border-mid)] text-[var(--nc-text)]';
  return 'border-[var(--nc-border-dark)] text-[var(--nc-text-dim)]';
}

export function PairSessionScreen({
  sessionId: preset,
  lang = 'es',
  streamRetryMs = 1_000,
}: PairSessionScreenProps) {
  const L: Translate = (es, en) => translate(lang, es, en);
  const initial = (preset ?? readSessionFromUrl()).trim();
  const [sessionId, setSessionId] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [reply, setReply] = useState('');
  const [session, setSession] = useState<SessionView | null>(null);
  const [sessionNote, setSessionNote] = useState<string | null>(null);
  const [leaseState, setLeaseState] = useState<PairLeaseClientState | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceNote, setDeviceNote] = useState<string | null>(null);
  const [deviceChecked, setDeviceChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<PairStreamStatus>('closed');
  const clientRef = useRef<PairLeaseClient | null>(null);
  const sessionRef = useRef(sessionId);
  /** Aprobaciones ya resueltas acá: un `resync` atrasado no las vuelve a ofrecer. */
  const decidedRef = useRef<Set<string>>(new Set());
  const loadInFlight = useRef(false);
  const loadQueued = useRef(false);

  // Quién soy para el host: sin este id el ack de un traspaso no se puede
  // atribuir a este dispositivo y la escritura no se habilita.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/pair/device', { credentials: 'same-origin' });
        const data: any = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.ok && data?.success && data?.device?.id) {
          setDeviceId(String(data.device.id));
        } else {
          setDeviceNote(
            translate(
              lang,
              'Este navegador no está emparejado: podés leer la sesión, pero no escribir. Canjeá un enlace de `commander pair` en este navegador.',
              'This browser is not paired: you can read the session but not write. Redeem a `commander pair` link in this browser.'
            )
          );
        }
      } catch {
        if (!cancelled) {
          setDeviceNote(
            translate(
              lang,
              'No se pudo comprobar el dispositivo: sin conexión con el host.',
              'Could not check the device: no connection to the host.'
            )
          );
        }
      } finally {
        if (!cancelled) setDeviceChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const loadSession = useCallback(async () => {
    const target = sessionId;
    if (!target) return;
    try {
      const response = await fetch(`/api/agent/sessions/${encodeURIComponent(target)}`, {
        credentials: 'same-origin',
      });
      const data: any = await response.json().catch(() => null);
      if (sessionRef.current !== target) return;
      if (!response.ok || !data?.success) {
        setSession(null);
        setSessionNote(
          translate(lang, 'No se pudo leer la sesión del host.', 'Could not read the session from the host.')
        );
        return;
      }
      setSession(data.state ?? null);
    } catch {
      if (sessionRef.current !== target) return;
      setSessionNote(translate(lang, 'Sin conexión con el host.', 'No connection to the host.'));
    }
  }, [sessionId, lang]);

  /**
   * Relee el estado autoritativo sin acumular peticiones: si ya hay una en
   * vuelo, la siguiente se hace al terminar. Los eventos del stream llegan en
   * ráfaga durante una corrida y no deben abrir un GET por cada uno.
   */
  const scheduleLoad = useCallback(() => {
    if (loadInFlight.current) {
      loadQueued.current = true;
      return;
    }
    loadInFlight.current = true;
    void (async () => {
      try {
        await loadSession();
        while (loadQueued.current) {
          loadQueued.current = false;
          await loadSession();
        }
      } finally {
        loadInFlight.current = false;
      }
    })();
  }, [loadSession]);

  useEffect(() => {
    sessionRef.current = sessionId;
    setSession(null);
    setSessionNote(null);
    decidedRef.current = new Set();
    if (!sessionId) {
      setStreamStatus('closed');
      return;
    }
    void loadSession();

    const stream = new PairSessionStream({
      url: `/api/agent/sessions/${encodeURIComponent(sessionId)}/stream`,
      retryMs: streamRetryMs,
      onStatus: (status) => {
        if (sessionRef.current === sessionId) setStreamStatus(status);
      },
      onFrame: (frame) => {
        if (sessionRef.current !== sessionId) return;
        // La sesión terminó: se cierra y se relee una vez el estado final.
        if (frame.event === 'gone') {
          scheduleLoad();
          return;
        }
        // `resync` trae el `SessionStateV2` completo: es el mismo contrato que
        // devuelve el GET, así que reemplaza el estado sin otra petición.
        if (frame.event === 'resync' && frame.data && typeof frame.data === 'object') {
          setSession(frame.data as SessionView);
          return;
        }
        scheduleLoad();
      },
    });
    stream.start();
    return () => {
      stream.close();
    };
  }, [sessionId, loadSession, scheduleLoad, streamRetryMs]);

  useEffect(() => {
    if (!sessionId || !deviceChecked) return;
    setLeaseState(null);
    const client = createPairLeaseClient({
      sessionId,
      ...(deviceId ? { deviceId } : {}),
    });
    clientRef.current = client;
    const unsubscribe = client.subscribe((next) => setLeaseState(next));
    client
      .refresh()
      .then((result) => {
        if (clientRef.current !== client) return;
        if (result.ok && result.state.canWrite) client.startRenewal();
      })
      .catch(() => {
        /* el estado de error ya lo publica el cliente */
      });
    return () => {
      unsubscribe();
      client.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [sessionId, deviceChecked, deviceId]);

  const connect = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    setSessionId(next);
    setSession(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('sessionId', next);
      window.history.replaceState(null, '', url);
    } catch {
      /* sin History API la sesión igual queda en memoria */
    }
  };

  const claim = async () => {
    const client = clientRef.current;
    if (!client || busy) return;
    setBusy('claim');
    try {
      const result = await client.claim();
      // El 409 queda en `lastError` del cliente y se pinta tal cual.
      if (result.ok) {
        client.startRenewal();
        await loadSession();
      }
    } finally {
      setBusy(null);
    }
  };

  const release = async () => {
    const client = clientRef.current;
    if (!client || busy) return;
    setBusy('release');
    try {
      await client.release();
    } finally {
      setBusy(null);
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const client = clientRef.current;
    const text = reply.trim();
    if (!client || !text || busy) return;
    setBusy('send');
    setSessionNote(null);
    try {
      const result = await client.sendMessage({ text });
      if (!result.ok) {
        setSessionNote(`${result.error.code ?? 'ERROR'} · ${result.error.message}`);
        return;
      }
      setReply('');
      await loadSession();
      if (result.state.canWrite) client.startRenewal();
    } finally {
      setBusy(null);
    }
  };

  const decide = async (approval: ApprovalRequestV2, decision: 'allow' | 'deny' | 'allow-session') => {
    const client = clientRef.current;
    if (!client || busy) return;
    setBusy(`approval:${approval.id}`);
    setSessionNote(null);
    try {
      const result = await client.resolveApproval(approval.id, { decision });
      if (!result.ok) {
        setSessionNote(`${result.error.code ?? 'ERROR'} · ${result.error.message}`);
        return;
      }
      decidedRef.current.add(approval.id);
      const verb =
        decision === 'deny'
          ? L('Denegaste', 'You denied')
          : decision === 'allow-session'
            ? L('Permitiste en la sesión', 'You allowed for the session')
            : L('Aprobaste', 'You approved');
      setSessionNote(`${verb} ${approval.tool}.`);
      await loadSession();
      if (result.state.canWrite) client.startRenewal();
    } finally {
      setBusy(null);
    }
  };

  const turns = session?.turns ?? [];
  const plan = session?.plan ?? [];
  const approvals = pendingFromState(session).filter((approval) => !decidedRef.current.has(approval.id));
  const canWrite = Boolean(leaseState?.canWrite);
  const disabled = busy !== null;
  const leaseError = leaseState?.lastError ?? null;

  return (
    <div className="min-h-screen nc-container p-4 sm:p-6" data-testid="pair-session-screen">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <header className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--nc-text-dim)]">
            {L('Commander AI Studio · pair', 'Commander AI Studio · pair')}
          </p>
          <h1 className="text-lg font-bold text-[var(--nc-text-accent)]">
            {L('Sesión remota', 'Remote session')}
          </h1>
          <p data-testid="pair-session-status" className="text-xs text-[var(--nc-text-dim)]">
            {session ? `${session.status ?? 'idle'} · ${sessionId}` : sessionId}
          </p>
          {sessionId && (
            <p data-testid="pair-session-stream" className="text-[11px] text-[var(--nc-text-dim)]">
              {streamStatus === 'open'
                ? L('En vivo (SSE)', 'Live (SSE)')
                : streamStatus === 'connecting'
                  ? L('Conectando el stream…', 'Connecting the stream…')
                  : streamStatus === 'reconnecting'
                    ? L('Reconectando…', 'Reconnecting…')
                    : L('Stream cerrado', 'Stream closed')}
            </p>
          )}
        </header>

        <form onSubmit={connect} className="nc-panel flex flex-col gap-2 p-3 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1 text-xs">
            <span className="block text-[var(--nc-text-dim)]">{L('Sesión', 'Session')}</span>
            <input
              data-testid="pair-session-id"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="sess_…"
              autoComplete="off"
              spellCheck={false}
              className="w-full border-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] px-2 py-1.5 font-mono text-sm text-[var(--nc-text)] outline-none focus:border-[var(--nc-text-accent)]"
            />
          </label>
          <button type="submit" data-testid="pair-session-connect" className="nc-button text-xs" disabled={!draft.trim()}>
            {L('Conectar', 'Connect')}
          </button>
        </form>

        {deviceNote && (
          <p
            data-testid="pair-session-device-note"
            className="border-2 border-[var(--nc-border-mid)] bg-[var(--nc-bg-panel)] p-2 text-xs text-[var(--nc-text-accent)]"
          >
            {deviceNote}
          </p>
        )}

        {sessionId && (
          <section className="nc-panel space-y-3 p-4" aria-live="polite">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p data-testid="pair-session-lease" className="text-sm font-bold">
                {leaseLine(leaseState, L)}
              </p>
              <span className="text-[11px] text-[var(--nc-text-dim)]">
                {leaseState?.lease ? `seq ${leaseState.lease.seq}` : '—'}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {!canWrite && (
                <button
                  type="button"
                  data-testid="pair-session-claim"
                  className="nc-button text-xs"
                  disabled={disabled}
                  onClick={() => void claim()}
                >
                  {L('Reclamar control', 'Claim control')}
                </button>
              )}
              {canWrite && (
                <button
                  type="button"
                  data-testid="pair-session-release"
                  className="nc-button text-xs"
                  disabled={disabled}
                  onClick={() => void release()}
                >
                  {L('Liberar control', 'Release control')}
                </button>
              )}
              <button
                type="button"
                data-testid="pair-session-refresh"
                className="nc-button text-xs"
                disabled={disabled}
                onClick={() => void loadSession()}
              >
                {L('Actualizar', 'Refresh')}
              </button>
            </div>

            {leaseError && (
              <div
                data-testid="pair-session-lease-error"
                role="alert"
                className="border-2 border-[var(--nc-danger)] bg-[var(--nc-bg-panel)] p-2 text-xs text-[var(--nc-danger)]"
              >
                <p className="font-bold">
                  {[leaseError.code ?? 'ERROR', leaseError.message].join(' · ')}
                </p>
              </div>
            )}
          </section>
        )}

        {sessionId && (
          <section data-testid="pair-session-chat" className="nc-panel space-y-3 p-4">
            <h2 className="text-sm font-bold text-[var(--nc-text-accent)]">
              {L('Chat', 'Chat')}
            </h2>

            {turns.length === 0 && (
              <p data-testid="pair-session-turns-empty" className="text-xs text-[var(--nc-text-dim)]">
                {L('Todavía no hay turnos.', 'No turns yet.')}
              </p>
            )}

            <ol className="space-y-2">
              {turns.map((turn, index) => (
                <li
                  key={`${turn.ts}-${index}`}
                  data-testid={`pair-session-turn-${turn.role}`}
                  className={`border-l-4 bg-[var(--nc-bg-main)] p-2 ${turnClass(turn.role)}`}
                >
                  <p className="text-[10px] uppercase tracking-wider text-[var(--nc-text-dim)]">
                    {turn.role}
                  </p>
                  <p className="whitespace-pre-wrap text-xs">{turn.text}</p>
                </li>
              ))}
            </ol>

            <form onSubmit={send} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex-1 space-y-1 text-xs">
                <span className="block text-[var(--nc-text-dim)]">{L('Mensaje', 'Message')}</span>
                <input
                  data-testid="pair-session-reply"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder={L('Escribí un turno…', 'Type a turn…')}
                  autoComplete="off"
                  className="w-full border-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] px-2 py-1.5 text-sm text-[var(--nc-text)] outline-none focus:border-[var(--nc-text-accent)]"
                />
              </label>
              <button
                type="submit"
                data-testid="pair-session-send"
                className="nc-button text-xs"
                disabled={disabled || !canWrite || !reply.trim()}
              >
                {L('Enviar', 'Send')}
              </button>
            </form>

            {!canWrite && (
              <p className="text-[11px] text-[var(--nc-text-dim)]">
                {L(
                  'Reclamá el control para enviar turnos: el escritor es uno solo.',
                  'Claim control to send turns: there is a single writer.'
                )}
              </p>
            )}

            {sessionNote && (
              <p
                data-testid="pair-session-note"
                role="status"
                className="border-2 border-[var(--nc-border-mid)] bg-[var(--nc-bg-panel)] p-2 text-xs text-[var(--nc-text-accent)]"
              >
                {sessionNote}
              </p>
            )}
          </section>
        )}

        {sessionId && (
          <section data-testid="pair-session-plan" className="nc-panel space-y-2 p-4">
            <h2 className="text-sm font-bold text-[var(--nc-text-accent)]">
              {L('Plan', 'Plan')}
            </h2>
            {plan.length === 0 ? (
              <p data-testid="pair-session-plan-empty" className="text-xs text-[var(--nc-text-dim)]">
                {L('La sesión todavía no tiene plan.', 'The session has no plan yet.')}
              </p>
            ) : (
              <ol className="space-y-1">
                {plan.map((item) => (
                  <li
                    key={item.id}
                    data-testid={`pair-session-plan-${item.id}`}
                    className="flex flex-wrap items-baseline gap-2 border-b border-[var(--nc-border-dark)] pb-1 text-xs"
                  >
                    <span className="font-mono text-[10px] uppercase text-[var(--nc-text-dim)]">
                      {item.status}
                    </span>
                    <span className={item.status === 'done' ? 'line-through text-[var(--nc-text-dim)]' : ''}>
                      {item.text}
                    </span>
                    {item.files && item.files.length > 0 && (
                      <span className="font-mono text-[10px] text-[var(--nc-text-dim)]">
                        {item.files.join(', ')}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {sessionId && (
          <section data-testid="pair-session-approvals" className="nc-panel space-y-3 p-4" aria-live="polite">
            <h2 className="text-sm font-bold text-[var(--nc-text-accent)]">
              {L('Aprobaciones pendientes', 'Pending approvals')}
            </h2>

            {approvals.length === 0 && (
              <p data-testid="pair-session-approvals-empty" className="text-xs text-[var(--nc-text-dim)]">
                {L('No hay aprobaciones pendientes.', 'No pending approvals.')}
              </p>
            )}

            {approvals.map((approval) => {
              const path = (approval.input as any)?.path;
              const target = typeof path === 'string' && path ? path : null;
              return (
                <article
                  key={approval.id}
                  data-testid={`pair-session-approval-${approval.id}`}
                  className="space-y-2 border-2 border-[var(--nc-border-mid)] bg-[var(--nc-bg-main)] p-2"
                >
                  <p className="font-mono text-xs">
                    {approval.tool}
                    {target ? ` · ${target}` : ''}
                  </p>
                  {approval.diff && (
                    <pre
                      data-testid={`pair-session-approval-diff-${approval.id}`}
                      className="max-h-40 overflow-auto border border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] p-1 font-mono text-[11px]"
                    >
                      {approval.diff}
                    </pre>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid={`pair-session-allow-${approval.id}`}
                      className="nc-button text-xs"
                      disabled={disabled || !canWrite}
                      onClick={() => void decide(approval, 'allow')}
                    >
                      {L('Aprobar', 'Approve')}
                    </button>
                    <button
                      type="button"
                      data-testid={`pair-session-deny-${approval.id}`}
                      className="nc-button text-xs"
                      disabled={disabled || !canWrite}
                      onClick={() => void decide(approval, 'deny')}
                    >
                      {L('Denegar', 'Deny')}
                    </button>
                    <button
                      type="button"
                      data-testid={`pair-session-allow-session-${approval.id}`}
                      className="nc-button text-xs"
                      disabled={disabled || !canWrite}
                      onClick={() => void decide(approval, 'allow-session')}
                    >
                      {L('Permitir en la sesión', 'Allow for session')}
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {sessionId && !session && (
          <p className="text-xs text-[var(--nc-text-dim)]">
            {L('Leyendo la sesión…', 'Reading the session…')}
          </p>
        )}
      </div>
    </div>
  );
}
