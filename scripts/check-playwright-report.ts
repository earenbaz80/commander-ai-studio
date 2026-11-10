/**
 * Falla si el reporte fusionado de Playwright no contiene exactamente la foto
 * esperada de la suite E2E.
 *
 * El artifact de CI se construye fusionando dos blobs: el E2E del productor de
 * artifacts (`agentVerificationArtifact.spec.ts`, 2 casos) y la suite general
 * (75 ejecuciones). Si el merge pierde uno de los dos, el job puede terminar
 * verde con un artifact incompleto; este chequeo convierte esa pérdida en un
 * fallo antes de subir el reporte.
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

const EXPECTED_TOTAL = 77;
const EXPECTED_STATS: Record<string, number> = {
  expected: 68,
  skipped: 9,
  unexpected: 0,
  flaky: 0,
};
const EXPECTED_PROJECTS: Record<string, number> = {
  chromium: 27,
  firefox: 25,
  'mobile-chrome': 25,
};
const EXPECTED_FILES: Record<string, number> = {
  'agentVerificationArtifact.spec.ts': 2,
  'app.spec.ts': 57,
  'contrast.spec.ts': 9,
  'lmstudio-loading.spec.ts': 6,
  'verificationArtifact.spec.ts': 3,
};
const EXPECTED_GENERAL = 75;
const AGENT_FILE = 'agentVerificationArtifact.spec.ts';
const AGENT_TITLES = [
  'crea el artifact desde shell.run, lo abre y lo conserva al recargar',
  'registra un exitCode 1 como failed y lo refleja en el informe',
];

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
if (!report.stats) errors.push('results.json no contiene `stats`');
const stats = report.stats ?? {};
const byProject = countBy(rows, (row) => row.project);
const byStatus = countBy(rows, (row) => row.status);
const byFile = countBy(rows, (row) => row.file);

function checkCount(label: string, actual: number, expected: number): void {
  if (actual !== expected) {
    errors.push(`${label}: esperado ${expected}, obtenido ${actual}`);
  }
}

checkCount('ejecuciones totales', rows.length, EXPECTED_TOTAL);
checkCount('stats.expected', stats.expected ?? 0, EXPECTED_STATS.expected);
checkCount('stats.skipped', stats.skipped ?? 0, EXPECTED_STATS.skipped);
checkCount('stats.unexpected', stats.unexpected ?? 0, EXPECTED_STATS.unexpected);
checkCount('stats.flaky', stats.flaky ?? 0, EXPECTED_STATS.flaky);
checkCount('filas expected', byStatus.expected ?? 0, EXPECTED_STATS.expected);
checkCount('filas skipped', byStatus.skipped ?? 0, EXPECTED_STATS.skipped);
checkCount(
  'filas unexpected',
  byStatus.unexpected ?? 0,
  EXPECTED_STATS.unexpected
);
checkCount('filas flaky', byStatus.flaky ?? 0, EXPECTED_STATS.flaky);

for (const [project, expected] of Object.entries(EXPECTED_PROJECTS)) {
  checkCount(`proyecto ${project}`, byProject[project] ?? 0, expected);
}
for (const [file, expected] of Object.entries(EXPECTED_FILES)) {
  checkCount(`archivo ${file}`, byFile[file] ?? 0, expected);
}

const extraProjects = Object.keys(byProject).filter(
  (project) => !(project in EXPECTED_PROJECTS)
);
if (extraProjects.length > 0) {
  errors.push(`proyectos no esperados: ${extraProjects.join(', ')}`);
}
const extraFiles = Object.keys(byFile).filter(
  (file) => !(file in EXPECTED_FILES)
);
if (extraFiles.length > 0) {
  errors.push(`archivos no esperados: ${extraFiles.join(', ')}`);
}

const agentRows = rows.filter((row) => row.file === AGENT_FILE);
const agentTitles = new Set(agentRows.map((row) => row.title));
checkCount(
  'casos del E2E del artifact',
  agentRows.length,
  EXPECTED_FILES[AGENT_FILE]
);
for (const row of agentRows) {
  if (row.project !== 'chromium') {
    errors.push(`E2E del artifact en ${row.project}; sólo se espera chromium`);
  }
  if (row.status !== 'expected') {
    errors.push(`E2E del artifact con estado ${row.status}; se esperaba expected`);
  }
}
for (const title of AGENT_TITLES) {
  if (!agentTitles.has(title)) {
    errors.push(`falta el caso del E2E del artifact: "${title}"`);
  }
}

const generalRows = rows.filter((row) => row.file !== AGENT_FILE);
checkCount('suite general', generalRows.length, EXPECTED_GENERAL);

if (errors.length > 0) {
  console.error(
    `[check:playwright-report] ${errors.length} problema(s) en ${REPORT_PATH}:`
  );
  for (const error of errors) console.error(`  - ${error}`);
  console.error(
    '[check:playwright-report] el artifact no contiene la foto esperada: el job debe fallar.'
  );
  process.exit(1);
}

const projects = Object.entries(byProject)
  .map(([project, count]) => `${project}=${count}`)
  .join(', ');
console.log(
  `[check:playwright-report] OK: ${rows.length} ejecuciones ` +
    `(${byStatus.expected ?? 0} passed, ${byStatus.skipped ?? 0} skipped, ` +
    `${byStatus.unexpected ?? 0} failed, ${byStatus.flaky ?? 0} flaky).`
);
console.log(
  `[check:playwright-report] proyectos: ${projects}; ` +
    `E2E del artifact=${agentRows.length}; suite general=${generalRows.length}.`
);
