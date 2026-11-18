/**
 * Falla si el reporte fusionado de Playwright no contiene las dos piezas con las
 * que CI arma el artifact: el E2E del productor de artifacts
 * (`agentVerificationArtifact.spec.ts`) y la suite general.
 *
 * Las comprobaciones son derivadas, no una foto congelada: agregar un spec o un
 * caso no obliga a tocar este archivo. Lo que se exige es
 *   1. que las dos piezas estén presentes — si `merge-reports` pierde un blob,
 *      una de las dos queda vacía y el job igual terminaría verde;
 *   2. que los proyectos de la suite general tengan los mismos conteos entre sí;
 *   3. que cada archivo de la suite general corra en todos los proyectos;
 *   4. que el E2E del artifact sólo aparezca en Chromium de escritorio;
 *   5. que el reporte esté verde (`unexpected` y `flaky` en cero) y que sus
 *      `stats` cuadren con las filas.
 *
 * Uso: `npm run check:playwright-report` después de `merge-reports`.
 * `PLAYWRIGHT_JSON_PATH` permite apuntar a otro `results.json` en local.
 */
import fs from 'node:fs';
import path from 'node:path';

interface PlaywrightTest {
  projectName: string;
  status: string;
}

interface PlaywrightSpec {
  title: string;
  tests?: PlaywrightTest[];
}

interface PlaywrightSuite {
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightStats {
  expected?: number;
  skipped?: number;
  unexpected?: number;
  flaky?: number;
}

interface PlaywrightReport {
  suites?: PlaywrightSuite[];
  stats?: PlaywrightStats;
}

interface Row {
  file: string;
  project: string;
  status: string;
  title: string;
}

const REPORT_PATH =
  process.env.PLAYWRIGHT_JSON_PATH ??
  path.join('playwright-report', 'results.json');

const AGENT_FILE = 'agentVerificationArtifact.spec.ts';
const AGENT_PROJECT = 'chromium';
const STATUS_KEYS = ['expected', 'skipped', 'unexpected', 'flaky'] as const;

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

const report = loadReport();
const rows: Row[] = [];
collect(report.suites, undefined, rows);

const errors: string[] = [];
const stats = report.stats;
if (!stats) errors.push('results.json no contiene `stats`');

const agentRows = rows.filter((row) => row.file === AGENT_FILE);
const generalRows = rows.filter((row) => row.file !== AGENT_FILE);

// 1. Las dos piezas del merge: si una se pierde, el artifact queda incompleto.
if (agentRows.length === 0) {
  errors.push(
    `falta el E2E del artifact (${AGENT_FILE}): el blob del primer paso no llegó al merge`
  );
}
if (generalRows.length === 0) {
  errors.push('falta la suite general: el blob del segundo paso no llegó al merge');
}

// 2. El E2E del artifact es de Chromium de escritorio, y sólo de ahí.
for (const row of agentRows) {
  if (row.project !== AGENT_PROJECT) {
    errors.push(
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
    errors.push(`el proyecto ${project} no tiene ejecuciones de la suite general`);
  }
}

const generalByProject = countBy(generalRows, (row) => row.project);
const projectTotals = generalProjects.map(
  (project) => generalByProject[project] ?? 0
);
if (new Set(projectTotals).size > 1) {
  errors.push(
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
    errors.push(`el archivo ${file} no corre en todos los proyectos: ${label}`);
  } else if (new Set(counts).size > 1) {
    errors.push(`conteos desparejos de ${file} entre proyectos: ${label}`);
  }
}

// 4. Reporte verde, y los `stats` del merge cuadrando con lo que hay en el árbol.
const byStatus = countBy(rows, (row) => row.status);
const byProject = countBy(rows, (row) => row.project);

for (const status of STATUS_KEYS) {
  const fromStats = stats?.[status] ?? 0;
  const fromRows = byStatus[status] ?? 0;
  if (stats && fromStats !== fromRows) {
    errors.push(
      `stats.${status}=${fromStats} no coincide con las filas (${fromRows})`
    );
  }
}
if ((byStatus.unexpected ?? 0) > 0) {
  errors.push(
    `${byStatus.unexpected} ejecución(es) fallida(s): el reporte no está verde`
  );
}
if ((byStatus.flaky ?? 0) > 0) {
  errors.push(
    `${byStatus.flaky} ejecución(es) flaky: el reporte no está verde`
  );
}

if (errors.length > 0) {
  console.error(
    `[check:playwright-report] ${errors.length} problema(s) en ${REPORT_PATH}:`
  );
  for (const error of errors) console.error(`  - ${error}`);
  console.error(
    '[check:playwright-report] el artifact no contiene lo esperado: el job debe fallar.'
  );
  process.exit(1);
}

console.log(
  `[check:playwright-report] OK: ${rows.length} ejecuciones ` +
    `(${byStatus.expected ?? 0} expected, ${byStatus.skipped ?? 0} skipped, ` +
    `${byStatus.unexpected ?? 0} failed, ${byStatus.flaky ?? 0} flaky).`
);
console.log(
  `[check:playwright-report] proyectos: ${describeCounts(byProject, allProjects)}; ` +
    `E2E del artifact=${agentRows.length} (${AGENT_PROJECT}); ` +
    `suite general=${generalRows.length} en ${generalFiles.length} archivo(s).`
);
