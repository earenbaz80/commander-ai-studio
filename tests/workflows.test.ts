/**
 * Los workflows son el tercer código del repo que ningún compilador mira: `tsc`
 * no ve YAML y los tests de `scripts/` sólo cubren las funciones puras. Un `if:`
 * cambiado de sitio no rompe nada hasta que el lunes llega un issue que nunca se
 * cierra, o una corrida en verde cierra uno sin haber medido la cadena.
 *
 * Aquí se fijan las guardas —qué outcome abre, qué outcome cierra y cuándo no se
 * hace nada— y el acoplamiento con el script: el prefijo del título y los nombres
 * `issue.md` / `cierre.md` están escritos en dos sitios, y si uno cambia sin el
 * otro el workflow deja de publicar en silencio.
 *
 * Se lee la estructura, no el texto literal: los comentarios cambian a menudo y
 * no son contrato. Los bloques se extraen por indentación (2 espacios = job,
 * 6 = paso), que es la forma de saber a qué job pertenece una línea sin añadir un
 * parser de YAML como dependencia.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const WATCH = '.github/workflows/audit-watch.yml';
const CI = '.github/workflows/tests.yml';

/**
 * Lee texto del repo con los saltos de línea normalizados.
 *
 * Estas pruebas fijan la estructura de los workflows con expresiones que cruzan
 * líneas (de `workflow_dispatch:` a `inputs:`). Un checkout con
 * `core.autocrlf=true` —el de Windows por defecto— entrega saltos CRLF, así que
 * sin normalizar el mismo YAML pasaba o fallaba según la configuración de git de
 * quien corriera la suite.
 */
const leer = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

/** Cuerpo de un job de primer nivel, sin la línea del nombre. */
function jobDe(yml: string, nombre: string): string {
  const lineas = yml.split('\n');
  const inicio = lineas.indexOf(`  ${nombre}:`);
  assert.ok(inicio >= 0, `falta el job \`${nombre}\``);
  let fin = lineas.length;
  for (let i = inicio + 1; i < lineas.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:/.test(lineas[i])) {
      fin = i;
      break;
    }
  }
  return lineas.slice(inicio + 1, fin).join('\n');
}

/** Pasos de un job, en orden: cada uno empieza con `      - `. */
function pasosDe(job: string): string[] {
  const pasos: string[] = [];
  for (const linea of job.split('\n')) {
    if (/^ {6}- /.test(linea)) pasos.push(linea.slice(8));
    else if (pasos.length > 0) pasos[pasos.length - 1] += `\n${linea}`;
  }
  return pasos;
}

/**
 * El único paso que contiene todos los marcadores. Falla si hay cero (el paso
 * desapareció) o más de uno (la guarda quedó ambigua: no se sabe cuál manda).
 */
function pasoCon(pasos: string[], ...marcadores: string[]): string {
  const encontrados = pasos.filter((p) => marcadores.every((m) => p.includes(m)));
  assert.equal(
    encontrados.length,
    1,
    `esperaba un solo paso con ${marcadores.map((m) => `«${m}»`).join(', ')}, hay ${encontrados.length}`
  );
  return encontrados[0];
}

const watch = leer(WATCH);
const ci = leer(CI);
const guion = leer('scripts/audit-watch.ts');
const guionProd = leer('scripts/audit-prod.ts');

test('audit-watch: el semanal audita y el de prueba no', () => {
  assert.match(watch, /cron: '0 6 \* \* 1'/, 'sigue siendo semanal');
  assert.match(watch, /^\s{2}contents: read$/m, 'permiso de lectura');
  assert.match(watch, /^\s{2}issues: write$/m, 'sin issues: write no puede abrir ni cerrar');

  assert.match(
    watch,
    /workflow_dispatch:\n\s+inputs:\n\s+self_test:\n\s+description:.*\n\s+type: boolean\n\s+default: false/,
    'el modo de prueba es un input booleano apagado por defecto'
  );

  const prueba = jobDe(watch, 'self-test');
  const audit = jobDe(watch, 'full-audit');

  // Los dos jobs se excluyen: si ambos corrieran, una prueba ensuciaría el gate
  // semanal y una corrida real haría el trabajo dos veces.
  assert.match(prueba, /if:\s*\$\{\{\s*inputs\.self_test == true\s*\}\}/, 'el de prueba sólo con el input');
  assert.match(audit, /if:\s*\$\{\{\s*inputs\.self_test != true\s*\}\}/, 'el semanal sólo sin el input');

  const pasosPrueba = pasosDe(prueba);
  assert.equal(pasosPrueba.length, 1, 'la prueba es un solo paso');
  assert.ok(!prueba.includes('actions/checkout'), 'la prueba no necesita el repo');
  assert.ok(!/\bnpm\b/.test(prueba), 'la prueba no audita: nada de npm');
  assert.ok(!prueba.includes('audit-watch.ts'), 'la prueba no corre el vigilante');

  const vigilante = pasoCon(pasosDe(audit), 'id: watch');
  assert.ok(vigilante.includes('continue-on-error: true'), 'seguir en rojo pero sin abortar el informe');
  assert.ok(vigilante.includes('npx tsx scripts/audit-watch.ts'), 'corre el vigilante');
  assert.ok(vigilante.includes('AUDIT_WATCH_ISSUE_DIR'), 'deja el informe donde el workflow lo recoge');
});

test('audit-watch: cada outcome tiene una sola acción y el verde parcial no actúa', () => {
  const pasos = pasosDe(jobDe(watch, 'full-audit'));

  const abre = pasoCon(pasos, 'gh issue create');
  assert.ok(abre.includes("steps.watch.outcome == 'failure'"), 'sólo un rojo abre o comenta el issue');
  assert.ok(abre.includes('! -f "$DIR/issue.md"'), 'sin informe no hay issue');
  assert.ok(abre.includes('issue.title'), 'el título lo pone el script');

  const cierra = pasoCon(pasos, 'gh issue close');
  assert.ok(cierra.includes("steps.watch.outcome == 'success'"), 'el cierre va por el camino verde');
  assert.ok(cierra.includes('cierre.md'), 'el verde sólo cierra con el archivo que exige veredicto completo');
  assert.ok(cierra.includes('! -f "$DIR/cierre.md"'), 'sin `cierre.md` no se cierra nada');
  // Un verde no puede publicar: si el cierre leyera `issue.md`, un registry
  // parcial (que no escribe informe) y un veredicto accionable se confundirían.
  assert.ok(!cierra.includes('issue.md'), 'el cierre no lee el informe de acción');

  const rojo = pasoCon(pasos, '::error::El audit completo');
  assert.ok(rojo.includes("steps.watch.outcome == 'failure'"), 'el rojo del job sigue la señal del vigilante');
  assert.ok(/exit 1\s*$/.test(rojo.trim()), 'el paso de rojo termina en 1');
});

test('audit-watch: el prefijo y los nombres de archivo son los del script', () => {
  const prefijo = guion.match(/PREFIJO_TITULO = '([^']+)'/)?.[1];
  const archivoIssue = guion.match(/ARCHIVO_ISSUE = '([^']+)'/)?.[1];
  const archivoCierre = guion.match(/ARCHIVO_CIERRE = '([^']+)'/)?.[1];
  assert.ok(prefijo && archivoIssue && archivoCierre, 'el script sigue exportando las tres constantes');

  // Renombrar una constante sin tocar el YAML deja el workflow mirando un
  // archivo o un título que ya no existen, y eso no falla: simplemente no pasa nada.
  const filtros = watch.match(new RegExp(`startswith\\("${prefijo}"\\)`, 'g')) ?? [];
  assert.equal(filtros.length, 2, 'los dos pasos que buscan el issue usan el prefijo del script');
  assert.ok(watch.includes(`$DIR/${archivoIssue}`), `el paso de acción espera ${archivoIssue}`);
  assert.ok(watch.includes(`$DIR/${archivoCierre}`), `el paso de cierre espera ${archivoCierre}`);
});

test('audit-watch: la corrida de prueba no se confunde con el issue real', () => {
  const titulo = pasosDe(jobDe(watch, 'self-test'))[0].match(/--title "([^"]+)"/)?.[1];
  const prefijo = guion.match(/PREFIJO_TITULO = '([^']+)'/)?.[1];
  assert.ok(titulo, 'la prueba crea el issue con un título');
  assert.ok(prefijo, 'prefijo del script');
  // Si el título cayera bajo el prefijo, una corrida real lo tomaría por su
  // issue abierto y le comentaría el informe encima.
  assert.ok(!titulo.startsWith(prefijo), `el título no puede empezar por «${prefijo}»: ${titulo}`);
});

test('audit-watch: la prueba ejercita crear, comentar, cerrar y verificar', () => {
  const paso = pasosDe(jobDe(watch, 'self-test'))[0];
  assert.ok(paso.includes('GH_TOKEN: ${{ github.token }}'), 'usa el mismo token que la corrida real');
  assert.ok(paso.includes('gh issue create'), 'abre el issue de mentira');
  assert.ok(paso.includes('gh issue comment'), 'comenta como el camino real');
  assert.ok(paso.includes('gh issue close') && paso.includes('--reason completed'), 'cierra como el camino real');
  // Salir 0 al cerrar no prueba que cerró: se lee el estado.
  assert.ok(paso.includes('gh issue view') && paso.includes('CLOSED'), 'verifica el estado, no el código de salida');
});

test('CI: el gate de producción va antes del lint y node:test antes de Vitest', () => {
  assert.match(ci, /push:\n\s+branches: \[main, develop\]/, 'push en main y develop');
  assert.match(ci, /pull_request:\n\s+branches: \[main\]/, 'PRs contra main');

  const pasos = pasosDe(jobDe(ci, 'lint-and-test'));
  // Comparación exacta del `run:`: `npm run test:node` contiene `npm run test`
  // como subcadena, y con `includes` los dos pasos caían en el mismo índice.
  const posicion = (comando: string) => {
    const i = pasos.findIndex((p) => p.split('\n').some((l) => l.trim() === `run: ${comando}`));
    assert.ok(i >= 0, `falta el paso «${comando}»`);
    return i;
  };

  const orden = [
    'npm run check:index',
    'npx tsx scripts/audit-prod.ts',
    'npm run lint',
    'npm run typecheck',
    'npm run test:node',
    'npm run test',
  ].map(posicion);

  // El comentario del workflow dice por qué: el índice barato primero, y
  // node:test antes de Vitest porque en Actions un paso que falla aborta los
  // siguientes. Invertirlos esconde la suite de node.
  for (let i = 1; i < orden.length; i++) {
    assert.ok(orden[i] > orden[i - 1], `el paso ${i + 1} debe ir después del ${i}: ${orden.join(', ')}`);
  }
});

test('CI: el gate audita producción, no la cadena de tooling', () => {
  const gate = pasosDe(jobDe(ci, 'lint-and-test')).find((p) => p.includes('audit-prod.ts'));
  assert.ok(gate, 'el paso del gate existe');
  // El gate completo no puede estar en cero (ver README § Dependencias y
  // auditoría); si alguien le quita el `--omit=dev` el CI se vuelve rojo para
  // siempre y se acaba ignorando.
  assert.match(guionProd, /'--omit=dev'/, 'audit-prod.ts sigue auditando sólo producción');
  assert.match(guionProd, /'--audit-level=low'/, 'umbral explícito, no el de npm por defecto');
});

test('CI: build depende del gate y e2e del build', () => {
  assert.match(jobDe(ci, 'build'), /needs: lint-and-test/, 'no se construye sin lint ni tests');
  assert.match(jobDe(ci, 'e2e'), /needs: build/, 'el e2e usa el build');
});

test('los workflows no invocan scripts ni ficheros que no existan', () => {
  const pkg = JSON.parse(leer('package.json')) as { scripts: Record<string, string> };

  for (const [nombre, yml] of [
    ['audit-watch.yml', watch],
    ['tests.yml', ci],
  ] as const) {
    for (const [, script] of yml.matchAll(/npm run ([A-Za-z0-9:_.-]+)/g)) {
      assert.ok(pkg.scripts[script], `${nombre} llama a \`npm run ${script}\`, que no está en package.json`);
    }
    for (const [, fichero] of yml.matchAll(/npx tsx ([A-Za-z0-9:_.\-/]+\.ts)/g)) {
      assert.ok(fs.existsSync(fichero), `${nombre} ejecuta ${fichero}, que no existe`);
    }
  }
});
