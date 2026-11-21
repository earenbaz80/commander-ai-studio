import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeAgentTool } from '../../agentTools';
import { createSession, executeTask, getSession, listSessions, removeSession } from '../../agentSession';
import { clearSubAgents } from '../../subAgents';

/**
 * `G1-T10-09` midió 0/6 y una corrida dejó `hijo-b.txt` en el árbol principal.
 * El worktree sólo aísla si (1) el flag del modelo no se descarta y (2) una ruta
 * absoluta dentro del proyecto padre no puede escapar de la copia.
 */

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-worktree-'));
  tempDirs.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base');
  // La regla del proyecto evita el modal de aprobación: el subagente no tiene
  // un humano al otro lado (misma política que usa el escenario T10).
  fs.mkdirSync(path.join(dir, '.commander'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.commander', 'permissions.json'),
    JSON.stringify({
      mode: 'build',
      allowedTools: null,
      deniedTools: [],
      files: { read: [], write: [] },
      rules: [
        { tool: 'fs.write', pattern: '**', decision: 'allow' },
        { tool: 'fs.edit', pattern: '**', decision: 'allow' },
      ],
    })
  );
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: dir });
  return dir;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('aislamiento del worktree en subagentes', () => {
  it('no escribe fuera de la copia aunque la ruta sea absoluta', async () => {
    const dir = makeRepo();
    const parent = createSession({ goal: `padre-fuga-${Date.now()}`, cwd: dir });
    const objetivo = `fuga-${Date.now()}`;
    const fuera = path.join(dir, 'hijo-b.txt');
    let llamadas = 0;
    let pasos = '';

    // Primer turno del hijo: intenta escribir en el árbol principal con una ruta
    // absoluta. Segundo: cierra con el contrato.
    globalThis.fetch = (async () => {
      llamadas += 1;
      if (llamadas === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            functionCalls: [{ name: 'fs_write', args: { path: fuera, content: 'fuga' } }],
          }),
        } as any;
      }
      const resumen = listSessions().find((s) => s.goal === objetivo);
      const hijo = resumen ? getSession(resumen.id) : undefined;
      pasos = JSON.stringify(hijo?.getSteps() ?? []);
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: 'Archivos: ninguno\nDenegado: ninguna', functionCalls: [] }),
      } as any;
    }) as any;

    try {
      const res: any = await executeTask(parent.id, { goal: objetivo, worktree: true });

      expect(res.ok, JSON.stringify(res).slice(0, 600)).toBe(true);
      expect(fs.existsSync(fuera)).toBe(false);
      expect(pasos).toMatch(/fuera del worktree/);
    } finally {
      removeSession(parent.id);
      clearSubAgents(parent.id);
    }
  });

  it('respeta worktree:"true" enviado como texto', async () => {
    const dir = makeRepo();
    const parent = createSession({ goal: `padre-texto-${Date.now()}`, cwd: dir });
    const objetivo = `texto-${Date.now()}`;
    let visto = '';
    let llamadas = 0;

    // El hijo escribe `hijo-b.txt` relativo: con el flag descartado, caía en el
    // árbol principal, que es la fuga de `G1-T10-09`.
    globalThis.fetch = (async () => {
      llamadas += 1;
      const resumen = listSessions().find((s) => s.goal === objetivo);
      if (resumen) visto = getSession(resumen.id)?.getConfig().cwd ?? '';
      if (llamadas === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            functionCalls: [{ name: 'fs_write', args: { path: 'hijo-b.txt', content: 'b' } }],
          }),
        } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: 'Archivos: hijo-b.txt\nDenegado: ninguna', functionCalls: [] }),
      } as any;
    }) as any;

    try {
      const res: any = await executeAgentTool('spawn_agents', {
        root: dir,
        parentSessionId: parent.id,
        agents: [{ goal: objetivo, worktree: 'true' }],
      });

      expect(res.ok, JSON.stringify(res).slice(0, 600)).toBe(true);
      expect(res.data.results[0].ok, JSON.stringify(res.data.results[0]).slice(0, 400)).toBe(true);
      expect(visto).not.toBe(dir);
      expect(visto.startsWith(os.homedir())).toBe(true);
      expect(fs.existsSync(path.join(dir, 'hijo-b.txt'))).toBe(false);
    } finally {
      removeSession(parent.id);
      clearSubAgents(parent.id);
    }
  });
});
