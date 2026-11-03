/**
 * Reglas propias del repo, en la línea de comandos.
 *
 * El problema de una regla nueva en un repo grande es siempre el mismo: hay
 * miles de casos previos y activarla castiga al que no los escribió. Aquí se
 * resuelve comparando con una revisión de git: sólo cuentan las violaciones que
 * **no estaban** en la base (por defecto `HEAD`). Así `npm run lint` puede
 * exigir «no añadas deuda» sin pedir que se limpien los 3.000 colores que ya
 * hay, y sin mantener un fichero de baseline que se queda viejo.
 *
 *   npm run check:rules                 # árbol de trabajo contra HEAD
 *   npm run check:rules -- --all        # todo (informe completo)
 *   npm run check:rules -- --files src/App.tsx
 *   npm run check:rules -- --base origin/main
 *
 * Si la base no se puede resolver (clon superficial, sin git) no se inventa un
 * veredicto: avisa y sale en verde.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import * as ts from 'typescript';
import { checkSource, newViolations, type RuleViolation } from '../src/agent/projectRules';

const args = process.argv.slice(2);
const valueOf = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const base = valueOf('--base') || 'HEAD';
const reportAll = args.includes('--all');
const asJson = args.includes('--json');
const only = (valueOf('--files') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function baseExists(ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const baseOk = baseExists(base);

/** Contenido del archivo en la base. `null` si no está (nuevo, o sin git). */
function baseText(file: string): string | null {
  try {
    return execFileSync('git', ['show', `${base}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full.split(path.sep).join('/'));
  }
}

const files = only.length > 0 ? only : (() => {
  const out: string[] = [];
  if (fs.existsSync('src')) walk('src', out);
  return out;
})();

const triage: RuleViolation[] = [];
let scanned = 0;
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  scanned++;
  const after = checkSource(ts, file, text);
  if (reportAll || !baseOk) {
    triage.push(...after);
    continue;
  }
  const before = baseText(file);
  // Archivo nuevo (sin versión en la base): todo lo que tenga es nuevo.
  triage.push(...newViolations(before === null ? [] : checkSource(ts, file, before), after));
}

if (asJson) {
  console.log(JSON.stringify({ base, baseOk, scanned, violations: triage }, null, 2));
} else if (triage.length === 0) {
  const alcance = reportAll || !baseOk ? 'sin violaciones' : `sin violaciones nuevas frente a ${base}`;
  console.log(`[check:rules] ${alcance} (${scanned} archivos)`);
} else {
  for (const v of triage) {
    console.log(`  ${v.file}:${v.line}:${v.column}  ${v.rule}  ${v.message}  · «${v.excerpt}»`);
  }
  const cabeza = reportAll || !baseOk ? `${triage.length} violaciones` : `${triage.length} violaciones NUEVAS frente a ${base}`;
  console.log(`[check:rules] ${cabeza} en ${scanned} archivos.`);
}

if (!baseOk && !reportAll) {
  console.warn(`[check:rules] no se pudo resolver «${base}»: informe sin comparación, no cuenta como fallo.`);
  process.exit(0);
}
process.exit(triage.length > 0 ? 1 : 0);
