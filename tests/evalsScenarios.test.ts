/**
 * Escenarios de producto de la baseline (T7, T9, T10) contra el servidor real.
 *
 * T6 necesita Chromium y se ejecuta en la pasada live/CI con navegador
 * instalado; aquí se prueban los caminos que no dependen de un modelo externo:
 * publicador local, reanudación de sesión y subagentes con worktree.
 */
import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';
import {
  assertNoLingeringSessions,
  snapshotSessions,
  type SessionSnapshot,
} from './helpers/sessionAssertions.js';
import { startScriptedProvider, type ScriptedProvider } from '../evals/scriptedProvider.js';
import { runT6, runT7, runT9, runT10 } from '../evals/scenarios.js';
import { EVAL_ROOT } from '../evals/harness.js';
import type { AgentStep } from '../src/agent/types.js';

let srv: ServerHarness;
let provider: ScriptedProvider | null = null;
let sessionsBefore: SessionSnapshot | null = null;

before(async () => {
  srv = await startServer();
});

beforeEach(async () => {
  sessionsBefore = await snapshotSessions(srv);
});

afterEach(async () => {
  await provider?.close();
  provider = null;
  if (sessionsBefore) {
    await assertNoLingeringSessions(srv, sessionsBefore, 'el escenario', { rootPrefix: EVAL_ROOT });
  }
});

after(async () => {
  await provider?.close();
  await srv?.stop();
});

function keysFor(provider: Pick<ScriptedProvider, 'baseUrl'>) {
  return {
    CUSTOM_BASE_URL: provider.baseUrl,
    CUSTOM_API_KEY: 'clave-eval',
    CUSTOM_MODEL: 'modelo-eval',
  };
}

/** Sesiones de una tarea que siguen en el registro del servidor. */
async function sessionsStartingWith(prefix: string): Promise<any[]> {
  const listed = await srv.request('GET', '/api/agent/sessions');
  const sessions: any[] = Array.isArray(listed.body?.sessions) ? listed.body.sessions : [];
  return sessions.filter((session) => String(session.goal ?? '').startsWith(prefix));
}

/** Espera a que el servidor registre una sesión de Playwright viva. */
async function waitForBrowserSessions(timeoutMs = 8_000): Promise<any[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listed = await srv.request('GET', '/api/browser/sessions');
    const sessions: any[] = Array.isArray(listed.body?.sessions) ? listed.body.sessions : [];
    if (sessions.length > 0) return sessions;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('no se abrió ninguna sesión de Playwright');
}

/** Primer turno: abre el preview. Segundo: se queda colgado para forzar el timeout. */
async function startBrowserOpenThenHangingProvider(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  let requests = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requests += 1;
      if (requests > 1) return; // deja la petición abierta a propósito
      const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(raw)?.[0];
      if (!url) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'sin URL de preview' }));
        return;
      }
      const body = JSON.stringify({
        id: 'chatcmpl-t6-browser-timeout',
        object: 'chat.completion',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_t6_open',
              type: 'function',
              function: {
                name: 'browser',
                arguments: JSON.stringify({ action: 'open', url }),
              },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      });
      res.end(body);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('el proveedor de prueba no obtuvo un puerto TCP');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

/** Proveedor que deja la petición abierta para que venza el presupuesto. */
async function startHangingProvider(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(() => { /* sin respuesta a propósito */ });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('el proveedor de prueba no obtuvo un puerto TCP');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

test('T6 · browser verifica el preview y guarda consola/red', async () => {
  let step = 0;
  let url = '';
  let uid = '';
  provider = await startScriptedProvider((prompt) => {
    step += 1;
    if (step === 1) {
      url = /http:\/\/127\.0\.0\.1:\d+\//.exec(prompt)?.[0] ?? '';
      assert.ok(url, 'el objetivo no incluyó la URL del preview');
      return { tools: [{ tool: 'browser', args: { action: 'open', url } }] };
    }
    if (step === 2) return { tools: [{ tool: 'browser', args: { action: 'snapshot' } }] };
    if (step === 3) {
      // El prompt incluye el snapshot con las comillas escapadas por JSON; el
      // uid de la línea del botón es el que hay que pulsar.
      uid = /e(\d+)\s+button[^\n]{0,40}Interacción verificada/.exec(prompt)?.[0]
        ?.match(/^e\d+/)?.[0] ?? '';
      assert.ok(uid, 'el snapshot no expuso un uid para el botón');
      return { tools: [{ tool: 'browser', args: { action: 'click', uid } }] };
    }
    if (step === 4) return { tools: [{ tool: 'browser', args: { action: 'snapshot' } }] };
    if (step === 5) return { tools: [{ tool: 'browser', args: { action: 'logs' } }] };
    return { text: 'El contador quedó en 1 y vi el error de consola esperado.' };
  });

  const outcome = await runT6({
    baseUrl: srv.baseUrl,
    model: 'custom/eval',
    keys: keysFor(provider),
    timeoutMs: 60_000,
  });

  assert.equal(outcome.error, undefined, outcome.error);
  assert.equal(outcome.passed, true, JSON.stringify(outcome.checks));
  assert.deepEqual(
    outcome.checks.filter((check) => check.error),
    []
  );
});

test('T6 · un timeout se registra como timeout, no como fallo de browser', async () => {
  const hanging = await startHangingProvider();
  try {
    const outcome = await runT6({
      baseUrl: srv.baseUrl,
      model: 'custom/eval',
      keys: keysFor(hanging),
      timeoutMs: 120,
    });

    assert.equal(outcome.stopReason, 'timeout');
    assert.equal(outcome.timedOut, true);
    assert.equal(outcome.passed, false);
    assert.match(outcome.error ?? '', /no terminó en 120ms/);

    // La prueba no limpia la sesión: si el escenario la deja viva, esto falla.
    assert.deepEqual(await sessionsStartingWith('T6:'), [], 'T6 dejó una sesión viva después del timeout');
  } finally {
    await hanging.close();
  }
});

test('T6 · el timeout después de abrir cierra también la sesión de Playwright', async () => {
  const hanging = await startBrowserOpenThenHangingProvider();
  try {
    const running = runT6({
      baseUrl: srv.baseUrl,
      model: 'custom/eval',
      keys: keysFor(hanging),
      timeoutMs: 8_000,
    });

    // No se espera al timeout: se comprueba que el navegador llegó a abrirse.
    const opened = await waitForBrowserSessions();
    assert.ok(opened.length > 0, 'el navegador no llegó a abrirse antes del timeout');

    const outcome = await running;
    assert.equal(outcome.stopReason, 'timeout');
    assert.equal(outcome.timedOut, true);
    assert.match(outcome.error ?? '', /no terminó en 8000ms/);

    const listed = await srv.request('GET', '/api/browser/sessions');
    assert.deepEqual(
      Array.isArray(listed.body?.sessions) ? listed.body.sessions : [],
      [],
      'T6 dejó una sesión de Playwright viva después del timeout'
    );
    assert.deepEqual(await sessionsStartingWith('T6:'), [], 'T6 dejó una sesión de agente viva');
  } finally {
    await hanging.close();
  }
});

test('T6 · un error de tool después de abrir cierra el navegador sin timeout', async () => {
  let step = 0;
  let url = '';
  const steps: AgentStep[] = [];
  provider = await startScriptedProvider((prompt) => {
    step += 1;
    if (step === 1) {
      url = /http:\/\/127\.0\.0\.1:\d+\//.exec(prompt)?.[0] ?? '';
      assert.ok(url, 'el objetivo no incluyó la URL del preview');
      return { tools: [{ tool: 'browser', args: { action: 'open', url } }] };
    }
    if (step === 2) {
      // No hay snapshot, así que este uid no existe: la tool falla sin cerrar Chromium.
      return { tools: [{ tool: 'browser', args: { action: 'click', uid: 'e999999' } }] };
    }
    return { text: 'No pude completar la interacción solicitada.' };
  });

  const outcome = await runT6({
    baseUrl: srv.baseUrl,
    model: 'custom/eval',
    keys: keysFor(provider),
    timeoutMs: 60_000,
    onStep: (agentStep) => steps.push(agentStep),
  });

  assert.equal(outcome.error, undefined, outcome.error);
  assert.equal(outcome.timedOut, false);
  assert.equal(outcome.stopReason, 'completed');
  assert.equal(outcome.passed, false, 'T6 no debía pasar sin snapshot, click ni logs');
  assert.ok(outcome.checks.some((check) => check.error), 'T6 no registró ningún check fallido');

  const browserResults = steps.filter(
    (agentStep) => agentStep.type === 'tool_result' && agentStep.toolId === 'browser'
  );
  assert.ok(
    browserResults.some(
      (agentStep) =>
        agentStep.status === 'completed' && Boolean((agentStep.output as any)?.sessionId)
    ),
    'el navegador no llegó a abrirse'
  );
  assert.ok(
    browserResults.some(
      (agentStep) =>
        agentStep.status === 'failed' && /uid desconocido/.test(String(agentStep.content ?? ''))
    ),
    'no se registró el fallo de la tool browser'
  );

  const listed = await srv.request('GET', '/api/browser/sessions');
  assert.deepEqual(
    Array.isArray(listed.body?.sessions) ? listed.body.sessions : [],
    [],
    'T6 dejó una sesión de Playwright viva tras un fallo de tool'
  );
  assert.deepEqual(await sessionsStartingWith('T6:'), [], 'T6 dejó una sesión de agente viva');
});

test('T9 · un timeout cancela y borra la sesión', async () => {
  const hanging = await startHangingProvider();
  try {
    const outcome = await runT9({
      baseUrl: srv.baseUrl,
      model: 'custom/eval',
      keys: keysFor(hanging),
      timeoutMs: 120,
    });

    assert.equal(outcome.stopReason, 'timeout');
    assert.equal(outcome.timedOut, true);
    assert.match(outcome.error ?? '', /no terminó en 120ms/);
    assert.deepEqual(await sessionsStartingWith('T9:'), [], 'T9 dejó una sesión viva después del timeout');
  } finally {
    await hanging.close();
  }
});

test('T10 · un timeout cancela y borra la sesión', async () => {
  const hanging = await startHangingProvider();
  try {
    const outcome = await runT10({
      baseUrl: srv.baseUrl,
      model: 'custom/eval',
      keys: keysFor(hanging),
      timeoutMs: 120,
    });

    assert.equal(outcome.stopReason, 'timeout');
    assert.equal(outcome.timedOut, true);
    assert.match(outcome.error ?? '', /no terminó en 120ms/);
    assert.deepEqual(await sessionsStartingWith('T10:'), [], 'T10 dejó una sesión viva después del timeout');
  } finally {
    await hanging.close();
  }
});

test('T7 · preview, promoción y rollback con el publicador local', async () => {
  const outcome = await runT7({ baseUrl: srv.baseUrl });

  assert.equal(outcome.error, undefined, outcome.error);
  assert.equal(outcome.passed, true, JSON.stringify(outcome.checks));
  assert.deepEqual(
    outcome.checks.filter((check) => check.error),
    []
  );
  assert.ok(outcome.checks.some((check) => /rollback/.test(check.name)));
});

test('T9 · reanudar una sesión conserva historial y no repite la tool', async () => {
  let firstCalls = 0;
  provider = await startScriptedProvider((prompt) => {
    if (prompt.includes('T9 SEGUNDO TURNO')) return { text: 'Segundo turno listo.' };
    firstCalls += 1;
    if (firstCalls === 1) {
      return { tools: [{ tool: 'fs_write', args: { path: 'hito.txt', content: 'uno' } }] };
    }
    return { text: 'Primer turno listo.' };
  });

  const outcome = await runT9({
    baseUrl: srv.baseUrl,
    model: 'custom/eval',
    keys: keysFor(provider),
    timeoutMs: 30_000,
  });

  assert.equal(outcome.error, undefined, outcome.error);
  assert.equal(outcome.passed, true, JSON.stringify(outcome.checks));
  assert.deepEqual(
    outcome.checks.filter((check) => check.error),
    []
  );
});

test('T10 · dos subagentes en worktrees aislados con allowlist', async () => {
  const childCalls = new Map<string, number>();
  let parentCalls = 0;
  provider = await startScriptedProvider((prompt) => {
    const child = /OBJETIVO:\s*Hijo ([AB])/.exec(prompt)?.[1];
    if (child) {
      const count = (childCalls.get(child) ?? 0) + 1;
      childCalls.set(child, count);
      if (count === 1) {
        return { tools: [{ tool: 'shell_run', args: { command: 'echo no > prohibido.txt' } }] };
      }
      if (count === 2) {
        return {
          tools: [{
            tool: 'fs_write',
            args: { path: `hijo-${child.toLowerCase()}.txt`, content: `hijo ${child}` },
          }],
        };
      }
      return { text: `Hijo ${child} listo; shell.run denegado por allowlist.` };
    }

    parentCalls += 1;
    if (parentCalls === 1) {
      return {
        tools: [{
          tool: 'spawn_agents',
          args: {
            agents: [
              {
                goal: 'Hijo A: intenta shell.run y luego escribe hijo-a.txt. Informa si shell fue denegado.',
                allowedTools: ['fs.read', 'fs.write'],
                worktree: true,
                maxSteps: 8,
              },
              {
                goal: 'Hijo B: escribe hijo-b.txt. Informa si shell fue denegado.',
                allowedTools: ['fs.read', 'fs.write'],
                worktree: true,
                maxSteps: 8,
              },
            ],
          },
        }],
      };
    }
    return { text: 'Dos subagentes listos.' };
  });

  const outcome = await runT10({
    baseUrl: srv.baseUrl,
    model: 'custom/eval',
    keys: keysFor(provider),
    timeoutMs: 60_000,
  });

  assert.equal(outcome.error, undefined, outcome.error);
  assert.equal(outcome.passed, true, JSON.stringify(outcome.checks));
  assert.deepEqual(
    outcome.checks.filter((check) => check.error),
    []
  );
});
