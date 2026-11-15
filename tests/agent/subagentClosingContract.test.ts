import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeAgentTool } from '../../agentTools';
import {
  SUBAGENT_CLOSING_CONTRACT,
  SUBAGENT_CLOSING_REMINDER,
  createSession,
  reinforceClosingContract,
  removeSession,
} from '../../agentSession';
import { clearSubAgents } from '../../subAgents';

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];
const sessions: string[] = [];

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-cierre-'));
  tempDirs.push(dir);
  return dir;
}

function makeParent(dir: string) {
  const parent = createSession({ goal: `padre-cierre-${Date.now()}-${Math.random()}`, cwd: dir });
  sessions.push(parent.id);
  return parent;
}

/** Stub del proveedor: guarda cada cuerpo y cierra el hijo con una respuesta final. */
function stubProvider(bodies: { url: string; body: any }[]): void {
  globalThis.fetch = (async (url: any, init: any) => {
    const raw = init?.body ? String(init.body) : '';
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
    bodies.push({ url: String(url), body });
    return { ok: true, status: 200, json: async () => ({ text: 'fin', functionCalls: [] }) } as any;
  }) as any;
}

/** Prompt de sistema del hijo, tal como lo recibió el proveedor. */
function systemOf(entry: { body: any }): string {
  return String(entry.body.systemInstruction ?? entry.body.contents ?? entry.body.prompt ?? '');
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const id of sessions.splice(0)) removeSession(id);
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('cierre de subagentes (G1-SUBAGENT-CLOSE)', () => {
  it('el hijo recibe el contrato de cierre y las instrucciones del padre', async () => {
    const dir = makeDir();
    const parent = makeParent(dir);
    const bodies: { url: string; body: any }[] = [];
    stubProvider(bodies);

    const res: any = await executeAgentTool('spawn_agents', {
      root: dir,
      parentSessionId: parent.id,
      agents: [{ goal: 'hijo-a: escribe hito-a.txt', instructions: 'Escribe hito-a.txt con fs.write' }],
    });
    clearSubAgents(parent.id);

    expect(res.ok).toBe(true);
    expect(res.data?.results?.length).toBe(1);
    const child = bodies.find((entry) => systemOf(entry).includes('hijo-a: escribe hito-a.txt'));
    expect(child).toBeTruthy();
    const system = systemOf(child!);

    expect(system).toContain(SUBAGENT_CLOSING_CONTRACT);
    expect(system).toContain('Archivos:');
    expect(system).toContain('Denegado:');
    expect(system).toContain('INSTRUCCIONES DEL PADRE');
    expect(system).toContain('Escribe hito-a.txt con fs.write');
  });

  it('el encargo lleva el recordatorio aunque el padre no escriba instrucciones', async () => {
    const dir = makeDir();
    const parent = makeParent(dir);
    const bodies: { url: string; body: any }[] = [];
    stubProvider(bodies);

    const res: any = await executeAgentTool('spawn_agents', {
      root: dir,
      parentSessionId: parent.id,
      agents: [{ goal: 'hijo-b: escribe hito-b.txt' }],
    });
    clearSubAgents(parent.id);

    expect(res.ok).toBe(true);
    const child = bodies.find((entry) => systemOf(entry).includes('hijo-b: escribe hito-b.txt'));
    expect(child).toBeTruthy();
    const system = systemOf(child!);

    expect(system).toContain(SUBAGENT_CLOSING_REMINDER);
    expect(system).toContain(SUBAGENT_CLOSING_CONTRACT);
  });

  it('no duplica el recordatorio si el padre ya lo incluyó', () => {
    const una = reinforceClosingContract('Escribe el informe.');
    const dos = reinforceClosingContract(una);
    expect(dos).toBe(una);
    expect(una.startsWith('Escribe el informe.')).toBe(true);
    expect(reinforceClosingContract()).toBe(SUBAGENT_CLOSING_REMINDER);
    expect(reinforceClosingContract(undefined)).toBe(SUBAGENT_CLOSING_REMINDER);
  });
});
