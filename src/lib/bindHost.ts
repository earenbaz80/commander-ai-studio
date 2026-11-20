/**
 * Host de escucha del servidor.
 *
 * La app no autentica a quien llama y expone la ejecución de tools sobre el
 * workspace, así que el servidor sólo escucha en loopback. `serve --host` y
 * `server.host` eligen entre los alias de loopback; pedir otra interfaz es un
 * error de arranque y no un bind silencioso a 127.0.0.1, para que nadie crea que
 * abrió el servidor a la red cuando en realidad no pasó nada.
 */
export const DEFAULT_BIND_HOST = '127.0.0.1';

const LOOPBACK_ALIASES = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export class BindHostError extends Error {
  constructor(requested: string) {
    super(
      `bind no permitido: ${requested}. El servidor sólo escucha en loopback ` +
        '(127.0.0.1, ::1, localhost); abrirlo a la red dejaría las tools del ' +
        'agente sin autenticación.'
    );
    this.name = 'BindHostError';
  }
}

/** Host efectivo, normalizado a la forma que acepta `server.listen`. */
export function resolveBindHost(requested?: unknown): string {
  const raw = typeof requested === 'string' ? requested.trim() : '';
  if (!raw) return DEFAULT_BIND_HOST;
  const value = raw.toLowerCase();
  if (!LOOPBACK_ALIASES.has(value)) throw new BindHostError(raw);
  if (value === 'localhost') return DEFAULT_BIND_HOST;
  return value === '[::1]' ? '::1' : value;
}
