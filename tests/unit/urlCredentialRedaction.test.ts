/**
 * `fetch` repite la URL entera cuando rechaza una con credenciales, y un host
 * con clave guardado en la config (`https://usuario:clave@host`) viajaría en el
 * mensaje del error. La redacción tapa el userinfo y deja host y puerto.
 */
import { expect, it } from 'vitest';
import { redactSecrets } from '../../secretRedaction';

const PASSWORD = 'clave-de-host-9d3f';

it('tapa la credencial de una URL que fetch repite en el error', () => {
  const message =
    'TypeError: Request cannot be constructed from a URL that includes credentials: ' +
    `http://usuario:${PASSWORD}@127.0.0.1:1234/v1/models`;

  const redacted = redactSecrets(message);

  expect(redacted).toContain('http://[redactado]@127.0.0.1:1234/v1/models');
  expect(redacted).not.toContain(PASSWORD);
  expect(redacted).not.toContain('usuario');
});

it('tapa también el userinfo dentro de un mensaje de conexión', () => {
  const message =
    `No se pudo conectar a LM Studio en http://usuario:${PASSWORD}@10.0.0.5:1234/v1. ` +
    `Failed to parse URL from http://usuario:${PASSWORD}@10.0.0.5:1234/v1`;

  const redacted = redactSecrets(message);

  expect(redacted).toContain('No se pudo conectar a LM Studio en http://[redactado]@10.0.0.5:1234/v1');
  expect(redacted).toContain('Failed to parse URL from http://[redactado]@10.0.0.5:1234/v1');
  expect(redacted).not.toContain(PASSWORD);
});

it('no toca una URL sin credenciales', () => {
  const message = 'HTTP 404 en https://api.openai.com/v1/models';

  expect(redactSecrets(message)).toBe(message);
});
