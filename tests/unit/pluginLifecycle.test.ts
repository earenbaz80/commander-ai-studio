import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunPluginLifecycle, type PluginLifecycleHook } from '../../src/agent/pluginLifecycle';
import {
  clearPluginCache,
  runAfterToolHooks,
  runBeforeToolHooks,
  runPluginHook,
} from '../../pluginsRuntime';

/**
 * Lifecycle de plugins contra el runtime real.
 *
 * Antes el test montaba un `AgentSession`, y como `agentSession.ts` importa
 * `agentTools.ts` (que importa `browserSession`), el grafo metía el DOM en el
 * proyecto `node` de Vitest. Acá se prueba la misma cadena sin la sesión del
 * servidor: `RunPluginLifecycle` encola los hooks y el transporte llama a
 * `runPluginHook`, que es lo que ejecuta el endpoint en producción. El plugin
 * de referencia deja una línea JSON por hook.
 */

const REFERENCE_PLUGIN = fileURLToPath(
  new URL('../../examples/plugins/reference-plugin/index.js', import.meta.url),
);
const REFERENCE_MANIFEST = fileURLToPath(
  new URL('../../examples/plugins/reference-plugin/plugin.json', import.meta.url),
);

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-plugin-lifecycle-'));
  const dir = path.join(root, '.commander', 'plugins', 'reference-plugin');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(REFERENCE_PLUGIN, path.join(dir, 'index.js'));
  fs.copyFileSync(REFERENCE_MANIFEST, path.join(dir, 'plugin.json'));
  clearPluginCache(root);
});

afterEach(() => {
  clearPluginCache(root);
  fs.rmSync(root, { recursive: true, force: true });
});

interface LoggedHook {
  seq: number;
  hook: string;
  sessionId?: string;
  phase?: string;
  turn?: number;
  ok?: boolean;
  reason?: string;
  error?: string;
}

function loggedHooks(): LoggedHook[] {
  try {
    return fs.readFileSync(path.join(root, '.commander', 'reference-plugin.log'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LoggedHook);
  } catch {
    return [];
  }
}

function lifecycle(): RunPluginLifecycle {
  const context = { sessionId: 'sess_1', root, goal: 'probar el lifecycle', model: 'gemini-2.5-flash' };
  return new RunPluginLifecycle(
    (hook: PluginLifecycleHook, ctx: Record<string, unknown>) =>
      runPluginHook(root, hook, ctx as any, { timeoutMs: 200 }),
    context,
  );
}

describe('lifecycle de plugins contra el runtime', () => {
  it('ejecuta sessionStart, modelo y sessionEnd en una corrida normal', async () => {
    const run = lifecycle();

    await run.start();
    await run.beforeModel(1);
    await run.afterModel(1, true);
    await run.close({ kind: 'done', answer: 'Listo' });

    const entries = loggedHooks();
    expect(entries.map((entry) => entry.hook)).toEqual([
      'sessionStart',
      'beforeModel',
      'afterModel',
      'sessionEnd',
    ]);
    expect(entries[0].sessionId).toBe('sess_1');
    expect(entries[2]).toMatchObject({ phase: 'after', turn: 1, ok: true });
  });

  it('un fallo del modelo deja afterModel con ok:false y error como terminal', async () => {
    const run = lifecycle();

    await run.start();
    await run.beforeModel(1);
    await run.afterModel(1, false, 'LLM HTTP 500');
    await run.close({ kind: 'error', error: 'LLM HTTP 500' });

    const entries = loggedHooks();
    expect(entries.map((entry) => entry.hook)).toEqual([
      'sessionStart',
      'beforeModel',
      'afterModel',
      'error',
    ]);
    expect(entries[2].ok).toBe(false);
    expect(entries[3].error).toMatch(/LLM HTTP 500/);
  });

  it('corre beforeTool y afterTool entre el modelo y el cierre', async () => {
    const run = lifecycle();

    await run.start();
    await run.beforeModel(1);
    await run.afterModel(1, true);
    await runBeforeToolHooks(root, 'fs.read', { path: 'package.json' }, { timeoutMs: 200 });
    await runAfterToolHooks(
      root,
      'fs.read',
      { path: 'package.json' },
      { ok: true, output: 'listo' } as any,
      { timeoutMs: 200 },
    );
    await run.close({ kind: 'done', answer: 'Listo' });

    expect(loggedHooks().map((entry) => entry.hook)).toEqual([
      'sessionStart',
      'beforeModel',
      'afterModel',
      'beforeTool',
      'afterTool',
      'sessionEnd',
    ]);
  });

  it('un stop cierra con stop y no emite sessionEnd ni error', async () => {
    const run = lifecycle();

    await run.start();
    await run.close({ kind: 'stopped', reason: 'user' });

    const entries = loggedHooks();
    expect(entries.map((entry) => entry.hook)).toEqual(['sessionStart', 'stop']);
    expect(entries[1].reason).toBe('user');
  });
});
