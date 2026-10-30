/**
 * Runner autónomo: el planificador habla con el propio server por HTTP.
 *
 * Cubre los dos fallos que lo dejaban muerto:
 *   1. `resolveEndpoint` devuelve una RUTA; en Node un `fetch` relativo lanza
 *      «Failed to parse URL». La llamada va contra `getServerBaseUrl()`.
 *   2. La comprobación de «¿queda trabajo?» miraba el estado `queued`, que no
 *      existe (los ítems nacen en `pending`), así que re-planificaba siempre.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-autorun-'));
process.env.COMMANDER_DB_PATH = path.join(dir, 'studio.db');

const p = await import('../persistence.js');
const { planCampaign, runAutonomousCampaign } = await import('../autonomousRun.js');

const realFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = realFetch;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('planCampaign llama al LLM con una URL absoluta', async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    urls.push(String(url));
    return {
      ok: true,
      json: async () => ({ text: '{"tasks":[{"prompt":"arregla el bug","label":"fix"}]}' }),
    } as any;
  }) as any;

  p.createThread({ id: 'th-plan', title: 'plan' });
  const out = await planCampaign('th-plan', 'arregla el bug', { parentSessionId: 'sess-x' });
  globalThis.fetch = realFetch;

  assert.equal(out.ok, true, String(out.error));
  assert.equal(out.enqueued, 1);
  assert.equal(urls.length, 1);
  // Antes era `/api/gemini/generate` y el fetch moría antes de salir.
  assert.match(urls[0], /^http:\/\/127\.0\.0\.1:\d+\/api\/gemini\/generate$/);
  assert.equal(p.listQueue('th-plan', 'pending').length, 1, 'la tarea queda encolada');
});

test('el planner corta por timeout en vez de esperar minutos', async () => {
  let calls = 0;
  const signals: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    calls++;
    signals.push(init?.signal);
    const err: any = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    throw err;
  }) as any;

  p.createThread({ id: 'th-timeout', title: 'timeout' });
  const out = await planCampaign('th-timeout', 'algo', { parentSessionId: 'sess-x' });
  globalThis.fetch = realFetch;

  assert.equal(calls, 1, 'un timeout no se reintenta: duplicaría la espera');
  assert.ok(signals[0] instanceof AbortSignal, 'la petición debe llevar AbortSignal');
  assert.equal(out.ok, false);
  assert.match(String(out.error), /no respondió en 60s/);
  assert.equal(p.listQueue('th-timeout').length, 0, 'no encola nada si no hubo plan');
});

test('planificar un hilo inexistente lo crea en vez de fallar por la clave foránea', async () => {
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({ text: '{"tasks":[{"prompt":"tarea nueva","label":"nueva"}]}' }),
    }) as any) as any;

  assert.equal(p.getThread('th-nuevo'), null, 'el hilo no existe todavía');
  const out = await planCampaign('th-nuevo', 'objetivo sin hilo', { parentSessionId: 'sess-x' });
  globalThis.fetch = realFetch;

  assert.equal(out.ok, true, String(out.error));
  assert.equal(out.enqueued, 1);
  assert.equal(p.getThread('th-nuevo')?.title, 'objetivo sin hilo', 'el hilo nace con el objetivo por título');
  assert.equal(p.listQueue('th-nuevo', 'pending').length, 1);
});

test('un plan fallido no deja un hilo vacío', async () => {
  globalThis.fetch = (async () => {
    const err: any = new Error('aborted');
    err.name = 'TimeoutError';
    throw err;
  }) as any;

  const out = await planCampaign('th-nada', 'objetivo que no responde', { parentSessionId: 'sess-x' });
  globalThis.fetch = realFetch;

  assert.equal(out.ok, false);
  assert.equal(p.getThread('th-nada'), null, 'sin tareas no se crea nada');
});

test('una campaña con trabajo pendiente no vuelve a planificar', async () => {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return { ok: true, json: async () => ({ text: '{"tasks":[]}' }) } as any;
  }) as any;

  p.createThread({ id: 'th-run', title: 'run' });
  p.enqueueItem({ id: 'q-run', threadId: 'th-run', prompt: 'tarea concreta' });

  // Sesión padre inexistente: la tarea falla rápido, pero lo que se prueba es
  // que NO se consulta al planificador cuando ya hay un ítem pendiente.
  const out = await runAutonomousCampaign('th-run', { parentSessionId: 'sess-inexistente', goal: 'algo' });
  globalThis.fetch = realFetch;

  assert.equal(fetchCalls, 0, 'no debe llamar al LLM para planificar');
  assert.equal(out.processed, 1, 'sí debe consumir el ítem que ya estaba en la cola');
});
