/**
 * Preferencias del REPL (F1-09): modelo, plantilla y modo sobreviven entre
 * sesiones sin pisar el turno en vuelo. La precedencia es
 * flag > sesión > commander.json > default.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReplSession } from '../../src/cli/repl.js';
import { Tui } from '../../src/cli/tui.js';
import { createSessionState } from '../../src/agent/sessionTypes.js';
import { getCliPreferences, resetConfig, saveCliPreferences } from '../../src/config/index.js';
import type { RunAgentOptions } from '../../src/cli/agentClient.js';

function quietTui(): { tui: Tui; lines: string[] } {
  const tui = new Tui({ interactive: false, color: false });
  const lines: string[] = [];
  tui.line = (text = '') => {
    lines.push(text);
  };
  tui.rule = () => {};
  return { tui, lines };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout esperando condición');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

const noSave = async (): Promise<void> => {};

describe('preferencias del REPL', () => {
  test('precedencia flag > sesión > config > defecto', () => {
    const state = createSessionState({
      id: 'sess_precedencia',
      goal: 'precedencia',
      cwd: '/workspace/demo',
      model: 'gemini-3.1-pro-preview',
      mode: 'readonly',
    });
    const preferences = {
      lastModel: 'gemini-3.5-flash',
      lastAgent: 'planner',
      lastMode: 'plan' as const,
    };

    const configured = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: '/workspace/demo',
      preferences,
      tui: quietTui().tui,
      deps: { savePreferences: noSave },
    });
    assert.equal(configured.model, 'gemini-3.5-flash');
    assert.equal(configured.mode, 'plan');
    assert.equal(configured.agent, 'planner');
    assert.equal(configured.maxSteps, 20, 'la plantilla aporta su tope de pasos');

    const session = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: '/workspace/demo',
      state,
      preferences,
      tui: quietTui().tui,
      deps: { savePreferences: noSave },
    });
    assert.equal(session.model, 'gemini-3.1-pro-preview', 'la sesión gana a la config');
    assert.equal(session.mode, 'readonly', 'el modo de la sesión gana a la config');

    const flagged = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: '/workspace/demo',
      state,
      preferences,
      model: 'gemini-3.8-flash',
      mode: 'build',
      agent: 'reviewer',
      tui: quietTui().tui,
      deps: { savePreferences: noSave },
    });
    assert.equal(flagged.model, 'gemini-3.8-flash', 'el flag gana a la sesión');
    assert.equal(flagged.mode, 'build', 'el flag de modo gana a la sesión');
    assert.equal(flagged.agent, 'reviewer');
    assert.equal(flagged.maxSteps, 16);

    const defaults = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: '/workspace/demo',
      preferences: {},
      tui: quietTui().tui,
      deps: { savePreferences: noSave },
    });
    assert.equal(defaults.model, 'gemini-3.5-flash', 'default Gemini vigente');
    assert.equal(defaults.mode, 'build');
    assert.equal(defaults.agent, undefined);
    assert.equal(defaults.maxSteps, 25);
  });

  test('guarda cli.* con escritura atómica y lo relee al reiniciar', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-cli-prefs-'));
    try {
      const configPath = path.join(dir, 'commander.json');
      fs.writeFileSync(configPath, JSON.stringify({ version: 1 }), 'utf8');
      const written = saveCliPreferences(
        {
          lastModel: 'gemini-3.8-flash',
          lastAgent: 'planner',
          lastMode: 'plan',
        },
        { cwd: dir }
      );

      assert.equal(written, configPath);
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        cli?: Record<string, string>;
      };
      assert.deepEqual(raw.cli, {
        lastModel: 'gemini-3.8-flash',
        lastAgent: 'planner',
        lastMode: 'plan',
      });
      assert.deepEqual(getCliPreferences({ cwd: dir }), {
        lastModel: 'gemini-3.8-flash',
        lastAgent: 'planner',
        lastMode: 'plan',
      });
      assert.equal(
        fs.readdirSync(dir).some((file) => file.endsWith('.tmp')),
        false,
        'no queda ningún temporal tras el rename atómico'
      );

      resetConfig();
      const restarted = new ReplSession({
        serverUrl: 'http://127.0.0.1:1',
        cwd: dir,
        tui: quietTui().tui,
        deps: { savePreferences: noSave },
      });
      assert.equal(restarted.model, 'gemini-3.8-flash');
      assert.equal(restarted.agent, 'planner');
      assert.equal(restarted.mode, 'plan');
    } finally {
      resetConfig();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('un id inválido lista las opciones y no cambia ni guarda', async () => {
    const { tui, lines } = quietTui();
    let saves = 0;
    const session = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: '/workspace/demo',
      preferences: { lastModel: 'gemini-3.5-flash', lastAgent: 'planner' },
      tui,
      deps: {
        savePreferences: async () => {
          saves += 1;
        },
      },
    });
    const beforeModel = session.model;
    const beforeAgent = session.agent;
    const beforeMode = session.mode;

    await session.handleLine('/model no-existe');
    assert.equal(session.model, beforeModel);
    assert.equal(saves, 0);
    assert.match(lines.join('\n'), /modelo desconocido: no-existe/);
    assert.match(lines.join('\n'), /gemini-3\.8-flash/);

    await session.handleLine('/agent no-existe');
    assert.equal(session.agent, beforeAgent);
    assert.equal(session.mode, beforeMode);
    assert.equal(saves, 0);
    assert.match(lines.join('\n'), /plantilla desconocida: no-existe/);
    assert.match(lines.join('\n'), /planner/);
  });

  test('cambiar el modelo afecta al siguiente turno, no al que está en vuelo', async () => {
    const { tui, lines } = quietTui();
    const calls: RunAgentOptions[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saves = 0;
    const session = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: '/workspace/demo',
      preferences: { lastModel: 'gemini-3.5-flash' },
      tui,
      deps: {
        savePreferences: async () => {
          saves += 1;
        },
        runAgent: async (opts) => {
          calls.push(opts);
          await gate;
          return { answer: 'ok', steps: 1, sessionId: 'sess_hot', seq: calls.length };
        },
      },
    });

    const firstTurn = session.handleLine('turno uno');
    await waitFor(() => calls.length === 1);
    assert.equal(calls[0].model, 'gemini-3.5-flash');

    await session.handleLine('/model gemini-3.8-flash');
    assert.equal(session.model, 'gemini-3.8-flash');
    assert.equal(calls[0].model, 'gemini-3.5-flash', 'el turno en vuelo conserva su modelo');
    assert.equal(saves, 1);

    release();
    await firstTurn;
    await session.handleLine('turno dos');
    assert.equal(calls[1].model, 'gemini-3.8-flash', 'el turno siguiente usa el nuevo modelo');
    assert.match(lines.join('\n'), /modelo → gemini-3\.8-flash/);
  });

  test('/plan y /agent persisten el modo y la plantilla elegidos', async () => {
    const saves: Array<{ lastModel?: string; lastAgent?: string; lastMode?: string }> = [];
    const session = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: '/workspace/demo',
      preferences: { lastModel: 'gemini-3.5-flash' },
      tui: quietTui().tui,
      deps: {
        savePreferences: async (prefs) => {
          saves.push(prefs);
        },
      },
    });

    await session.handleLine('/plan');
    assert.deepEqual(saves.at(-1), {
      lastModel: 'gemini-3.5-flash',
      lastMode: 'plan',
    });

    await session.handleLine('/agent reviewer');
    assert.deepEqual(saves.at(-1), {
      lastModel: 'gemini-3.5-flash',
      lastAgent: 'reviewer',
      lastMode: 'readonly',
    });
  });
});
