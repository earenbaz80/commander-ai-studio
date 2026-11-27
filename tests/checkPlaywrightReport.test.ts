/**
 * El gate del reporte fusionado es lo que convierte el artifact de Playwright en
 * una garantía: si `merge-reports` pierde una pieza o el adjunto de C8 llega
 * recortado, el job tiene que fallar. Estos casos fijan esa orilla sobre
 * `validarReporte` y la línea que se publica en el resumen del job.
 *
 * El fixture imita la forma real del `results.json` fusionado: el adjunto de C8
 * viaja como `body` en base64 (así lo embebe `merge-reports`) dentro del caso de
 * dos dispositivos, que vive en su propio spec. Los cinco pasos son los del
 * recibo G2; el caso de 4 pasos es el que delataría una secuencia recortada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_FILE,
  C8_ATTACHMENT,
  C8_FILE,
  C8_STEPS,
  AGENT_PROJECT,
  lineaResumen,
  validarReporte,
  type PlaywrightAttachment,
  type PlaywrightReport,
} from '../scripts/check-playwright-report';

/** Inicio > fs.read > fs.write > Razonamiento > Finalizado. */
const PASOS = [
  'thought:Inicio',
  'tool_result:fs.read(fs.read)',
  'tool_result:fs.write(fs.write)',
  'thought:Razonamiento',
  'thought:Finalizado',
];

function adjuntoC8(datos: Record<string, unknown>): PlaywrightAttachment {
  return {
    name: C8_ATTACHMENT,
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(datos), 'utf8').toString('base64'),
  };
}

/**
 * Reporte mínimo que el gate acepta: el E2E del artifact en Chromium y el caso
 * de C8 en el mismo proyecto, con los adjuntos que se le pasen. Los `stats`
 * cuadran con las dos filas para que un fallo del caso no se confunda con un
 * desbalance de conteos.
 */
function reporte(adjuntos: PlaywrightAttachment[]): PlaywrightReport {
  return {
    suites: [
      {
        file: `tests/e2e/${AGENT_FILE}`,
        specs: [
          {
            title: 'crea el artifact desde shell.run y lo conserva al recargar',
            tests: [{ projectName: AGENT_PROJECT, status: 'expected' }],
          },
        ],
      },
      {
        file: `tests/e2e/${C8_FILE}`,
        specs: [
          {
            title: 'C8 · dos dispositivos sobre la misma sesión',
            tests: [
              {
                projectName: AGENT_PROJECT,
                status: 'expected',
                results: [{ status: 'passed', attachments: adjuntos }],
              },
            ],
          },
        ],
      },
    ],
    stats: { expected: 2, skipped: 0, unexpected: 0, flaky: 0 },
  };
}

test('check:playwright-report: el adjunto completo deja el veredicto sin problemas', () => {
  const veredicto = validarReporte(
    reporte([
      adjuntoC8({
        desktopId: 'sess_1',
        mobileId: 'sess_1',
        approvedBy: 'dev_1',
        steps: PASOS,
      }),
    ])
  );

  assert.deepEqual(veredicto.errores, []);
  assert.equal(veredicto.c8?.pasos.length, C8_STEPS);
  // El `body` embebido manda: el gate no depende de dónde viva el reporte.
  assert.equal(veredicto.c8?.origen, 'body embebido');
});

test('check:playwright-report: un adjunto con 4 pasos falla y dice cuántos espera', () => {
  const veredicto = validarReporte(
    reporte([adjuntoC8({ steps: PASOS.slice(0, 4) })])
  );

  assert.equal(veredicto.c8, undefined, 'una secuencia corta no se publica como válida');
  assert.match(
    veredicto.erroresC8.join('\n'),
    new RegExp(`trae 4 paso\\(s\\), se esperan ${C8_STEPS}`)
  );
  assert.ok(
    veredicto.errores.some((error) => error.includes('trae 4 paso(s)')),
    'el problema del adjunto tiene que llegar a los errores del gate'
  );
});

test('check:playwright-report: un caso de C8 sin el adjunto c8-steps falla', () => {
  const veredicto = validarReporte(reporte([]));

  assert.equal(veredicto.c8, undefined);
  assert.match(
    veredicto.erroresC8.join('\n'),
    new RegExp(`el caso de C8 no adjunta ${C8_ATTACHMENT}`)
  );
});

test('check:playwright-report: un adjunto sin el arreglo steps falla', () => {
  const veredicto = validarReporte(
    reporte([
      // El sobre real de C8 sin la secuencia: ids y quién aprobó, nada más.
      adjuntoC8({ desktopId: 'sess_1', mobileId: 'sess_1', approvedBy: 'dev_1' }),
    ])
  );

  assert.equal(veredicto.c8, undefined);
  assert.match(veredicto.erroresC8.join('\n'), /no trae un arreglo `steps`/);
});

test('check:playwright-report: la línea del resumen trae los 5 pasos en orden', () => {
  const linea = lineaResumen(validarReporte(reporte([adjuntoC8({ steps: PASOS })])));

  assert.equal(
    linea,
    `- **C8 · \`${C8_ATTACHMENT}\`**: ${C8_STEPS} pasos — ${PASOS.join(' > ')} (body embebido)`
  );
});

test('check:playwright-report: sin secuencia válida la línea publica el motivo, no pasos inventados', () => {
  const linea = lineaResumen(
    validarReporte(reporte([adjuntoC8({ steps: PASOS.slice(0, 4) })]))
  );

  assert.match(linea, /trae 4 paso\(s\), se esperan 5/);
  assert.ok(!linea.includes(' > '), 'no debe armar una secuencia con los pasos que faltan');
});
