/**
 * Lifecycle de plugins para los bucles que no corren dentro de `AgentSession`.
 *
 * El bucle del navegador (`AgentLoop`) y el del CLI (`runAgent`) ejecutan el
 * agente fuera del servidor, pero los plugins viven en el proyecto y los carga
 * `pluginsRuntime`. Por eso cada hook viaja a `POST /api/plugins/lifecycle`, que
 * ejecuta el mismo runtime: no hay un segundo cargador ni otra semántica.
 *
 * Los hooks son observacionales. Un servidor sin plugins, un plugin que lanza o
 * una red caída no cambian la corrida: el emisor se traga el fallo.
 */

export type PluginLifecycleHook =
  | 'sessionStart'
  | 'beforeModel'
  | 'afterModel'
  | 'sessionEnd'
  | 'stop'
  | 'error';

/** Cierre de una corrida: normal, cancelada o fallida. */
export type PluginCloseOutcome =
  | { kind: 'done'; answer: string }
  | { kind: 'stopped'; reason: 'user' | 'timeout' }
  | { kind: 'error'; error: string };

export interface PluginLifecycleContext {
  sessionId: string;
  root: string;
  goal: string;
  model: string;
}

export type PluginLifecycleTransport = (
  hook: PluginLifecycleHook,
  context: Record<string, unknown>,
) => Promise<unknown>;

/** Ruta del endpoint que ejecuta el runtime en el servidor. */
export const PLUGIN_LIFECYCLE_PATH = '/api/plugins/lifecycle';

/** Transporte HTTP; `baseUrl` vacío usa el mismo origen (navegador). */
export function httpPluginLifecycleTransport(options: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
} = {}): PluginLifecycleTransport {
  const base = String(options.baseUrl ?? '').replace(/\/+$/, '');
  const url = `${base}${PLUGIN_LIFECYCLE_PATH}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (hook, context) => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook, context }),
      // La corrida no espera al cierre; `keepalive` deja salir la petición.
      keepalive: true,
    });
    if (!response.ok) return undefined;
    return response.json().catch(() => undefined);
  };
}

/**
 * Lifecycle de una corrida.
 *
 * `start()` se espera para que `sessionStart` preceda al primer modelo; los
 * hooks de modelo también se esperan. El cierre es idempotente y silencioso, y
 * después de cerrar se ignoran los eventos tardíos (un `afterModel` que llega
 * cuando el usuario ya detuvo la corrida).
 */
export class RunPluginLifecycle {
  private started = false;
  private closed = false;

  constructor(
    private readonly transport: PluginLifecycleTransport,
    private readonly context: PluginLifecycleContext,
  ) {}

  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    await this.emit('sessionStart', {});
  }

  beforeModel(turn: number): Promise<void> {
    return this.emit('beforeModel', { phase: 'before', turn });
  }

  afterModel(turn: number, ok: boolean, error?: string): Promise<void> {
    return this.emit('afterModel', {
      phase: 'after',
      turn,
      ok,
      ...(ok || !error ? {} : { error }),
    });
  }

  /** Cierra una sola vez: `sessionEnd`, `stop` o `error`, nunca dos. */
  close(outcome: PluginCloseOutcome): Promise<void> {
    if (this.closed || !this.started) return Promise.resolve();
    this.closed = true;
    switch (outcome.kind) {
      case 'done':
        return this.emit('sessionEnd', { answer: outcome.answer });
      case 'stopped':
        return this.emit('stop', { reason: outcome.reason });
      default:
        return this.emit('error', { error: outcome.error });
    }
  }

  private async emit(hook: PluginLifecycleHook, extra: Record<string, unknown>): Promise<void> {
    const terminal = hook === 'sessionEnd' || hook === 'stop' || hook === 'error';
    if (this.closed && !terminal) return;
    try {
      await this.transport(hook, { ...this.context, ...extra });
    } catch {
      /* un hook caído o un servidor sin plugins no rompe la corrida */
    }
  }
}

export function createPluginLifecycle(options: {
  context: PluginLifecycleContext;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): RunPluginLifecycle {
  return new RunPluginLifecycle(
    httpPluginLifecycleTransport({ baseUrl: options.baseUrl, fetchImpl: options.fetchImpl }),
    options.context,
  );
}
