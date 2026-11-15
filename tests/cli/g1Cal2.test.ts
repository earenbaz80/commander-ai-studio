import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm run g1:cal2` guarda y publica dos métricas por decisión: `latencyMs`
 * (creación → decisión, la de la puerta) y `decisionMs` (primera tecla →
 * decisión, §12.11). El segundo juego de percentiles es descriptivo: no tiene
 * umbral, no excluye muestras y no toca la referencia de 15 151 ms. Las filas
 * anteriores al campo no se reescriben.
 *
 * El script se ejecuta de verdad, con el cwd en un temporal: el store vive en
 * `<cwd>/.commander/g1/cal2/samples.jsonl`, así que no se toca el del repo.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SCRIPT = path.join(ROOT, 'scripts', 'g1-cal2.ts');

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cal2-'));
}

function runWithEnv(dir: string, env: Record<string, string>, ...args: string[]) {
  const res = spawnSync(process.execPath, [TSX, SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: dir, USERPROFILE: dir, ...env },
  });
  return { code: res.status ?? 1, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

function run(dir: string, ...args: string[]) {
  return runWithEnv(dir, {}, ...args);
}

function storeOf(dir: string): string {
  return path.join(dir, '.commander', 'g1', 'cal2', 'samples.jsonl');
}

const JUSTIFICA = 'math.mjs: values.length - 1 → values.length';

describe('g1:cal2 — decisionMs junto a latencyMs', () => {
  test('add guarda decisionMs y summary lo publica aparte, sin mover la puerta', (t) => {
    const dir = tempDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    for (const [ms, decisionMs] of [
      [2000, 100],
      [2100, 300],
      [3000, 900],
    ] as const) {
      const added = run(
        dir,
        'add',
        '--run',
        'CAL2-T01',
        '--tool',
        'shell.run',
        '--decision',
        'allow',
        '--ms',
        String(ms),
        '--decision-ms',
        String(decisionMs),
        '--leido',
        '--justifica',
        'node --test math.test.mjs'
      );
      assert.equal(added.code, 0, added.out);
    }

    const rows = fs
      .readFileSync(storeOf(dir), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((row) => row.decisionMs),
      [100, 300, 900],
      'decisionMs se escribe en samples.jsonl'
    );

    const summary = run(dir, 'summary');
    assert.equal(summary.code, 0, summary.out);
    // Latencia: p95 de [2000, 2100, 3000] = 3000. La puerta sigue siendo ésa y
    // no puede pasar a valer el p95 de decisionMs (900).
    assert.match(summary.out, /puerta: p95 3000 ms frente a 15151 ms → CUMPLE/);
    assert.match(summary.out, /# decisionMs — desde la primera tecla de lectura \(3 de 3 incluidas\)/);
    assert.match(summary.out, /n=3 · p50 300 ms · p90 900 ms · p95 900 ms/);
    assert.match(summary.out, /shell\.run: n=3 · p50 300 ms · p90 900 ms · p95 900 ms/);
    assert.match(summary.out, /la referencia de 15151 ms es de `latencyMs` y no se toca/);
  });

  test('summary no reescribe las muestras viejas y las cuenta sólo una vez', (t) => {
    const dir = tempDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = storeOf(dir);
    fs.mkdirSync(path.dirname(store), { recursive: true });
    const legacy = {
      sampleId: 'CAL2-01',
      ts: '2026-11-13T09:37:13.221Z',
      runId: 'CAL2-R13',
      tool: 'fs.edit',
      decision: 'allow',
      latencyMs: 61246,
      leido: true,
      diffLog: false,
      detalle: false,
      justificacion: JUSTIFICA,
      nota: '',
      source: 'session',
      approvalId: 'apr_36a4ff3b',
      render: { diffShown: true, diffTruncated: false, detailOpened: false },
    };
    const original = `${JSON.stringify(legacy)}\n`;
    fs.writeFileSync(store, original);

    const summary = run(dir, 'summary');
    assert.equal(summary.code, 0, summary.out);
    assert.match(summary.out, /\| CAL2-01 \| CAL2-R13 \| fs\.edit \| allow \| 61246 \| — \| primario \|/);
    assert.match(summary.out, /sin muestras con decisionMs/);
    assert.match(summary.out, /puerta: p95 61246 ms frente a 15151 ms → NO CUMPLE/);
    assert.equal(fs.readFileSync(store, 'utf8'), original, 'summary es de sólo lectura');
  });

  test('import copia decisionMs del estado y avisa cuando falta la latencia', (t) => {
    const dir = tempDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const sessionFile = path.join(dir, 'CAL2-T03.json');
    fs.writeFileSync(
      sessionFile,
      JSON.stringify({
        success: true,
        state: {
          id: 'sess_cal2_t03',
          steps: [
            {
              type: 'tool_result',
              toolId: 'fs.edit',
              approval: {
                id: 'apr_a',
                decision: 'allow',
                latencyMs: 61_246,
                decisionMs: 1_300,
                render: { diffShown: true, diffTruncated: false, detailOpened: false },
              },
            },
            {
              type: 'tool_result',
              toolId: 'shell.run',
              approval: { id: 'apr_b', decision: 'allow', latencyMs: 2_104 },
            },
            {
              type: 'tool_result',
              toolId: 'fs.edit',
              approval: {
                id: 'apr_c',
                decision: 'allow',
                decisionMs: 800,
                render: { diffShown: true, diffTruncated: false, detailOpened: false },
              },
            },
          ],
        },
      })
    );

    const imported = run(
      dir,
      'import',
      '--run',
      'CAL2-T03',
      '--session',
      sessionFile,
      '--leido',
      '--justifica',
      JUSTIFICA
    );
    assert.equal(imported.code, 0, imported.out);
    assert.match(imported.out, /importadas 2 · rechazadas 0 · sin `latencyMs` 1/);
    assert.match(imported.out, /sí trae decisionMs 800 ms/);

    const rows = fs
      .readFileSync(storeOf(dir), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 2, 'sin latencyMs no hay muestra, aunque traiga decisionMs');
    assert.equal(rows[0].decisionMs, 1300);
    assert.equal('decisionMs' in rows[1], false, 'no se inventa el campo que el estado no trae');

    const summary = run(dir, 'summary');
    assert.equal(summary.code, 0, summary.out);
    assert.match(summary.out, /# decisionMs — desde la primera tecla de lectura \(1 de 2 incluidas\)/);
    assert.match(summary.out, /aviso: 1 incluidas no traen decisionMs/);
  });

  test('add en modo piloto no escribe muestras', (t) => {
    const dir = tempDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const added = runWithEnv(
      dir,
      { CAL2_PILOT: '1' },
      'add',
      '--run',
      'CAL2-P01',
      '--tool',
      'fs.edit',
      '--decision',
      'allow',
      '--ms',
      '2000',
      '--leido',
      '--diff-log',
      '--justifica',
      JUSTIFICA
    );

    assert.equal(added.code, 1, added.out);
    assert.match(added.out, /modo piloto: no se escribe ninguna muestra/);
    assert.equal(fs.existsSync(storeOf(dir)), false, 'el piloto no crea el store');
  });

  test('add rechaza una justificación sin letras', (t) => {
    const dir = tempDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const bad = run(
      dir,
      'add',
      '--run',
      'CAL2-T05',
      '--tool',
      'fs.edit',
      '--decision',
      'allow',
      '--ms',
      '2000',
      '--leido',
      '--diff-log',
      '--justifica',
      '1'
    );

    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /excluida \(I1\)/);
    assert.equal(fs.existsSync(storeOf(dir)), false, 'una justificación numérica no se escribe');
  });

  test('add rechaza un decisionMs que no es una medida', (t) => {
    const dir = tempDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const bad = run(
      dir,
      'add',
      '--run',
      'CAL2-T04',
      '--tool',
      'shell.run',
      '--decision',
      'allow',
      '--ms',
      '2000',
      '--decision-ms',
      '-5',
      '--leido',
      '--justifica',
      'node --test math.test.mjs'
    );

    assert.equal(bad.code, 1, bad.out);
    assert.equal(fs.existsSync(storeOf(dir)), false, 'no se escribe una fila inválida');
  });
});
