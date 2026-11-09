/**
 * Persistencia de sesiones (F1-02).
 *
 * Cubre las garantías del store sin pasar por HTTP: escritura atómica,
 * relectura tras “reinicio” (instancia nueva), truncado por límites y poda de
 * sesiones viejas.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_SESSIONS,
  MAX_STATE_BYTES,
  MAX_STEPS,
  createSessionStore,
  isValidSessionId,
  type SessionStore,
} from '../../src/agent/sessionStore';
import { createSessionState, decodeSessionState } from '../../src/agent/sessionTypes';

let dir: string;
let store: SessionStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-sessions-'));
  store = createSessionStore(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function stateWithSteps(id: string, count: number, content = 'paso') {
  const state = createSessionState({ id, goal: `objetivo ${id}`, cwd: '/workspace', model: 'm' });
  state.steps = Array.from({ length: count }, (_, index) => ({
    id: `${id}_step_${index}`,
    type: 'thought' as const,
    title: `paso ${index}`,
    content,
    status: 'completed' as const,
    ts: index,
  }));
  state.updatedAt = Date.now() + count;
  return state;
}

describe('sessionStore', () => {
  it('guarda y relee el estado completo desde una instancia nueva', () => {
    const state = stateWithSteps('sess_a', 3, 'contenido');
    state.status = 'completed';
    state.turns = [{ role: 'user', text: 'hola', ts: 1 }];
    state.plan = [{ id: 'p1', text: 'leer', status: 'done', done: true }];

    store.save(state);

    const file = path.join(dir, 'sess_a.json');
    expect(fs.existsSync(file)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.schemaVersion).toBe(2);

    // “Reinicio”: otra instancia sobre el mismo directorio.
    const reloaded = createSessionStore(dir).load('sess_a');
    expect(reloaded).not.toBeNull();
    expect(reloaded).toEqual(state);
  });

  it('la escritura es atómica y no deja temporales', () => {
    store.save(stateWithSteps('sess_atomic', 1));
    store.save(stateWithSteps('sess_atomic', 2));

    const leftovers = fs.readdirSync(dir).filter((name) => name.includes('.tmp'));
    expect(leftovers).toEqual([]);
    expect(store.load('sess_atomic')?.steps).toHaveLength(2);
  });

  it('un archivo corrupto no se carga y no lanza', () => {
    fs.writeFileSync(path.join(dir, 'sess_roto.json'), '{ esto no es json', 'utf8');
    expect(() => store.load('sess_roto')).not.toThrow();
    expect(store.load('sess_roto')).toBeNull();
  });

  it('rechaza ids que puedan escapar del directorio', () => {
    expect(isValidSessionId('sess_abc123')).toBe(true);
    expect(isValidSessionId('..')).toBe(false);
    expect(isValidSessionId('../fuera')).toBe(false);
    expect(isValidSessionId('a/b')).toBe(false);
    expect(isValidSessionId('')).toBe(false);

    expect(store.load('..')).toBeNull();
    expect(store.load('../fuera')).toBeNull();
    expect(() => store.save(stateWithSteps('../fuera', 1))).toThrow(/id de sesión inválido/);
  });

  it('trunca a MAX_STEPS conservando lo más reciente', () => {
    const state = stateWithSteps('sess_pasos', MAX_STEPS + 50);
    const saved = store.save(state);
    expect(saved.steps).toHaveLength(MAX_STEPS);
    expect(saved.steps[0].id).toBe(`sess_pasos_step_50`);

    const reloaded = store.load('sess_pasos');
    expect(reloaded?.steps).toHaveLength(MAX_STEPS);
    expect(reloaded?.steps.at(-1)?.id).toBe(`sess_pasos_step_${MAX_STEPS + 49}`);
  });

  it('recorta por tamaño sin corromper el JSON', () => {
    const huge = 'x'.repeat(200_000);
    const state = stateWithSteps('sess_grande', 40, huge);
    store.save(state);

    const file = path.join(dir, 'sess_grande.json');
    const size = fs.statSync(file).size;
    expect(size).toBeLessThanOrEqual(MAX_STATE_BYTES);

    const raw = fs.readFileSync(file, 'utf8');
    const parsed = decodeSessionState(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe('sess_grande');
    expect(parsed!.steps.length).toBeLessThan(40);
  });

  it(`poda a ${MAX_SESSIONS} sesiones y conserva la más nueva`, () => {
    for (let index = 0; index < MAX_SESSIONS + 5; index++) {
      const id = `sess_${String(index).padStart(3, '0')}`;
      store.save(stateWithSteps(id, 1));
    }
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    expect(files).toHaveLength(MAX_SESSIONS);
    expect(files).toContain(`sess_${String(MAX_SESSIONS + 4).padStart(3, '0')}.json`);
  });

  it('lista por updatedAt descendente y borra el archivo al eliminar', () => {
    const older = stateWithSteps('sess_vieja', 1);
    older.updatedAt = 1_000;
    const newer = stateWithSteps('sess_nueva', 1);
    newer.updatedAt = 2_000;
    store.save(older);
    store.save(newer);

    expect(store.list().map((state) => state.id)).toEqual(['sess_nueva', 'sess_vieja']);
    expect(store.remove('sess_nueva')).toBe(true);
    expect(store.remove('sess_nueva')).toBe(false);
    expect(store.load('sess_nueva')).toBeNull();
    expect(store.list().map((state) => state.id)).toEqual(['sess_vieja']);
  });

  it('un directorio inexistente lista vacío', () => {
    const empty = createSessionStore(path.join(dir, 'no-existe'));
    expect(empty.list()).toEqual([]);
    expect(empty.load('sess_x')).toBeNull();
  });

  it('getOrLoadSession reconstruye desde disco sin arrancar la sesión', async () => {
    const state = stateWithSteps('sess_lazy', 2);
    state.status = 'completed';
    state.answer = 'hecho';
    state.turns = [{ role: 'user', text: 'objetivo', ts: 1 }];
    store.save(state);

    const previous = process.env.COMMANDER_AGENT_SESSIONS_DIR;
    process.env.COMMANDER_AGENT_SESSIONS_DIR = dir;
    try {
      const { getOrLoadSession } = await import('../../agentSession');
      const session = getOrLoadSession('sess_lazy');
      expect(session).toBeDefined();
      expect(session!.getStatus()).toBe('done');
      expect(session!.getSteps()).toHaveLength(2);
      expect(session!.isRunning()).toBe(false);
      expect(session!.toState().status).toBe('completed');
      expect(session!.toState().turns).toEqual(state.turns);
      // La segunda llamada sale del registro en memoria, no vuelve a leer.
      expect(getOrLoadSession('sess_lazy')).toBe(session);
    } finally {
      if (previous === undefined) delete process.env.COMMANDER_AGENT_SESSIONS_DIR;
      else process.env.COMMANDER_AGENT_SESSIONS_DIR = previous;
    }
  });
});
