/**
 * Falla si una tabla marca un issue como `Cerrado` y su cuerpo versionado aún
 * tiene criterios de aceptación sin marcar.
 *
 * `check:issue-status` ya detecta ese caso, pero pregunta a GitHub: necesita
 * red y gasta cuota. Éste mira sólo el repo, así que sirve de guardia antes de
 * cada commit. Comparte con el otro script la lectura de la tabla y de la
 * sección de criterios (`parseRows`, `findUncheckedCriteria`) para que no haya
 * dos definiciones distintas de «issue cerrado a medias».
 *
 * Uso: `npm run check:criteria` (también desde el hook de pre-commit).
 * Sale 1 con los criterios pendientes; 0 si todos los cerrados los tienen
 * marcados.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findUncheckedCriteria, parseRows } from './sync-issue-status';

const TABLE = 'docs/parity/issues/README.md';
const ISSUES_DIR = 'docs/parity/issues';

const pendientes: string[] = [];
const avisos: string[] = [];
let cerrados = 0;

for (const row of parseRows(fs.readFileSync(TABLE, 'utf8'))) {
  if (row.status !== 'Cerrado') continue;
  cerrados++;

  const file = path.join(ISSUES_DIR, `${row.id}.md`);
  if (!fs.existsSync(file)) {
    avisos.push(`${row.id}: figura cerrado en ${TABLE} pero no existe ${file}`);
    continue;
  }

  const sinMarcar = findUncheckedCriteria(fs.readFileSync(file, 'utf8'));
  if (sinMarcar.length === 0) continue;

  const { owner, repo, number } = row.issue;
  pendientes.push(
    `${row.id} (${owner}/${repo}#${number}) tiene ${sinMarcar.length} criterio(s) sin marcar en ${file}:\n` +
      sinMarcar.map((criterio) => `    - ${criterio}`).join('\n')
  );
}

if (pendientes.length === 0) {
  const aviso = avisos.length > 0 ? `, ${avisos.length} aviso(s)` : '';
  console.log(`[check:criteria] ${cerrados} issue(s) cerrado(s) con criterios completos${aviso}`);
  process.exit(0);
}

console.error(
  `[check:criteria] ${pendientes.length} issue(s) cerrado(s) con criterios de aceptación sin marcar:\n`
);
for (const pendiente of pendientes) console.error(`  ${pendiente}`);
for (const aviso of avisos) console.warn(`[check:criteria] aviso: ${aviso}`);
console.error(
  '\n[check:criteria] marca los criterios en el cuerpo del issue o déjalo como `Abierto`.\n' +
    '               La tabla y el cuerpo versionado deben contar lo mismo.'
);
process.exit(1);
