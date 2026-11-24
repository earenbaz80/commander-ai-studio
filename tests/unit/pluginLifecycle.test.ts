import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentSession } from '../../agentSession';
import { clearPluginCache } from '../../pluginsRuntime';
import { setServerBaseUrl } from '../../serverRuntime';

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
  setServerBaseUrl('http://127.0.0.1:1');
});

afterEach(() => {
  vi.unstubAllGlobals();
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

function session(): AgentSession {
  return new AgentSession({
    goal: 'probar el lifecycle',
    cwd: root,
    model: 'gemini-2.5-flash',
    pluginHookTimeoutMs: 200,
  });
}

function modelOk(text = 'Listo'): any {
  return {
    ok: true,
    status: 200,
    json: async () => ({ text, functionCalls: [] }),
  };
}

describe('lifecycle de plugins en AgentSession', () => {
  it('ejecuta sessionStart, modelo y sessionEnd en una corrida normal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => modelOk()));

    const agent = session();
    await agent.start();
    await agent.whenLifecycleSettled();

    const entries = loggedHooks();
    const hooks = entries.map((entry) => entry.hook);
    expect(agent.getStatus()).toBe('done');
    expect(hooks[0]).toBe('sessionStart');
    expect(hooks).toContain('beforeTool');
    expect(hooks).toContain('afterTool');
    expect(hooks).toContain('beforeModel');
    expect(hooks).toContain('afterModel');
    expect(hooks.at(-1)).toBe('sessionEnd');
    expect(hooks).not.toContain('stop');
    expect(hooks).not.toContain('error');

    const before = hooks.indexOf('beforeModel');
    const after = hooks.indexOf('afterModel');
    expect(before).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(before);
    const end = entries.find((entry) => entry.hook === 'sessionEnd');
    expect(end?.sessionId).toBe(agent.id);
    expect(agent.getPluginErrors()).toEqual([]);
  });

  it('un fallo del modelo dispara afterModel con ok:false y error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })));

    const agent = session();
    await agent.start();
    await agent.whenLifecycleSettled();

    const entries = loggedHooks();
    const hooks = entries.map((entry) => entry.hook);
    expect(agent.getStatus()).toBe('error');
    expect(hooks).toContain('beforeModel');
    expect(hooks.at(-1)).toBe('error');
    expect(hooks).not.toContain('sessionEnd');
    expect(entries.filter((entry) => entry.hook === 'afterModel').every((entry) => entry.ok === false)).toBe(true);
    expect(entries.find((entry) => entry.hook === 'error')?.error).toMatch(/LLM HTTP 500/);
  });

  it('stop durante la llamada al modelo aborta y registra stop, no error', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('abortado')));
    }));
    vi.stubGlobal('fetch', fetchMock);

    const agent = session();
    const running = agent.start();
    for (let i = 0; i < 200 && fetchMock.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(fetchMock).toHaveBeenCalled();

    agent.stop('user');
    await running;
    await agent.whenLifecycleSettled();

    const hooks = loggedHooks().map((entry) => entry.hook);
    expect(agent.getStatus()).toBe('stopped');
    expect(hooks).toContain('stop');
    expect(hooks).not.toContain('error');
    expect(hooks).not.toContain('sessionEnd');
  });
});
