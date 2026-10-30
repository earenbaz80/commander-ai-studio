/**
 * Falla si el índice de git quedó fijado a un árbol viejo.
 *
 * Commitear una selección de hunks con un `GIT_INDEX_FILE` propio deja el índice
 * normal apuntando a la foto anterior: `git status` muestra la ruta a la vez en
 * lo staged y en lo no staged, y si alguien commitea así el árbol no compila. Es
 * un estado que no se ve leyendo el código: hay que mirar el índice.
 *
 * El síntoma se comprueba sin ambigüedad comparando blobs: si el blob que tiene
 * el índice para una ruta es el de un commit anterior (y no el de HEAD), el
 * índice se quedó ahí. Eso lo distingue de un `git add -p`, donde el blob staged
 * es contenido nuevo y no el de ningún commit. Una ruta que aparece en las dos
 * listas sin blob antiguo sólo se avisa: puede ser un staging parcial legítimo.
 *
 * Uso: `npm run check:index` (también corre en CI). Sale 1 con las rutas y el
 * arreglo; 0 si el índice está sano. Sin git avisa y sale 0: sin índice no hay
 * nada que comprobar.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Separador `-z` de git: evita que se coman rutas con espacios o acentos. */
const SEP = '\u0000';
/** Cuántos commits atrás se busca la foto vieja. */
const VENTANA = 10;

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Ejecuta git y devuelve `null` si falla (ruta que no existe en ese árbol, p. ej.). */
function gitOrNull(args: string[]): string | null {
  try {
    return git(args).trim();
  } catch {
    return null;
  }
}

function rutas(args: string[]): string[] {
  return git([...args, '-z'])
    .split(SEP)
    .map((ruta) => ruta.trim())
    .filter(Boolean);
}

function esRepoGit(): boolean {
  return gitOrNull(['rev-parse', '--is-inside-work-tree']) === 'true';
}

if (!esRepoGit()) {
  console.log('[check:index] no es un repositorio git: nada que comprobar');
  process.exit(0);
}

const staged = new Set(rutas(['diff', '--cached', '--name-only']));
const sinPreparar = new Set(rutas(['diff', '--name-only']));
const enAmbas = [...staged].filter((ruta) => sinPreparar.has(ruta)).sort();

/** Commits recientes: la foto vieja a la que puede apuntar el índice. */
const commits = rutas(['rev-list', `-n${VENTANA}`, 'HEAD']);

const indexBlob = (ruta: string) => gitOrNull(['rev-parse', `:${ruta}`]);

/** Primer commit de la ventana cuyo blob para esa ruta coincide con el del índice. */
function commitQueCoincide(ruta: string, blob: string): string | null {
  for (const commit of commits) {
    if (gitOrNull(['rev-parse', `${commit}:${ruta}`]) === blob) return commit.slice(0, 7);
  }
  return null;
}

const errores: string[] = [];
const avisos: string[] = [];

for (const ruta of enAmbas) {
  const blob = indexBlob(ruta);
  const viejo = blob ? commitQueCoincide(ruta, blob) : null;
  if (viejo) {
    errores.push(
      `${ruta}\n    el índice apunta al árbol de ${viejo}, no al de HEAD: entrada staged y cambios ` +
        'sin preparar a la vez'
    );
  } else {
    avisos.push(`${ruta}\n    staged y sin preparar a la vez; si no es un staging parcial, revisa el índice`);
  }
}

// Borrado staged con el archivo en disco: mismo trío roto (index, HEAD, disco).
for (const ruta of rutas(['diff', '--cached', '--name-only', '--diff-filter=D']).sort()) {
  if (existsSync(ruta)) {
    errores.push(
      `${ruta}\n    staged como borrado pero el archivo sigue en disco (¿git rm --cached, o índice viejo?)`
    );
  }
}

for (const aviso of avisos) console.warn(`[check:index] aviso: ${aviso}`);

if (errores.length === 0) {
  const aviso = avisos.length > 0 ? `, ${avisos.length} aviso(s)` : '';
  console.log(`[check:index] índice sano (${staged.size} staged, ${sinPreparar.size} sin preparar${aviso})`);
  process.exit(0);
}

console.error(`[check:index] índice inconsistente en ${errores.length} ruta(s):\n`);
for (const error of errores) console.error(`  ${error}`);
console.error(
  '\n[check:index] arreglo sin tocar el disco:\n' +
    '  git restore --staged -- <rutas>                                        # re-sincroniza con HEAD\n' +
    '  git update-index --cacheinfo 100644,$(git rev-parse HEAD:<ruta>),<ruta> # si el commit ya existe\n' +
    'Después: `git diff --cached --stat` vacío y `tsc` en verde.'
);
process.exit(1);
