/**
 * Runtime del servidor: guarda la base URL a la que el código servidor puede
 * llamarse a sí mismo (p. ej. el agente en sesión invoca los endpoints
 * /api/{provider}/generate internamente, sin refactorizar los handlers).
 */

let baseUrl = 'http://127.0.0.1:3000';

/** Fija la base URL (se llama al arrancar el server con el puerto real). */
export function setServerBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, '');
}

export function getServerBaseUrl(): string {
  return baseUrl;
}
