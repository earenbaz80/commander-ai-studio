/**
 * Host de escucha del servidor.
 *
 * Por defecto escucha en loopback. `serve --host` y `server.host` permiten pedir
 * otra interfaz (`0.0.0.0`, una IP de la LAN, un nombre), pero la API ejecuta
 * tools sobre el workspace y no tiene autenticación propia: exponerla es una
 * decisión explícita del operador y el arranque lo avisa por consola.
 */
export const DEFAULT_BIND_HOST = '127.0.0.1';

export class BindHostError extends Error {
  constructor(requested: string) {
    super(`host de escucha inválido: ${requested}`);
    this.name = 'BindHostError';
  }
}

/**
 * Host efectivo, normalizado a la forma que acepta `server.listen`.
 *
 * `localhost` se resuelve a 127.0.0.1 para que el bind no dependa de la
 * resolución de nombres del sistema; el resto se pasa tal cual, en minúsculas.
 */
export function resolveBindHost(requested?: unknown): string {
  const raw = typeof requested === 'string' ? requested.trim() : '';
  if (!raw) return DEFAULT_BIND_HOST;
  // Un host no es una URL ni lleva espacios: eso es un error de configuración.
  if (/[\s/]/.test(raw) || raw.includes('://')) throw new BindHostError(raw);
  const value = raw.toLowerCase();
  if (value === 'localhost') return DEFAULT_BIND_HOST;
  if (value === '[::1]') return '::1';
  if (value === '[::]') return '::';
  return value;
}

/** ¿El bind queda dentro de la máquina? */
export function isLoopbackHost(host: string): boolean {
  const value = String(host || '').trim().toLowerCase();
  return (
    value === 'localhost' ||
    value === '::1' ||
    value === '[::1]' ||
    /^127\.\d{1,3}(\.\d{1,3}){2}$/.test(value)
  );
}

/** Aviso de exposición, o `null` cuando el bind es loopback. */
export function bindExposureWarning(host: string): string | null {
  if (isLoopbackHost(host)) return null;
  return (
    `[commander] Aviso: el servidor escucha en ${host} y la API no tiene ` +
    'autenticación propia; quien llegue a ese puerto puede ejecutar las tools ' +
    'del agente sobre el workspace.'
  );
}
