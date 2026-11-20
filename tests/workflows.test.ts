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
const PAGES = '.github/workflows/pages.yml';

/**
 * Lee texto del repo con los saltos de línea normalizados.
 *
 * Estas pruebas fijan la estructura de los workflows con expresiones que cruzan
 * líneas (`workflow_dispatch:\n  inputs:`). Un checkout con `core.autocrlf=true`
 * —el de Windows por defecto— entrega `\r\n`, así que sin normalizar el mismo
 * YAML pasaba o fallaba según la configuración de git de quien corriera la suite.
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
  // El trigger de PR no filtra por rama base: con `branches: [main]` un PR
  // apilado —cuya base es otra rama del stack— no veía ni un check, y el único
  // CI que veía ese código era el del fondo del stack.
  assert.match(ci, /pull_request:\n\s+types: \[/, 'el trigger de PR acepta cualquier base');
  assert.ok(
    !/pull_request:\n\s+branches:/.test(ci),
    'el trigger de PR no vuelve a limitarse a una rama base'
  );

  const pasos = pasosDe(jobDe(ci, 'lint-and-test'));
  // Comparación exacta del `run:`: `npm run test:node` contiene `npm run test`
  // como subcadena, y con `includes` los dos pasos caían en el mismo índice.
  // Un paso puede agregar argumentos al script (`-- --reporter=json …`): el
  // comando base lo sigue identificando. `npm run test:node` no cae en
  // `npm run test` porque la comparación es por línea completa, no por prefijo
  // suelto.
  const posicion = (comando: string) => {
    const i = pasos.findIndex((p) =>
      p
        .split('\n')
        .some((l) => {
          const linea = l.trim();
          return linea === `run: ${comando}` || linea.startsWith(`run: ${comando} --`);
        })
    );
    assert.ok(i >= 0, `falta el paso «${comando}»`);
    return i;
  };

  // El workflow separa ESLint del check de reglas contra la rama base; el
  // contrato es que el lint vaya después del audit y antes del typecheck.
  const lintIndex = pasos.findIndex((p) =>
    p.split('\n').some((l) => ['run: npm run lint', 'run: npx eslint src'].includes(l.trim()))
  );
  assert.ok(lintIndex >= 0, 'falta el paso de lint');

  const orden = [
    'npm run check:index',
    'npx tsx scripts/audit-prod.ts',
  ].map(posicion).concat(lintIndex, [
    'npm run typecheck',
    'npm run test:node',
    'npm run test',
  ].map(posicion));

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
  // Lo caro se paga una vez por stack, no una por nivel: build, package y e2e
  // corren en los PRs contra `main` (y en `push`), no en los PRs apilados. Sin
  // esta guarda, correr CI en cada nivel del stack multiplica minutos de runner.
  for (const job of ['build', 'package', 'e2e']) {
    assert.match(
      jobDe(ci, job),
      /if: github\.event_name != 'pull_request' \|\| github\.base_ref == 'main'/,
      `\`${job}\` sólo corre en PRs contra \`main\``
    );
  }
});

test('CI: el job de lógica corre sólo el proyecto node y en paralelo', () => {
  const job = jobDe(ci, 'logic');
  const pasos = pasosDe(job);
  // Los argumentos del reporter no cambian qué corre: el script sigue siendo
  // `test:logic`, con su `--project node` dentro.
  const esRun = (paso: string, comando: string) =>
    paso.split('\n').some((l) => {
      const linea = l.trim();
      return linea === `run: ${comando}` || linea.startsWith(`run: ${comando} --`);
    });

  const logica = pasos.find((p) => esRun(p, 'npm run test:logic'));
  assert.ok(logica, 'el job de lógica corre `npm run test:logic`');
  // Sin el reporte JSON el resumen del job no tendría qué contar.
  assert.ok(
    logica.includes('--reporter=json') && logica.includes('--outputFile'),
    'el job de lógica deja el reporte JSON para el resumen'
  );
  // El flag es lo único que lo separa de la suite completa: sin él vuelve a
  // levantar jsdom y deja de ser el feedback rápido que justifica el job.
  assert.match(
    leer('package.json'),
    /"test:logic": "vitest run --project node"/,
    'test:logic sigue limitado al proyecto node'
  );
  // Con `needs` arrancaría cuando `lint-and-test` termine, que es justo lo que
  // el job evita.
  assert.ok(!job.includes('needs:'), 'corre en paralelo, sin `needs`');
  assert.ok(
    !pasos.some((p) => esRun(p, 'npm run test')),
    'no corre la suite completa: para eso ya está lint-and-test'
  );
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

test('CI: una guardia construye y empaqueta el CLI', () => {
  const pasos = pasosDe(jobDe(ci, 'lint-and-test'));
  const esRun = (paso: string, comando: string) =>
    paso.split('\n').some((l) => l.trim() === `run: ${comando}`);

  // `prepack` construye el bundle, pero sin un job que empaquete nadie lo
  // ejecuta: el `bin`, `files` o el banner podían romperse en silencio.
  const build = pasos.findIndex((p) => esRun(p, 'npm run build:cli'));
  const pack = pasos.findIndex((p) => esRun(p, 'npm run check:cli-package'));
  assert.ok(build >= 0, 'falta el paso que construye el bundle del CLI');
  assert.ok(pack >= 0, 'falta el paso que empaqueta y prueba el CLI');
  assert.ok(build < pack, 'el bundle se construye antes de empaquetarlo');

  // El script es el que mide: si se vacía, el job queda verde sin comprobar nada.
  const guion = leer('scripts/check-cli-package.mjs');
  assert.match(guion, /'pack'/, 'el script corre npm pack');
  assert.match(guion, /cli-dist\/commander\.mjs/, 'comprueba el bundle en el tarball');
  assert.match(guion, /--version/, 'ejecuta el bundle empaquetado');
});
test('CI: el paquete de Electron se arma y se revisa su contenido', () => {
  const pasos = pasosDe(jobDe(ci, 'package'));
  const esRun = (paso: string, comando: string) =>
    paso.split('\n').some((l: string) => l.trim() === `run: ${comando}`);

  // El job empaquetaba con electron-builder a mano: si el script o el flag
  // cambian, el CI dejaría de medir lo que corre un humano.
  const empaqueta = pasos.findIndex((p) => esRun(p, 'npm run build:electron -- --dir --x64'));
  const revisa = pasos.findIndex((p) => esRun(p, 'npm run check:electron-package'));
  assert.ok(empaqueta >= 0, 'falta el paso que corre `npm run build:electron -- --dir`');
  assert.ok(revisa >= 0, 'falta el paso que revisa el contenido del paquete');
  assert.ok(revisa > empaqueta, 'el contenido se revisa después de empaquetar');

  // Sin estas rutas el script queda verde mirando cualquier cosa.
  const guion = leer('scripts/check-electron-package.mjs');
  assert.match(guion, /node-pty/, 'exige node-pty en extraResources');
  assert.match(guion, /server\.cjs/, 'exige server.cjs en resources');
  assert.match(guion, /app\.asar/, 'exige el asar');
});
test('Pages: publica docs/ con los permisos mínimos', () => {
  const yml = leer(PAGES);
  const job = jobDe(yml, 'deploy');
  const pasos = pasosDe(job);

  // Sin el trigger, un cambio en el roadmap no llega nunca al sitio; y sin
  // `docs/**` en `paths` se redespliega por commits que no lo tocan.
  assert.match(yml, /^on:/m, 'declara el trigger');
  assert.match(yml, /workflow_dispatch:/, 'se puede publicar a mano');
  assert.match(yml, /^\s{2}push:/m, 'se dispara con push');
  assert.match(yml, /branches: \[main\]/, 'sólo desde main');
  assert.match(yml, /paths:\n(?:\s+- [^\n]+\n)*\s+- 'docs\/\*\*'/, 'los cambios en docs/** lo disparan');

  // Exacto, no «contiene»: un `contents: write` de más es un permiso que nadie
  // pidió, y el token de este job sólo necesita escribir el deployment.
  const permisos = (yml.match(/\npermissions:\n((?: {2}[^\n]+\n)+)/)?.[1] ?? '')
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  assert.deepEqual(permisos, ['contents: read', 'pages: write', 'id-token: write']);

  // Lo que se publica es la carpeta, sin build: el roadmap es HTML autocontenido
  // y si mañana se sube otro directorio el sitio queda vacío.
  const indice = (marcador: string) => {
    const i = pasos.findIndex((p) => p.includes(marcador));
    assert.ok(i >= 0, `falta el paso con ${marcador}`);
    return i;
  };
  const configura = indice('actions/configure-pages');
  const sube = indice('actions/upload-pages-artifact');
  const publica = indice('actions/deploy-pages');

  assert.ok(configura < sube && sube < publica, 'configura, sube y publica en ese orden');
  assert.match(pasos[sube], /path: docs/, 'sube docs/');
  // La primera corrida tiene que poder habilitar Pages: sin esto devuelve 404.
  assert.match(pasos[configura], /enablement: true/, 'habilita Pages si no lo está');
  assert.match(job, /url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/, 'el job expone la URL publicada');
});

test('CI: la firma de los commits se revisa con historia completa', () => {
  const job = jobDe(ci, 'lint-and-test');
  const pasos = pasosDe(job);
  const paso = pasos.find((p) =>
    p.split('\n').some((l) => l.trim() === 'run: npm run check:commit-signature')
  );
  assert.ok(paso, 'falta el paso que revisa la firma de los commits');
  // Sin historia completa el script no ve los commits viejos y pasaría en falso.
  assert.match(job, /fetch-depth: 0/, 'el job trae la historia completa');

  // El hook local es la primera barrera, pero se saltea con --no-verify: por
  // eso el paso de CI existe y por eso esto se comprueba junto.
  assert.ok(fs.existsSync('.husky/commit-msg'), 'existe el hook commit-msg');
  assert.match(
    leer('.husky/commit-msg'),
    /check:commit-signature/
    , 'el hook corre el mismo script'
  );
  assert.match(leer('scripts/check-commit-signature.ts'), /co-authored-by/i, 'el script mira co-autoría');
});

test('CI: cada suite deja sus conteos en el resumen del job', () => {
  const pasos = pasosDe(jobDe(ci, 'lint-and-test'));
  const delJob = (job: string[]) => (modo: string) => {
    const encontrados = job.filter((p) =>
      p.split('\n').some((l) => {
        const linea = l.trim();
        return (
          linea === `run: npm run ci:summary -- ${modo}` ||
          linea.startsWith(`run: npm run ci:summary -- ${modo} --`)
        );
      })
    );
    assert.equal(encontrados.length, 1, `esperaba un solo paso «ci:summary -- ${modo}»`);
    // Sin `always()` el resumen desaparece justo cuando la suite falla, que es
    // cuando sus conteos importan.
    assert.ok(encontrados[0].includes('if: always()'), `«${modo}» resume también en rojo`);
    return encontrados[0];
  };

  // El resumen no inventa nada: lee el reporte que deja cada suite. Si el paso
  // deja de escribirlo, la tabla queda vacía y nadie se entera.
  const nodeTest = pasos.find((p) => p.split('\n').some((l) => l.trim() === 'run: npm run test:node'));
  assert.ok(nodeTest?.includes('TEST_NODE_JUNIT'), 'node:test deja el reporte JUnit');
  const vitest = pasos.find((p) => p.split('\n').some((l) => l.trim().startsWith('run: npm run test --')));
  assert.ok(
    vitest?.includes('--reporter=json') && vitest.includes('--outputFile'),
    'Vitest deja el reporte JSON'
  );

  delJob(pasos)('node-test');
  delJob(pasos)('vitest');
  const logica = delJob(pasosDe(jobDe(ci, 'logic')))('vitest');
  // Ese job sólo corre el proyecto node: con el rótulo por defecto se
  // confundiría con la suite completa que corre en `lint-and-test`.
  assert.ok(
    logica.includes('--title "Tests (Vitest, lógica)"'),
    'el resumen de lógica se rotula distinto del completo'
  );
  delJob(pasosDe(jobDe(ci, 'e2e')))('e2e');

  assert.match(
    leer('scripts/ci-summary.ts'),
    /GITHUB_STEP_SUMMARY/,
    'el script escribe en el archivo que Actions muestra como resumen'
  );
});
