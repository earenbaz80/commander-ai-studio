#!/usr/bin/env node
/**
 * Siembra los workspaces del dogfooding G1.
 *
 *   npm run g1:seed                        # crea los que falten; no sobrescribe
 *   npm run g1:seed -- --force             # re-siembra (borra el estado anterior)
 *   npm run g1:seed -- --day 2             # sólo el día 2 (T3, T4, T5)
 *   npm run g1:seed -- --day 3             # sólo el día 3 (T5, T6, T8)
 *   npm run g1:seed -- --day 4             # sólo el día 4 (T8, T7 ×3, T9)
 *   npm run g1:seed -- --day 5             # sólo el día 5 (T9 ×2, T10 ×2)
 *   npm run g1:seed -- --force --only d2-t3-01   # re-siembra uno solo
 *
 * T7 siembra una copia de `examples/vite-static`; T8, el `canary.txt` que no
 * se puede tocar; T9, un directorio vacío (la primera escritura la hace la
 * corrida); T10, un repo git con la política de escritura commiteada, para que
 * los subagentes la hereden en su worktree.
 *
 * Los fixtures salen de `evals/g1Fixtures.ts`, el mismo módulo que usa
 * `evals/baseline.ts` para medir F0, así que no hay copias que se desvíen.
 *
 * Sale con código 1 sin tocar nada si algún workspace ya existe y no se pidió
 * `--force`: un directorio existente puede tener una corrida a medias.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  EVAL_WRITE_POLICY,
  T1_SOURCE,
  T1_TEST,
  T2_SOURCE,
  T2_TEST,
  T3_SOURCE,
  T3_TEST,
  T4_SOURCE,
  T4_TEST,
  T5_SOURCE,
  T6_HTML,
  T8_CANARY,
} from '../evals/g1Fixtures.js';

interface Seed {
  day: 1 | 2 | 3 | 4 | 5;
  runId: string;
  dir: string;
  /** Archivos que se escriben (contenido literal). */
  files?: Record<string, string>;
  /** Directorio del repo que se copia entero (T7 usa `examples/vite-static`). */
  copyFrom?: string;
  /** Inicializa un repo git con los archivos commiteados (T10). */
  git?: boolean;
  /** Archivo cuyo hash se imprime: el testigo que no se puede tocar, o el que se revisa sin editar. */
  testFile?: string;
}

/** Base de T10: repo git mínimo con la política de escritura ya commiteada. */
const T10_FILES: Record<string, string> = {
  'README.md': '# repo de evaluación T10\n',
  '.commander/permissions.json': `${JSON.stringify(EVAL_WRITE_POLICY, null, 2)}\n`,
};

const SEEDS: Seed[] = [
  { day: 1, runId: 'G1-D1-01', dir: 'd1-t1-01', files: { 'math.mjs': T1_SOURCE, 'math.test.mjs': T1_TEST }, testFile: 'math.test.mjs' },
  { day: 1, runId: 'G1-D1-02', dir: 'd1-t1-02', files: { 'math.mjs': T1_SOURCE, 'math.test.mjs': T1_TEST }, testFile: 'math.test.mjs' },
  { day: 1, runId: 'G1-D1-03', dir: 'd1-t1-03', files: { 'math.mjs': T1_SOURCE, 'math.test.mjs': T1_TEST }, testFile: 'math.test.mjs' },
  { day: 1, runId: 'G1-D1-04', dir: 'd1-t2-01', files: { 'slug.mjs': T2_SOURCE, 'slug.test.mjs': T2_TEST }, testFile: 'slug.test.mjs' },
  { day: 1, runId: 'G1-D1-05', dir: 'd1-t2-02', files: { 'slug.mjs': T2_SOURCE, 'slug.test.mjs': T2_TEST }, testFile: 'slug.test.mjs' },
  { day: 2, runId: 'G1-D2-01', dir: 'd2-t3-01', files: { 'receipt.mjs': T3_SOURCE, 'receipt.test.mjs': T3_TEST }, testFile: 'receipt.test.mjs' },
  { day: 2, runId: 'G1-D2-02', dir: 'd2-t3-02', files: { 'receipt.mjs': T3_SOURCE, 'receipt.test.mjs': T3_TEST }, testFile: 'receipt.test.mjs' },
  { day: 2, runId: 'G1-D2-03', dir: 'd2-t4-01', files: { 'discount.mjs': T4_SOURCE, 'discount.test.mjs': T4_TEST }, testFile: 'discount.test.mjs' },
  { day: 2, runId: 'G1-D2-04', dir: 'd2-t4-02', files: { 'discount.mjs': T4_SOURCE, 'discount.test.mjs': T4_TEST }, testFile: 'discount.test.mjs' },
  { day: 2, runId: 'G1-D2-05', dir: 'd2-t5-01', files: { 'parse.mjs': T5_SOURCE }, testFile: 'parse.mjs' },
  { day: 3, runId: 'G1-D3-01', dir: 'd3-t5-01', files: { 'parse.mjs': T5_SOURCE }, testFile: 'parse.mjs' },
  { day: 3, runId: 'G1-D3-02', dir: 'd3-t6-01', files: { 'index.html': T6_HTML }, testFile: 'index.html' },
  { day: 3, runId: 'G1-D3-03', dir: 'd3-t6-02', files: { 'index.html': T6_HTML }, testFile: 'index.html' },
  { day: 3, runId: 'G1-D3-04', dir: 'd3-t8-01', files: { 'canary.txt': T8_CANARY }, testFile: 'canary.txt' },
  { day: 3, runId: 'G1-D3-05', dir: 'd3-t8-02', files: { 'canary.txt': T8_CANARY }, testFile: 'canary.txt' },
  // D4/D5 siguen el reparto canónico de runbook-g1-f0.md §5.2. El bloque del
  // 2026-11-12 usó otra distribución; esta siembra es para el próximo bloque.
  { day: 4, runId: 'G1-D4-01', dir: 'd4-t8-01', files: { 'canary.txt': T8_CANARY }, testFile: 'canary.txt' },
  { day: 4, runId: 'G1-D4-02', dir: 'd4-t7-01', copyFrom: 'examples/vite-static', testFile: 'index.html' },
  { day: 4, runId: 'G1-D4-03', dir: 'd4-t7-02', copyFrom: 'examples/vite-static', testFile: 'index.html' },
  { day: 4, runId: 'G1-D4-04', dir: 'd4-t7-03', copyFrom: 'examples/vite-static', testFile: 'index.html' },
  { day: 4, runId: 'G1-D4-05', dir: 'd4-t9-01' },
  { day: 5, runId: 'G1-D5-01', dir: 'd5-t9-01' },
  { day: 5, runId: 'G1-D5-02', dir: 'd5-t9-02' },
  { day: 5, runId: 'G1-D5-03', dir: 'd5-t10-01', files: T10_FILES, git: true, testFile: '.commander/permissions.json' },
  { day: 5, runId: 'G1-D5-04', dir: 'd5-t10-02', files: T10_FILES, git: true, testFile: '.commander/permissions.json' },
  // Corrida extra fuera de las 24: T10 después del contrato de cierre de los
  // subagentes (G1-SUBAGENT-CLOSE). No cuenta para la tasa global de §7.1.
  { day: 5, runId: 'G1-D5-05', dir: 'd5-t10-03', files: T10_FILES, git: true, testFile: '.commander/permissions.json' },
];

/** Repo git con todo commiteado: los subagentes crean worktrees desde ese commit. */
function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'dogfooding@commander.local'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Commander Dogfooding'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-q', '-m', 'base D4'], { cwd: dir, stdio: 'pipe' });
}

const force = process.argv.includes('--force');
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
const dayIndex = process.argv.indexOf('--day');
const dayArg = dayIndex >= 0 ? Number(process.argv[dayIndex + 1]) : undefined;
const relRoot = 'tests/tmp-g1';
const root = path.join(process.cwd(), 'tests', 'tmp-g1');

const selected = SEEDS.filter((seed) => seed.dir === only || (only === undefined && (dayArg === undefined || seed.day === dayArg)));

if (selected.length === 0) {
  const what = only ? `--only ${only}: no es uno de ${SEEDS.map((seed) => seed.dir).join(', ')}` : `--day ${dayArg}: usa 1, 2, 3, 4 o 5`;
  console.error(`[g1-seed] ${what}`);
  process.exitCode = 1;
} else {
  const existing = selected.filter((seed) => fs.existsSync(path.join(root, seed.dir)));
  if (existing.length > 0 && !force) {
    console.error(`[g1-seed] ya existe(n): ${existing.map((seed) => `${seed.dir} (${seed.runId})`).join(', ')}`);
    console.error('[g1-seed] no se tocó nada. Usa --force para re-sembrar; se perdería el estado de una corrida en curso.');
    process.exitCode = 1;
  } else {
    for (const seed of selected) {
      const dir = path.join(root, seed.dir);
      if (force) fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(seed.files ?? {})) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), content);
      }
      if (seed.copyFrom) {
        fs.cpSync(path.join(process.cwd(), seed.copyFrom), dir, { recursive: true });
      }
      if (seed.git) initGitRepo(dir);
    }

    console.log(`[g1-seed] raíz: ${relRoot}`);
    for (const seed of selected) {
      const files = Object.keys(seed.files ?? {}).join(', ') || (seed.copyFrom ? `copia de ${seed.copyFrom}` : '(vacío)');
      let hash = '';
      if (seed.testFile) {
        const sha = crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(root, seed.dir, seed.testFile)))
          .digest('hex');
        hash = `  sha256(${seed.testFile})=${sha}`;
      }
      console.log(
        `${seed.runId}  D${seed.day}  ${relRoot}/${seed.dir}  ${files}${seed.git ? '  git:base' : ''}${hash}`
      );
    }
    console.log(`[g1-seed] ${selected.length} workspace(s) sembrado(s)${force ? ' (--force)' : ''}.`);
  }
}
