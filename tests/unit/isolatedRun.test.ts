import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runIsolated } from '../../evals/isolatedRun';

/**
 * Las dos tandas de T10 del 2026-11-21 murieron con código 1 sin dejar línea
 * en el JSONL. La corrida aislada convierte esa muerte en un error registrable
 * y deja seguir con la tanda.
 */
const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-run-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('corrida aislada', () => {
  it('lee el resultado que deja el worker', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'resultado.json');
    const script = path.join(dir, 'ok.mjs');
    fs.writeFileSync(
      script,
      `import fs from 'node:fs';\n` +
        `fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({ result: { id: 'T10', passed: true }, toolCalls: 2, answer: 'Archivos: x' }));\n`,
      'utf8'
    );

    const run = await runIsolated<{ id: string; passed: boolean }>({
      command: process.execPath,
      args: [script],
      resultPath: out,
      timeoutMs: 10_000,
    });

    expect(run.error).toBeUndefined();
    expect(run.toolCalls).toBe(2);
    expect(run.answer).toBe('Archivos: x');
    expect(run.result).toMatchObject({ id: 'T10', passed: true });
  });

  it('convierte una muerte sin resultado en error con el código de salida', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'resultado.json');
    const script = path.join(dir, 'crash.mjs');
    fs.writeFileSync(script, `console.error('boom'); process.exit(1);\n`, 'utf8');

    const run = await runIsolated({ command: process.execPath, args: [script], resultPath: out, timeoutMs: 10_000 });

    expect(run.result).toBeUndefined();
    expect(run.error).toMatch(/código 1/);
    expect(run.error).toMatch(/boom/);
    expect(run.exitCode).toBe(1);
  });

  it('corta un worker colgado y lo informa como corrida sin terminar', async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'resultado.json');
    const script = path.join(dir, 'colgado.mjs');
    fs.writeFileSync(script, `setTimeout(() => {}, 60_000);\n`, 'utf8');

    const run = await runIsolated({ command: process.execPath, args: [script], resultPath: out, timeoutMs: 200 });

    expect(run.result).toBeUndefined();
    expect(run.error).toMatch(/no terminó en/);
  });
});
