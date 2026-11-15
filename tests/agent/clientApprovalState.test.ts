import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSession, removeSession } from '../../agentSession';
import type { ApprovalRequestV2, SessionStateV2 } from '../../src/agent/sessionTypes';

/**
 * El bucle puede correr en el CLI, no en el servidor. En ese modo la promesa de
 * la aprobación vive en el proceso del cliente, así que el servidor no la tiene
 * en `pendingApprovals`: la conoce sólo por el checkpoint (`PUT /state`). Sin
 * esto el prompt quedaba abierto sin que el estado lo dijera (G1-D4-05: 801 s).
 */

const dirs: string[] = [];
const sessions: string[] = [];

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdr-apr-cli-'));
  dirs.push(dir);
  return dir;
}

function makeSession() {
  const session = createSession({ goal: `apr-cli-${Date.now()}-${Math.random()}`, cwd: makeDir() });
  sessions.push(session.id);
  return session;
}

function approval(overrides: Partial<ApprovalRequestV2> = {}): ApprovalRequestV2 {
  const now = Date.now();
  return {
    id: 'apr_cli_1',
    sessionId: 'sess_pendiente',
    tool: 'fs.write',
    input: { path: 'salida.txt', content: 'x' },
    createdAt: now,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

/** Checkpoint tal como lo manda el CLI: el estado completo con su `status`. */
function checkpoint(
  session: { toState: () => SessionStateV2 },
  patch: Partial<SessionStateV2>
): SessionStateV2 {
  return { ...session.toState(), ...patch };
}

afterEach(() => {
  for (const id of sessions.splice(0)) removeSession(id);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('checkpoint del CLI con una aprobación abierta', () => {
  it('la anuncia en el estado mientras la sesión corre', () => {
    const session = makeSession();
    const pending = approval({ sessionId: session.id });

    session.replaceState(checkpoint(session, { status: 'running', pendingApproval: pending }));

    const state = session.toState();
    expect(state.status).toBe('running');
    expect(state.pendingApproval?.id).toBe(pending.id);
    expect(state.pendingApproval?.tool).toBe('fs.write');
    expect(state.pendingApprovals).toBeUndefined();
  });

  it('acepta varias pendientes y deja la primera en pendingApproval', () => {
    const session = makeSession();
    const first = approval({ id: 'apr_a', sessionId: session.id });
    const second = approval({ id: 'apr_b', sessionId: session.id, tool: 'fs.edit' });

    session.replaceState(
      checkpoint(session, {
        status: 'running',
        pendingApproval: first,
        pendingApprovals: [first, second],
      })
    );

    const state = session.toState();
    expect(state.pendingApproval?.id).toBe('apr_a');
    expect(state.pendingApprovals?.map((item) => item.id)).toEqual(['apr_a', 'apr_b']);
  });

  it('la retira en cuanto el checkpoint llega sin ella', () => {
    const session = makeSession();
    const pending = approval({ sessionId: session.id });
    session.replaceState(checkpoint(session, { status: 'running', pendingApproval: pending }));

    session.replaceState(checkpoint(session, { status: 'running', pendingApproval: null }));

    expect(session.toState().pendingApproval).toBeNull();
    expect(session.toState().pendingApprovals).toBeUndefined();
  });

  it('no la anuncia si la sesión ya terminó', () => {
    const session = makeSession();
    const pending = approval({ sessionId: session.id });

    session.replaceState(checkpoint(session, { status: 'completed', pendingApproval: pending }));

    expect(session.toState().status).toBe('completed');
    expect(session.toState().pendingApproval).toBeNull();
  });

  it('no anuncia una aprobación ya caducada', () => {
    const session = makeSession();
    const pending = approval({ sessionId: session.id, expiresAt: Date.now() - 1 });

    session.replaceState(checkpoint(session, { status: 'running', pendingApproval: pending }));

    expect(session.toState().pendingApproval).toBeNull();
  });

  it('stop() la retira aunque el último checkpoint la anunciara', () => {
    const session = makeSession();
    const pending = approval({ sessionId: session.id });
    session.replaceState(checkpoint(session, { status: 'running', pendingApproval: pending }));

    session.stop();

    expect(session.toState().pendingApproval).toBeNull();
  });
});
