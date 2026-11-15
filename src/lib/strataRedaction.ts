/**
 * Redacción de credenciales de Strata.
 *
 * Los logs del CLI y los mensajes del host son texto libre: una versión puede
 * imprimir la API key aunque el argumento sea `--api-key-env`. Este helper
 * elimina el valor exacto cuando se conoce y, además, cubre Authorization y
 * asignaciones habituales (`api_key=…`, `token: …`) para no depender de que el
 * llamador recuerde pasar la clave.
 */

const REDACTED = '[redacted]';

export function redactStrataSecret(value: unknown, secret?: string): string {
  let out = String(value ?? '');
  const known = typeof secret === 'string' ? secret.trim() : '';
  // Un secreto de menos de 4 caracteres no se reemplaza: produciría falsos
  // positivos en palabras normales y el valor tampoco es una credencial real.
  if (known.length >= 4) out = out.split(known).join(REDACTED);
  return out
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, `$1${REDACTED}`)
    .replace(
      /((?:api[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|authorization|secret|token)\s*[:=]\s*)(["']?)[^\s"',;}]+/gi,
      `$1$2${REDACTED}`
    );
}
