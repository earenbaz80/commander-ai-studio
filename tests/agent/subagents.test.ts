import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeAgentTool } from '../../agentTools';
import {
  createSession,
  executeTask,
  getSession,
  listSessions,
  removeSession,
} from '../../agentSession';
import { clearSubAgents } from '../../subAgents';

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-subagent-'));
  tempDirs.push(dir);
  return dir;
}

function makeParent(dir: string) {
  return createSession({ goal: `padre-${Date.now()}-${Math.random()}`, cwd: dir });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('subagentes F1-12', () => {
  it('una tool fuera de la allowlist falla cerrada y no escribe nada', async () => {
    const dir = makeDir();
    const parent = makeParent(dir);
    const objetivo = `intento-escribir-${Date.now()}`;
    let capturado = '';
    let llamadas = 0;

    globalThis.fetch = (async () => {
      llamadas += 1;
      if (llamadas === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            functionCalls: [{ name: 'fs_write', args: { path: 'hack.txt', content: 'x' } }],
          }),
        } as any;
      }
      const resumen = listSessions().find((s) => s.goal === objetivo);
      const hijo = resumen ? getSession(resumen.id) : undefined;
      capturado = JSON.stringify(hijo?.getSteps() ?? []);
      return { ok: true, status: 200, json: async () => ({ text: 'fin', functionCalls: [] }) } as any;
    }) as any;

    try {
      const res: any = await executeAgentTool('task', {
        root: dir,
        parentSessionId: parent.id,
        goal: objetivo,
        template: 'file-explorer',
      });

      expect(res.ok).toBe(true);
      expect(res.answer).toBe('fin');
      expect(fs.existsSync(path.join(dir, 'hack.txt'))).toBe(false);
      expect(capturado).toContain('fs.write');
      expect(capturado).toMatch(/deshabilitada|no permitida|Modo/);
    } finally {
      removeSession(parent.id);
      clearSubAgents(parent.id);
    }
  });

  it('lanza seis subagentes en paralelo sin mezclar sesiones ni resultados', async () => {
    const dir = makeDir();
    const parent = makeParent(dir);
    const nombres = ['file-explorer', 'researcher', 'reviewer', 'planner', 'coder', 'tester'];
    const objetivos = nombres.map((n) => `paralelo-${n}-${Date.now()}`);

    globalThis.fetch = (async (_url: any, init?: any) => {
      const body = JSON.parse(String(init?.body || '{}'));
      const texto = String(body.contents || body.prompt || '');
      const goal = objetivos.find((g) => texto.includes(g)) || '';
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: `listo:${goal}`, functionCalls: [] }),
      } as any;
    }) as any;

    try {
      const res: any = await executeAgentTool('spawn_agents', {
        root: dir,
        parentSessionId: parent.id,
        agents: nombres.map((template, i) => ({ goal: objetivos[i], template })),
      });

      expect(res.ok, JSON.stringify(res).slice(0, 600)).toBe(true);
      expect(res.data.spawned).toBe(6);
      expect(res.data.capped).toBe(false);
      expect(res.data.results).toHaveLength(6);
      res.data.results.forEach((r: any, i: number) => {
        expect(r.ok, JSON.stringify(r).slice(0, 400)).toBe(true);
        expect(r.answer).toBe(`listo:${objetivos[i]}`);
      });
      expect(listSessions().filter((s) => objetivos.includes(s.goal))).toEqual([]);
    } finally {
      removeSession(parent.id);
      clearSubAgents(parent.id);
    }
  });

  it('worktree:true corre en una copia aislada y la limpia al terminar', async () => {
    const dir = makeDir();
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'base.txt'), 'base');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: dir });

    const parent = makeParent(dir);
    const objetivo = `worktree-${Date.now()}`;
    let visto = '';

    globalThis.fetch = (async () => {
      const resumen = listSessions().find((s) => s.goal === objetivo);
      const hijo = resumen ? getSession(resumen.id) : undefined;
      if (hijo) visto = hijo.getConfig().cwd;
      return { ok: true, status: 200, json: async () => ({ text: 'fin', functionCalls: [] }) } as any;
    }) as any;

    try {
      const res: any = await executeTask(parent.id, { goal: objetivo, worktree: true });
      expect(res.ok, JSON.stringify(res).slice(0, 600)).toBe(true);
      expect(visto).not.toBe(dir);
      expect(visto.startsWith(os.homedir())).toBe(true);
      expect(fs.existsSync(visto)).toBe(false);

      expect(fs.readFileSync(path.join(dir, 'base.txt'), 'utf8')).toBe('base');
      const lista = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(lista).not.toContain(visto);
      const ramas = execFileSync('git', ['branch', '--list', 'commander/*'], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(ramas.trim()).toBe('');
    } finally {
      if (visto && fs.existsSync(visto)) {
        try {
          execFileSync('git', ['worktree', 'remove', '--force', visto], { cwd: dir, stdio: 'ignore' });
        } catch { /* best-effort */ }
      }
      removeSession(parent.id);
      clearSubAgents(parent.id);
    }
  });

  it('valida plantilla y allowlist antes de crear la sesión hija', async () => {
    const dir = makeDir();
    const parent = makeParent(dir);

    try {
      const plantilla: any = await executeAgentTool('task', {
        root: dir,
        parentSessionId: parent.id,
        goal: 'x',
        template: 'no-existe',
      });
      expect(plantilla.ok).toBe(false);
      expect(plantilla.status).toBe(400);
      expect(plantilla.error).toMatch(/Plantilla de subagente desconocida/);

      const incoherente: any = await executeAgentTool('task', {
        root: dir,
        parentSessionId: parent.id,
        goal: 'x',
        allowedTools: ['fs.write'],
        mode: 'readonly',
      });
      expect(incoherente.ok).toBe(false);
      expect(incoherente.status).toBe(400);
      expect(incoherente.error).toMatch(/Modo readonly/);
    } finally {
      removeSession(parent.id);
      clearSubAgents(parent.id);
    }
  });
});
