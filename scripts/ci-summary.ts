/**
 * Vuelca los conteos de las suites en el resumen del job de GitHub Actions.
 *
 * En la página del run, el log de un job no se puede leer sin sesión: los
 * totales de `test:node`, Vitest y Playwright quedaban inaccesibles. Cada suite
 * deja un reporte máquina-legible (JUnit, JSON) y este script lo convierte en
 * una tabla de `$GITHUB_STEP_SUMMARY`, que sí se ve en el run.
 *
 *   npm run ci:summary -- node-test   # TEST_NODE_JUNIT, lo escribe test-node.ts
 *   npm run ci:summary -- vitest      # --reporter=json --outputFile
 *   npm run ci:summary -- e2e         # results.json de merge-reports
 *
 * Cuando un reporte existe pero no se puede interpretar, la sección lo dice y
 * el script sale 1: un resumen en verde con números inventados es peor que un
 * rojo. Si el reporte falta, se avisa y no se falla (el paso de la suite ya se
 * puso rojo). Los tres lectores son funciones puras: `tests/ciSummary.test.ts`
 * los ejercita con fixtures sin arrancar el script.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface Resumen {
  /** Sección Markdown lista para el resumen del job. */
  markdown: string;
  /** Motivo cuando el reporte existe pero no se pudo interpretar. */
  error?: string;
}

interface PlaywrightSuite {
  file?: string;
  specs?: { tests?: { projectName: string; status: string }[] }[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightReport {
  suites?: PlaywrightSuite[];
  stats?: {
    expected?: number;
    skipped?: number;
    unexpected?: number;
    flaky?: number;
    duration?: number;
  };
}

interface VitestReport {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults?: { startTime?: number; endTime?: number }[];
}

interface Ejecucion {
  file: string;
  project: string;
  status: string;
}

const RUTA_NODE = process.env.TEST_NODE_JUNIT ?? path.join('.ci', 'node-test.xml');
const RUTA_VITEST = process.env.CI_VITEST_JSON ?? path.join('.ci', 'vitest.json');
const RUTA_E2E = process.env.PLAYWRIGHT_JSON_PATH ?? path.join('playwright-report', 'results.json');

const AGENTE = 'agentVerificationArtifact.spec.ts';

const entero = (valor: number): string => valor.toLocaleString('es-ES');
/** El runner es Windows: en el Markdown se muestra siempre con `/`. */
const legible = (ruta: string): string => ruta.split(path.sep).join('/');
const segundos = (ms: number): string => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

function leer(ruta: string): string | undefined {
  try {
    return fs.readFileSync(ruta, 'utf8');
  } catch {
    return undefined;
  }
}

function seccion(titulo: string, cuerpo: string): string {
  return `### ${titulo}\n\n${cuerpo}\n`;
}

/** El paso previo no escribió el reporte: se dice, en vez de una tabla en cero. */
function faltante(ruta: string): string {
  return `> Sin datos: no se encontró \`${legible(ruta)}\`. El paso de la suite no llegó a escribir el reporte.\n`;
}

function ilegible(ruta: string, detalle: string): Resumen {
  return {
    markdown: `> No se pudo leer \`${legible(ruta)}\`: ${detalle}\n`,
    error: `${legible(ruta)}: ${detalle}`,
  };
}

function tabla(encabezado: string[], filas: string[][]): string {
  const separador = encabezado.map(() => '---').join(' | ');
  return [
    `| ${encabezado.join(' | ')} |`,
    `| ${separador} |`,
    ...filas.map((fila) => `| ${fila.join(' | ')} |`),
  ].join('\n');
}

function cuerpoConTabla(filas: string[], encabezado: string[], ms: number | undefined): string {
  return [
    tabla(encabezado, [filas]),
    ms === undefined ? '' : `Duración: ${segundos(ms)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * JUnit del reporter de `node --test`.
 *
 * Los totales no están en atributos: el reporter los deja como comentarios
 * (`<!-- tests 961 -->`, `<!-- pass 961 -->`). Sin esos comentarios no se puede
 * separar pass de fail —contar sólo los `<testcase>` daría «N casos, 0 pasan»—
 * así que se avisa en vez de inventar el desglose.
 */
export function resumenNodeTest(xml: string | undefined, ruta = RUTA_NODE): Resumen {
  const titulo = 'Tests (node:test)';
  if (!xml) return { markdown: seccion(titulo, faltante(ruta)) };

  const contador = (clave: string): number | undefined => {
    const encontrado = xml.match(new RegExp(`<!--\\s*${clave}\\s+([0-9.]+)\\s*-->`));
    return encontrado ? Number(encontrado[1]) : undefined;
  };

  const casos = contador('tests');
  const pasan = contador('pass');
  const fallan = contador('fail');
  const saltados = contador('skipped');
  const archivos = new Set(
    [...xml.matchAll(/<testcase\b[^>]*\bfile="([^"]+)"/g)].map((coincidencia) => coincidencia[1])
  ).size;
  const declarados = xml.match(/<testcase\b/g)?.length ?? 0;

  if (casos === undefined || pasan === undefined || fallan === undefined || saltados === undefined) {
    const detalle =
      `el JUnit de \`${legible(ruta)}\` no trae los totales ` +
      '(`<!-- tests -->`, `<!-- pass -->`, `<!-- fail -->`, `<!-- skipped -->`) ' +
      `que escribe el reporter \`junit\` de \`node --test\`: trae ${entero(declarados)} ` +
      `caso(s) en ${entero(archivos)} archivo(s), pero sin el desglose no se puede afirmar cuántos pasan`;
    return {
      markdown: seccion(
        titulo,
        `> No se pudo contar: ${detalle}.\n`
      ),
      error: detalle,
    };
  }

  const filas = [entero(archivos), entero(casos), entero(pasan), entero(fallan), entero(saltados)];
  return {
    markdown: seccion(
      titulo,
      cuerpoConTabla(filas, ['Archivos', 'Casos', 'Pasan', 'Fallan', 'Saltados'], contador('duration_ms'))
    ),
  };
}

/** Reporte JSON de Vitest (`--reporter=json --outputFile`). */
export function resumenVitest(texto: string | undefined, ruta = RUTA_VITEST): Resumen {
  const titulo = 'Tests (Vitest)';
  if (!texto) return { markdown: seccion(titulo, faltante(ruta)) };

  let datos: VitestReport;
  try {
    datos = JSON.parse(texto) as VitestReport;
  } catch (error) {
    const ilegibleAqui = ilegible(ruta, (error as Error).message);
    return { ...ilegibleAqui, markdown: seccion(titulo, ilegibleAqui.markdown) };
  }

  const resultados = datos.testResults ?? [];

  // El JSON no trae una duración global: se toma la ventana entre el primer
  // archivo que arrancó y el último que terminó.
  const inicios = resultados
    .map((resultado) => resultado.startTime)
    .filter((valor): valor is number => typeof valor === 'number');
  const fines = resultados
    .map((resultado) => resultado.endTime)
    .filter((valor): valor is number => typeof valor === 'number');
  const ms = inicios.length > 0 && fines.length > 0 ? Math.max(...fines) - Math.min(...inicios) : undefined;

  const filas = [
    entero(resultados.length),
    entero(datos.numTotalTests),
    entero(datos.numPassedTests),
    entero(datos.numFailedTests),
    entero(datos.numPendingTests),
  ];
  return {
    markdown: seccion(
      titulo,
      cuerpoConTabla(filas, ['Archivos', 'Casos', 'Pasan', 'Fallan', 'Saltados'], ms)
    ),
  };
}

function recolectar(suites: PlaywrightSuite[] | undefined, padre: string | undefined, salida: Ejecucion[]): void {
  for (const suite of suites ?? []) {
    const file = path.basename(suite.file ?? padre ?? '(sin archivo)');
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        salida.push({ file, project: test.projectName, status: test.status });
      }
    }
    recolectar(suite.suites, file, salida);
  }
}

/** `results.json` del `merge-reports` de Playwright. */
export function resumenE2E(texto: string | undefined, ruta = RUTA_E2E): Resumen {
  const titulo = 'E2E (Playwright)';
  if (!texto) return { markdown: seccion(titulo, faltante(ruta)) };

  let reporte: PlaywrightReport;
  try {
    reporte = JSON.parse(texto) as PlaywrightReport;
  } catch (error) {
    const ilegibleAqui = ilegible(ruta, (error as Error).message);
    return { ...ilegibleAqui, markdown: seccion(titulo, ilegibleAqui.markdown) };
  }

  const ejecuciones: Ejecucion[] = [];
  recolectar(reporte.suites, undefined, ejecuciones);

  // El spec del artifact va primero porque es el que el job mide aparte.
  const grupos = [
    { etiqueta: 'E2E del artifact', corridas: ejecuciones.filter((fila) => fila.file === AGENTE) },
    { etiqueta: 'Suite general', corridas: ejecuciones.filter((fila) => fila.file !== AGENTE) },
  ];
  const conEstado = (corridas: Ejecucion[], estado: string): number =>
    corridas.filter((fila) => fila.status === estado).length;

  const filas = grupos.map((grupo) => {
    const proyectos = [...new Set(grupo.corridas.map((fila) => fila.project))].sort();
    return [
      grupo.etiqueta,
      proyectos.length > 0 ? proyectos.join(', ') : '—',
      entero(grupo.corridas.length),
      entero(conEstado(grupo.corridas, 'expected')),
      entero(conEstado(grupo.corridas, 'unexpected')),
      entero(conEstado(grupo.corridas, 'skipped')),
      entero(conEstado(grupo.corridas, 'flaky')),
    ];
  });
  filas.push([
    '**Total**',
    '—',
    entero(ejecuciones.length),
    entero(conEstado(ejecuciones, 'expected')),
    entero(conEstado(ejecuciones, 'unexpected')),
    entero(conEstado(ejecuciones, 'skipped')),
    entero(conEstado(ejecuciones, 'flaky')),
  ]);

  const duracion = reporte.stats?.duration;
  const cuerpo = [
    tabla(['Suite', 'Proyectos', 'Casos', 'Pasan', 'Fallan', 'Saltados', 'Flaky'], filas),
    typeof duracion === 'number' ? `Duración: ${segundos(duracion)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { markdown: seccion(titulo, cuerpo) };
}

function publicar(markdown: string): void {
  const destino = process.env.GITHUB_STEP_SUMMARY;
  if (!destino) {
    console.log(markdown);
    return;
  }
  try {
    fs.appendFileSync(destino, `${markdown}\n`, 'utf8');
  } catch (error) {
    console.error(`[ci:summary] no se pudo escribir ${destino}: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

function principal(): void {
  const modo = process.argv[2];
  if (modo !== 'node-test' && modo !== 'vitest' && modo !== 'e2e') {
    console.error('[ci:summary] uso: npm run ci:summary -- node-test|vitest|e2e');
    process.exit(1);
  }

  const resumen =
    modo === 'node-test'
      ? resumenNodeTest(leer(RUTA_NODE))
      : modo === 'vitest'
        ? resumenVitest(leer(RUTA_VITEST))
        : resumenE2E(leer(RUTA_E2E));

  if (resumen.error) {
    console.error(`[ci:summary] ${resumen.error}`);
    process.exitCode = 1;
  }
  publicar(resumen.markdown);
}

// Sólo corre como CLI: los tests importan los lectores y no deben ejecutarlos.
if (process.argv[1] && /ci-summary\.(ts|js)$/.test(process.argv[1])) {
  principal();
}
