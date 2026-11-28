/**
 * Falla si el reporte fusionado de Playwright no contiene las piezas con las
 * que CI arma el artifact: el E2E del productor de artifacts
 * (`agentVerificationArtifact.spec.ts`), la suite general y el adjunto con la
 * secuencia de C8 (`c8-steps`) en el caso de dos dispositivos.
 *
 * Las comprobaciones son derivadas, no una foto congelada: agregar un spec o un
 * caso no obliga a tocar este archivo. Lo que se exige es
 *   1. que las dos piezas estén presentes — si `merge-reports` pierde un blob,
 *      una de las dos queda vacía y el job igual terminaría verde;
 *   2. que los proyectos de la suite general tengan los mismos conteos entre sí;
 *   3. que cada archivo de la suite general corra en todos los proyectos;
 *   4. que el E2E del artifact sólo aparezca en Chromium de escritorio;
 *   5. que el caso de C8 corra una sola vez y traiga el adjunto `c8-steps` con
 *      sus 5 pasos;
 *   6. que el artifact traiga además un `index.html` no vacío: el JSON prueba
 *      que el merge leyó los blobs, no que el reporte HTML se haya generado;
 *   7. que no haya fallos reales (`unexpected` en cero) y que los `stats`
 *      cuadren con las filas. `flaky` no tumba el gate: `retries: 1` existe
 *      justamente para absorber un parpadeo, así que un reintento exitoso se
 *      informa en el resumen (conteos y una línea propia) sin pintar el job de
 *      rojo; si el test falla de verdad, el intento final queda `unexpected`.
 *
 * El adjunto de C8 se valida por contenido y no por presencia del nombre: un
 * `c8-steps` vacío o con menos pasos deja el recibo G2 citando una secuencia que
 * ya no existe. Como el log del paso no se puede leer sin sesión, la sección del
 * resumen lleva la línea con los pasos y los conteos del veredicto (ejecuciones,
 * `expected` y proyectos).
 *
 * Uso: `npm run check:playwright-report` después de `merge-reports`.
 * `PLAYWRIGHT_JSON_PATH` permite apuntar a otro `results.json` en local.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface PlaywrightAttachment {
  name?: string;
  contentType?: string;
  path?: string;
  /** Contenido en base64 cuando el reporte no dejó archivo en disco. */
  body?: string;
}

export interface PlaywrightResult {
  status?: string;
  attachments?: PlaywrightAttachment[];
}

export interface PlaywrightTest {
  projectName: string;
  status: string;
  results?: PlaywrightResult[];
}

export interface PlaywrightSpec {
  title: string;
  tests?: PlaywrightTest[];
}

export interface PlaywrightSuite {
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

export interface PlaywrightStats {
  expected?: number;
  skipped?: number;
  unexpected?: number;
  flaky?: number;
}

export interface PlaywrightReport {
  suites?: PlaywrightSuite[];
  stats?: PlaywrightStats;
}

interface Row {
  file: string;
  project: string;
  status: string;
  title: string;
  attachments: PlaywrightAttachment[];
}

/** La secuencia que el caso de C8 adjunta al reporte, ya validada. */
export interface C8Steps {
  pasos: string[];
  /** De dónde salió el contenido: el archivo del reporte o el `body` embebido. */
  origen: string;
}

/** Lo que el gate decide sobre un reporte, separado del CLI para poder probarlo. */
export interface Veredicto {
  errores: string[];
  ejecuciones: number;
  porEstado: Record<string, number>;
  porProyecto: Record<string, number>;
  proyectos: string[];
  agentRows: number;
  generalRows: number;
  generalFiles: string[];
  c8?: C8Steps;
  /** Problemas propios del adjunto de C8, para la línea del resumen. */
  erroresC8: string[];
}

export const REPORT_PATH =
  process.env.PLAYWRIGHT_JSON_PATH ??
  path.join('playwright-report', 'results.json');

export const AGENT_FILE = 'agentVerificationArtifact.spec.ts';
export const AGENT_PROJECT = 'chromium';
/** El caso de C8 vive en este spec; el adjunto lo escribe el propio test. */
export const C8_FILE = 'pairTwoDevices.spec.ts';
export const C8_ATTACHMENT = 'c8-steps';
/** Inicio > fs.read > fs.write > Razonamiento > Finalizado. */
export const C8_STEPS = 5;
/** El reporte que se abre cuando el job falla; el JSON solo no lo reemplaza. */
export const HTML_REPORT = 'index.html';

const STATUS_KEYS = ['expected', 'skipped', 'unexpected', 'flaky'] as const;

function adjuntosDe(test: PlaywrightTest): PlaywrightAttachment[] {
  // Un test con reintentos deja varios `results`: se juntan todos, porque el
  // adjunto puede venir del intento que terminó en verde.
  return (test.results ?? []).flatMap((result) => result.attachments ?? []);
}

function collect(
  suites: PlaywrightSuite[] | undefined,
  parentFile: string | undefined,
  rows: Row[]
): void {
  for (const suite of suites ?? []) {
    const file = suite.file ?? parentFile ?? '(sin archivo)';
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        rows.push({
          file: path.basename(file),
          project: test.projectName,
          status: test.status,
          title: spec.title,
          attachments: adjuntosDe(test),
        });
      }
    }
    collect(suite.suites, file, rows);
  }
}

function countBy(
  rows: Row[],
  key: (row: Row) => string
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = key(row);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function describeCounts(counts: Record<string, number>, keys: string[]): string {
  return keys.map((key) => `${key}=${counts[key] ?? 0}`).join(', ');
}

/**
 * Contenido del adjunto. `merge-reports` deja los adjuntos como archivos en el
 * reporte y guarda la ruta relativa; si el JSON trae el `body` embebido, ése
 * manda porque no depende de dónde se lea el reporte.
 */
function leerAdjunto(
  adjunto: PlaywrightAttachment,
  baseDir: string
): { texto: string; origen: string } | undefined {
  if (typeof adjunto.body === 'string' && adjunto.body.length > 0) {
    return {
      texto: Buffer.from(adjunto.body, 'base64').toString('utf8'),
      origen: 'body embebido',
    };
  }
  if (!adjunto.path) return undefined;

  // La ruta del reporte es relativa a su carpeta de salida; se prueban las dos
  // formas para no depender de desde dónde se invoque el script.
  const candidatas = [path.resolve(baseDir, adjunto.path), path.resolve(adjunto.path)];
  for (const candidata of candidatas) {
    try {
      return {
        texto: fs.readFileSync(candidata, 'utf8'),
        origen: path.relative(process.cwd(), candidata) || candidata,
      };
    } catch {
      /* se prueba la siguiente */
    }
  }
  return undefined;
}

function validarC8(
  rows: Row[],
  baseDir: string
): { errores: string[]; c8?: C8Steps } {
  const errores: string[] = [];
  const delCaso = rows.filter((row) => row.file === C8_FILE);
  // `test.skip()` deja la fila en el reporte con estado `skipped`: el caso se
  // salta a propósito en firefox y mobile-chrome, así que contar filas lo leía
  // como tres ejecuciones (run #290). Correr es tener estado distinto de
  // `skipped`; las saltadas siguen en el reporte y en los conteos del resumen.
  const ejecutadas = delCaso.filter((row) => row.status !== 'skipped');
  // Un caso que se cuela en otro proyecto corre dos veces con el mismo nombre
  // de archivo: el recibo G2 cita una sola ejecución, y los adjuntos se
  // duplicarían sin que el conteo de proyectos lo delate.
  if (ejecutadas.length > 1) {
    const proyectos = [...new Set(ejecutadas.map((row) => row.project))].join(', ');
    return {
      errores: [
        `el caso de C8 corre ${ejecutadas.length} veces (${proyectos}): se espera ` +
          'una sola ejecución, la que cita el recibo',
      ],
    };
  }
  if (delCaso.length === 0) {
    return {
      errores: [
        `falta el caso de C8 (${C8_FILE}): el reporte no lo incluye, así que la ` +
          'secuencia del recibo G2 no se puede comprobar',
      ],
    };
  }
  // Todas saltadas: el caso está en el reporte pero no llegó a correr, así que
  // tampoco hay secuencia que citar. Se nombra el salto en vez de lamentar el
  // adjunto que nunca iba a existir.
  if (ejecutadas.length === 0) {
    const proyectos = [...new Set(delCaso.map((row) => row.project))].join(', ');
    return {
      errores: [
        `el caso de C8 no corrió en ningún proyecto (saltado en ${proyectos}): ` +
          'el recibo G2 se queda sin la secuencia de esta corrida',
      ],
    };
  }

  const adjuntos = delCaso
    .flatMap((row) => row.attachments)
    .filter((adjunto) => adjunto.name === C8_ATTACHMENT);
  if (adjuntos.length === 0) {
    return {
      errores: [
        `el caso de C8 no adjunta ${C8_ATTACHMENT}: el test tiene que ` +
          '`testInfo.attach` con la secuencia de pasos',
      ],
    };
  }

  const leidos = adjuntos
    .map((adjunto) => leerAdjunto(adjunto, baseDir))
    .filter((leido): leido is { texto: string; origen: string } => leido !== undefined);
  if (leidos.length === 0) {
    const rutas = adjuntos.map((adjunto) => adjunto.path ?? '(sin ruta)').join(', ');
    return {
      errores: [
        `no se pudo leer el adjunto ${C8_ATTACHMENT} (${rutas}): el archivo no ` +
          'está en el reporte o la ruta no resuelve',
      ],
    };
  }

  const { texto, origen } = leidos[0];
  let datos: { steps?: unknown };
  try {
    datos = JSON.parse(texto) as { steps?: unknown };
  } catch (error) {
    return {
      errores: [
        `el adjunto ${C8_ATTACHMENT} no es JSON válido: ` +
          (error instanceof Error ? error.message : String(error)),
      ],
    };
  }

  if (!Array.isArray(datos.steps)) {
    return {
      errores: [`el adjunto ${C8_ATTACHMENT} no trae un arreglo \`steps\``],
    };
  }

  const pasos = datos.steps;
  if (pasos.length !== C8_STEPS) {
    errores.push(
      `el adjunto ${C8_ATTACHMENT} trae ${pasos.length} paso(s), se esperan ${C8_STEPS}`
    );
  }
  const vacios = pasos.filter(
    (paso) => typeof paso !== 'string' || paso.trim() === ''
  ).length;
  if (vacios > 0) {
    errores.push(`el adjunto ${C8_ATTACHMENT} trae ${vacios} paso(s) sin texto`);
  }

  if (errores.length > 0) return { errores };

  return {
    errores,
    c8: { pasos: pasos as string[], origen },
  };
}

/** Valida un reporte ya parseado. `baseDir` es donde viven sus adjuntos. */
export function validarReporte(
  report: PlaywrightReport,
  baseDir = path.dirname(REPORT_PATH)
): Veredicto {
  const rows: Row[] = [];
  collect(report.suites, undefined, rows);

  const errores: string[] = [];
  const stats = report.stats;
  if (!stats) errores.push('results.json no contiene `stats`');

  const agentRows = rows.filter((row) => row.file === AGENT_FILE);
  const generalRows = rows.filter((row) => row.file !== AGENT_FILE);

  // 1. Las dos piezas del merge: si una se pierde, el artifact queda incompleto.
  if (agentRows.length === 0) {
    errores.push(
      `falta el E2E del artifact (${AGENT_FILE}): el blob del primer paso no llegó al merge`
    );
  }
  if (generalRows.length === 0) {
    errores.push('falta la suite general: el blob del segundo paso no llegó al merge');
  }

  // 2. El E2E del artifact es de Chromium de escritorio, y sólo de ahí.
  for (const row of agentRows) {
    if (row.project !== AGENT_PROJECT) {
      errores.push(
        `E2E del artifact en ${row.project}: sólo se espera ${AGENT_PROJECT}`
      );
    }
  }

  // 3. La suite general corre entera en cada proyecto, con los mismos conteos:
  //    un blob perdido deja un proyecto corto.
  const generalProjects = [...new Set(generalRows.map((row) => row.project))];
  const allProjects = [...new Set(rows.map((row) => row.project))];

  for (const project of allProjects) {
    if (!generalProjects.includes(project)) {
      errores.push(`el proyecto ${project} no tiene ejecuciones de la suite general`);
    }
  }

  const generalByProject = countBy(generalRows, (row) => row.project);
  const projectTotals = generalProjects.map(
    (project) => generalByProject[project] ?? 0
  );
  if (new Set(projectTotals).size > 1) {
    errores.push(
      'conteos desparejos entre proyectos de la suite general: ' +
        describeCounts(generalByProject, generalProjects)
    );
  }

  const generalFiles = [...new Set(generalRows.map((row) => row.file))].sort();
  for (const file of generalFiles) {
    const byProject = countBy(
      generalRows.filter((row) => row.file === file),
      (row) => row.project
    );
    const counts = generalProjects.map((project) => byProject[project] ?? 0);
    const label = describeCounts(byProject, generalProjects);
    if (counts.some((count) => count === 0)) {
      errores.push(`el archivo ${file} no corre en todos los proyectos: ${label}`);
    } else if (new Set(counts).size > 1) {
      errores.push(`conteos desparejos de ${file} entre proyectos: ${label}`);
    }
  }

  // 4. El adjunto de C8: la secuencia del recibo tiene que venir de esta corrida.
  const c8 = validarC8(rows, baseDir);
  errores.push(...c8.errores);

  // 5. Reporte verde, y los `stats` del merge cuadrando con lo que hay en el árbol.
  const byStatus = countBy(rows, (row) => row.status);
  const byProject = countBy(rows, (row) => row.project);

  for (const status of STATUS_KEYS) {
    const fromStats = stats?.[status] ?? 0;
    const fromRows = byStatus[status] ?? 0;
    if (stats && fromStats !== fromRows) {
      errores.push(
        `stats.${status}=${fromStats} no coincide con las filas (${fromRows})`
      );
    }
  }
  if ((byStatus.unexpected ?? 0) > 0) {
    errores.push(
      `${byStatus.unexpected} ejecución(es) fallida(s): el reporte no está verde`
    );
  }
  // `flaky` no entra en `errores` a propósito: un test que pasó en el reintento
  // no es un fallo del job. Se ve en los conteos y en la línea propia del
  // resumen (`lineasConteos`), para que no quede escondido.

  return {
    errores,
    ejecuciones: rows.length,
    porEstado: byStatus,
    porProyecto: byProject,
    proyectos: allProjects,
    agentRows: agentRows.length,
    generalRows: generalRows.length,
    generalFiles,
    c8: c8.c8,
    erroresC8: c8.errores,
  };
}

/**
 * El merge produce `html,json`; este gate sólo mira el JSON. Si el HTML sale
 * vacío o no sale, el artifact queda inservible y el job verde lo taparía.
 * Se comprueba junto al JSON porque son las dos caras del mismo artifact.
 */
export function verificarArtifactHtml(baseDir: string): string[] {
  const ruta = path.join(baseDir, HTML_REPORT);
  let tamano: number;
  try {
    tamano = fs.statSync(ruta).size;
  } catch {
    return [
      `falta ${HTML_REPORT} en ${baseDir}: el artifact se subiría sin reporte legible`,
    ];
  }
  if (tamano === 0) {
    return [`${HTML_REPORT} está vacío (0 B): el merge no generó el reporte HTML`];
  }
  return [];
}

/** La línea que se lee en el run sin abrir el artifact. */
export function lineaResumen(veredicto: Veredicto): string {
  const etiqueta = `**C8 · \`${C8_ATTACHMENT}\`**`;
  if (veredicto.c8) {
    const { pasos, origen } = veredicto.c8;
    return `- ${etiqueta}: ${pasos.length} pasos — ${pasos.join(' > ')} (${origen})`;
  }
  return `- ${etiqueta}: ${veredicto.erroresC8[0] ?? 'sin datos en el reporte'}`;
}

/**
 * El log del paso no se puede leer sin sesión en el repo: el resumen sí. Si no
 * hay `GITHUB_STEP_SUMMARY` (local), la línea igual sale por stdout.
 */
/**
 * Los conteos del veredicto, en el resumen del job. `ci:summary -- e2e` publica
 * los del reporte crudo; éstos son los que este gate contó y validó, y hasta
 * ahora sólo se veían abriendo el log del paso.
 */
export function lineasConteos(veredicto: Veredicto): string[] {
  const estados = STATUS_KEYS.map(
    (clave) => `${clave} ${veredicto.porEstado[clave] ?? 0}`
  ).join(', ');
  const proyectos = Object.entries(veredicto.porProyecto)
    .map(([proyecto, ejecuciones]) => `${proyecto} ${ejecuciones}`)
    .join(', ');
  const lineas = [
    `- **Ejecuciones**: ${veredicto.ejecuciones} — ${estados}`,
    `- **Proyectos**: ${proyectos || '—'}`,
  ];
  const flaky = veredicto.porEstado.flaky ?? 0;
  if (flaky > 0) {
    // Un reintento exitoso no rompe el gate, pero tampoco se esconde: el flake
    // sigue siendo deuda y así se ve en el resumen del job sin abrir el log.
    lineas.push(
      `- **Flaky**: ${flaky} ejecución(es) que pasaron en el reintento (no tumban el gate)`
    );
  }
  return lineas;
}

function publicar(lineas: string[]): void {
  console.log(lineas.join('\n'));
  const destino = process.env.GITHUB_STEP_SUMMARY;
  if (!destino) return;
  try {
    fs.appendFileSync(
      destino,
      `### Gate del reporte de Playwright\n\n${lineas.join('\n')}\n`,
      'utf8'
    );
  } catch (error) {
    console.error(
      `[check:playwright-report] no se pudo escribir ${destino}: ` +
        (error instanceof Error ? error.message : String(error))
    );
    process.exitCode = 1;
  }
}

function loadReport(): PlaywrightReport {
  try {
    return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8')) as PlaywrightReport;
  } catch (error) {
    console.error(
      `[check:playwright-report] no se pudo leer ${REPORT_PATH}: ` +
        (error instanceof Error ? error.message : String(error))
    );
    console.error(
      '[check:playwright-report] genera el reporte con `merge-reports` antes de este chequeo.'
    );
    process.exit(1);
  }
}

function principal(): void {
  const baseDir = path.dirname(REPORT_PATH);
  const veredicto = validarReporte(loadReport(), baseDir);
  // El HTML no sale del JSON: se mide en disco y se suma a los mismos problemas.
  const problemas = [...veredicto.errores, ...verificarArtifactHtml(baseDir)];
  const byStatus = veredicto.porEstado;
  publicar([lineaResumen(veredicto), ...lineasConteos(veredicto)]);

  if (problemas.length > 0) {
    console.error(
      `[check:playwright-report] ${problemas.length} problema(s) en ${REPORT_PATH}:`
    );
    for (const error of problemas) console.error(`  - ${error}`);
    console.error(
      '[check:playwright-report] el artifact no contiene lo esperado: el job debe fallar.'
    );
    process.exit(1);
  }

  console.log(
    `[check:playwright-report] OK: ${veredicto.ejecuciones} ejecuciones ` +
      `(${byStatus.expected ?? 0} expected, ${byStatus.skipped ?? 0} skipped, ` +
      `${byStatus.unexpected ?? 0} failed, ${byStatus.flaky ?? 0} flaky).`
  );
  console.log(
    `[check:playwright-report] proyectos: ${describeCounts(
      veredicto.porProyecto,
      veredicto.proyectos
    )}; ` +
      `E2E del artifact=${veredicto.agentRows} (${AGENT_PROJECT}); ` +
      `suite general=${veredicto.generalRows} en ${veredicto.generalFiles.length} archivo(s).`
  );
}

// Sólo corre como CLI: los tests pueden importar `validarReporte` sin ejecutarlo.
if (process.argv[1] && /check-playwright-report\.(ts|js)$/.test(process.argv[1])) {
  principal();
}
