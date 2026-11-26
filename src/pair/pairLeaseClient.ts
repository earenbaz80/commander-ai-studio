/**
 * Cliente web del control lease (F3, §6.4 del modelo de amenazas remoto).
 *
 * Habla las rutas del host desde el navegador emparejado (la cookie de
 * dispositivo viaja con `credentials: 'same-origin'`):
 *
 * - `claim()` toma el control; `renew()` lo mantiene con el `seq` vigente.
 * - `startRenewal()` renueva cada 30 s (el servidor puede anunciar otro
 *   intervalo en `renewMs`); sin renovación el lease caduca y el control vuelve
 *   al escritorio. Los ticks no se solapan y un fallo deja de renovar.
 * - `requestTransfer()` sólo deja la solicitud; `transfer()` la acepta. La
 *   respuesta trae el `ack` y el cliente **no habilita la escritura** hasta
 *   verificarlo: `ack.deviceId` y `ack.seq` tienen que coincidir con el lease
 *   devuelto. Sin ack válido el traspaso se considera fallido y se sigue en
 *   lectura, aunque el servidor haya cambiado el dueño.
 * - `sendMessage()`, `resolveApproval()`, `cancel()`, `forkAndRun()`,
 *   `saveState()` y `applyProposal()` escriben en la sesión con el `seq` que
 *   tiene el estado: el turno de usuario, la decisión de una aprobación
 *   (aprobar es aplicar un diff), parar la corrida, arrancar una copia,
 *   guardar el checkpoint del CLI y aplicar una propuesta guardada. Si el
 *   servidor responde `LEASE_STALE` (una renovación en vuelo movió el testigo)
 *   releen el estado y, cuando el control sigue siendo de este dispositivo,
 *   reintentan **una sola vez** con el `seq` nuevo: al dueño vigente no lo
 *   bloquea un `seq` desactualizado. Si el control cambió de dueño no
 *   reintentan; el 409 es la verdad. El fork de sólo copia (sin arrancar la
 *   copia), el `dryRun` de una propuesta y las lecturas no escriben: no pasan
 *   por este cliente.
 * - Quien recibe el control por un traspaso ajeno lo descubre con `refresh()`,
 *   pero tampoco escribe con eso: `canWrite` sólo se enciende con una
 *   confirmación propia (reclamo, renovación exitosa o escritura aceptada con
 *   el `seq` vigente). El temporizador lo hace solo en el siguiente tick.
 *
 * El módulo no toca el DOM: `fetch`, reloj e intervalos son inyectables para
 * probarlo en node sin red y sin esperar 30 s. La pantalla/PWA que lo usa es
 * otro tramo de F3.
 */
import type { PairLease } from './pairLease.js';

export interface PairLeaseAck {
  deviceId: string;
  seq: number;
  at: number;
}

export interface PairLeaseError {
  status: number;
  code: string | null;
  message: string;
}

export type PairLeasePhase = 'idle' | 'syncing' | 'owned' | 'readonly' | 'error';

export interface PairLeaseClientState {
  sessionId: string;
  phase: PairLeasePhase;
  lease: PairLease | null;
  /** El lease vigente es de este dispositivo. */
  mine: boolean;
  /** Sólo con confirmación propia (reclamo, renovación o ack válido). */
  canWrite: boolean;
  /** Hay un traspaso en vuelo esperando el ack. */
  pending: boolean;
  /** El temporizador de renovación está corriendo. */
  renewalActive: boolean;
  ack: PairLeaseAck | null;
  renewMs: number;
  lastError: PairLeaseError | null;
}

export type PairLeaseClientResult =
  | { ok: true; state: PairLeaseClientState }
  | { ok: false; error: PairLeaseError; state: PairLeaseClientState };

/** Cuerpo de una escritura de sesión; el `seq` lo agrega el cliente. */
export interface PairLeaseWriteBody {
  text: string;
}

/** Decisión sobre una aprobación; el `seq` también lo agrega el cliente. */
export interface PairLeaseApprovalBody {
  decision: 'allow' | 'deny' | 'allow-session';
  reason?: string;
}

/**
 * Primer turno opcional de la copia; el arranque no se elige: `forkAndRun()`
 * siempre manda `run: true`, porque copiar sin arrancar no escribe y no pide
 * el control de la sesión.
 */
export interface PairLeaseForkAndRunBody {
  text?: string;
}

export type PairLeaseWriteResult =
  | { ok: true; data: any; state: PairLeaseClientState }
  | { ok: false; error: PairLeaseError; state: PairLeaseClientState };

export interface PairLeaseClientOptions {
  sessionId: string;
  /** Origen del servidor; vacío cuando la app se sirve desde él. */
  baseUrl?: string;
  /** Identidad propia, si ya se conoce; sin ella un ack sólo puede verificarse por seq. */
  deviceId?: string;
  fetchImpl?: typeof fetch;
  /** 30 s por defecto; el `renewMs` del servidor manda si es válido. */
  renewMs?: number;
  setIntervalImpl?: (fn: () => unknown, ms: number) => unknown;
  clearIntervalImpl?: (handle: unknown) => void;
}

export interface PairLeaseClient {
  getState(): PairLeaseClientState;
  subscribe(listener: (state: PairLeaseClientState) => void): () => void;
  refresh(): Promise<PairLeaseClientResult>;
  claim(): Promise<PairLeaseClientResult>;
  renew(): Promise<PairLeaseClientResult>;
  startRenewal(): void;
  stopRenewal(): void;
  requestTransfer(): Promise<PairLeaseClientResult>;
  transfer(options?: { toDeviceId?: string }): Promise<PairLeaseClientResult>;
  /** Escritura de sesión firmada con el `seq` del lease. */
  sendMessage(body: PairLeaseWriteBody): Promise<PairLeaseWriteResult>;
  /** Decisión de una aprobación firmada con el `seq` del lease. */
  resolveApproval(
    approvalId: string,
    body: PairLeaseApprovalBody
  ): Promise<PairLeaseWriteResult>;
  /** Parar la corrida cambia el estado: va firmada con el `seq` del lease. */
  cancel(): Promise<PairLeaseWriteResult>;
  /**
   * Bifurca la sesión y **arranca** la copia (`run: true`): es la variante que
   * escribe. El fork de sólo copia no pide control y queda fuera de este
   * cliente; por eso el arranque está en el nombre y no en una opción.
   */
  forkAndRun(body?: PairLeaseForkAndRunBody): Promise<PairLeaseWriteResult>;
  /** Checkpoint del CLI (`PUT /state`) firmado con el `seq` del lease. */
  saveState(state: unknown): Promise<PairLeaseWriteResult>;
  /** Aplica una propuesta guardada (escribe el archivo), firmada y sin `dryRun`. */
  applyProposal(proposalId: string): Promise<PairLeaseWriteResult>;
  release(): Promise<PairLeaseClientResult>;
  dispose(): void;
}

export const PAIR_LEASE_CLIENT_RENEW_MS = 30_000;

function isAck(value: any): value is PairLeaseAck {
  return (
    Boolean(value) &&
    typeof value.deviceId === 'string' &&
    value.deviceId.length > 0 &&
    Number.isInteger(value.seq) &&
    typeof value.at === 'number'
  );
}

function snapshot(state: PairLeaseClientState): PairLeaseClientState {
  return {
    ...state,
    lease: state.lease ? { ...state.lease, pending: state.lease.pending ? { ...state.lease.pending } : null } : null,
    ack: state.ack ? { ...state.ack } : null,
    lastError: state.lastError ? { ...state.lastError } : null,
  };
}

export function createPairLeaseClient(options: PairLeaseClientOptions): PairLeaseClient {
  const sessionId = String(options.sessionId || '').trim();
  if (!sessionId) throw new Error('createPairLeaseClient necesita una sesión');
  const base = String(options.baseUrl || '').trim().replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const setIntervalImpl =
    options.setIntervalImpl ??
    ((fn: () => unknown, ms: number) => setInterval(fn, ms) as unknown);
  const clearIntervalImpl =
    options.clearIntervalImpl ?? ((handle: unknown) => clearInterval(handle as any));

  let state: PairLeaseClientState = {
    sessionId,
    phase: 'idle',
    lease: null,
    mine: false,
    canWrite: false,
    pending: false,
    renewalActive: false,
    ack: null,
    renewMs: options.renewMs && options.renewMs > 0 ? options.renewMs : PAIR_LEASE_CLIENT_RENEW_MS,
    lastError: null,
  };
  let deviceId = options.deviceId ? String(options.deviceId) : null;
  /** `seq` con el que el servidor nos confirmó el control en una mutación propia. */
  let verifiedSeq: number | null = null;
  let renewing = false;
  let timer: unknown = null;

  const listeners = new Set<(state: PairLeaseClientState) => void>();

  function emit(): void {
    const view = snapshot(state);
    for (const listener of listeners) {
      try {
        listener(view);
      } catch {
        /* un listener roto no frena al cliente */
      }
    }
  }

  function update(patch: Partial<PairLeaseClientState>): void {
    state = { ...state, ...patch };
    emit();
  }

  function fail(error: PairLeaseError, patch: Partial<PairLeaseClientState> = {}): PairLeaseClientResult {
    update({ ...patch, lastError: error });
    return { ok: false, error, state: snapshot(state) };
  }

  async function call(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown
  ): Promise<{ ok: true; data: any } | { ok: false; error: PairLeaseError }> {
    const init: RequestInit = { method, credentials: 'same-origin' };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    try {
      const response = await doFetch(`${base}${path}`, init);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        return {
          ok: false,
          error: {
            status: response.status,
            code: typeof data?.code === 'string' ? data.code : null,
            message: String(data?.error ?? `HTTP ${response.status}`),
          },
        };
      }
      return { ok: true, data };
    } catch (e: any) {
      return {
        ok: false,
        error: { status: 0, code: null, message: `sin conexión: ${e?.message || e}` },
      };
    }
  }

  function applyLease(lease: PairLease, patch: Partial<PairLeaseClientState> = {}): PairLeaseClientState {
    state = {
      ...state,
      lease,
      pending: lease.pending !== null,
      ...patch,
    };
    emit();
    return snapshot(state);
  }

  function refreshMs(data: any): number {
    const announced = Number(data?.renewMs);
    return Number.isFinite(announced) && announced > 0 ? Math.floor(announced) : state.renewMs;
  }

  async function refresh(): Promise<PairLeaseClientResult> {
    update({ phase: 'syncing' });
    const result = await call(
      'GET',
      `/api/pair/lease?sessionId=${encodeURIComponent(sessionId)}`
    );
    if (!result.ok) return fail(result.error, { phase: 'error', canWrite: false });

    const lease = result.data.lease as PairLease | undefined;
    if (!lease || typeof lease.seq !== 'number') {
      return fail(
        { status: 200, code: 'LEASE_BAD_STATE', message: 'el servidor no devolvió un lease utilizable' },
        { phase: 'error', canWrite: false }
      );
    }
    const mine = Boolean(result.data.mine);
    const confirmed = mine && verifiedSeq === lease.seq;
    if (!mine) verifiedSeq = null;
    applyLease(lease, {
      mine,
      canWrite: confirmed,
      phase: confirmed ? 'owned' : 'readonly',
      renewMs: refreshMs(result.data),
      lastError: null,
    });
    return { ok: true, state: snapshot(state) };
  }

  async function claim(): Promise<PairLeaseClientResult> {
    update({ phase: 'syncing', canWrite: false });
    const result = await call('POST', '/api/pair/lease', { sessionId });
    if (!result.ok) return fail(result.error, { phase: 'readonly' });
    const lease = result.data.lease as PairLease;
    verifiedSeq = lease.seq;
    applyLease(lease, {
      mine: true,
      canWrite: true,
      phase: 'owned',
      ack: null,
      renewMs: refreshMs(result.data),
      lastError: null,
    });
    return { ok: true, state: snapshot(state) };
  }

  async function renew(): Promise<PairLeaseClientResult> {
    const seq = state.lease?.seq;
    if (typeof seq !== 'number') {
      return fail({
        status: 0,
        code: 'LEASE_NO_STATE',
        message: 'no hay lease que renovar: pedí el estado primero',
      });
    }
    const result = await call('POST', '/api/pair/lease/renew', { sessionId, seq });
    if (!result.ok) {
      // HELD/STALE: otro dispositivo tiene el control o cambió el testigo.
      // Seguir renovando sólo repetiría el 409, así que se corta el temporizador.
      stopRenewal();
      return fail(result.error, { canWrite: false, phase: 'readonly' });
    }
    const lease = result.data.lease as PairLease;
    verifiedSeq = lease.seq;
    applyLease(lease, {
      mine: true,
      canWrite: true,
      phase: 'owned',
      renewMs: refreshMs(result.data),
      lastError: null,
    });
    return { ok: true, state: snapshot(state) };
  }

  /**
   * Fallo de una escritura de sesión (turno, aprobación, propuesta).
   *
   * No es un problema del control: la pantalla ya lo cuenta en el chat con
   * `sessionNote`. `lastError` queda para reclamo, renovación y traspaso, que
   * son los que alimentan la alerta del panel del lease; si una aprobación
   * fallaba, el mismo error salía dos veces (nota y alerta).
   */
  function failWrite(error: PairLeaseError): PairLeaseWriteResult {
    return { ok: false, error, state: snapshot(state) };
  }

  function postMessage(body: PairLeaseWriteBody, seq: number) {
    return call('POST', `/api/agent/sessions/${encodeURIComponent(sessionId)}/message`, {
      ...body,
      seq,
    });
  }

  function postApproval(approvalId: string, body: PairLeaseApprovalBody, seq: number) {
    return call(
      'POST',
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`,
      { ...body, seq }
    );
  }

  function postCancel(seq: number) {
    return call('POST', `/api/agent/sessions/${encodeURIComponent(sessionId)}/cancel`, { seq });
  }

  function postForkAndRun(body: PairLeaseForkAndRunBody, seq: number) {
    return call('POST', `/api/agent/sessions/${encodeURIComponent(sessionId)}/fork`, {
      ...body,
      run: true,
      seq,
    });
  }

  function putState(state: unknown, seq: number) {
    return call('PUT', `/api/agent/sessions/${encodeURIComponent(sessionId)}/state`, {
      state,
      seq,
    });
  }

  function postApply(proposalId: string, seq: number) {
    return call(
      'POST',
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/proposals/${encodeURIComponent(proposalId)}/apply`,
      { seq }
    );
  }

  /** El servidor aceptó la escritura con este `seq`: el control es nuestro. */
  function confirmWrite(seq: number, data: any): PairLeaseWriteResult {
    verifiedSeq = seq;
    update({ mine: true, canWrite: true, phase: 'owned', lastError: null });
    return { ok: true, data, state: snapshot(state) };
  }

  /**
   * Escritura firmada con el `seq` del lease. Ante `LEASE_STALE` se relee el
   * estado y, si el control sigue siendo propio, se reintenta una sola vez con
   * el `seq` nuevo; si cambió de dueño, el 409 es la verdad. Lo comparten el
   * turno y la aprobación porque el servidor exige el mismo testigo en ambas.
   */
  async function writeSigned(
    send: (seq: number) => ReturnType<typeof call>
  ): Promise<PairLeaseWriteResult> {
    const seq = state.lease?.seq;
    if (typeof seq !== 'number') {
      return failWrite({
        status: 0,
        code: 'LEASE_NO_STATE',
        message: 'no hay lease que firmar: pedí el estado primero',
      });
    }
    const first = await send(seq);
    if (first.ok) return confirmWrite(seq, first.data);
    if (first.error.code !== 'LEASE_STALE') return failWrite(first.error);

    // El testigo viejo no se reintenta a ciegas: primero se relee el estado.
    // Si el control sigue siendo propio, el `seq` nuevo desbloquea la
    // escritura; si cambió de dueño, insistir sólo repetiría el 409.
    const refreshed = await refresh();
    if (!refreshed.ok) return { ok: false, error: refreshed.error, state: refreshed.state };
    if (!refreshed.state.mine) return failWrite(first.error);
    const freshSeq = refreshed.state.lease?.seq;
    if (typeof freshSeq !== 'number' || freshSeq === seq) return failWrite(first.error);
    const second = await send(freshSeq);
    if (second.ok) return confirmWrite(freshSeq, second.data);
    return failWrite(second.error);
  }

  function sendMessage(body: PairLeaseWriteBody): Promise<PairLeaseWriteResult> {
    return writeSigned((seq) => postMessage(body, seq));
  }

  function resolveApproval(
    approvalId: string,
    body: PairLeaseApprovalBody
  ): Promise<PairLeaseWriteResult> {
    return writeSigned((seq) => postApproval(approvalId, body, seq));
  }

  function cancel(): Promise<PairLeaseWriteResult> {
    return writeSigned((seq) => postCancel(seq));
  }

  function forkAndRun(body: PairLeaseForkAndRunBody = {}): Promise<PairLeaseWriteResult> {
    return writeSigned((seq) => postForkAndRun(body, seq));
  }

  function saveState(state: unknown): Promise<PairLeaseWriteResult> {
    return writeSigned((seq) => putState(state, seq));
  }

  function applyProposal(proposalId: string): Promise<PairLeaseWriteResult> {
    return writeSigned((seq) => postApply(proposalId, seq));
  }

  async function tick(): Promise<void> {
    if (timer === null || renewing) return;
    renewing = true;
    try {
      await renew();
    } finally {
      renewing = false;
    }
  }

  function startRenewal(): void {
    if (timer !== null) return;
    timer = setIntervalImpl(() => tick(), state.renewMs);
    update({ renewalActive: true });
  }

  function stopRenewal(): void {
    if (timer === null) return;
    clearIntervalImpl(timer);
    timer = null;
    update({ renewalActive: false });
  }

  async function requestTransfer(): Promise<PairLeaseClientResult> {
    const result = await call('POST', '/api/pair/lease/request', { sessionId });
    if (!result.ok) return fail(result.error);
    const lease = result.data.lease as PairLease;
    applyLease(lease, { mine: lease.deviceId === deviceId, lastError: null });
    return { ok: true, state: snapshot(state) };
  }

  async function transfer(target: { toDeviceId?: string } = {}): Promise<PairLeaseClientResult> {
    const current = state.lease;
    const seq = current?.seq;
    if (!current || typeof seq !== 'number') {
      return fail({
        status: 0,
        code: 'LEASE_NO_STATE',
        message: 'no hay lease que traspasar: pedí el estado primero',
      });
    }
    // Mientras el ack está en vuelo no se escribe: el control pudo cambiar.
    update({ pending: true, canWrite: false });
    const body: Record<string, unknown> = { sessionId, seq };
    if (target.toDeviceId) body.toDeviceId = target.toDeviceId;
    const result = await call('POST', '/api/pair/lease/transfer', body);
    if (!result.ok) {
      update({ pending: false, phase: 'readonly' });
      return fail(result.error, { canWrite: false });
    }

    const lease = result.data.lease as PairLease | undefined;
    const ack = result.data.ack;
    if (!lease || !isAck(ack) || ack.seq !== lease.seq || ack.deviceId !== lease.deviceId) {
      // Sin ack verificable no se habilita nada, aunque el dueño ya haya cambiado.
      if (lease) applyLease(lease, { mine: false });
      return fail(
        {
          status: 200,
          code: 'LEASE_ACK_MISSING',
          message: 'el traspaso no trajo un ack que confirme el nuevo dueño y su seq',
        },
        { pending: false, canWrite: false, phase: 'readonly', ack: null }
      );
    }

    verifiedSeq = null;
    const ackForMe = Boolean(deviceId && ack.deviceId === deviceId);
    applyLease(lease, {
      ack,
      pending: false,
      mine: ackForMe,
      // Sólo escribe si el ack lo nombra dueño con el seq vigente.
      canWrite: ackForMe && ack.seq === lease.seq,
      phase: ackForMe ? 'owned' : 'readonly',
      lastError: null,
    });
    return { ok: true, state: snapshot(state) };
  }

  async function release(): Promise<PairLeaseClientResult> {
    const seq = state.lease?.seq;
    if (typeof seq !== 'number') {
      return fail({
        status: 0,
        code: 'LEASE_NO_STATE',
        message: 'no hay lease que liberar: pedí el estado primero',
      });
    }
    const result = await call('POST', '/api/pair/lease/release', { sessionId, seq });
    if (!result.ok) return fail(result.error, { canWrite: false });
    const lease = result.data.lease as PairLease;
    verifiedSeq = null;
    applyLease(lease, {
      mine: false,
      canWrite: false,
      phase: 'readonly',
      ack: null,
      lastError: null,
    });
    return { ok: true, state: snapshot(state) };
  }

  return {
    getState: () => snapshot(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    claim,
    renew,
    startRenewal,
    stopRenewal,
    requestTransfer,
    transfer,
    sendMessage,
    resolveApproval,
    cancel,
    forkAndRun,
    saveState,
    applyProposal,
    release,
    dispose() {
      stopRenewal();
      listeners.clear();
    },
  };
}
