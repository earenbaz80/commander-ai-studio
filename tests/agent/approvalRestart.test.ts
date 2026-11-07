/**
 * Aprobaciones pendientes tras reiniciar el servidor (F1-04).
 *
 * Se simula el reinicio escribiendo el estado en disco y cargándolo con
 * `getOrLoadSession` en este proceso. La decisión posterior no debe ejecutar la
 * llamada vieja: queda atada a la misma tool + input y se consume una sola vez
 * cuando la sesión reanuda.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionState, type ApprovalRequestV2, type SessionStateV2 } from '../../src/agent/sessionTypes';
import { createSessionStore } from '../../src/agent/sessionStore';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-approval-restart-'));
// Aislar las raíces de proyecto y las sesiones del repo real.
process.env.AGENT_ROOTS_FILE = path.join(base, 'roots.json');
process.env.COMMANDER_AGENT_SESSIONS_DIR = path.join(base, 'sessions');

let agentSession: typeof import('../../agentSession');
let projects: typeof import('../../projects');
let permissions: typeof import('../../permissions');

beforeAll(async () => {
  agentSession = await import('../../agentSession');
  projects = await import('../../projects');
  permissions = await import('../../permissions');
});

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(base, 'case-'));
  projects.addRoot(cwd);
  permissions.setPermissions(cwd, { mode: 'build', allowedTools: ['fs.write'], deniedTools: [] });
});

afterEach(() => {
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

afterAll(() => {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
});

function approval(
  id: string,
  sessionId: string,
  overrides: Partial<ApprovalRequestV2> = {}
): ApprovalRequestV2 {
  const now = Date.now();
  return {
    id,
    sessionId,
    tool: 'fs.write',
    input: { path: 'aprobado.txt', content: 'ok' },
    createdAt: now,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

function stateWith(id: string, approvals: ApprovalRequestV2[]): SessionStateV2 {
  const state = createSessionState({ id, goal: 'reanudar aprobaciones', cwd, model: 'gemini/fake' });
  state.status = 'running';
  state.pendingApproval = approvals[0] ?? null;
  if (approvals.length > 1) state.pendingApprovals = approvals;
  return state;
}

function save(state: SessionStateV2): void {
  createSessionStore().save(state);
}

function loadState(id: string): SessionStateV2 | null {
  return createSessionStore().load(id);
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condición no alcanzada');
}

describe('aprobaciones tras reiniciar el servidor', () => {
  test('una pendiente se puede resolver después del reinicio', () => {
    const id = 'sess_restart_1';
    const apr = approval('apr_restart_1', id);
    save(stateWith(id, [apr]));

    const session = agentSession.getOrLoadSession(id);
    expect(session).toBeDefined();
    expect(session!.getPendingApprovals().map((item) => item.id)).toEqual([apr.id]);
    expect(session!.toState().pendingApproval?.id).toBe(apr.id);

    const resolved = session!.resolveApproval(apr.id, 'allow');
    expect(resolved.status).toBe(200);
    expect(resolved.body.decision).toBe('allow');
    expect(session!.getPendingApprovals()).toEqual([]);
    expect(loadState(id)?.pendingApproval ?? null).toBeNull();

    expect(session!.resolveApproval(apr.id, 'allow')).toEqual(resolved);
    expect(session!.resolveApproval(apr.id, 'deny').status).toBe(409);
  });

  test('allow tras reinicio autoriza sólo la llamada idéntica y una vez', async () => {
    const id = 'sess_restart_2';
    const input = { path: 'aprobado.txt', content: 'ok' };
    const apr = approval('apr_restart_2', id, { input });
    save(stateWith(id, [apr]));

    const session = agentSession.getOrLoadSession(id)!;
    expect(session.resolveApproval(apr.id, 'allow').status).toBe(200);

    const runOne = (session as any).runOne.bind(session);
    const first = await runOne({ tool: 'fs.write', input });
    expect(first.ok).toBe(true);
    expect(first.approval?.id).toBe(apr.id);
    expect(fs.readFileSync(path.join(cwd, 'aprobado.txt'), 'utf8')).toBe('ok');

    // Otro contenido no hereda el permiso: pide una aprobación nueva.
    const other = runOne({ tool: 'fs.write', input: { path: 'otro.txt', content: 'x' } });
    await waitFor(() => session.getPendingApprovals().length === 1);
    expect(fs.existsSync(path.join(cwd, 'otro.txt'))).toBe(false);

    const pending = session.getPendingApprovals()[0];
    expect(session.resolveApproval(pending.id, 'deny').status).toBe(200);
    const denied = await other;
    expect(denied.ok).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'otro.txt'))).toBe(false);
  });

  test('deny tras reinicio no ejecuta la llamada vieja', async () => {
    const id = 'sess_restart_3';
    const input = { path: 'denegado.txt', content: 'no' };
    const apr = approval('apr_restart_3', id, { input });
    save(stateWith(id, [apr]));

    const session = agentSession.getOrLoadSession(id)!;
    expect(session.resolveApproval(apr.id, 'deny', 'no autorizado').status).toBe(200);

    const result = await (session as any).runOne({ tool: 'fs.write', input });
    expect(result.ok).toBe(false);
    expect(result.approval?.decision).toBe('deny');
    expect(result.approval?.reason).toBe('no autorizado');
    expect(fs.existsSync(path.join(cwd, 'denegado.txt'))).toBe(false);
  });

  test('una pendiente vencida durante la caída se cierra como timeout', () => {
    const id = 'sess_restart_4';
    const apr = approval('apr_restart_4', id, { expiresAt: Date.now() - 1_000 });
    save(stateWith(id, [apr]));

    const session = agentSession.getOrLoadSession(id)!;
    expect(session.getPendingApprovals()).toEqual([]);
    expect(session.resolveApproval(apr.id, 'allow').status).toBe(409);

    const deny = session.resolveApproval(apr.id, 'deny');
    expect(deny.status).toBe(200);
    expect(deny.body.reason).toBe('timeout');
    expect(loadState(id)?.pendingApproval ?? null).toBeNull();
  });

  test('varias pendientes sobreviven al reinicio', () => {
    const id = 'sess_restart_5';
    const first = approval('apr_restart_5a', id);
    const second = approval('apr_restart_5b', id, {
      tool: 'shell.run',
      input: { command: 'echo hola' },
    });
    save(stateWith(id, [first, second]));

    const session = agentSession.getOrLoadSession(id)!;
    expect(session.getPendingApprovals().map((item) => item.id)).toEqual([first.id, second.id]);
    expect(session.toState().pendingApprovals?.map((item) => item.id)).toEqual([first.id, second.id]);

    expect(session.resolveApproval(second.id, 'deny').status).toBe(200);
    expect(session.getPendingApprovals().map((item) => item.id)).toEqual([first.id]);
  });

  test('si el modelo repite la llamada, reengancha la misma aprobación', async () => {
    const id = 'sess_restart_6';
    const input = { path: 'reuso.txt', content: 'ok' };
    const apr = approval('apr_restart_6', id, { input });
    save(stateWith(id, [apr]));

    const session = agentSession.getOrLoadSession(id)!;
    const pendingRun = (session as any).runOne({ tool: 'fs.write', input });
    await waitFor(() => session.getPendingApprovals().length === 1);
    expect(session.getPendingApprovals()[0].id).toBe(apr.id);

    expect(session.resolveApproval(apr.id, 'allow').status).toBe(200);
    const result = await pendingRun;
    expect(result.ok).toBe(true);
    expect(result.approval?.id).toBe(apr.id);
    expect(fs.readFileSync(path.join(cwd, 'reuso.txt'), 'utf8')).toBe('ok');
  });

  test('allow-session tras reinicio vale para esa tool y ruta, sin persistirse', async () => {
    const id = 'sess_restart_7';
    const input = { path: 'sesion.txt', content: 'ok' };
    const apr = approval('apr_restart_7', id, { input });
    save(stateWith(id, [apr]));

    const session = agentSession.getOrLoadSession(id)!;
    expect(session.resolveApproval(apr.id, 'allow-session').status).toBe(200);

    const result = await (session as any).runOne({ tool: 'fs.write', input });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(cwd, 'sesion.txt'), 'utf8')).toBe('ok');

    const onDisk = loadState(id);
    expect(onDisk?.pendingApproval ?? null).toBeNull();
    expect(JSON.stringify(onDisk)).not.toContain('sesion.txt');
  });
});
