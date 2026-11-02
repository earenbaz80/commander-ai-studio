import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  GEMINI_KEY_REQUIRED,
  handleGeminiGenerate,
  handleGeminiStream,
  handleFallbackModelsStatus,
  handleResetToolsMemory,
  handleSetFallbackModels,
  handleSetToolsMemoryTtl,
  handleToolsMemoryStatus,
  readableStreamError,
  resolveFallbackChain,
} from '../gemini.js';
import { resetConfig } from '../src/config/index.js';
import {
  GEMINI_DEFAULT_MODEL,
  GEMINI_FALLBACK_MODELS,
  GEMINI_MODEL_CHAIN,
  GEMINI_PRO_MODEL,
  MAX_FALLBACK_MODELS,
  normalizeFallbackChain,
} from '../src/config/geminiModels.js';
import { mapGeminiModel } from '../localModels.js';
import { FREEBUFF_TOOL_MODELS } from '../src/config/freebuffModels.js';
import {
  capabilityTtlMs,
  forgetToolsMemory,
  keyFingerprint,
  keyLacksBuiltinTools,
  rememberKeyLacksBuiltinTools,
} from '../keyCapabilities.js';

// Estado aislado por ejecución: la memoria de keys no toca el ~/.config real.
process.env.COMMANDER_STATE_DIR = mkdtempSync(join(tmpdir(), 'commander-state-'));

/**
 * `closeEarly` reproduce lo que hace Node de verdad: `close` en la petición se
 * dispara al consumirse su cuerpo, sin que el cliente se haya desconectado.
 */
function mockReq(body: any, { closeEarly = false }: { closeEarly?: boolean } = {}) {
  return {
    body,
    ip: '127.0.0.1',
    headers: {},
    cookies: {},
    socket: { setTimeout() { /* noop */ } },
    on(event: string, cb: () => void) { if (closeEarly && event === 'close') cb(); },
  } as any;
}

function mockRes() {
  const chunks: string[] = [];
  const res: any = {
    statusCode: 200,
    body: null,
    ended: false,
    writableEnded: false,
    chunks,
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.body = data; return this; },
    setHeader() { return this; },
    flushHeaders() { /* noop */ },
    on() { return this; },
    write(chunk: string) { chunks.push(String(chunk)); return true; },
    end() { this.ended = true; this.writableEnded = true; return this; },
  };
  return res;
}

/** Ejecuta `fn` con GEMINI_API_KEY garantizado como ausente. */
async function withoutGeminiKey(fn: () => Promise<void>) {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await fn();
  } finally {
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  }
}

test('gemini/generate sin API key responde 400 MISSING_API_KEY (no error de Google)', async () => {
  await withoutGeminiKey(async () => {
    const res = mockRes();
    await handleGeminiGenerate(mockReq({ contents: 'hola', model: 'gemini-2.5-flash' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'MISSING_API_KEY');
    assert.equal(res.body.error, GEMINI_KEY_REQUIRED);
  });
});

/**
 * Ids que la API ya no sirve (404 «no longer available» el 2026-10-27).
 * Reintentarlos sólo alargaba la espera hasta el error del motor local.
 */
const RETIRED_GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-8b',
  'gemini-2.5-flash',
];

test('la cadena explícita se normaliza y una lista vacía es una decisión', () => {
  assert.equal(normalizeFallbackChain(undefined), null, 'no pedir nada = usar la de por defecto');
  assert.equal(normalizeFallbackChain(null), null);
  assert.equal(normalizeFallbackChain('gemini-x'), null, 'un tipo raro no rompe la cadena por defecto');
  assert.deepEqual(normalizeFallbackChain([]), [], 'lista vacía = sin respaldo');
  assert.deepEqual(normalizeFallbackChain([' a ', 'a', 'b', 3, '', null]), ['a', 'b'], 'dedupe y descarta basura');
  const longChain = normalizeFallbackChain(Array.from({ length: 10 }, (_, i) => `m${i}`)) ?? [];
  assert.equal(longChain.length, MAX_FALLBACK_MODELS, 'la cadena se recorta: no es una lista de deseos');
});

/** Simula que solo responde `failing`: el resto responde 429. */
function stubOnlyModelWorks(failing: string) {
  const seen: string[] = [];
  const quota = JSON.stringify({ error: { code: 429, message: 'Quota exceeded: RESOURCE_EXHAUSTED' } });
  const fetchImpl = async (url: any) => {
    const id = String(url).match(/models\/([^:]+):/)?.[1] ?? '';
    seen.push(id);
    if (id === failing) {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => JSON.parse(quota),
        text: async () => quota,
      };
    }
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'respuesta del respaldo' }], role: 'model' }, finishReason: 'STOP' }],
    });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => JSON.parse(body),
      text: async () => body,
    };
  };
  return { fetchImpl, seen };
}

/** Todos los modelos agotan cuota: solo queda el motor local, que aquí no existe. */
function stubAllModelsQuota() {
  const seen: string[] = [];
  const quota = JSON.stringify({ error: { code: 429, message: 'Quota exceeded: RESOURCE_EXHAUSTED' } });
  const fetchImpl = async (url: any) => {
    seen.push(String(url).match(/models\/([^:]+):/)?.[1] ?? '');
    return {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => JSON.parse(quota),
      text: async () => quota,
    };
  };
  return { fetchImpl, seen };
}

/** Ejecuta el handler con key falsa y `fetch` sustituido. */
async function withStubbedFetch(
  fetchImpl: any,
  fn: () => Promise<void>
): Promise<void> {
  const realFetch = globalThis.fetch;
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'clave-de-prueba-no-real';
  (globalThis as any).fetch = fetchImpl;
  try {
    await fn();
  } finally {
    (globalThis as any).fetch = realFetch;
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
}

test('con cadena explícita responde el primero que funcione y la respuesta lo declara', async () => {
  const requested = mapGeminiModel(GEMINI_DEFAULT_MODEL);
  const { fetchImpl, seen } = stubOnlyModelWorks(requested);

  await withStubbedFetch(fetchImpl, async () => {
    const res = mockRes();
    await handleGeminiGenerate(
      mockReq({ contents: 'hola', model: GEMINI_DEFAULT_MODEL, fallbackModels: ['gemini-3.5-flash-lite', 'gemini-3.6-flash'] }),
      res
    );

    assert.equal(res.body?.success, true, JSON.stringify(res.body));
    // Distintos modelos, no número de intentos: el SDK reintenta el 429 solo.
    assert.deepEqual([...new Set(seen)], [requested, 'gemini-3.5-flash-lite'], 'no debe probar más modelos de los declarados');
    assert.equal(res.body.model, 'gemini-3.5-flash-lite', 'la respuesta dice quién contestó');
    assert.equal(res.body.requestedModel, requested);
    assert.deepEqual(res.body.fallback, { from: requested, to: 'gemini-3.5-flash-lite' });
  });
});

test('con cadena vacía no se cambia de modelo: falla en voz alta', async () => {
  const requested = mapGeminiModel(GEMINI_DEFAULT_MODEL);
  const { fetchImpl, seen } = stubAllModelsQuota();

  await withStubbedFetch(fetchImpl, async () => {
    const res = mockRes();
    await handleGeminiGenerate(
      mockReq({ contents: 'hola', model: GEMINI_DEFAULT_MODEL, fallbackModels: [] }),
      res
    );

    assert.equal(res.statusCode, 503);
    assert.deepEqual([...new Set(seen)], [requested], 'solo se intenta el modelo pedido');
    assert.equal(res.body.tried.length, 1, 'el error lista un solo modelo intentado');
    assert.match(res.body.tried[0], new RegExp(`^${requested}`));
  });
});

test('sin cadena explícita se sigue usando la de por defecto', async () => {
  const requested = mapGeminiModel(GEMINI_DEFAULT_MODEL);
  const { fetchImpl, seen } = stubOnlyModelWorks(requested);

  await withStubbedFetch(fetchImpl, async () => {
    const res = mockRes();
    await handleGeminiGenerate(mockReq({ contents: 'hola', model: GEMINI_DEFAULT_MODEL }), res);

    assert.equal(res.body?.success, true, JSON.stringify(res.body));
    assert.ok(seen.length > 1, 'sin decisión explícita sigue habiendo respaldo');
  });
});

test('la cadena de respaldo de Gemini no reintenta ids retirados', () => {
  assert.ok(GEMINI_FALLBACK_MODELS.length > 0, 'debe haber al menos un respaldo');
  for (const id of GEMINI_FALLBACK_MODELS) {
    assert.ok(typeof id === 'string' && id.length > 0, 'cada respaldo es un id no vacío');
    assert.ok(id.startsWith('gemini-'), `id inesperado en la cadena: ${id}`);
    assert.ok(!RETIRED_GEMINI_MODELS.includes(id), `${id} ya no existe en la API`);
  }
  assert.ok(
    GEMINI_FALLBACK_MODELS.some((id) => id.endsWith('-latest')),
    'conviene dejar un alias -latest, que es el que más tarda en quedar obsoleto'
  );
});

/** fetch que responde 404 a todo: simula que Google retiró todos los modelos. */
function stubNotFoundFetch() {
  const body = JSON.stringify({ error: { code: 404, message: 'model not found' } });
  return async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => JSON.parse(body),
    text: async () => body,
  });
}

test('si ningún modelo responde y no hay motor local, el error es accionable', async () => {
  const realFetch = globalThis.fetch;
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'clave-de-prueba-no-real';
  (globalThis as any).fetch = stubNotFoundFetch();
  try {
    const res = mockRes();
    await handleGeminiGenerate(mockReq({ contents: 'hola', model: 'gemini-3.8-flash' }), res);

    assert.equal(res.statusCode, 503, 'no debe ser 500 (error interno del motor local)');
    assert.equal(res.body.code, 'ALL_GEMINI_MODELS_UNAVAILABLE');
    assert.ok(
      Array.isArray(res.body.tried) && res.body.tried.length > 1,
      `debe listar los modelos intentados (obtenido: ${JSON.stringify(res.body.tried)})`
    );
    assert.match(res.body.error, /Ningún modelo de Gemini respondió/);
    assert.doesNotMatch(res.body.error, /MODEL_RUNTIME_UNAVAILABLE/);
  } finally {
    (globalThis as any).fetch = realFetch;
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

/**
 * Simula una key cuyo plan no incluye las herramientas integradas: cualquier
 * petición que pida `googleSearch` o `codeExecution` responde 429 y las que
 * van limpias funcionan. Es el caso real del 2026-10-28: con esas tools todas
 * las llamadas acababan en cuota y el chat se quedaba sin respuesta.
 */
function stubToolsQuotaFetch({ withStream = false }: { withStream?: boolean } = {}) {
  const bodies: string[] = [];
  const quota = JSON.stringify({ error: { code: 429, message: 'Quota exceeded: RESOURCE_EXHAUSTED' } });
  const fetchImpl = async (url: any, init: any) => {
    const body = String(init?.body || '');
    bodies.push(body);
    if (body.includes('googleSearch') || body.includes('codeExecution')) {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => JSON.parse(quota),
        text: async () => quota,
      };
    }
    if (withStream || String(url).includes('streamGenerateContent')) {
      const frame = (text: string) =>
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: 'model' } }] })}\r\n\r\n`;
      const sse = frame('respuesta ') + frame('completa sin herramientas');
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sse));
            controller.close();
          },
        }),
      };
    }
    const okBody = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'respuesta completa sin herramientas' }], role: 'model' }, finishReason: 'STOP' }],
    });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => JSON.parse(okBody),
      text: async () => okBody,
    };
  };
  return { fetchImpl, bodies };
}

/** Petición como la del chat: grounding y ejecución de código activados por defecto. */
const CHAT_WITH_BUILTIN_TOOLS = {
  contents: 'hola',
  model: GEMINI_DEFAULT_MODEL,
  tools: [{ googleSearch: {} }, { codeExecution: {} }],
};

test('si la key no admite las tools, generate reintenta sin ellas y responde', async () => {
  const realFetch = globalThis.fetch;
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'clave-de-prueba-no-real';
  const { fetchImpl, bodies } = stubToolsQuotaFetch();
  (globalThis as any).fetch = fetchImpl;
  forgetToolsMemory('clave-de-prueba-no-real');
  try {
    const res = mockRes();
    await handleGeminiGenerate(mockReq({ ...CHAT_WITH_BUILTIN_TOOLS }), res);

    assert.equal(res.body?.success, true, `debe responder igualmente (body: ${JSON.stringify(res.body)})`);
    assert.match(res.body.text, /respuesta completa sin herramientas/);
    assert.match(
      res.body.text,
      /no admite las herramientas integradas/,
      'el usuario debe saber que la respuesta va sin grounding ni ejecución de código'
    );
    assert.ok(
      bodies.some((b) => !b.includes('googleSearch') && !b.includes('codeExecution')),
      'tiene que existir un reintento sin las herramientas integradas'
    );
  } finally {
    (globalThis as any).fetch = realFetch;
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

test('si la key no admite las tools, el stream arranca sin ellas y llega completo', async () => {
  const realFetch = globalThis.fetch;
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'clave-de-prueba-no-real';
  const { fetchImpl, bodies } = stubToolsQuotaFetch({ withStream: true });
  (globalThis as any).fetch = fetchImpl;
  forgetToolsMemory('clave-de-prueba-no-real');
  try {
    const res = mockRes();
    await handleGeminiStream(mockReq({ ...CHAT_WITH_BUILTIN_TOOLS }), res);

    const payload = res.chunks.join('');
    assert.doesNotMatch(payload, /"type":"error"/, `no debe cerrar con error (payload: ${payload})`);
    assert.match(payload, /respuesta /);
    assert.match(payload, /completa sin herramientas/);
    assert.match(payload, /no admite las herramientas integradas/);
    assert.equal(res.ended, true);
    assert.ok(
      bodies.some((b) => !b.includes('googleSearch') && !b.includes('codeExecution')),
      'tiene que existir un reintento sin las herramientas integradas'
    );
  } finally {
    (globalThis as any).fetch = realFetch;
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

test('una key sin herramientas integradas no repite la pasada fallida en el mensaje siguiente', async () => {
  const realFetch = globalThis.fetch;
  const prevKey = process.env.GEMINI_API_KEY;
  // Key propia para no arrastrar la memoria dejada por otros tests.
  const testKey = 'clave-sin-tools-del-test-de-memoria';
  process.env.GEMINI_API_KEY = testKey;
  const { fetchImpl, bodies } = stubToolsQuotaFetch();
  (globalThis as any).fetch = fetchImpl;
  forgetToolsMemory(testKey);
  try {
    const first = mockRes();
    await handleGeminiGenerate(mockReq({ ...CHAT_WITH_BUILTIN_TOOLS }), first);
    assert.equal(first.body?.success, true, 'el primer mensaje debe aprender que la key no admite las tools');

    const bodiesAfterFirst = bodies.length;
    bodies.length = 0;
    const second = mockRes();
    await handleGeminiGenerate(mockReq({ ...CHAT_WITH_BUILTIN_TOOLS }), second);

    assert.equal(second.body?.success, true);
    assert.match(second.body.text, /no admite las herramientas integradas/, 'el aviso sigue siendo necesario');
    assert.ok(bodies.length > 0, 'el segundo mensaje tiene que llamar a la API');
    assert.deepEqual(
      bodies.filter((b) => b.includes('googleSearch') || b.includes('codeExecution')),
      [],
      'ya no debe pedir las herramientas que esta key no admite'
    );
    assert.ok(
      bodies.length < bodiesAfterFirst,
      `el segundo mensaje no puede repetir la primera pasada (${bodies.length} vs ${bodiesAfterFirst} llamadas)`
    );
  } finally {
    (globalThis as any).fetch = realFetch;
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

test('la memoria de keys sobrevive a un reinicio y nunca guarda la key en claro', () => {
  const testKey = 'clave-que-debe-sobrevivir-al-reinicio';
  forgetToolsMemory(testKey);
  assert.equal(keyLacksBuiltinTools(testKey), false, 'sin memoria previa no debe omitir nada');

  rememberKeyLacksBuiltinTools(testKey);
  // La lectura va al fichero en cada llamada: no queda caché de proceso que un
  // reinicio pudiera llevarse por delante.
  assert.equal(keyLacksBuiltinTools(testKey), true);

  const file = join(process.env.COMMANDER_STATE_DIR!, 'key-capabilities.json');
  const saved = readFileSync(file, 'utf8');
  assert.ok(saved.includes(keyFingerprint(testKey)), 'debe guardar la huella de la key');
  assert.ok(!saved.includes(testKey), 'la key en claro no puede acabar en disco');

  const entries = JSON.parse(saved) as Record<string, number>;
  const until = entries[keyFingerprint(testKey)];
  const ttl = capabilityTtlMs();
  assert.ok(
    until > Date.now() && until <= Date.now() + ttl,
    'la caducidad debe ser finita y no mayor que el TTL'
  );

  forgetToolsMemory(testKey);
  assert.equal(keyLacksBuiltinTools(testKey), false, 'borrarla debe devolver la primera pasada');
});

test('la duración de la marca rechaza valores fuera de rango', async () => {
  for (const minutes of [0, -5, 1441, 2.5, 'diez', null]) {
    const res = mockRes();
    await handleSetToolsMemoryTtl(mockReq({ minutes }), res);
    assert.equal(res.statusCode, 400, `${minutes} debe rechazarse`);
    assert.equal(res.body.success, false);
  }
});

test('el botón de reintentar borra la memoria de la key en uso', async () => {
  const testKey = 'clave-para-reintentar-grounding';
  rememberKeyLacksBuiltinTools(testKey);
  assert.equal(keyLacksBuiltinTools(testKey), true);

  const res = mockRes();
  await handleResetToolsMemory(mockReq({ apiKey: testKey }), res);

  assert.equal(res.body.success, true);
  assert.equal(res.body.scope, 'key', 'debe borrar sólo la key en uso');
  assert.equal(keyLacksBuiltinTools(testKey), false, 'el próximo mensaje vuelve a probar las tools');
});

test('el estado de la marca dice si la key usa herramientas integradas y cuándo caduca', async () => {
  const testKey = 'clave-de-estado-de-tools';
  forgetToolsMemory(testKey);
  const prevKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const reqWithKey = () => ({ ...mockReq({}), apiKeys: { GEMINI_API_KEY: testKey } });

    const before = mockRes();
    await handleToolsMemoryStatus(reqWithKey(), before);
    assert.equal(before.body.success, true);
    assert.equal(before.body.keyKnown, true);
    assert.equal(before.body.marked, false, 'sin memoria no debe estar marcada');

    rememberKeyLacksBuiltinTools(testKey);
    const after = mockRes();
    await handleToolsMemoryStatus(reqWithKey(), after);
    assert.equal(after.body.marked, true);
    assert.ok(
      after.body.expiresAt > Date.now() && after.body.expiresAt <= Date.now() + after.body.ttlMs,
      'debe informar de una caducidad dentro del TTL'
    );

    const noKey = mockRes();
    await handleToolsMemoryStatus(mockReq({}), noKey);
    assert.equal(noKey.body.keyKnown, false, 'sin key no hay nada que marcar');
  } finally {
    forgetToolsMemory(testKey);
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

test('sin key conocida, el botón limpia toda la memoria de herramientas', async () => {
  rememberKeyLacksBuiltinTools('clave-una');
  rememberKeyLacksBuiltinTools('clave-dos');
  const prevKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const res = mockRes();
    await handleResetToolsMemory(mockReq({}), res);

    assert.equal(res.body.success, true);
    assert.equal(res.body.scope, 'all');
    assert.equal(keyLacksBuiltinTools('clave-una'), false);
    assert.equal(keyLacksBuiltinTools('clave-dos'), false);
  } finally {
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

/** Id de modelo de Gemini escrito a mano, p. ej. gemini-3.5-flash. */
const GEMINI_ID_LITERAL = /gemini-\d+(?:\.\d+)?(?:-[a-z0-9]+)+/;

/**
 * Dónde un id literal sí es legítimo:
 *  - el módulo que los define,
 *  - la migración de defaults antiguos (apunta a ids de los que se sale),
 *  - los catálogos y plantillas de `src/data` (son listas para mostrar),
 *  - `scripts` y `evals` (harness de desarrollo: fabrican proyectos de prueba y
 *    sondean modelos contra la API real, así que un id muerto ahí se ve en la
 *    primera ejecución en vez de quedarse años en la app),
 *  - los propios tests.
 */
const LITERAL_ID_ALLOWED = ['src/config/geminiModels.ts', 'src/utils/defaultModel.ts', 'src/data', 'scripts', 'evals', 'tests'];

/**
 * Ids de Freebuff con forma de id de Gemini (`gemini-3.8-flash`, `gemini-4-argon`).
 *
 * No son ids de la API de Google: caducan cuando Freebuff cambia su catálogo,
 * no cuando Google retira un modelo, y por eso no salen de `geminiModels.ts`.
 * La fuente es el propio módulo que los declara, para no eximir ficheros enteros
 * (un id de Google suelto en `server.ts` sigue siendo un fallo).
 */
const FOREIGN_MODEL_IDS: ReadonlySet<string> = FREEBUFF_TOOL_MODELS;
// `release-packager` es una copia empaquetada y gitignored de la app: no cuenta.
const SCAN_SKIP = ['node_modules', 'dist', '.git', 'release', 'release-packager', 'staging'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SCAN_SKIP.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Ids de Gemini escritos a mano que el guard considera infracción, bajo `dir`.
 *
 * Vive aparte del test para que el propio guard se pueda ejercitar contra un
 * directorio de prueba: un guard que nadie prueba acaba pasando por no mirar.
 */
function findLiteralIds(dir: string, base = '.'): string[] {
  const offenders: string[] = [];
  for (const file of sourceFiles(dir)) {
    const rel = relative(base, file).split('\\').join('/');
    if (LITERAL_ID_ALLOWED.some((allowed) => rel === allowed || rel.startsWith(`${allowed}/`))) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const match = line.match(GEMINI_ID_LITERAL);
      if (match && !FOREIGN_MODEL_IDS.has(match[0])) offenders.push(`${rel}:${i + 1} -> ${match[0]}`);
    });
  }
  return offenders;
}

test('los defaults de Gemini salen del módulo compartido y la cadena no repite ids', () => {
  for (const id of [GEMINI_DEFAULT_MODEL, GEMINI_PRO_MODEL]) {
    assert.ok(id.startsWith('gemini-'), `id inesperado: ${id}`);
    assert.ok(!RETIRED_GEMINI_MODELS.includes(id), `${id} ya no existe en la API`);
  }
  assert.equal(GEMINI_MODEL_CHAIN[0], GEMINI_DEFAULT_MODEL, 'el default va primero en la cadena');
  assert.equal(
    GEMINI_MODEL_CHAIN.length,
    new Set(GEMINI_MODEL_CHAIN).size,
    `la cadena no debe repetir ids: ${GEMINI_MODEL_CHAIN.join(', ')}`
  );
  for (const id of GEMINI_FALLBACK_MODELS) {
    assert.ok(GEMINI_MODEL_CHAIN.includes(id), `${id} falta en la cadena del router`);
  }
});

test('los catálogos no ofrecen modelos retirados y siguen sincronizados', () => {
  const [rootCatalog, publicCatalog] = ['models.json', 'public/models.json'].map((f) => readFileSync(f, 'utf8'));
  assert.equal(rootCatalog, publicCatalog, 'models.json y public/models.json deben ser idénticos');

  const entries = (JSON.parse(rootCatalog) as { models: { id: string; provider: string }[] }).models;
  const offered = entries.filter((m) => m.provider === 'google').map((m) => m.id);
  assert.ok(offered.length > 0, 'el catálogo debe ofrecer algún modelo de Google');
  for (const id of offered) {
    assert.ok(!RETIRED_GEMINI_MODELS.includes(id), `${id} está retirado y no debe ofrecerse`);
  }

  // El catálogo del código (GEMINI_MODELS) es el que pinta el selector.
  const source = readFileSync('src/data/models.ts', 'utf8');
  const section = source.slice(source.indexOf('export const GEMINI_MODELS'), source.indexOf('export const HUGGINGFACE_MODELS'));
  const ids = [...section.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, 'GEMINI_MODELS no puede quedarse vacío');
  for (const id of ids) {
    assert.ok(!RETIRED_GEMINI_MODELS.includes(id), `${id} sigue en GEMINI_MODELS y ya no existe en la API`);
  }
});

test('ningún id de Gemini escrito a mano fuera del módulo compartido', () => {
  const offenders = findLiteralIds('.');
  assert.deepEqual(
    offenders,
    [],
    'usa GEMINI_DEFAULT_MODEL / GEMINI_PRO_MODEL / GEMINI_FALLBACK_MODELS en vez de ids sueltos:\n' +
      offenders.join('\n')
  );
});

/**
 * El guard se comprueba a sí mismo: si alguien lo afloja (regex, allowlist,
 * exención de Freebuff), este test deja de ver la infracción y falla.
 */
test('el guard detecta un id suelto de verdad y no marca uno de Freebuff', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-guard-'));
  try {
    writeFileSync(join(dir, 'suelto.ts'), "export const MODELO = 'gemini-9.9-flash';\n");
    writeFileSync(join(dir, 'suelto.tsx'), "const otro = 'gemini-9.9-pro';\n");
    writeFileSync(join(dir, 'freebuff.ts'), "export const MODELO = 'gemini-4-argon';\n");
    // Fichero no escaneado: el guard sólo mira .ts/.tsx
    writeFileSync(join(dir, 'notas.md'), "modelo: gemini-9.9-flash\n");

    assert.deepEqual(
      findLiteralIds(dir, dir),
      ['suelto.ts:1 -> gemini-9.9-flash', 'suelto.tsx:1 -> gemini-9.9-pro'],
      'el guard debe ver los ids de Google escritos a mano y sólo ésos'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gemini/stream sin API key emite un evento SSE de error claro y cierra', async () => {
  await withoutGeminiKey(async () => {
    const res = mockRes();
    await handleGeminiStream(mockReq({ contents: 'hola', model: 'gemini-2.5-flash' }), res);
    const payload = res.chunks.join('');
    assert.match(payload, /"type":"error"/);
    assert.match(payload, /MISSING_API_KEY/);
    assert.equal(res.ended, true);
  });
});

/**
 * Regresión del stream colgado: escuchar `close` en la petición lo marcaba como
 * cerrado nada más empezar, así que el `catch` retornaba sin escribir el error
 * ni cerrar la respuesta, y la UI se quedaba en «Generando…» para siempre.
 * El evento debe salir aunque la petición ya haya emitido su `close`.
 */
/**
 * El SDK devuelve a veces el error como un JSON anidado dentro de `message`; en
 * la UI eso se veía como un volcado con `\\"` y saltos escapados.
 */
test('el error del stream se muestra como texto, no como JSON anidado', () => {
  const nested = JSON.stringify({
    error: { message: JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }) },
  });
  assert.equal(readableStreamError(new Error(nested)), 'API key not valid. Please pass a valid API key.');
  assert.equal(readableStreamError(new Error('Fallo directo')), 'Fallo directo');
});

/** Ejecuta `fn` con un directorio de trabajo temporal: la config se escribe ahí. */
async function inTempConfigDir(fn: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'commander-fallback-'));
  const previousCwd = process.cwd();
  process.chdir(dir);
  resetConfig();
  try {
    await fn(dir);
  } finally {
    process.chdir(previousCwd);
    resetConfig();
  }
}

test('la cadena de respaldo sale de la config cuando la petición no la trae', async () => {
  await inTempConfigDir(async () => {
    assert.deepEqual(
      resolveFallbackChain(undefined),
      GEMINI_FALLBACK_MODELS,
      'sin config propia se usa la de fábrica'
    );

    const saved = mockRes();
    await handleSetFallbackModels(mockReq({ models: ['gemini-3.5-flash-lite', 'gemini-3.6-flash'] }), saved);
    assert.equal(saved.body.success, true, JSON.stringify(saved.body));

    assert.deepEqual(
      resolveFallbackChain(undefined),
      ['gemini-3.5-flash-lite', 'gemini-3.6-flash'],
      'guardada una vez, ya no hace falta mandarla en cada petición'
    );
    assert.deepEqual(
      resolveFallbackChain(['gemini-otro']),
      ['gemini-otro'],
      'lo que pide la petición manda sobre la config'
    );

    const cleared = mockRes();
    await handleSetFallbackModels(mockReq({ models: [] }), cleared);
    assert.deepEqual(resolveFallbackChain(undefined), [], 'una cadena vacía guardada desactiva el respaldo');
    assert.deepEqual(
      resolveFallbackChain([]),
      [],
      'la petición también puede desactivarlo aunque la config diga otra cosa'
    );
  });
});

test('el guardado de la cadena rechaza listas ambiguas en vez de corregirlas en silencio', async () => {
  await inTempConfigDir(async () => {
    const garbage = mockReq({ models: ['gemini-uno', ''] });
    const garbageRes = mockRes();
    await handleSetFallbackModels(garbage, garbageRes);
    assert.equal(garbageRes.statusCode, 400);

    const duplicatedRes = mockRes();
    await handleSetFallbackModels(mockReq({ models: ['gemini-uno', ' gemini-uno '] }), duplicatedRes);
    assert.equal(duplicatedRes.statusCode, 400);

    const tooManyRes = mockRes();
    await handleSetFallbackModels(
      mockReq({ models: Array.from({ length: MAX_FALLBACK_MODELS + 1 }, (_, i) => `gemini-m${i}`) }),
      tooManyRes
    );
    assert.equal(tooManyRes.statusCode, 400);

    const notAListRes = mockRes();
    await handleSetFallbackModels(mockReq({ models: 'gemini-uno' }), notAListRes);
    assert.equal(notAListRes.statusCode, 400, 'un tipo raro no puede convertirse en «sin respaldo»');
  });
});

test('el estado de la cadena distingue lo guardado de la cadena de fábrica', async () => {
  await inTempConfigDir(async () => {
    const untouched = mockRes();
    await handleFallbackModelsStatus(mockReq({}), untouched);
    assert.equal(untouched.body.success, true);
    assert.equal(untouched.body.configured, false, 'sin fichero no hay decisión guardada');
    assert.deepEqual(untouched.body.models, GEMINI_FALLBACK_MODELS);
    assert.deepEqual(untouched.body.defaultModels, GEMINI_FALLBACK_MODELS);
    assert.equal(untouched.body.maxModels, MAX_FALLBACK_MODELS);

    await handleSetFallbackModels(mockReq({ models: ['gemini-3.6-flash'] }), mockRes());
    const saved = mockRes();
    await handleFallbackModelsStatus(mockReq({}), saved);
    assert.equal(saved.body.configured, true);
    assert.deepEqual(saved.body.models, ['gemini-3.6-flash']);
  });
});

test('un close temprano de la petición no silencia el error del stream', async () => {
  await withoutGeminiKey(async () => {
    const res = mockRes();
    await handleGeminiStream(
      mockReq({ contents: 'hola', model: 'gemini-2.5-flash' }, { closeEarly: true }),
      res
    );
    assert.match(
      res.chunks.join(''),
      /"type":"error"/,
      'el error tiene que llegar al cliente aunque la petición emita close'
    );
    assert.equal(res.ended, true, 'la respuesta debe cerrarse para que la UI deje de girar');
  });
});
