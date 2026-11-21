/**
 * Temporizador real del subagente, con reloj falso.
 *
 * Los tests unitarios de `resolveSubagentTimeout` cubren los números; éstos
 * cubren el reloj: un hijo que nunca responde se corta al presupuesto que
 * corresponde (180 s por defecto, 240 s heredados del padre de T10 o el que
 * pida `spawn_agents`/`task`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSession, executeTask, removeSession } from '../../agentSession';
import { clearSubAgents } from '../../subAgents';

const originalFetch = globalThis.fetch;

describe('temporizador del subagente', () => {
  let dir: string;
  let parent: ReturnType<typeof createSession>;

  /** El proveedor nunca contesta: el único reloj que actúa es el del hijo. */
  beforeEach(() => {
    vi.useFakeTimers();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-timeout-'));
    globalThis.fetch = (() => new Promise(() => {})) as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    if (parent) {
      clearSubAgents(parent.id);
      removeSession(parent.id);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeParent(subagentTimeoutMs?: number) {
    parent = createSession({
      goal: `padre-timeout-${Date.now()}`,
      cwd: dir,
      ...(subagentTimeoutMs ? { subagentTimeoutMs } : {}),
    });
    return parent;
  }

  async function avanza(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  test('sin valor configurado corta al hijo a los 180 s', async () => {
    makeParent();
    const child = executeTask(parent.id, { goal: 'hijo colgado' });
    let settled = false;
    void child.then(() => { settled = true; });

    await avanza(179_999);
    expect(settled).toBe(false);

    await avanza(2);
    const res = await child;
    expect(res.ok).toBe(false);
    expect(res.error).toContain('180 s');
    expect(res.error).toContain('tiempo límite');
  });

  test('hereda los 240 s del padre, como T10', async () => {
    makeParent(240_000);
    const child = executeTask(parent.id, { goal: 'hijo colgado de T10' });
    let settled = false;
    void child.then(() => { settled = true; });

    await avanza(180_000);
    expect(settled).toBe(false);

    await avanza(59_999);
    expect(settled).toBe(false);

    await avanza(2);
    const res = await child;
    expect(res.ok).toBe(false);
    expect(res.error).toContain('240 s');
  });

  test('el timeout pedido por el padre de la tanda gana al valor de la sesión', async () => {
    makeParent(240_000);
    const child = executeTask(parent.id, { goal: 'hijo con timeout propio', timeoutMs: 300_000 });
    let settled = false;
    void child.then(() => { settled = true; });

    await avanza(240_001);
    expect(settled).toBe(false);

    await avanza(59_999);
    const res = await child;
    expect(res.ok).toBe(false);
    expect(res.error).toContain('300 s');
  });
});
