import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ISOLATED_SCENARIOS,
  isolatedFailureOutcome,
  runScenarioIsolated,
  scenarioWorkerArgs,
} from '../../evals/scenarioRunner';

/**
 * El 2026-11-21 el runner murió dos veces a mitad de T10 y se llevó la tanda.
 * Estos casos fijan que los cuatro escenarios pasen por el worker y que una
 * muerte del worker se registre como error de esa corrida, no de la tanda.
 */
const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-runner-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('escenarios aislados', () => {
  it('T6, T7, T9 y T10 se lanzan en el worker con su escenario', () => {
    expect([...ISOLATED_SCENARIOS]).toEqual(['T6', 'T7', 'T9', 'T10']);

    for (const scenario of ISOLATED_SCENARIOS) {
      const args = scenarioWorkerArgs(
        { scenario, model: 'modelo/eval', baseUrl: 'http://127.0.0.1:3280' },
        'resultado.json'
      );
      expect(args[args.indexOf('--scenario') + 1]).toBe(scenario);
      expect(args[args.indexOf('--out') + 1]).toBe('resultado.json');
      expect(args.join(' ')).toContain(path.join('evals', 'scenarioWorker.ts'));
      expect(args.join(' ')).toContain('modelo/eval');
      expect(args.join(' ')).toContain('http://127.0.0.1:3280');
    }
  });

  it('una muerte del worker queda como error de esa corrida, no de la tanda', async () => {
    const dir = tmpDir();
    const worker = path.join(dir, 'crash.mjs');
    fs.writeFileSync(worker, `console.error('boom'); process.exit(1);\n`, 'utf8');

    const isolated = await runScenarioIsolated({
      scenario: 'T9',
      model: 'modelo/eval',
      baseUrl: 'http://127.0.0.1:9',
      resultPath: path.join(dir, 'resultado.json'),
      workerPath: worker,
    });

    expect(isolated.result).toBeUndefined();
    expect(isolated.exitCode).toBe(1);
    expect(isolated.error).toMatch(/código 1/);
    expect(isolated.error).toMatch(/boom/);

    const outcome = isolatedFailureOutcome('T9', isolated, Date.now() - 1500);
    expect(outcome).toMatchObject({ id: 'T9', passed: false, stopReason: 'error', timedOut: false });
    expect(outcome.error).toMatch(/código 1/);
  });

  it('un worker que sale sin dejar archivo también se informa', async () => {
    const dir = tmpDir();
    const worker = path.join(dir, 'vacio.mjs');
    fs.writeFileSync(worker, `process.exit(0);\n`, 'utf8');

    const isolated = await runScenarioIsolated({
      scenario: 'T7',
      model: 'modelo/eval',
      baseUrl: 'http://127.0.0.1:9',
      resultPath: path.join(dir, 'resultado.json'),
      workerPath: worker,
    });

    expect(isolated.error).toMatch(/sin dejar resultado/);
    expect(isolatedFailureOutcome('T7', isolated, Date.now()).error).toMatch(/sin dejar resultado/);
  });
});
