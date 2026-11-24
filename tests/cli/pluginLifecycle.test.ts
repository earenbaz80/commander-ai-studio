/**
 * El bucle del CLI (`runAgent`) no corre dentro de `AgentSession`, así que
 * antes no emitía lifecycle. Estos casos fijan que el motor de hooks se
 * engancha en el arranque, en cada llamada al modelo y en los tres cierres.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAgent } from '../../src/cli/agentClient.js';
import {
  RunPluginLifecycle,
  type PluginLifecycleHook,
} from '../../src/agent/pluginLifecycle.js';
import { startFakeAgentServer, type FakeAgentServer } from '../helpers/fakeAgentServer.js';
import { GEMINI_DEFAULT_MODEL } from '../../src/config/geminiModels.js';

const servers: FakeAgentServer[] = [];

after(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

interface RecordedHook {
  hook: PluginLifecycleHook;
  context: Record<string, unknown>;
}

function recorder(): { events: RecordedHook[]; lifecycle: RunPluginLifecycle } {
  const events: RecordedHook[] = [];
  const lifecycle = new RunPluginLifecycle(
    async (hook, context) => {
      events.push({ hook, context });
    },
    {
      sessionId: 'sess_cli_lifecycle',
      root: os.tmpdir(),
      goal: 'probar lifecycle',
      model: GEMINI_DEFAULT_MODEL,
    }
  );
  return { events, lifecycle };
}

function tempCwd(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-cli-lifecycle-'));
}

async function fakeServer(): Promise<FakeAgentServer> {
  const server = await startFakeAgentServer();
  servers.push(server);
  return server;
}

const hooks = (events: RecordedHook[]) => events.map((event) => event.hook);

describe('lifecycle en el bucle local del CLI', () => {
  test('emite sessionStart, beforeModel/afterModel y sessionEnd', async () => {
    const server = await fakeServer();
    const { events, lifecycle } = recorder();
    const cwd = tempCwd();
    try {
      const result = await runAgent({
        serverUrl: server.baseUrl,
        task: 'SCENARIO:final',
        cwd,
        model: GEMINI_DEFAULT_MODEL,
        sessionId: 'sess_cli_lifecycle',
        lifecycle,
      });

      assert.match(result.answer, /Listo/);
      assert.deepEqual(hooks(events), [
        'sessionStart',
        'beforeModel',
        'afterModel',
        'sessionEnd',
      ]);
      assert.equal(events[1].context.turn, 1);
      assert.equal(events[2].context.ok, true);
      assert.match(String(events[3].context.answer), /Listo/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('espera el hook de cierre antes de devolver', async () => {
    const server = await fakeServer();
    const events: string[] = [];
    const lifecycle = new RunPluginLifecycle(
      async (hook) => {
        // Si `done()` no esperara, el resultado volvería sin `sessionEnd`.
        if (hook === 'sessionEnd') await new Promise((resolve) => setTimeout(resolve, 25));
        events.push(hook);
      },
      {
        sessionId: 'sess_cli_lifecycle',
        root: os.tmpdir(),
        goal: 'probar lifecycle',
        model: GEMINI_DEFAULT_MODEL,
      }
    );
    const cwd = tempCwd();
    try {
      await runAgent({
        serverUrl: server.baseUrl,
        task: 'SCENARIO:final',
        cwd,
        model: GEMINI_DEFAULT_MODEL,
        sessionId: 'sess_cli_lifecycle',
        lifecycle,
      });

      assert.equal(events.at(-1), 'sessionEnd');
      assert.equal(events.filter((hook) => hook === 'sessionEnd').length, 1);
      assert.ok(!events.includes('stop') && !events.includes('error'));
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('emite afterModel ok:false y error cuando el proveedor falla', async () => {
    const server = await fakeServer();
    const { events, lifecycle } = recorder();
    const cwd = tempCwd();
    try {
      await runAgent({
        serverUrl: server.baseUrl,
        task: 'SCENARIO:llm-error',
        cwd,
        model: GEMINI_DEFAULT_MODEL,
        sessionId: 'sess_cli_lifecycle',
        lifecycle,
      });

      assert.deepEqual(hooks(events), [
        'sessionStart',
        'beforeModel',
        'afterModel',
        'error',
      ]);
      assert.equal(events[2].context.ok, false);
      assert.match(String(events[2].context.error), /LLM HTTP 500/);
      assert.match(String(events[3].context.error), /LLM HTTP 500/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('emite stop cuando el turno se cancela', async () => {
    const server = await fakeServer();
    const { events, lifecycle } = recorder();
    const cwd = tempCwd();
    const controller = new AbortController();
    controller.abort();
    try {
      const result = await runAgent({
        serverUrl: server.baseUrl,
        task: 'SCENARIO:final',
        cwd,
        model: GEMINI_DEFAULT_MODEL,
        sessionId: 'sess_cli_lifecycle',
        lifecycle,
        signal: controller.signal,
      });

      assert.equal(result.cancelled, true);
      assert.deepEqual(hooks(events), ['sessionStart', 'stop']);
      assert.equal(events[1].context.reason, 'user');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
