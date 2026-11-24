/**
 * Redacción de secretos para textos que salen del servidor.
 *
 * La usan el log de una build y los detalles que devuelven los proveedores
 * externos. Se ocultan los valores de variables sensibles del entorno y los
 * formatos de token conocidos; el resto del texto queda legible para
 * diagnosticar.
 */

/** Variables cuyo valor no debe aparecer en un texto que viaja al cliente. */
const SENSITIVE_ENV =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH|DATABASE_URL|DSN|CONNECTION_STRING)(?:_|$)/i;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsbp_[A-Za-z0-9]{8,}\b/g, '[redactado]'],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redactado]'],
  [/\bgh[pousr]_[A-Za-z0-9]{8,}\b/g, '[redactado]'],
  [/\bgithub_pat_[A-Za-z0-9_]{8,}\b/g, '[redactado]'],
  [/\bxox[abp]-[A-Za-z0-9-]{8,}\b/g, '[redactado]'],
  [/\bAKIA[0-9A-Z]{12,}\b/g, '[redactado]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redactado]'],
];

export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let value = String(text ?? '');
  const values = Object.entries(env)
    .filter(
      ([name, secret]) =>
        typeof secret === 'string' && secret.length >= 6 && SENSITIVE_ENV.test(name)
    )
    .map(([, secret]) => String(secret))
    // Los valores largos primero: si uno contiene a otro, se tapa entero.
    .sort((a, b) => b.length - a.length);
  for (const secret of values) value = value.split(secret).join('[redactado]');

  value = value.replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi, 'postgresql://[redactado]');
  // Credenciales embebidas en una URL (`https://usuario:clave@host`). `fetch`
  // rechaza esas URLs repitiéndolas enteras en el mensaje, así que un host con
  // clave guardado en la config viajaría tal cual en el error. Se tapa sólo el
  // userinfo: el host y el puerto siguen a la vista para diagnosticar.
  value = value.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[redactado]@');
  value = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redactado]');
  value = value.replace(
    /(\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|DATABASE_URL)\s*=\s*)\S+/g,
    '$1[redactado]'
  );
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    value = value.replace(pattern, replacement);
  }
  return value;
}
