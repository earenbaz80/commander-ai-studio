import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionStore } from '../../src/agent/sessionStore';
import { createSessionState, decodeSessionState } from '../../src/agent/sessionTypes';

let dir: string;
const loaded: string[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-plan-'));
  process.env.COMMANDER_AGENT_SESSIONS_DIR = dir;
});

afterEach(async () => {
  const { removeSession } = await import('../../agentSession');
  for (const id of loaded.splice(0)) removeSession(id);
  delete process.env.COMMANDER_AGENT_SESSIONS_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

function oldState(id: string) {
  return {
    ...createSessionState({ id, goal: `objetivo ${id}`, cwd: '/workspace', model: 'm' }),
    plan: [
      { id: 'p1', text: 'leer el repo', done: true },
      { id: 'p2', text: 'escribir el fix', done: false },
    ],
  };
}

describe('persistencia del plan', () => {
  it('migra un plan viejo al leerlo de disco sin perder pasos', () => {
    const id = 'sess_plan_viejo';
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(oldState(id)), 'utf8');

    const decoded = decodeSessionState(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
    expect(decoded?.plan).toEqual([
      { id: 'p1', text: 'leer el repo', status: 'done', done: true },
      { id: 'p2', text: 'escribir el fix', status: 'pending', done: false },
    ]);
  });

  it('conserva status, archivos y criterios tras reiniciar el servidor', () => {
    const id = 'sess_plan_nuevo';
    const state = createSessionState({ id, goal: 'plan con estados', cwd: '/workspace', model: 'm' });
    state.plan = [
      {
        id: 'p1',
        text: 'leer el repo',
        status: 'in_progress',
        files: ['src/a.ts'],
        criteria: 'identifica el bug',
        done: false,
      },
      { id: 'p2', text: 'esperar review', status: 'blocked', done: false },
    ];
    createSessionStore(dir).save(state);

    // “Reinicio”: otra instancia del store sobre el mismo directorio.
    const reloaded = createSessionStore(dir).load(id);
    expect(reloaded?.plan).toEqual(state.plan);
    expect(reloaded?.plan[1].done).toBe(false);
    expect(reloaded?.plan[1].status).toBe('blocked');
  });

  it('getOrLoadSession (--resume) reconstruye el plan desde disco', async () => {
    const id = 'sess_plan_resume';
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(oldState(id)), 'utf8');
    const { getOrLoadSession } = await import('../../agentSession');
    loaded.push(id);

    const session = getOrLoadSession(id);
    expect(session).toBeDefined();
    expect(session!.isRunning()).toBe(false);
    expect(session!.toState().plan).toEqual([
      { id: 'p1', text: 'leer el repo', status: 'done', done: true },
      { id: 'p2', text: 'escribir el fix', status: 'pending', done: false },
    ]);
  });
});
