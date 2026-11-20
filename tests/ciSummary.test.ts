/**
 * Los tres lectores de `ci-summary` convierten reportes ajenos —JUnit de
 * `node --test`, JSON de Vitest y `results.json` de Playwright— en el resumen
 * del job. Si un formato cambia, el resumen no falla: muestra números, y ahí
 * está el peligro. Estos casos fijan las dos orillas: se cuenta bien lo que se
 * entiende, y se avisa cuando el reporte no alcanza para contar.
 *
 * Los fixtures son literales con la forma real de cada reporte. En especial el
 * JUnit de Node, que no pone los totales en atributos sino en comentarios al
 * final del archivo: sin ellos, contar sólo los `<testcase>` daría «N casos, 0
 * pasan», un desglose falso.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumenE2E, resumenNodeTest, resumenVitest } from '../scripts/ci-summary';

const JUNIT = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="verde" time="0.000744" classname="test" file="tests/a.test.ts"/>
	<testcase name="rojo" time="0.001" classname="test" file="tests/a.test.ts">
		<failure message="boom"/>
	</testcase>
	<testcase name="salteado" time="0.000412" classname="test" file="tests/b.test.ts">
		<skipped type="skipped" message="true"/>
	</testcase>
	<!-- tests 3 -->
	<!-- suites 0 -->
	<!-- pass 1 -->
	<!-- fail 1 -->
	<!-- cancelled 0 -->
	<!-- skipped 1 -->
	<!-- todo 0 -->
	<!-- duration_ms 12345.6 -->
</testsuites>`;

const VITEST = JSON.stringify({
  numTotalTestSuites: 2,
  numPassedTestSuites: 2,
  numFailedTestSuites: 0,
  numPendingTestSuites: 0,
  numTotalTests: 3,
  numPassedTests: 2,
  numFailedTests: 0,
  numPendingTests: 1,
  numTodoTests: 0,
  startTime: 1000,
  success: true,
  testResults: [
    { startTime: 1000, endTime: 2500 },
    { startTime: 2000, endTime: 4000 },
  ],
});

const PLAYWRIGHT = JSON.stringify({
  // El archivo se repite en la suite anidada: el lector tiene que heredarlo y no
  // contar dos veces al padre.
  suites: [
    {
      file: 'tests/e2e/agentVerificationArtifact.spec.ts',
      specs: [
        { title: 'a', tests: [{ projectName: 'chromium', status: 'expected' }] },
        { title: 'b', tests: [{ projectName: 'chromium', status: 'expected' }] },
      ],
    },
    {
      file: 'tests/e2e/app.spec.ts',
      suites: [
        {
          file: 'tests/e2e/app.spec.ts',
          specs: [
            { title: 'c', tests: [{ projectName: 'chromium', status: 'expected' }] },
            { title: 'd', tests: [{ projectName: 'firefox', status: 'skipped' }] },
          ],
        },
      ],
    },
  ],
  stats: { expected: 3, skipped: 1, unexpected: 0, flaky: 0, duration: 16700 },
});

test('ci-summary: el JUnit con totales cuenta archivos, casos y desglose', () => {
  const resumen = resumenNodeTest(JUNIT);
  assert.equal(resumen.error, undefined);
  assert.match(resumen.markdown, /\| 2 \| 3 \| 1 \| 1 \| 1 \|/);
  assert.match(resumen.markdown, /Duración: 12,3 s/);
});

test('ci-summary: un JUnit sin los comentarios de totales avisa y no inventa 0 pasan', () => {
  const sinTotales = JUNIT.split('\n')
    .filter((linea) => !linea.includes('<!--'))
    .join('\n');

  const resumen = resumenNodeTest(sinTotales);
  assert.ok(resumen.error, 'sin totales el lector tiene que avisar');
  assert.match(resumen.markdown, /No se pudo contar/);
  assert.match(resumen.markdown, /trae 3 caso\(s\) en 2 archivo\(s\)/);

  // El defecto que este caso previene: «3 casos, 0 pasan» con la tabla armada.
  assert.ok(!/\| 2 \| 3 \| 0 \|/.test(resumen.markdown), 'no debe mostrar 0 pasan');
  assert.ok(!resumen.markdown.includes('| Pasan |'), 'sin desglose no hay tabla de conteos');
});

test('ci-summary: el lector de Vitest acepta un título alternativo', () => {
  const resumen = resumenVitest(VITEST, '.ci/vitest.json', 'Tests (Vitest, lógica)');
  assert.match(resumen.markdown, /^### Tests \(Vitest, lógica\)$/m);
  // El título por defecto no se cuela: el job de lógica se distingue del completo.
  assert.ok(!resumen.markdown.includes('### Tests (Vitest)\n'));
});

test('ci-summary: el JSON de Vitest cuenta archivos, casos y ventana de duración', () => {
  const resumen = resumenVitest(VITEST);
  assert.equal(resumen.error, undefined);
  assert.match(resumen.markdown, /\| 2 \| 3 \| 2 \| 0 \| 1 \|/);
  // 4000 ms del último archivo menos 1000 ms del primero.
  assert.match(resumen.markdown, /Duración: 3,0 s/);
});

test('ci-summary: el results.json separa el E2E del artifact de la suite general', () => {
  const resumen = resumenE2E(PLAYWRIGHT);
  assert.equal(resumen.error, undefined);
  assert.match(resumen.markdown, /\| E2E del artifact \| chromium \| 2 \| 2 \| 0 \| 0 \| 0 \|/);
  assert.match(resumen.markdown, /\| Suite general \| chromium, firefox \| 2 \| 1 \| 0 \| 1 \| 0 \|/);
  assert.match(resumen.markdown, /\| \*\*Total\*\* \| — \| 4 \| 3 \| 0 \| 1 \| 0 \|/);
  assert.match(resumen.markdown, /Duración: 16,7 s/);
});

test('ci-summary: un reporte ausente se anota sin fallar', () => {
  const resumenes = [
    resumenNodeTest(undefined, '.ci/node-test.xml'),
    resumenVitest(undefined, '.ci/vitest.json'),
    resumenE2E(undefined, 'playwright-report/results.json'),
  ];
  for (const resumen of resumenes) {
    // El paso de la suite ya se puso rojo: el resumen sólo tiene que explicarlo.
    assert.equal(resumen.error, undefined);
    assert.match(resumen.markdown, /Sin datos/);
  }
});

test('ci-summary: un reporte ilegible falla en vez de mostrar una tabla vacía', () => {
  const resumen = resumenVitest('{ roto', '.ci/vitest.json');
  assert.ok(resumen.error, 'un JSON corrupto tiene que reportarse');
  assert.match(resumen.markdown, /No se pudo leer/);
});
