import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sessionDiagnostics, type SessionState } from '../../evals/scenarios';

/**
 * G1-T10-02: el fallo dejaba `spawned=undefined`, 4 pasos y «sin respuesta
 * final», pero nada decía qué tool había llamado el padre. El estado se borra
 * con la sesión, así que el diagnóstico se captura antes y deja un volcado.
 */
function stateOf(steps: any[]): SessionState {
  return {
    id: 'sess_diag',
    goal: 'T10: dos subagentes',
    cwd: '/tmp/t10',
    status: 'completed',
    steps,
    turns: [],
  } as any;
}

describe('diagnóstico de T10', () => {
  it('resume tools del padre, títulos de pasos y truncaciones, y guarda el estado', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't10-diag-'));
    const state = stateOf([
      { id: 's1', ts: 1, type: 'thought', title: 'Inicio', content: 'Objetivo: T10', status: 'completed' },
      {
        id: 's2',
        ts: 2,
        type: 'tool_result',
        title: 'spawn_agents',
        toolId: 'spawn_agents',
        content: 'spawned=undefined',
        status: 'completed',
      },
      {
        id: 's3',
        ts: 3,
        type: 'thought',
        title: 'Respuesta truncada',
        content: 'respuesta truncada por max_tokens (finish_reason: length); max_tokens=16384',
        status: 'failed',
      },
    ]);

    const diag = sessionDiagnostics(state, ['respuesta truncada por max_tokens (finish_reason: length)'], dir);

    expect(diag).toBeDefined();
    expect(diag!.parentTools).toEqual(['spawn_agents']);
    expect(diag!.stepTitles).toEqual(['Inicio', 'spawn_agents', 'Respuesta truncada']);
    // Un turno truncado del padre y otro que sólo llegó en el error del hijo.
    expect(diag!.truncatedTurns).toBe(2);
    expect(diag!.statePath).toBeTruthy();

    const [file] = fs.readdirSync(dir);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    expect(saved.id).toBe('sess_diag');
    expect(saved.steps).toHaveLength(3);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('no inventa diagnóstico si la sesión no llegó a existir', () => {
    expect(sessionDiagnostics(undefined)).toBeUndefined();
  });
});
