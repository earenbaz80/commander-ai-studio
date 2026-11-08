/**
 * Contrato HTTP de `/api/keys`: el valor de una clave sólo puede viajar al
 * navegador en la cookie httpOnly que emite `POST /api/keys`. Ningún cuerpo ni
 * otra cabecera de la respuesta puede repetirlo.
 *
 * Se prueba contra el server real y no contra los handlers sueltos porque el
 * fallo que se quiere atrapar es el serializado de Express: un `res.json` que
 * empiece a incluir el valor, o un error que lo devuelva tal cual. Los handlers
 * por separado ya tienen sus casos en `tests/apiKeys.test.ts`.
 *
 * El POST es la única excepción deliberada: su `Set-Cookie` lleva el secreto
 * para que el navegador lo guarde. Ese caso se comprueba aparte, incluyendo
 * `HttpOnly` y `SameSite=Strict`; el resto de cabeceras sigue sin poder
 * repetirlo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;

before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

const CLAVE = 'GEMINI_API_KEY';
const CANARIO = `contrato-keys-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const COOKIE = `ai_studio_${CLAVE}=${encodeURIComponent(CANARIO)}`;

interface Respuesta {
  status: number;
  body: any;
  raw: string;
  headers: http.IncomingHttpHeaders;
  setCookie: string[];
}

/**
 * Petición con cabeceras propias y acceso a `Set-Cookie`. El arnés compartido
 * no expone cabeceras; se repite su molde (socket por petición, cuerpo leído
 * entero, 30 s) para no cambiar la interfaz que usan los demás tests.
 */
function pedir(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string } = {}
): Promise<Respuesta> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, srv.baseUrl);
    const payload = opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body));
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        agent: false,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: any = null;
          try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
          const setCookie = Array.isArray(res.headers['set-cookie'])
            ? res.headers['set-cookie']
            : [];
          resolve({ status: res.statusCode ?? 0, body, raw, headers: res.headers, setCookie });
        });
      }
    );
    req.setTimeout(30_000, () => req.destroy(new Error('sin respuesta del server en 30s')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sinFuga(etiqueta: string, res: Respuesta, permitirSetCookie = false): void {
  assert.ok(
    !res.raw.includes(CANARIO),
    `${etiqueta}: el cuerpo de la respuesta repite el valor de la clave`
  );

  const cabeceras = Object.entries(res.headers).flatMap(([name, value]) => {
    if (name.toLowerCase() === 'set-cookie' || value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((v) => `${name}: ${v}`);
  });
  assert.ok(
    !cabeceras.join('\n').includes(CANARIO),
    `${etiqueta}: otra cabecera de la respuesta repite el valor de la clave`
  );

  if (permitirSetCookie) {
    // El POST puede emitir dos cookies: la de la clave y la del token CSRF.
    // Sólo la primera puede contener el valor; si aparece en la del token (o en
    // cualquier otra), el contrato está roto.
    const cookiesConValor = res.setCookie
      .filter((c) => c.includes(CANARIO))
      .map((c) => c.slice(0, c.indexOf('=')))
      .sort();
    assert.deepEqual(
      cookiesConValor,
      [`ai_studio_${CLAVE}`],
      `${etiqueta}: el valor sólo puede viajar en la cookie httpOnly de la clave`
    );
  } else {
    assert.ok(
      !res.setCookie.join('\n').includes(CANARIO),
      `${etiqueta}: una cookie inesperada repite el valor de la clave`
    );
  }
}

test('apiKeys: las respuestas exitosas no filtran el valor fuera de la cookie httpOnly', async () => {
  // El POST sí lleva el valor en Set-Cookie: es el canal de guardado. El cuerpo
  // y las demás cabeceras no pueden repetirlo.
  const set = await pedir('POST', '/api/keys', { body: { key: CLAVE, value: CANARIO } });
  assert.equal(set.status, 200, set.raw);
  sinFuga('POST /api/keys', set, true);

  const cookieDeLaClave = set.setCookie.find((c) => c.startsWith(`ai_studio_${CLAVE}=`));
  assert.ok(cookieDeLaClave, 'POST /api/keys debe emitir la cookie de la clave');
  assert.match(cookieDeLaClave!, /HttpOnly/i, 'la cookie de la clave debe ser httpOnly');
  assert.match(cookieDeLaClave!, /SameSite=Strict/i, 'la cookie de la clave debe ser SameSite=Strict');
  assert.ok(cookieDeLaClave!.includes(CANARIO), 'la cookie debe llevar el valor que se guarda');

  const list = await pedir('GET', '/api/keys', { cookie: COOKIE });
  assert.equal(list.status, 200, list.raw);
  assert.equal(list.body.keys[CLAVE], true, 'la lista debe reflejar que la clave está configurada');
  sinFuga('GET /api/keys', list);

  const getParam = await pedir('GET', `/api/keys/${CLAVE}`, { cookie: COOKIE });
  assert.equal(getParam.status, 200, getParam.raw);
  assert.equal(getParam.body.configured, true);
  sinFuga('GET /api/keys/:key', getParam);

  const del = await pedir('DELETE', '/api/keys', { body: { key: CLAVE }, cookie: COOKIE });
  assert.equal(del.status, 200, del.raw);
  assert.equal(del.body.success, true);
  sinFuga('DELETE /api/keys', del);
});

test('apiKeys: las respuestas de error tampoco reflejan el valor de la clave', async () => {
  const casos: Array<{ etiqueta: string; method: string; path: string; body?: unknown }> = [
    {
      etiqueta: 'POST /api/keys con clave fuera de la allowlist',
      method: 'POST',
      path: '/api/keys',
      body: { key: 'AWS_SECRET_ACCESS_KEY', value: CANARIO },
    },
    {
      etiqueta: 'POST /api/keys sin value',
      method: 'POST',
      path: '/api/keys',
      body: { key: CLAVE },
    },
    {
      etiqueta: 'GET /api/keys/:key con clave inválida',
      method: 'GET',
      path: '/api/keys/AWS_SECRET_ACCESS_KEY',
    },
    {
      etiqueta: 'GET /api/keys/:key con el valor como clave inválida',
      method: 'GET',
      path: `/api/keys/${encodeURIComponent(CANARIO)}`,
    },
    {
      etiqueta: 'DELETE /api/keys con clave inválida',
      method: 'DELETE',
      path: '/api/keys',
      body: { key: 'AWS_SECRET_ACCESS_KEY', value: CANARIO },
    },
  ];

  for (const caso of casos) {
    const res = await pedir(caso.method, caso.path, { body: caso.body });
    assert.equal(res.status, 400, `${caso.etiqueta}: ${res.raw}`);
    sinFuga(caso.etiqueta, res);
  }
});

test('apiKeys: una clave no configurada responde sin valor y sin cookies', async () => {
  const list = await pedir('GET', '/api/keys');
  assert.equal(list.status, 200, list.raw);
  assert.equal(list.body.keys[CLAVE], false);
  sinFuga('GET /api/keys sin cookie', list);

  const get = await pedir('GET', `/api/keys/${CLAVE}`);
  assert.equal(get.status, 200, get.raw);
  assert.equal(get.body.configured, false);
  sinFuga('GET /api/keys/:key sin cookie', get);
});
