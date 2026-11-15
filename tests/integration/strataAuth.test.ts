/**
 * Integración opcional contra un Strata local autenticado.
 *
 * No forma parte de `npm test` ni de `npm run test:node` por defecto: vive en
 * `tests/integration` y sólo se ejecuta cuando se le pasa la ruta. Se salta si
 * el host no está levantado, si no exige API key o si falta `STRATA_API_KEY`.
 *
 * Uso:
 *   STRATA_API_KEY=... npm run test:node -- tests/integration/strataAuth.test.ts
 *
 * El servidor de Commander lo levanta `startServer()` (el mismo arnés de la
 * suite de endpoints); no se arranca un servidor a mano. La clave se pasa al
 * proceso hijo mediante el entorno, igual que en una instalación real.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type ServerHarness } from '../helpers/serverHarness.js';
import {
  normalizeStrataLocalBaseUrl,
  STRATA_LOCAL_DEFAULT_BASE_URL,
} from '../../src/lib/strataLocal';

const BASE = normalizeStrataLocalBaseUrl(
  process.env.STRATA_LOCAL_BASE_URL || STRATA_LOCAL_DEFAULT_BASE_URL
);
const ROOT = BASE.replace(/\/v1$/, '');
const API_KEY = process.env.STRATA_API_KEY?.trim();
const MODEL_FALLBACK = 'qwen3.8-flash-next-iq3_s';

let srv: ServerHarness | undefined;
let skipReason = '';

/**
 * El health de Strata es público: sirve para distinguir «host apagado» de
 * «host levantado sin clave». Si el puerto contesta otra cosa, se trata como
 * no disponible para no convertir este test opcional en un falso positivo.
 */
async function probeHost(): Promise<{ reachable: boolean; apiKey: boolean }> {
  try {
    const response = await fetch(`${ROOT}/health`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return { reachable: false, apiKey: false };
    const payload: any = await response.json().catch(() => null);
    return {
      reachable: payload?.service === 'strata',
      apiKey: payload?.api_key === true,
    };
  } catch {
    return { reachable: false, apiKey: false };
  }
}

before(async () => {
  const host = await probeHost();
  if (!host.reachable) {
    skipReason = `Strata no está levantado en ${ROOT}`;
    return;
  }
  if (!host.apiKey) {
    skipReason = 'Strata no exige API key; este test valida el flujo autenticado';
    return;
  }
  if (!API_KEY) {
    skipReason = 'STRATA_API_KEY no está configurada';
    return;
  }
  srv = await startServer();
});

after(async () => {
  await srv?.stop();
});

function skipIfUnavailable(t: { skip: (reason?: string) => void }): boolean {
  if (!skipReason) return false;
  t.skip(skipReason);
  return true;
}

async function expectStatus(response: Response, expected: number, label: string): Promise<void> {
  if (response.status === expected) return;
  const body = await response.text().catch(() => '');
  assert.fail(`${label}: HTTP ${response.status} (se esperaba ${expected}): ${body.slice(0, 500)}`);
}

test('sin clave responde 401 y con STRATA_API_KEY responde 200', async (t) => {
  if (skipIfUnavailable(t)) return;

  const withoutKey = await fetch(`${BASE}/models`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  await expectStatus(withoutKey, 401, 'sin clave');

  const withKey = await fetch(`${BASE}/models`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  await expectStatus(withKey, 200, 'con clave');
  const catalog: any = await withKey.json();
  assert.equal(catalog?.object, 'list');
  assert.ok(Array.isArray(catalog?.data) && catalog.data.length > 0);
});

test('salud y runtime del adaptador usan STRATA_API_KEY del entorno', async (t) => {
  if (skipIfUnavailable(t) || !srv) return;

  const health = await srv.request('POST', '/api/strata-local/health', { baseUrl: BASE });
  assert.equal(health.status, 200, health.raw);
  assert.equal(health.body.ok, true, health.raw);
  assert.equal(health.body.identity, 'verified', health.raw);
  assert.ok(health.body.model, health.raw);
  assert.ok(health.body.contextWindow > 0, health.raw);

  const runtime = await srv.request('POST', '/api/strata-local/runtime', { baseUrl: BASE });
  assert.equal(runtime.status, 200, runtime.raw);
  assert.equal(runtime.body.success, true, runtime.raw);
  assert.ok(runtime.body.runtime?.instances?.length > 0, runtime.raw);
  assert.equal(runtime.body.runtime.instances[0].model, health.body.model);
  assert.equal(runtime.body.monitor?.context?.maxTokens, health.body.contextWindow);
  assert.equal(typeof runtime.body.monitor.queue.running, 'number');
  assert.equal(typeof runtime.body.monitor.queue.waiting, 'number');
});

test('generación y streaming funcionan con STRATA_API_KEY', async (t) => {
  if (skipIfUnavailable(t) || !srv) return;

  const health = await srv.request('POST', '/api/strata-local/health', { baseUrl: BASE });
  const model = String(health.body.model || MODEL_FALLBACK);

  const generate = await srv.request('POST', '/api/strata-local/generate', {
    baseURL: BASE,
    model: `strata-local/${model}`,
    prompt: 'Responde solo con la palabra OK.',
    maxTokens: 64,
  });
  assert.equal(generate.status, 200, generate.raw);
  assert.equal(generate.body.success, true, generate.raw);
  assert.equal(typeof generate.body.text, 'string');
  assert.ok(generate.body.text.length > 0, generate.raw);

  const stream = await srv.request('POST', '/api/strata-local/stream', {
    baseURL: BASE,
    model: `strata-local/${model}`,
    prompt: 'Cuenta hasta tres.',
    maxTokens: 64,
  });
  assert.equal(stream.status, 200, stream.raw);
  assert.match(stream.raw, /"type":"chunk"/);
  assert.match(stream.raw, /"type":"done"/);
  assert.match(stream.raw, /"fullText":/);
});
