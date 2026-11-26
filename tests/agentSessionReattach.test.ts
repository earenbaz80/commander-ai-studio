/**
 * C4 de F4A: el panel de la extensión y el escritorio comparten la misma
 * sesión del servidor.
 *
 * Se usa el cliente real de la extensión (`vscode-extension/src/session.ts`,
 * sin `vscode`) contra el server de verdad: crear, listar como hace el
 * escritorio, cerrar el cliente (panel) y volver a engancharse al mismo id.
 * El LLM se sustituye por el proveedor guionado; la primera prueba no ejecuta
 * nada (sesión idle), la segunda comprueba que un turno nuevo tras reabrir
 * sigue llegando por SSE.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';
import { startScriptedProvider, type ScriptedProvider } from '../evals/scriptedProvider.js';
import { AgentSession, type SessionEvent } from '../vscode-extension/src/session.js';

let srv: ServerHarness;
let provider: ScriptedProvider;
let dir: string;

before(async () => {
  srv = await startServer();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-c4-'));
  provider = await startScriptedProvider((_prompt, request) => ({ text: `Listo (turno ${request}).` }));
});

after(async () => {
  await provider?.close();
  await srv?.stop();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporales */ }
});

/** Crea una sesión como lo hace el panel, con el guion local como modelo. */
async function createSession(run: boolean): Promise<string> {
  const res = await srv.request('POST', '/api/agent/sessions', {
    goal: 'Sesión que sobrevive al panel (C4)',
    cwd: dir,
    model: 'custom/test',
    maxSteps: 10,
    run,
    keys: {
      CUSTOM_BASE_URL: provider.baseUrl,
      CUSTOM_API_KEY: 'clave-falsa',
      CUSTOM_MODEL: 'modelo-falso',
    },
  });
  assert.equal(res.status, 200, res.raw);
  return String(res.body.session.id);
}

/** El listado que consume el escritorio. */
async function listedIds(): Promise<string[]> {
  const res = await srv.request('GET', '/api/agent/sessions');
  assert.equal(res.status, 200, res.raw);
  return (Array.isArray(res.body?.sessions) ? res.body.sessions : []).map((item: any) => String(item.id));
}

async function waitFor(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail('la condición no se cumplió a tiempo');
}

async function waitForStatus(id: string, statuses: string[], timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const res = await srv.request('GET', `/api/agent/sessions/${id}`);
    assert.equal(res.status, 200, res.raw);
    last = String(res.body.state?.status ?? '');
    if (statuses.includes(last)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`la sesión ${id} no llegó a ${statuses.join('/')} (último: ${last})`);
}

describe('C4: el panel reabre la misma sesión que lista el escritorio', () => {
  test('el id que muestra la extensión es el que lista el escritorio', async () => {
    const id = await createSession(false);
    const resync: string[] = [];
    const client = new AgentSession(srv.baseUrl, {
      onEvent: () => {},
      onResync: (state) => resync.push(String(state.id)),
    });
    try {
      const state = await client.attach(id);
      assert.equal(client.sessionId, id);
      assert.equal(state.id, id);
      assert.deepEqual(resync, [id]);
      const ids = await listedIds();
      assert.equal(ids.filter((listed) => listed === id).length, 1);
    } finally {
      client.dispose();
    }
  });

  test('cerrar y reabrir el panel se engancha al mismo id sin duplicarlo', async () => {
    const id = await createSession(false);

    // Panel abierto: crea/usa la sesión y se engancha.
    const beforeClose = new AgentSession(srv.baseUrl, { onEvent: () => {} });
    await beforeClose.attach(id);
    assert.equal(beforeClose.sessionId, id);
    beforeClose.dispose(); // cerrar el panel sólo corta el SSE, no la sesión

    // Panel reabierto: arranca de cero y restaura el id guardado.
    const resync: string[] = [];
    const afterOpen = new AgentSession(srv.baseUrl, {
      onEvent: () => {},
      onResync: (state) => resync.push(String(state.id)),
    });
    try {
      const state = await afterOpen.attach(id);
      assert.equal(afterOpen.sessionId, id);
      assert.equal(state.id, id);
      assert.deepEqual(resync, [id]);
      const ids = await listedIds();
      assert.equal(ids.filter((listed) => listed === id).length, 1, 'no se creó una sesión nueva');
    } finally {
      afterOpen.dispose();
    }
  });

  test('tras reabrir, un turno nuevo sigue llegando por SSE', async () => {
    const id = await createSession(true);
    await waitForStatus(id, ['completed', 'failed']);

    const events: SessionEvent[] = [];
    const client = new AgentSession(srv.baseUrl, { onEvent: (event) => events.push(event) });
    try {
      await client.attach(id);
      await client.message('segundo turno');
      // El guion numera las respuestas: "turno 2" sólo puede venir del turno
      // nuevo (el replay del buffer también trae el "turno 1" viejo).
      await waitFor(() =>
        events.some((event) => event.type === 'answer' && String(event.text ?? '').includes('turno 2'))
      );
      assert.equal(client.sessionId, id);
    } finally {
      client.dispose();
    }
  });

  test('si el id guardado ya no existe, el cliente no se queda con él', async () => {
    const client = new AgentSession(srv.baseUrl, { onEvent: () => {} });
    await assert.rejects(() => client.attach('sess_00000000'), /no encontrada/);
    assert.equal(client.sessionId, undefined);
  });
});
