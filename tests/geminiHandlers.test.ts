import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { handleGeminiGenerate, handleGeminiStream, GEMINI_KEY_REQUIRED } from '../gemini.js';
import { GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODELS, GEMINI_MODEL_CHAIN, GEMINI_PRO_MODEL } from '../src/config/geminiModels.js';

function mockReq(body: any) {
  return {
    body,
    ip: '127.0.0.1',
    headers: {},
    cookies: {},
    socket: { setTimeout() { /* noop */ } },
    on() { /* noop */ },
  } as any;
}

function mockRes() {
  const chunks: string[] = [];
  const res: any = {
    statusCode: 200,
    body: null,
    ended: false,
    chunks,
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.body = data; return this; },
    setHeader() { return this; },
    flushHeaders() { /* noop */ },
    write(chunk: string) { chunks.push(String(chunk)); return true; },
    end() { this.ended = true; return this; },
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

/** Id de modelo de Gemini escrito a mano, p. ej. gemini-3.5-flash. */
const GEMINI_ID_LITERAL = /gemini-\d+(?:\.\d+)?(?:-[a-z0-9]+)+/;

/**
 * Dónde un id literal sí es legítimo:
 *  - el módulo que los define,
 *  - la migración de defaults antiguos (apunta a ids de los que se sale),
 *  - los catálogos y plantillas de `src/data` (son listas para mostrar),
 *  - `scripts` (harness de desarrollo) y los propios tests.
 */
const LITERAL_ID_ALLOWED = ['src/config/geminiModels.ts', 'src/utils/defaultModel.ts', 'src/data', 'scripts', 'tests'];
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

test('ningún id de Gemini escrito a mano fuera del módulo compartido', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles('.')) {
    const rel = relative('.', file).split('\\').join('/');
    if (LITERAL_ID_ALLOWED.some((allowed) => rel === allowed || rel.startsWith(`${allowed}/`))) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const match = line.match(GEMINI_ID_LITERAL);
      if (match) offenders.push(`${rel}:${i + 1} -> ${match[0]}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'usa GEMINI_DEFAULT_MODEL / GEMINI_PRO_MODEL / GEMINI_FALLBACK_MODELS en vez de ids sueltos:\n' +
      offenders.join('\n')
  );
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
