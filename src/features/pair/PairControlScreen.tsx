/**
 * Pantalla mínima del cliente web/PWA para el control lease (F3, §6.4 del
 * modelo de amenazas remoto).
 *
 * Vive en `/pair` y se monta sola, sin el resto de la SPA, para que el móvil
 * emparejado abra una vista corta. Muestra quién escribe la sesión y su `seq`,
 * deja reclamar y liberar el control, pide y acepta el traspaso mostrando el
 * `ack`, y mantiene la renovación cada 30 s mientras el control es propio.
 *
 * El 409 `LEASE_HELD` no se esconde: el código y el mensaje del servidor se
 * pintan tal cual, porque es la señal de que hay que pedir el traspaso en vez
 * de insistir. La escritura (`canWrite`) la decide el cliente, que sólo la
 * enciende con una confirmación propia.
 *
 * La sesión se toma de `?sessionId=` o del formulario. La identidad del
 * dispositivo sale de `GET /api/pair/device` (cookie `HttpOnly`); sin cookie,
 * el host puede seguir leyendo el estado si la petición es loopback.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createPairLeaseClient,
  type PairLeaseClient,
  type PairLeaseClientResult,
  type PairLeaseClientState,
} from '../../pair/pairLeaseClient';

export interface PairControlScreenProps {
  /** Para enlaces internos y tests; si falta se lee `?sessionId=` de la URL. */
  sessionId?: string;
}

function readSessionFromUrl(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('sessionId')?.trim() ?? '';
}

function ownerLabel(id: string | null | undefined): string {
  if (!id || id === 'desktop') return 'el escritorio';
  return id;
}

function clock(at: number | null): string {
  if (at === null) return 'sin caducidad';
  try {
    return new Date(at).toLocaleTimeString('es-ES', { hour12: false });
  } catch {
    return String(at);
  }
}

function statusText(state: PairLeaseClientState): string {
  if (state.phase === 'syncing') return 'Sincronizando con el host…';
  if (state.phase === 'error') return 'No se pudo leer el control de la sesión';
  if (state.canWrite) return 'Tenés el control de escritura';
  if (state.mine) return 'El control es de este dispositivo, falta confirmarlo';
  return `Sólo lectura · el control lo tiene ${ownerLabel(state.lease?.deviceId)}`;
}

export function PairControlScreen({ sessionId: preset }: PairControlScreenProps) {
  const initial = (preset ?? readSessionFromUrl()).trim();
  const [sessionId, setSessionId] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [state, setState] = useState<PairLeaseClientState | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceNote, setDeviceNote] = useState<string | null>(null);
  const [deviceChecked, setDeviceChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const clientRef = useRef<PairLeaseClient | null>(null);
  const targetRef = useRef('');

  // Quién soy para el host: sin este id el ack de un traspaso no se puede
  // atribuir a este dispositivo y la escritura no se habilita.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/pair/device', { credentials: 'same-origin' });
        const data: any = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.ok && data?.success && data.device?.id) {
          setDeviceId(String(data.device.id));
        } else {
          setDeviceNote(
            'Este navegador no está emparejado como dispositivo: el host puede mostrar el control, pero no reclamarlo desde acá. Generá un enlace con `commander pair` y canjealo en este navegador.'
          );
        }
      } catch {
        if (!cancelled) setDeviceNote('No se pudo comprobar el dispositivo: sin conexión con el host.');
      } finally {
        if (!cancelled) setDeviceChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionId || !deviceChecked) return;
    setState(null);
    const client = createPairLeaseClient({
      sessionId,
      ...(deviceId ? { deviceId } : {}),
    });
    clientRef.current = client;
    const unsubscribe = client.subscribe((next) => setState(next));
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

  const run = useCallback(
    async (label: string, action: (client: PairLeaseClient) => Promise<PairLeaseClientResult>) => {
      const client = clientRef.current;
      if (!client || busy) return;
      setBusy(label);
      try {
        const result = await action(client);
        // La renovación sigue sólo mientras la escritura esté confirmada.
        if (result.ok && result.state.canWrite) client.startRenewal();
        else if (!result.state.canWrite) client.stopRenewal();
      } finally {
        setBusy(null);
      }
    },
    [busy]
  );

  const connect = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    setSessionId(next);
    setState(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('sessionId', next);
      window.history.replaceState(null, '', url);
    } catch {
      /* sin History API la sesión igual queda en memoria */
    }
  };

  const lease = state?.lease ?? null;
  const pending = lease?.pending ?? null;
  const canWrite = Boolean(state?.canWrite);
  const disabled = busy !== null || state?.phase === 'syncing';

  return (
    <div className="min-h-screen nc-container p-4 sm:p-6" data-testid="pair-screen">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--nc-text-dim)]">
            Commander AI Studio · pair
          </p>
          <h1 className="text-lg font-bold text-[var(--nc-text-accent)]">Control de la sesión</h1>
          <p className="text-xs text-[var(--nc-text-dim)]">
            Un solo dispositivo escribe; el resto lee y puede pedir el traspaso.
          </p>
        </header>

        <form onSubmit={connect} className="nc-panel flex flex-col gap-2 p-3 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1 text-xs">
            <span className="block text-[var(--nc-text-dim)]">Sesión</span>
            <input
              data-testid="pair-session"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="sess_…"
              autoComplete="off"
              spellCheck={false}
              className="w-full border-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] px-2 py-1.5 font-mono text-sm text-[var(--nc-text)] outline-none focus:border-[var(--nc-text-accent)]"
            />
          </label>
          <button type="submit" data-testid="pair-connect" className="nc-button text-xs" disabled={!draft.trim()}>
            Conectar
          </button>
        </form>

        {deviceNote && (
          <p
            data-testid="pair-device-note"
            className="border-2 border-[var(--nc-border-mid)] bg-[var(--nc-bg-panel)] p-2 text-xs text-[var(--nc-text-accent)]"
          >
            {deviceNote}
          </p>
        )}

        {!sessionId && (
          <p className="text-xs text-[var(--nc-text-dim)]">
            Elegí una sesión para ver quién tiene el control.
          </p>
        )}

        {sessionId && state && (
          <section className="nc-panel space-y-3 p-4" aria-live="polite">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p data-testid="pair-status" className="text-sm font-bold">
                {statusText(state)}
              </p>
              <span className="text-[11px] text-[var(--nc-text-dim)]">
                {sessionId}
                {lease ? ` · seq ${lease.seq}` : ''}
              </span>
            </div>

            <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-[var(--nc-text-dim)]">Dueño</dt>
                <dd data-testid="pair-owner">{ownerLabel(lease?.deviceId)}</dd>
              </div>
              <div>
                <dt className="text-[var(--nc-text-dim)]">Caducidad</dt>
                <dd data-testid="pair-expiry">
                  {lease ? clock(lease.expiresAt) : '—'}
                  {lease?.expiresAt !== null && lease ? ` · renueva cada ${Math.round(state.renewMs / 1000)} s` : ''}
                </dd>
              </div>
            </dl>

            <p
              data-testid="pair-renewal"
              className={`text-xs ${state.renewalActive ? 'text-[var(--nc-success)]' : 'text-[var(--nc-text-dim)]'}`}
            >
              {state.renewalActive ? 'Renovación activa cada 30 s' : 'Renovación detenida'}
            </p>

            {pending && (
              <p data-testid="pair-pending" className="text-xs text-[var(--nc-text-accent)]">
                Traspaso pedido por {ownerLabel(pending.deviceId)}
                {canWrite ? ': aceptalo para cederle el control.' : ': esperando que el dueño lo acepte.'}
              </p>
            )}

            {state.ack && (
              <p data-testid="pair-ack" className="text-xs text-[var(--nc-success)]">
                Control cedido a {state.ack.deviceId} · seq {state.ack.seq}
              </p>
            )}

            {state.lastError && (
              <div
                data-testid="pair-error"
                role="alert"
                className="border-2 border-[var(--nc-danger)] bg-[var(--nc-bg-panel)] p-2 text-xs text-[var(--nc-danger)]"
              >
                <p className="font-bold">{[state.lastError.code ?? 'ERROR', state.lastError.message].join(' · ')}</p>
                {state.lastError.code === 'LEASE_HELD' && (
                  <p className="mt-1 text-[var(--nc-text)]">
                    La sesión la escribe otro dispositivo. Pedí el traspaso y esperá que el dueño lo acepte; no
                    insistas con el reclamo.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="pair-refresh"
                className="nc-button text-xs"
                disabled={disabled}
                onClick={() => run('refresh', (client) => client.refresh())}
              >
                Actualizar estado
              </button>

              {!canWrite && (
                <>
                  <button
                    type="button"
                    data-testid="pair-claim"
                    className="nc-button text-xs"
                    disabled={disabled}
                    onClick={() => run('claim', (client) => client.claim())}
                  >
                    Reclamar control
                  </button>
                  <button
                    type="button"
                    data-testid="pair-request"
                    className="nc-button text-xs"
                    disabled={disabled || pending !== null}
                    onClick={() => run('request', (client) => client.requestTransfer())}
                  >
                    Pedir traspaso
                  </button>
                </>
              )}

              {canWrite && (
                <>
                  <button
                    type="button"
                    data-testid="pair-release"
                    className="nc-button text-xs"
                    disabled={disabled}
                    onClick={() => run('release', (client) => client.release())}
                  >
                    Liberar control
                  </button>
                  {pending && (
                    <button
                      type="button"
                      data-testid="pair-accept"
                      className="nc-button text-xs"
                      disabled={disabled}
                      onClick={() => run('accept', (client) => client.transfer())}
                    >
                      Aceptar traspaso a {ownerLabel(pending.deviceId)}
                    </button>
                  )}
                </>
              )}
            </div>

            {canWrite && (
              <div className="flex flex-col gap-2 border-t-2 border-[var(--nc-border-dark)] pt-3 sm:flex-row sm:items-end">
                <label className="flex-1 space-y-1 text-xs">
                  <span className="block text-[var(--nc-text-dim)]">Ceder el control a (deviceId)</span>
                  <input
                    data-testid="pair-target"
                    placeholder="dev_…"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full border-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] px-2 py-1.5 font-mono text-sm text-[var(--nc-text)] outline-none focus:border-[var(--nc-text-accent)]"
                    onChange={(event) => {
                      targetRef.current = event.target.value.trim();
                    }}
                  />
                </label>
                <button
                  type="button"
                  data-testid="pair-transfer"
                  className="nc-button text-xs"
                  disabled={disabled}
                  onClick={() =>
                    run('transfer', (client) =>
                      client.transfer(targetRef.current ? { toDeviceId: targetRef.current } : {})
                    )
                  }
                >
                  Ceder control
                </button>
              </div>
            )}
          </section>
        )}

        {sessionId && !state && (
          <p className="text-xs text-[var(--nc-text-dim)]">Leyendo el control de la sesión…</p>
        )}
      </div>
    </div>
  );
}
