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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AGENT_FILE,
  C8_ATTACHMENT,
  C8_FILE,
  C8_STEPS,
  AGENT_PROJECT,
  HTML_REPORT,
  lineaResumen,
  lineasConteos,
  validarReporte,
  verificarArtifactHtml,
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
 * de C8 en los proyectos que se indiquen (uno por defecto), con los adjuntos
 * que se le pasen. Los `stats` cuadran con las filas para que un fallo del caso
 * no se confunda con un desbalance de conteos.
 */
function reporte(
  adjuntos: PlaywrightAttachment[],
  proyectosC8: string[] = [AGENT_PROJECT],
  saltadosC8: string[] = [],
  flakyEnGeneral = false
): PlaywrightReport {
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
              ...proyectosC8.map((projectName) => ({
                projectName,
                status: 'expected',
                results: [{ status: 'passed', attachments: adjuntos }],
              })),
              // `test.skip()` no borra la fila: queda con estado `skipped` y sin
              // resultados, que es lo que ve el gate en la suite real.
              ...saltadosC8.map((projectName) => ({
                projectName,
                status: 'skipped',
                results: [],
              })),
            ],
          },
        ],
      },
      // Un flaky real: la fila cuenta como ejecutada y guarda los dos intentos
      // (el que falló y el que pasó).
      ...(flakyEnGeneral
        ? [
            {
              file: 'tests/e2e/app.spec.ts',
              specs: [
                {
                  title: 'debe navegar al modo Agent desde la paleta',
                  tests: [
                    {
                      projectName: AGENT_PROJECT,
                      status: 'flaky',
                      results: [{ status: 'failed' }, { status: 'passed' }],
                    },
                  ],
                },
              ],
            },
          ]
        : []),
    ],
    stats: {
      expected: 1 + proyectosC8.length,
      skipped: saltadosC8.length,
      unexpected: 0,
      flaky: flakyEnGeneral ? 1 : 0,
    },
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

test('check:playwright-report: las filas saltadas de C8 no cuentan como ejecuciones', () => {
  // El caso se salta a propósito en firefox y mobile-chrome: contar filas, como
  // hacía la primera versión de la regla, leía el reporte de CI (#290) como «el
  // caso de C8 corre 3 veces».
  const veredicto = validarReporte(
    reporte([adjuntoC8({ steps: PASOS })], [AGENT_PROJECT], ['firefox', 'mobile-chrome'])
  );

  assert.deepEqual(veredicto.errores, []);
  assert.equal(veredicto.c8?.pasos.length, C8_STEPS);
  // Las saltadas no desaparecen: siguen siendo filas y cuentan en el resumen.
  // Son 4: el E2E del artifact, C8 en chromium y las dos saltadas.
  assert.equal(veredicto.ejecuciones, 4);
  assert.equal(veredicto.porEstado.skipped, 2);
});

test('check:playwright-report: un caso de C8 saltado en todos los proyectos falla', () => {
  const veredicto = validarReporte(
    reporte([adjuntoC8({ steps: PASOS })], [], [AGENT_PROJECT, 'firefox'])
  );

  assert.equal(veredicto.c8, undefined, 'sin ejecución no hay secuencia que citar');
  assert.match(veredicto.erroresC8.join('\n'), /no corrió en ningún proyecto/);
});

test('check:playwright-report: el caso de C8 en dos proyectos falla', () => {
  const veredicto = validarReporte(
    reporte([adjuntoC8({ steps: PASOS })], [AGENT_PROJECT, 'mobile-chrome'])
  );

  assert.equal(veredicto.c8, undefined, 'un caso duplicado no se publica como válido');
  assert.equal(veredicto.errores.length, 1, 'el duplicado es el único problema del reporte');
  assert.match(
    veredicto.errores[0],
    /el caso de C8 corre 2 veces \(chromium, mobile-chrome\)/,
    'el mensaje nombra los proyectos donde corrió'
  );
});

/** Reporte válido en un directorio temporal, para medir el HTML en disco. */
function dirDeReporte(flakyEnGeneral = false): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-gate-'));
  fs.writeFileSync(
    path.join(dir, 'results.json'),
    JSON.stringify(reporte([adjuntoC8({ steps: PASOS })], [AGENT_PROJECT], [], flakyEnGeneral)),
    'utf8'
  );
  return dir;
}

/**
 * Corre el gate como CLI sobre un reporte. Con `resumen` apunta
 * `GITHUB_STEP_SUMMARY` a un archivo temporal; sin él, el test escribiría en el
 * resumen del job que lo ejecute.
 */
function correrGate(
  dir: string,
  resumen?: string
): { code: number; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PLAYWRIGHT_JSON_PATH: path.join(dir, 'results.json'),
  };
  if (resumen) env.GITHUB_STEP_SUMMARY = resumen;
  else delete env.GITHUB_STEP_SUMMARY;
  const guion = path.join(process.cwd(), 'scripts', 'check-playwright-report.ts');
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', guion], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const fallo = error as { status?: number | null; stdout?: string; stderr?: string };
    return {
      code: fallo.status ?? 1,
      stdout: fallo.stdout ?? '',
      stderr: fallo.stderr ?? '',
    };
  }
}

test('check:playwright-report: el artifact exige un index.html no vacío', () => {
  const dir = dirDeReporte();
  try {
    // El JSON está perfecto: sin HTML el artifact igual sería inservible.
    assert.match(verificarArtifactHtml(dir)[0], /falta index\.html/);

    fs.writeFileSync(path.join(dir, HTML_REPORT), '', 'utf8');
    assert.match(verificarArtifactHtml(dir)[0], /index\.html está vacío \(0 B\)/);

    fs.writeFileSync(path.join(dir, HTML_REPORT), '<!doctype html><title>report</title>', 'utf8');
    assert.deepEqual(verificarArtifactHtml(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check:playwright-report: el CLI falla si el merge no dejó index.html', () => {
  const dir = dirDeReporte();
  try {
    const salida = correrGate(dir);
    assert.equal(salida.code, 1, 'sin HTML el job tiene que fallar');
    assert.match(salida.stderr, /1 problema\(s\)/);
    assert.match(salida.stderr, /falta index\.html/);
    // El resto del reporte está bien: el rojo es del artifact, no del adjunto.
    assert.ok(!salida.stderr.includes('c8-steps'), 'no debe culpar al adjunto');
    // La línea se publica igual: dice qué sí llegó antes de fallar.
    assert.match(salida.stdout, /5 pasos/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check:playwright-report: un flaky no tumba el gate', () => {
  const veredicto = validarReporte(
    reporte([adjuntoC8({ steps: PASOS })], [AGENT_PROJECT], [], true)
  );

  assert.deepEqual(
    veredicto.errores,
    [],
    'un test que pasó en el reintento no es un fallo del job'
  );
  assert.equal(veredicto.porEstado.flaky, 1);
});

test('check:playwright-report: los conteos del veredicto van al resumen', () => {
  const lineas = lineasConteos(
    validarReporte(reporte([adjuntoC8({ steps: PASOS })]))
  );

  assert.deepEqual(lineas, [
    '- **Ejecuciones**: 2 — expected 2, skipped 0, unexpected 0, flaky 0',
    '- **Proyectos**: chromium 2',
  ]);
  assert.ok(
    lineas.every((linea) => !linea.includes('**Flaky**')),
    'sin flaky no se agrega la línea, para no ensuciar el resumen'
  );
});

test('check:playwright-report: el flaky aparece en el resumen con los conteos', () => {
  const lineas = lineasConteos(
    validarReporte(reporte([adjuntoC8({ steps: PASOS })], [AGENT_PROJECT], [], true))
  );

  // Los conteos ya lo traen, y la línea propia lo hace legible de un vistazo.
  assert.ok(lineas[0].includes('flaky 1'), `los conteos tienen que traer el flaky: ${lineas[0]}`);
  assert.ok(
    lineas.some((linea) =>
      /^- \*\*Flaky\*\*: 1 ejecución\(es\) que pasaron en el reintento \(no tumban el gate\)$/.test(
        linea
      )
    ),
    `falta la línea de flaky: ${lineas.join(' | ')}`
  );
});

test('check:playwright-report: el CLI sale en verde con un flaky y lo publica', () => {
  const dir = dirDeReporte(true);
  const resumen = path.join(dir, 'step-summary.md');
  try {
    fs.writeFileSync(path.join(dir, HTML_REPORT), '<!doctype html><title>report</title>', 'utf8');
    const salida = correrGate(dir, resumen);
    assert.equal(salida.code, 0, `un flaky no puede tumbar el job: ${salida.stderr}`);
    assert.match(salida.stdout, /1 flaky/);

    const escrito = fs.readFileSync(resumen, 'utf8');
    assert.match(escrito, /\*\*Ejecuciones\*\*: 3 — .*flaky 1/);
    assert.match(escrito, /\*\*Flaky\*\*: 1 ejecución\(es\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check:playwright-report: el CLI publica pasos y conteos en el resumen del job', () => {
  const dir = dirDeReporte();
  const resumen = path.join(dir, 'step-summary.md');
  try {
    fs.writeFileSync(path.join(dir, HTML_REPORT), '<!doctype html><title>report</title>', 'utf8');
    const salida = correrGate(dir, resumen);
    assert.equal(salida.code, 0, `el gate tiene que pasar: ${salida.stderr}`);

    const escrito = fs.readFileSync(resumen, 'utf8');
    assert.match(escrito, /### Gate del reporte de Playwright/);
    // La secuencia del recibo y los conteos que el gate validó, en el mismo sitio.
    assert.match(escrito, /5 pasos/);
    assert.match(escrito, /\*\*Ejecuciones\*\*: 2 — expected 2, skipped 0/);
    assert.match(escrito, /\*\*Proyectos\*\*: chromium 2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check:playwright-report: con HTML y adjuntos el CLI sale en verde', () => {
  const dir = dirDeReporte();
  try {
    fs.writeFileSync(path.join(dir, HTML_REPORT), '<!doctype html><title>report</title>', 'utf8');
    const salida = correrGate(dir);
    assert.equal(salida.code, 0, `el gate tiene que pasar: ${salida.stderr}`);
    assert.match(salida.stdout, /OK: 2 ejecuciones/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
