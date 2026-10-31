import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleApiKeySet,
  handleApiKeyGet,
  handleApiKeyDelete,
  handleApiKeysList,
  apiKeyMiddleware,
  getApiKey,
  VALID_KEYS,
} from '../apiKeys.js';
import { CLIENT_VALID_KEYS } from '../src/lib/apiKeys.js';

/**
 * Las dos allowlists son espejos: el servidor decide qué cookie se emite y el
 * cliente qué keys se piden. Si divergen, la key se pierde en silencio.
 */
test('apiKeys: la allowlist del servidor y la del cliente son la misma', () => {
  const servidor = new Set(VALID_KEYS);
  const cliente = new Set(CLIENT_VALID_KEYS);
  // El orden no cuenta y un 12-vs-12 en un deepEqual tampoco dice nada útil: se
  // comparan las diferencias en las dos direcciones para que el fallo nombre el
  // proveedor que quedó a medias, que es el caso real (añadir Gemini 4 o Grok a
  // una lista y olvidar la otra).
  const soloServidor = [...servidor].filter((k) => !cliente.has(k)).sort();
  const soloCliente = [...cliente].filter((k) => !servidor.has(k)).sort();

  assert.deepEqual(
    soloServidor,
    [],
    `añadidas sólo a VALID_KEYS (servidor) y el panel nunca las pide: ${soloServidor.join(', ')}`
  );
  assert.deepEqual(
    soloCliente,
    [],
    `añadidas sólo a CLIENT_VALID_KEYS (cliente) y el servidor las rechaza con 400: ${soloCliente.join(', ')}`
  );
  assert.equal(
    cliente.size,
    CLIENT_VALID_KEYS.length,
    'la lista del cliente no debe repetir keys'
  );
});

test('apiKeys: Freebuff viaja en las dos allowlists', () => {
  // Se nombran explícitamente: si alguien recorta la lista, el mensaje dice qué
  // se perdió en vez de sólo «los conjuntos difieren».
  for (const name of ['FREEBUFF_API_KEY', 'FREEBUFF_BASE_URL']) {
    assert.ok(VALID_KEYS.has(name), `${name} falta en la allowlist del servidor`);
    assert.ok(CLIENT_VALID_KEYS.includes(name), `${name} falta en la allowlist del cliente`);
  }
});

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    cookies: [] as { name: string; value: string; opts: any }[],
    cleared: [] as { name: string; opts: any }[],
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.body = data; return this; },
    cookie(name: string, value: string, opts: any) { this.cookies.push({ name, value, opts }); return this; },
    clearCookie(name: string, opts: any) { this.cleared.push({ name, opts }); return this; },
  };
  return res;
}

function mockReq(overrides: any = {}) {
  return { body: {}, query: {}, cookies: {}, ...overrides } as any;
}

test('apiKeys: guarda una key válida como cookie httpOnly', () => {
  const req = mockReq({ body: { key: 'GEMINI_API_KEY', value: 'AIzaSecret123' } });
  const res = mockRes();
  handleApiKeySet(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);

  const key = res.cookies.find((c: any) => c.name === 'ai_studio_GEMINI_API_KEY');
  assert.ok(key, 'debe emitir la cookie de la key');
  assert.equal(key.value, 'AIzaSecret123');
  assert.equal(key.opts.httpOnly, true, 'la cookie debe ser httpOnly (inaccesible desde JS)');
  assert.equal(key.opts.sameSite, 'strict');
  assert.equal(key.opts.path, '/');
  assert.ok(key.opts.maxAge > 0, 'debe expirar');

  const csrf = res.cookies.find((c: any) => c.name === 'ai_studio_token');
  assert.ok(csrf, 'debe emitir token CSRF');
  assert.equal(csrf.opts.httpOnly, true);
  assert.equal(csrf.value.length, 32, 'token CSRF de 16 bytes en hex');
});

test('apiKeys: secure=true en producción', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = mockRes();
    handleApiKeySet(mockReq({ body: { key: 'GEMINI_API_KEY', value: 'x' } }), res);
    assert.equal(res.cookies.find((c: any) => c.name === 'ai_studio_GEMINI_API_KEY').opts.secure, true);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test('apiKeys: sanitiza CRLF para impedir inyección de cookies', () => {
  const req = mockReq({ body: { key: 'GEMINI_API_KEY', value: 'abc\r\nSet-Cookie: evil=1' } });
  const res = mockRes();
  handleApiKeySet(req, res);

  const value = res.cookies.find((c: any) => c.name === 'ai_studio_GEMINI_API_KEY').value;
  assert.ok(!value.includes('\r') && !value.includes('\n'), 'no debe quedar CRLF en el valor');
});

test('apiKeys: trunca valores largos a 4096', () => {
  const res = mockRes();
  handleApiKeySet(mockReq({ body: { key: 'GEMINI_API_KEY', value: 'a'.repeat(9000) } }), res);
  const value = res.cookies.find((c: any) => c.name === 'ai_studio_GEMINI_API_KEY').value;
  assert.equal(value.length, 4096);
});

test('apiKeys: rechaza key fuera de la allowlist', () => {
  const res = mockRes();
  handleApiKeySet(mockReq({ body: { key: 'AWS_SECRET_ACCESS_KEY', value: 'leak' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.cookies.length, 0, 'no debe emitir ninguna cookie');
});

test('apiKeys: rechaza body sin value', () => {
  const res = mockRes();
  handleApiKeySet(mockReq({ body: { key: 'GEMINI_API_KEY' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.cookies.length, 0);
});

test('apiKeys: get lee el valor de la cookie', () => {
  const req = mockReq({ query: { key: 'GEMINI_API_KEY' }, cookies: { ai_studio_GEMINI_API_KEY: 'AIzaFromCookie' } });
  const res = mockRes();
  handleApiKeyGet(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.value, 'AIzaFromCookie');
});

test('apiKeys: get acepta la key como param de ruta (GET /api/keys/:key)', () => {
  // La ruta registrada en server.ts es `/api/keys/:key`; leer solo `req.query`
  // devolvía 400 y dejaba la key vacía en el cliente.
  const req = mockReq({
    params: { key: 'GEMINI_API_KEY' },
    cookies: { ai_studio_GEMINI_API_KEY: 'AIzaDesdeParam' },
  });
  const res = mockRes();
  handleApiKeyGet(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.value, 'AIzaDesdeParam');
});

test('apiKeys: get devuelve vacío si no hay cookie', () => {
  const res = mockRes();
  handleApiKeyGet(mockReq({ query: { key: 'GEMINI_API_KEY' } }), res);
  assert.equal(res.body.success, true);
  assert.equal(res.body.value, '');
});

test('apiKeys: get rechaza key inválida (no enumera)', () => {
  const res = mockRes();
  handleApiKeyGet(mockReq({ query: { key: 'AWS_SECRET_ACCESS_KEY' } }), res);
  assert.equal(res.statusCode, 400);
});

test('apiKeys: list solo expone presencia, nunca el valor', () => {
  const req = mockReq({ cookies: { ai_studio_GEMINI_API_KEY: 'AIzaNoMostrar', ai_studio_OLLAMA_HOST: 'http://x' } });
  const res = mockRes();
  handleApiKeysList(req, res);

  assert.equal(res.body.success, true);
  assert.equal(res.body.keys.GEMINI_API_KEY, true);
  assert.equal(res.body.keys.OLLAMA_HOST, true);
  assert.equal(res.body.keys.ANTHROPIC_API_KEY, false, 'no configurada debe ser false');

  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes('AIzaNoMostrar'), 'el valor de la key nunca debe salir en la respuesta');
});

test('apiKeys: delete limpia la cookie con path /', () => {
  const res = mockRes();
  handleApiKeyDelete(mockReq({ body: { key: 'GEMINI_API_KEY' } }), res);

  assert.equal(res.body.success, true);
  assert.equal(res.cleared.length, 1);
  assert.equal(res.cleared[0].name, 'ai_studio_GEMINI_API_KEY');
  assert.equal(res.cleared[0].opts.path, '/');
});

test('apiKeys: delete rechaza key inválida', () => {
  const res = mockRes();
  handleApiKeyDelete(mockReq({ body: { key: 'NOPE' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.cleared.length, 0);
});

test('apiKeys: middleware inyecta solo keys presentes', () => {
  const req = mockReq({
    cookies: { ai_studio_GEMINI_API_KEY: 'k1', ai_studio_TOKEN_SOY_FALSO: 'x' },
  });
  let called = false;
  apiKeyMiddleware(req, mockRes(), () => { called = true; });

  assert.equal(called, true, 'debe llamar a next()');
  assert.equal(req.apiKeys.GEMINI_API_KEY, 'k1');
  assert.equal(getApiKey(req, 'GEMINI_API_KEY'), 'k1');
  assert.equal(getApiKey(req, 'ANTHROPIC_API_KEY'), undefined);
  assert.ok(!('TOKEN_SOY_FALSO' in req.apiKeys), 'ignora cookies fuera de la allowlist');
});

test('apiKeys: middleware funciona sin cookies', () => {
  const req = mockReq({ cookies: undefined });
  apiKeyMiddleware(req, mockRes(), () => {});
  assert.deepEqual(req.apiKeys, {});
});
