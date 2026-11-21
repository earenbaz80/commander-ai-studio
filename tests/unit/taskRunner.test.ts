import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ISOLATED_TASKS, isolatedTaskFailureOutcome, runTaskIsolated, taskWorkerArgs } from '../../evals/taskRunner';
import { TASKS } from '../../evals/baselineTasks';

/**
 * T1–T5 y T8 corrían dentro del runner: una muerte del proceso se llevaba la
 * tanda entera. Estos casos fijan el ruteo al worker y el registro del aborto.
 */
const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-runner-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('tareas aisladas', () => {
  it('las seis tareas del arnés se lanzan en el worker con su --task', () => {
    expect([...ISOLATED_TASKS]).toEqual(TASKS.map((task) => task.id));

    for (const task of ISOLATED_TASKS) {
      const args = taskWorkerArgs(
        { task, model: 'modelo/eval', baseUrl: 'http://127.0.0.1:3280' },
        'resultado.json'
      );
      expect(args[args.indexOf('--task') + 1]).toBe(task);
      expect(args[args.indexOf('--out') + 1]).toBe('resultado.json');
      expect(args.join(' ')).toContain(path.join('evals', 'taskWorker.ts'));
      expect(args.join(' ')).toContain('modelo/eval');
      expect(args.join(' ')).toContain('http://127.0.0.1:3280');
    }
  });

  it('una muerte del worker queda como error de esa corrida, no de la tanda', async () => {
    const dir = tmpDir();
    const worker = path.join(dir, 'crash.mjs');
    fs.writeFileSync(worker, `console.error('boom'); process.exit(1);\n`, 'utf8');

    const isolated = await runTaskIsolated({
      task: 'T4',
      model: 'modelo/eval',
      baseUrl: 'http://127.0.0.1:9',
      resultPath: path.join(dir, 'resultado.json'),
      workerPath: worker,
    });

    expect(isolated.result).toBeUndefined();
    expect(isolated.exitCode).toBe(1);
    expect(isolated.error).toMatch(/código 1/);
    expect(isolated.error).toMatch(/boom/);

    const outcome = isolatedTaskFailureOutcome('T4', isolated, Date.now() - 900);
    expect(outcome).toMatchObject({ id: 'T4', passed: false, stopReason: 'error', timedOut: false });
    expect(outcome.error).toMatch(/código 1/);
  });

  it('un worker que sale sin dejar archivo también se informa', async () => {
    const dir = tmpDir();
    const worker = path.join(dir, 'vacio.mjs');
    fs.writeFileSync(worker, `process.exit(0);\n`, 'utf8');

    const isolated = await runTaskIsolated({
      task: 'T8',
      model: 'modelo/eval',
      baseUrl: 'http://127.0.0.1:9',
      resultPath: path.join(dir, 'resultado.json'),
      workerPath: worker,
    });

    expect(isolated.error).toMatch(/sin dejar resultado/);
    expect(isolatedTaskFailureOutcome('T8', isolated, Date.now()).error).toMatch(/sin dejar resultado/);
  });
});
