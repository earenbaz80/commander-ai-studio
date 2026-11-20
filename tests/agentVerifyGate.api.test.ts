/**
 * Gate de verificación en el bucle del servidor (F1-3), contra el server real.
 *
 * El gate nació en el bucle del CLI (`src/cli/agentClient.ts`): editar código y
 * responder «listo» sin correr nada no cierra. Acá se comprueba que una sesión
 * abierta desde la app se comporta igual, primero rechazando el cierre y luego
 * aceptándolo cuando hay un verde posterior a la última edición.
 *
 * El LLM se sustituye por un proveedor OpenAI-compatible guionado
 * (`evals/scriptedProvider.ts`) al que apunta la sesión con `model: 'custom/…'`
 * y sus `keys`, así que se ejercita el camino completo por HTTP sin claves ni
 * red externa. La raíz del agente es un proyecto temporal: los permisos del
 * repo (`.commander/permissions.json`) son del usuario y pueden ser readonly.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';
import { startScriptedProvider, type ScriptedProvider, type ScriptedStep } from '../evals/scriptedProvider.js';

const CODIGO = 'gate-http.mjs';
const PRUEBA_OK = 'gate-http-ok.test.mjs';
const CONTENIDO = 'export const valor = 1;\n';
const CIERRE = 'Listo, quedó hecho.';

let srv: ServerHarness;
const providers: ScriptedProvider[] = [];

before(async () => {
  srv = await startServer();
});

after(async () => {
  for (const provider of providers) await provider.close();
  await srv?.stop();
});

interface ScriptedRun {
  id: string;
  dir: string;
  provider: ScriptedProvider;
  /** Prompt que recibió cada petición, por número (1-based). */
  prompts: string[];
}

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'commander-gate-http-'));
}

/** Crea y arranca una sesión con el guion dado. */
async function runScript(
  respond: (request: number) => ScriptedStep,
  prepare?: (dir: string) => void
): Promise<ScriptedRun> {
  const dir = tempProject();
  prepare?.(dir);
  const prompts: string[] = [];
  const provider = await startScriptedProvider((_prompt, request) => respond(request), {
    onRequest: (prompt, request) => { prompts[request] = prompt; },
  });
  providers.push(provider);

  const res = await srv.request('POST', '/api/agent/sessions', {
    goal: 'Gate de verificación en el servidor (F1-3)',
    cwd: dir,
    mode: 'build',
    model: 'custom/test',
    maxSteps: 10,
    run: true,
    keys: {
      CUSTOM_BASE_URL: provider.baseUrl,
      CUSTOM_API_KEY: 'clave-falsa',
      CUSTOM_MODEL: 'modelo-falso',
    },
  });
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.success, true, res.raw);
  return { id: String(res.body.session.id), dir, provider, prompts };
}

/**
 * Espera el estado final resolviendo aprobaciones con «allow»: el objeto del
 * test es el gate, no el canal de aprobaciones (F1-04, con sus propios tests).
 */
async function waitFinal(id: string, timeoutMs = 60_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const res = await srv.request('GET', `/api/agent/sessions/${id}`);
    assert.equal(res.status, 200, res.raw);
    last = res.body.state;
    const approval = last.pendingApproval;
    if (approval?.id) {
      await srv.request('POST', `/api/agent/sessions/${id}/approvals/${encodeURIComponent(approval.id)}`, {
        decision: 'allow',
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    if (['completed', 'failed', 'error'].includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`la sesión ${id} no terminó: ${JSON.stringify(last)}`);
}

describe('gate de verificación del servidor (F1-3)', () => {
  test('rechaza el cierre sin verificar y falla tras agotar los rechazos', async () => {
    const run = await runScript((request) =>
      request === 1
        ? { tools: [{ tool: 'fs.write', args: { path: CODIGO, content: CONTENIDO } }] }
        : { text: CIERRE }
    );
    try {
      const state = await waitFinal(run.id);

      assert.equal(state.status, 'failed', JSON.stringify(state));
      assert.match(String(state.error || ''), /Gate de verificación/);
      assert.match(String(state.error || ''), /no se verificó después de la última edición/);
      // La edición se aplicó de verdad: el gate no simula trabajo.
      assert.equal(fs.readFileSync(path.join(run.dir, CODIGO), 'utf8'), CONTENIDO);

      // La edición + tres intentos de cierre: dos rechazos con el motivo en el
      // historial y el tercero cierra la corrida, para no repetir sin fin. El
      // rechazo viaja en el turno siguiente, no en el mismo pedido.
      assert.equal(run.provider.requests(), 4);
      assert.doesNotMatch(run.prompts[2] || '', /SISTEMA: Gate de verificación/);
      assert.match(run.prompts[3] || '', /SISTEMA: Gate de verificación/);
      assert.match(run.prompts[4] || '', /SISTEMA: Gate de verificación/);

      const gateSteps = state.steps.filter((step: any) => step.title === 'Gate de verificación');
      assert.equal(gateSteps.length, 3, JSON.stringify(state.steps.map((step: any) => step.title)));
      assert.ok(gateSteps.every((step: any) => step.status === 'failed'));
    } finally {
      fs.rmSync(run.dir, { recursive: true, force: true });
    }
  });

  test('deja cerrar cuando hay una verificación en verde posterior a la edición', async () => {
    const cierreFinal = 'Listo: escrito y verificado.';
    const run = await runScript(
      (request) => {
        if (request === 1) return { tools: [{ tool: 'fs.write', args: { path: CODIGO, content: CONTENIDO } }] };
        if (request === 2) return { tools: [{ tool: 'shell.run', args: { command: `node --test ${PRUEBA_OK}` } }] };
        return { text: cierreFinal };
      },
      // Tiene que existir antes del primer turno: la verificación lo ejecuta.
      (dir) => fs.writeFileSync(
        path.join(dir, PRUEBA_OK),
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n\ntest('gate', () => { assert.equal(1, 1); });\n"
      )
    );
    try {
      const state = await waitFinal(run.id);

      assert.equal(state.status, 'completed', JSON.stringify(state));
      assert.equal(state.answer, cierreFinal);
      assert.equal(run.provider.requests(), 3);
      assert.equal(
        state.steps.filter((step: any) => step.title === 'Gate de verificación').length,
        0,
        'con verde posterior no hay rechazo'
      );
      const verificacion = state.steps.find((step: any) => step.toolId === 'shell.run');
      assert.equal(verificacion?.status, 'completed', JSON.stringify(verificacion));
    } finally {
      fs.rmSync(run.dir, { recursive: true, force: true });
    }
  });
});
