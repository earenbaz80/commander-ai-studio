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

/** Tope de una petición de lifecycle; un servidor colgado no frena la corrida. */
export const PLUGIN_LIFECYCLE_TIMEOUT_MS = 15_000;

/** Transporte HTTP; `baseUrl` vacío usa el mismo origen (navegador). */
export function httpPluginLifecycleTransport(options: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): PluginLifecycleTransport {
  const base = String(options.baseUrl ?? '').replace(/\/+$/, '');
  const url = `${base}${PLUGIN_LIFECYCLE_PATH}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PLUGIN_LIFECYCLE_TIMEOUT_MS;
  return async (hook, context) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hook, context }),
        // Si la pestaña se cierra, `keepalive` deja salir el hook.
        keepalive: true,
        signal: controller.signal,
      });
      // La respuesta no se usa: el hook es observacional.
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Lifecycle de una corrida.
 *
 * Todos los hooks viajan por una sola cola: `sessionStart` precede al primer
 * modelo, cada `beforeModel` precede a su `afterModel` y el terminal espera a
 * los hooks ya encolados. Así un `stop()` durante el arranque no puede adelantar
 * al `sessionStart` ni un cierre puede dispararse dos veces.
 */
export class RunPluginLifecycle {
  private started = false;
  private closed = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly transport: PluginLifecycleTransport,
    private readonly context: PluginLifecycleContext,
  ) {}

  start(): Promise<void> {
    if (this.started || this.closed) return this.tail;
    this.started = true;
    return this.append('sessionStart', {});
  }

  beforeModel(turn: number): Promise<void> {
    return this.append('beforeModel', { phase: 'before', turn });
  }

  afterModel(turn: number, ok: boolean, error?: string): Promise<void> {
    return this.append('afterModel', {
      phase: 'after',
      turn,
      ok,
      ...(ok || !error ? {} : { error }),
    });
  }

  /**
   * Cierra una sola vez: `sessionEnd`, `stop` o `error`, nunca dos.
   *
   * El terminal se encola detrás de los hooks que ya estaban en vuelo. Antes de
   * `start()` no hay corrida que cerrar y un `start()` posterior queda anulado.
   */
  close(outcome: PluginCloseOutcome): Promise<void> {
    if (this.closed) return this.tail;
    this.closed = true;
    if (!this.started) return this.tail;
    let hook: PluginLifecycleHook;
    let extra: Record<string, unknown>;
    switch (outcome.kind) {
      case 'done':
        hook = 'sessionEnd';
        extra = { answer: outcome.answer };
        break;
      case 'stopped':
        hook = 'stop';
        extra = { reason: outcome.reason };
        break;
      default:
        hook = 'error';
        extra = { error: outcome.error };
    }
    this.tail = this.tail.then(() => this.send(hook, extra));
    return this.tail;
  }

  /** Encola un hook no terminal; después del cierre se ignora. */
  private append(hook: PluginLifecycleHook, extra: Record<string, unknown>): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.tail = this.tail.then(() => this.send(hook, extra));
    return this.tail;
  }

  private async send(hook: PluginLifecycleHook, extra: Record<string, unknown>): Promise<void> {
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
  timeoutMs?: number;
}): RunPluginLifecycle {
  return new RunPluginLifecycle(
    httpPluginLifecycleTransport({
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    }),
    options.context,
  );
}
