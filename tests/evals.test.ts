/**
 * Las evaluaciones del agente corren en CI dentro de `npm run test:node`.
 *
 * Modo replay: el modelo es un guion, las herramientas son las de verdad y el
 * workspace es una copia temporal de ficheros del repo. Si una tarea deja de
 * pasar, o pasa por casualidad, se ve aquí.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { EVAL_TASKS } from '../evals/tasks.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_PORT,
  isLoopback,
  planServer,
  probeHealth,
  probePort,
  resolveBaseUrl,
} from '../evals/server.js';
import { decidePreflight, probeModel, PREFLIGHT_TIMEOUT_MS } from '../evals/preflight.js';
import {
  detectModelFallback,
  readAnsweredModel,
  LIVE_MAX_STEPS,
  LIVE_TASK_TIMEOUT_MS,
  REPLAY_MAX_STEPS,
  REPLAY_TASK_TIMEOUT_MS,
  resolveTaskBudget,
  resolveTaskSteps,
  runTask,
  summarize,
  type EvalOutcome,
  type EvalTask,
  type EvalWorkspace,
} from '../evals/harness.js';
import {
  appendRecord,
  buildRecord,
  compareRuns,
  decideRecording,
  formatComparison,
  formatHistory,
  lastRunFor,
  readRecords,
  strictScopeFailures,
  type EvalRunRecord,
} from '../evals/history.js';

for (const task of EVAL_TASKS) {
  test(`eval · ${task.id}`, async () => {
    const outcome = await runTask(task);

    assert.equal(outcome.error, undefined, `la tarea no llegó a ejecutarse: ${outcome.error}`);
    const failed = outcome.checks.filter((check) => check.error);
    const diffs = (outcome.diffs ?? [])
      .map((diff) => `  ${diff.status}: ${diff.path}\n${diff.patch}`)
      .join('\n');
    assert.deepEqual(
      failed,
      [],
      `Comprobaciones fallidas en ${task.id}:\n${failed.map((c) => `  ${c.name}: ${c.error}`).join('\n')}` +
        (diffs ? `\nCambios del agente:\n${diffs}` : '\nEl agente no cambió ningún fichero')
    );
    // Puerta de alcance: en CI, tocar fuera de lo declarado es un fallo aunque
    // los checks pasen. El veredicto de la tarea no cambia; esto es la política.
    assert.deepEqual(
      outcome.outOfScope,
      [],
      `${task.id} tocó ficheros que no declara: ${(outcome.outOfScope ?? [])
        .map((file) => `${file.path} (${file.status})`)
        .join(', ')}`
    );
  });
}

/** Tarea mínima que escribe un fichero que no declara, con un check que pasa. */
function scopeTask(extra: Partial<EvalTask> = {}): EvalTask {
  return {
    id: 'alcance',
    goal: 'demo de alcance',
    files: ['commander.json'],
    script: () => [
      {
        thought: 'Creo una nota que la tarea no pidió.',
        calls: [{ name: 'fs_write', args: { path: 'notas.txt', content: 'hola' } }],
      },
    ],
    checks: [
      {
        name: 'el fichero declarado sigue ahí',
        run: (ctx) => {
          assert.ok(ctx.read('commander.json').includes('"version"'));
        },
      },
    ],
    ...extra,
  };
}

test('alcance · tocar ficheros no declarados marca sospechosa aunque los checks pasen', async () => {
  const outcome = await runTask(scopeTask());

  assert.equal(outcome.passed, true, 'la sospecha no cambia el veredicto de los checks');
  assert.deepEqual(outcome.outOfScope, [{ path: 'notas.txt', status: 'nuevo' }]);
});

test('alcance estricto · la sospecha sólo falla cuando se activa', () => {
  const outcome = (overrides: Partial<EvalOutcome>): EvalOutcome => ({
    id: 't',
    passed: true,
    steps: 0,
    durationMs: 0,
    checks: [],
    ...overrides,
  });

  const clean = outcome({ outOfScope: [] });
  const suspicious = outcome({ outOfScope: [{ path: 'sobra.txt', status: 'nuevo' }] });

  assert.deepEqual(summarize([clean]), { passed: 1, total: 1, suspicious: 0, failed: false });
  assert.equal(summarize([suspicious]).failed, false, 'sin modo estricto la sospecha es sólo un aviso');
  assert.equal(summarize([suspicious], { strictScope: true }).failed, true);
  assert.equal(summarize([suspicious], { strictScope: true }).suspicious, 1);
  assert.equal(
    summarize([outcome({ passed: false })], { strictScope: true }).failed,
    true,
    'un check roto falla con o sin modo estricto'
  );
});

test('require-model · una pasada con modelo sustituido no cuenta como medida', () => {
  const substituted = {
    id: 't',
    passed: true,
    steps: 0,
    durationMs: 0,
    checks: [],
    modelFallback: { from: 'gemini-3.5-flash', to: 'gemini-3.5-flash-lite' },
  };

  assert.equal(summarize([substituted]).failed, false, 'por defecto sólo se avisa');
  assert.equal(summarize([substituted], { requireModel: true }).failed, true);
  assert.equal(summarize([{ ...substituted, modelFallback: undefined }], { requireModel: true }).failed, false);
});

test('alcance · allowChanges declara la ruta prevista y deja de marcar', async () => {
  const outcome = await runTask(scopeTask({ allowChanges: ['notas.txt'] }));

  assert.equal(outcome.passed, true);
  assert.deepEqual(outcome.outOfScope, []);
});

test('diagnóstico · una tarea fallida trae el diff de lo que cambió el agente', async () => {
  const base = EVAL_TASKS.find((task) => task.id === 'pipeline-agujereado')!;
  // Arreglo a medias: sólo la regla de $(). La etapa vacía debe seguir fallando.
  const partial = {
    ...base,
    script: (ws: EvalWorkspace) => {
      const turns = base.script(ws);
      return [turns[0], turns[1]];
    },
  };

  const outcome = await runTask(partial);

  assert.equal(outcome.passed, false, 'un arreglo parcial no debe darse por bueno');
  assert.deepEqual(
    (outcome.diffs ?? []).filter((entry) => entry.path.startsWith('.commander')),
    [],
    'los checkpoints que la app escribe en el workspace no son cambios del agente'
  );
  const diff = outcome.diffs?.find((entry) => entry.path.endsWith('shellCommand.ts'));
  assert.ok(diff, 'una tarea fallida debe traer el diff del fichero que tocó');
  assert.equal(diff.status, 'modificado');
  assert.match(diff.patch, /^--- src\/agent\/shellCommand\.ts$/m);
  assert.match(diff.patch, /^\+\+\+ src\/agent\/shellCommand\.ts$/m);
  // Se compara por fragmento y no con regex: la línea lleva `\$` y `\(`, y
  // escapar eso en un literal esconde justo el error que la prueba busca.
  const addedRule = diff.patch
    .split('\n')
    .find((line) => line.startsWith('+') && line.includes(String.raw`\$\(`));
  assert.ok(addedRule, `el diff debe mostrar la regla restaurada:\n${diff.patch}`);
  assert.ok(addedRule.includes(String.raw`\$\{`), 'la regla restaurada debe seguir cubriendo ${}');
});

test('diagnóstico · una tarea que sólo lee deja la lista de cambios vacía', async () => {
  const base = EVAL_TASKS.find((task) => task.id === 'pipeline-agujereado')!;
  const outcome = await runTask({ ...base, script: (ws: EvalWorkspace) => [base.script(ws)[0]] });

  assert.equal(outcome.passed, false);
  assert.deepEqual(outcome.diffs, [], 'sin ediciones no hay nada que diagnosticar');
});

/**
 * Historial live: se prueba sobre un fichero temporal para no ensuciar
 * `evals/results.jsonl`, que está versionado.
 */
function record(
  overrides: Partial<EvalRunRecord> & { tasks: EvalRunRecord['tasks'] }
): EvalRunRecord {
  const passed = overrides.tasks.filter((task) => task.passed).length;
  return {
    ts: '2026-10-28T10:00:00.000Z',
    commit: 'abc1234',
    dirty: false,
    model: 'modelo-x',
    mode: 'live',
    passed,
    total: overrides.tasks.length,
    durationMs: 1000,
    ...overrides,
  };
}

test('historial · escribe y relee pasadas, ignorando líneas corruptas', () => {
  const dir = path.join(process.cwd(), 'tests', 'tmp-evals-history');
  const file = path.join(dir, 'results.jsonl');
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    appendRecord(record({ tasks: [{ id: 'a', passed: true, failedChecks: [] }] }), file);
    appendRecord(
      record({ commit: 'def5678', tasks: [{ id: 'a', passed: false, failedChecks: ['existe'] }] }),
      file
    );
    // Simula un corte a mitad de escritura.
    fs.appendFileSync(file, '{"ts":"2026-10-28T11:00:00.000Z","tas');

    const records = readRecords(file);
    assert.equal(records.length, 2, 'la línea corrupta no debe tirar el historial');
    assert.equal(records[1].commit, 'def5678');
    assert.equal(records[1].tasks[0].failedChecks[0], 'existe');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('historial · lastRunFor usa la última pasada del mismo modelo y modo', () => {
  const base = [{ id: 'a', passed: true, failedChecks: [] }];
  const records = [
    record({ ts: '2026-10-28T09:00:00.000Z', model: 'modelo-x', tasks: base }),
    record({ ts: '2026-10-28T10:00:00.000Z', model: 'modelo-y', tasks: base }),
    record({ ts: '2026-10-28T11:00:00.000Z', model: 'modelo-x', mode: 'replay', tasks: base }),
    record({ ts: '2026-10-28T08:00:00.000Z', model: 'modelo-x', tasks: base }),
  ];

  assert.equal(lastRunFor(records, 'modelo-x')?.ts, '2026-10-28T09:00:00.000Z');
  assert.equal(lastRunFor(records, 'modelo-z'), null);
});

test('historial · la comparación señala qué tarea se rompió', () => {
  const prev = record({
    tasks: [
      { id: 'lectura', passed: true, failedChecks: [] },
      { id: 'edicion', passed: true, failedChecks: [] },
      { id: 'peligro', passed: false, failedChecks: ['canario intacto'] },
    ],
  });
  const next = record({
    tasks: [
      { id: 'lectura', passed: true, failedChecks: [] },
      {
        id: 'edicion',
        passed: false,
        failedChecks: ['el archivo no se reformateó'],
        changedFiles: [{ path: 'src/agent/contextBudget.ts', status: 'modificado' }],
      },
      { id: 'peligro', passed: true, failedChecks: [] },
      {
        id: 'nueva',
        passed: false,
        failedChecks: ['algo'],
        changedFiles: [],
        outOfScope: [{ path: 'sobra.txt', status: 'nuevo' }],
      },
    ],
  });

  const delta = compareRuns(prev, next);
  assert.deepEqual(delta.broken, ['edicion']);
  assert.deepEqual(delta.fixed, ['peligro']);
  assert.deepEqual(delta.added, ['nueva']);
  assert.deepEqual(delta.stillFailing, []);
  assert.equal(delta.totalDelta, 0, '2/3 → 2/4: misma cuenta aunque cambie el total');

  const lines = formatComparison(prev, next).join('\n');
  assert.match(lines, /↓ edicion — el archivo no se reformateó/);
  assert.match(lines, /\[tocó: src\/agent\/contextBudget\.ts \(modificado\)\]/);
  assert.match(lines, /↑ peligro/);
  assert.match(lines, /\+ nuevas: nueva/);
  assert.match(lines, /⚠ fuera de alcance: nueva \(sobra\.txt\)/);
});

test('historial · las tareas fallidas guardan qué tocó el agente; las que pasan no', () => {
  const recordBuilt = buildRecord(
    [
      {
        id: 'bien',
        passed: true,
        steps: 1,
        durationMs: 1,
        checks: [],
        diffs: [{ path: 'src/a.ts', status: 'modificado', patch: '…' }],
      },
      {
        id: 'mal',
        passed: false,
        steps: 1,
        durationMs: 1,
        checks: [{ name: 'algo', error: 'boom' }],
        diffs: [
          { path: 'src/b.ts', status: 'modificado', patch: '…' },
          { path: 'notas.txt', status: 'nuevo', patch: '…' },
        ],
      },
    ],
    { model: 'modelo-x', mode: 'live', commit: 'abc1234', dirty: false }
  );

  assert.equal(recordBuilt.tasks[0].changedFiles, undefined, 'una tarea que pasa no engorda el historial');
  assert.deepEqual(recordBuilt.tasks[1].changedFiles, [
    { path: 'src/b.ts', status: 'modificado' },
    { path: 'notas.txt', status: 'nuevo' },
  ]);
});

test('historial · el diagnóstico distingue "sin cambios" de "no se sabía"', () => {
  const prev = record({
    tasks: [
      { id: 'a', passed: true, failedChecks: [] },
      { id: 'b', passed: true, failedChecks: [] },
    ],
  });
  const next = record({
    tasks: [
      { id: 'a', passed: false, failedChecks: ['x'], changedFiles: [] },
      // Registro anterior a este campo: no hay diagnóstico que mostrar.
      { id: 'b', passed: false, failedChecks: ['x'] },
    ],
  });

  const lines = formatComparison(prev, next).join('\n');
  assert.match(lines, /↓ a — x \[sin cambios\]/);
  assert.match(lines, /↓ b — x$/m, 'un registro antiguo no debe inventarse un diagnóstico');
});

test('historial · los errores guardados no llevan rutas absolutas', () => {
  const recordBuilt = buildRecord(
    [
      {
        id: 'x',
        passed: false,
        steps: 0,
        durationMs: 1,
        checks: [],
        error: `ENOENT: ${process.cwd()}/tests/tmp-evals/x/commander.json`,
      },
    ],
    { model: 'modelo-x', mode: 'live', commit: 'abc1234', dirty: false }
  );

  assert.equal(recordBuilt.tasks[0].error, 'ENOENT: ./tests/tmp-evals/x/commander.json');
});

test('presupuesto · live tiene más pasos que replay, y la tarea manda', () => {
  assert.equal(resolveTaskSteps({}), REPLAY_MAX_STEPS);
  assert.equal(resolveTaskSteps({ live: true }), LIVE_MAX_STEPS);
  assert.ok(
    LIVE_MAX_STEPS > REPLAY_MAX_STEPS,
    'con 10 pasos un modelo real gasta tres tools en buscar y se queda sin editar'
  );
  assert.equal(resolveTaskSteps({ live: true, maxSteps: 4 }), 4, 'lo que declare la tarea gana');
  assert.equal(resolveTaskSteps({ live: true, maxSteps: 0 }), LIVE_MAX_STEPS);
});

test('presupuesto · live tiene más margen por tarea que replay', () => {
  assert.equal(resolveTaskBudget({}), REPLAY_TASK_TIMEOUT_MS);
  assert.equal(resolveTaskBudget({ live: false }), REPLAY_TASK_TIMEOUT_MS);
  assert.equal(
    resolveTaskBudget({ live: true }),
    LIVE_TASK_TIMEOUT_MS,
    'con el tope de replay ninguna tarea live llega a empezar'
  );
  assert.ok(LIVE_TASK_TIMEOUT_MS > REPLAY_TASK_TIMEOUT_MS);
  assert.equal(resolveTaskBudget({ live: true, timeoutMs: 1_000 }), 1_000);
  assert.equal(resolveTaskBudget({ live: true, timeoutMs: Number.NaN }), LIVE_TASK_TIMEOUT_MS);
});

test('servidor live · la URL objetivo respeta EVAL_BASE_URL, EVAL_PORT y el puerto por defecto', () => {
  assert.equal(DEFAULT_BASE_URL, `http://127.0.0.1:${DEFAULT_PORT}`);
  assert.equal(resolveBaseUrl({}), DEFAULT_BASE_URL);
  assert.equal(resolveBaseUrl({ EVAL_PORT: '4100' }), 'http://127.0.0.1:4100');
  assert.equal(resolveBaseUrl({ PORT: '4200' }), 'http://127.0.0.1:4200');
  assert.equal(
    resolveBaseUrl({ EVAL_PORT: '4100', PORT: '4200' }),
    'http://127.0.0.1:4100',
    'EVAL_PORT es más específico que el PORT del servidor'
  );
  assert.equal(
    resolveBaseUrl({ EVAL_BASE_URL: 'http://127.0.0.1:5000/' }),
    'http://127.0.0.1:5000',
    'una URL explícita manda y se le quita la barra final'
  );
  assert.equal(resolveBaseUrl({ EVAL_PORT: 'no-es-un-numero' }), DEFAULT_BASE_URL);
});

test('servidor live · sólo se arranca uno propio si la URL es loopback', () => {
  assert.equal(isLoopback('http://localhost:3280'), true);
  assert.equal(isLoopback('http://127.0.0.1:3280'), true);
  assert.equal(isLoopback('http://[::1]:3280'), true);
  assert.equal(isLoopback('https://eval.example.com'), false);
  assert.equal(isLoopback('no es una url'), false);

  const local = 'http://127.0.0.1:3280';
  assert.equal(planServer({ baseUrl: local, alive: true, portOpen: true }).action, 'reuse');
  assert.equal(
    planServer({ baseUrl: local, alive: false, portOpen: true }).action,
    'reuse',
    'un servidor ocupado (Vite optimizando) escucha pero no contesta: no se arranca otro'
  );
  assert.equal(planServer({ baseUrl: local, alive: false, portOpen: false }).action, 'start');

  const remote = planServer({ baseUrl: 'https://eval.example.com', alive: false, portOpen: false });
  assert.equal(remote.action, 'error', 'arrancar algo local no haría responder una URL remota');
  assert.match(remote.action === 'error' ? remote.error : '', /no es loopback/);
});

test('servidor live · la sonda distingue un servidor vivo de un puerto cerrado', async () => {
  const server = http.createServer((req, res) => {
    const ok = req.url?.startsWith('/api/health') ?? false;
    res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: ok ? 'ok' : 'no' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    assert.equal(await probeHealth(`http://127.0.0.1:${port}`), true);
    assert.equal(await probePort(`http://127.0.0.1:${port}`), true, 'el puerto sí escucha');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  // Puerto recién liberado: las sondas fallan rápido en vez de colgar la pasada.
  assert.equal(await probeHealth(`http://127.0.0.1:${port}`, 500), false);
  assert.equal(await probePort(`http://127.0.0.1:${port}`, 500), false);
});

// ---- Comprobación previa del modelo (antes de gastar las cinco tareas) ----

/** `fetch` falso que devuelve lo que se le diga, sin abrir ningún puerto. */
function stubFetch(status: number, body: any) {
  const calls: any[] = [];
  const urls: string[] = [];
  const impl = (async (url: string, init: any) => {
    urls.push(url);
    calls.push(JSON.parse(init?.body ?? '{}'));
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 503 ? 'Service Unavailable' : 'OK',
      json: async () => body,
    } as any;
  }) as unknown as typeof fetch;
  return { impl, calls, urls };
}

test('preflight · sin sustitución deja pasar la pasada', () => {
  const decision = decidePreflight(
    { status: 'ok', model: 'gemini-3.5-flash' },
    { model: 'gemini-3.5-flash' }
  );
  assert.equal(decision.proceed, true);
  assert.match(decision.lines.join('\n'), /responde en la comprobación previa/);
});

test('preflight · si contestaría otro modelo, aborta antes de gastar las tareas', () => {
  const probe = {
    status: 'substituted' as const,
    fallback: { from: 'gemini-3.5-flash', to: 'gemini-3.5-flash-lite' },
  };
  const decision = decidePreflight(probe, { model: 'gemini-3.5-flash' });
  const text = decision.lines.join('\n');

  assert.equal(decision.proceed, false, 'no se deben lanzar cinco tareas que no miden el modelo pedido');
  assert.match(text, /gemini-3\.5-flash no responde; contestaría gemini-3\.5-flash-lite/);
  assert.match(text, /no se registraría/);
  assert.match(text, /--allow-fallback/, 'dice cómo medir el sustituto a sabiendas');
});

test('preflight · --allow-fallback deja medir el sustituto, avisando de que no se registra', () => {
  const decision = decidePreflight(
    { status: 'substituted', fallback: { from: 'a', to: 'b' } },
    { model: 'a', allowFallback: true }
  );
  assert.equal(decision.proceed, true);
  assert.match(decision.lines.join('\n'), /no se registrará/);
});

test('preflight · sin respuesta no hay nada que medir, ni con --allow-fallback', () => {
  const decision = decidePreflight(
    { status: 'failed', error: 'HTTP 503: GEMINI_API_KEY requerida' },
    { model: 'gemini-3.5-flash', allowFallback: true }
  );
  const text = decision.lines.join('\n');
  assert.equal(decision.proceed, false);
  assert.match(text, /GEMINI_API_KEY requerida/, 'el motivo real llega al usuario');
  assert.match(text, /EVAL_BASE_URL/);
});

test('preflight · la sonda pregunta por el modelo pedido con una llamada mínima', async () => {
  const { impl, calls } = stubFetch(200, {
    success: true,
    text: 'ok',
    model: 'gemini-3.5-flash',
    requestedModel: 'gemini-3.5-flash',
    fallback: null,
  });

  const probe = await probeModel({ baseUrl: 'http://127.0.0.1:9', model: 'gemini-3.5-flash', fetchImpl: impl });

  assert.equal(probe.status, 'ok');
  assert.equal(probe.model, 'gemini-3.5-flash');
  assert.equal(calls.length, 1, 'una sola llamada: la comprobación no puede costar una pasada');
  assert.equal(calls[0].model, 'gemini-3.5-flash');
  assert.ok(calls[0].maxTokens <= 16, 'la sonda no pide una respuesta larga');
  assert.equal(calls[0].fallbackModels, undefined, 'deja hablar a la cadena configurada, como las tareas');
});

test('preflight · la sonda puede probar un solo modelo, sin cadena de respaldo', async () => {
  const { impl, calls, urls } = stubFetch(200, { success: true, model: 'gemini-3.5-flash', fallback: null });

  // Igual que la llama el botón del panel: mismo origen y sin respaldo, para
  // que un «✓» no pueda significar «respondió otro».
  const probe = await probeModel({
    baseUrl: '',
    model: 'gemini-3.5-flash',
    disableFallback: true,
    fetchImpl: impl,
  });

  assert.equal(probe.status, 'ok');
  assert.deepEqual(calls[0].fallbackModels, [], 'sin respaldo: el fallo se ve como fallo');
  assert.equal(urls[0], '/api/gemini/generate', 'mismo endpoint que el chat');
});

test('preflight · la sonda lee la sustitución que declara el servidor', async () => {
  const { impl } = stubFetch(200, {
    success: true,
    model: 'gemini-3.5-flash-lite',
    fallback: { from: 'gemini-3.5-flash', to: 'gemini-3.5-flash-lite' },
  });
  const probe = await probeModel({ baseUrl: 'http://127.0.0.1:9', model: 'gemini-3.5-flash', fetchImpl: impl });
  assert.deepEqual(probe, {
    status: 'substituted',
    fallback: { from: 'gemini-3.5-flash', to: 'gemini-3.5-flash-lite' },
    model: 'gemini-3.5-flash-lite',
  });
});

test('preflight · un error del servidor se lee, no se toma por una pasada válida', async () => {
  const { impl } = stubFetch(503, { success: false, error: 'Ningún modelo de la cadena respondió' });
  const probe = await probeModel({ baseUrl: 'http://127.0.0.1:9', model: 'gemini-3.5-flash', fetchImpl: impl });
  assert.equal(probe.status, 'failed');
  assert.match(probe.error ?? '', /HTTP 503: Ningún modelo de la cadena respondió/);
});

test('preflight · un fallo de red no lanza: es un resultado con motivo', async () => {
  const impl = (async () => {
    throw new Error('ECONNREFUSED 127.0.0.1:3280');
  }) as unknown as typeof fetch;
  const probe = await probeModel({ baseUrl: 'http://127.0.0.1:9', model: 'gemini-3.5-flash', fetchImpl: impl });
  assert.equal(probe.status, 'failed');
  assert.match(probe.error ?? '', /ECONNREFUSED/);

  const slow = (async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }) as unknown as typeof fetch;
  const timedOut = await probeModel({
    baseUrl: 'http://127.0.0.1:9',
    model: 'gemini-3.5-flash',
    fetchImpl: slow,
    timeoutMs: 5,
  });
  assert.match(timedOut.error ?? '', /sin respuesta en/);
  assert.ok(PREFLIGHT_TIMEOUT_MS >= 10_000, 'el tope por defecto tolera un modelo lento');
});

test('modelo · una respuesta de otro modelo no se atribuye al pedido', () => {
  const steps = [
    { id: '1', type: 'thought', title: 'Inicio', content: 'Objetivo: x', status: 'completed', ts: 0 },
    {
      id: '2',
      type: 'thought',
      title: 'Razonamiento',
      content:
        '⚡ *[Aviso: gemini-3.5-flash no respondió (cuota agotada o modelo retirado). Respuesta generada con gemini-3.5-flash-lite]*',
      status: 'completed',
      ts: 0,
    },
  ] as any[];

  assert.deepEqual(detectModelFallback(steps), { from: 'gemini-3.5-flash', to: 'gemini-3.5-flash-lite' });
  assert.deepEqual(
    detectModelFallback([
      {
        id: '4',
        type: 'thought',
        title: 'Modelo sustituido',
        content: 'gemini-3.5-flash no respondió; respondió gemini-3.5-flash-lite',
        status: 'completed',
        ts: 0,
      },
    ] as any[]),
    { from: 'gemini-3.5-flash', to: 'gemini-3.5-flash-lite' },
    'el paso estructurado se lee sin depender del texto del aviso'
  );
  assert.equal(detectModelFallback([]), null, 'sin aviso no hay sustitución que declarar');
  assert.equal(
    detectModelFallback([{ id: '3', type: 'thought', title: 'Razonamiento', content: 'todo normal', status: 'completed', ts: 0 }] as any[]),
    null
  );

  const built = buildRecord(
    [
      {
        id: 'x',
        passed: false,
        steps: 2,
        durationMs: 1,
        checks: [],
        modelFallback: { from: 'gemini-3.5-flash', to: 'gemini-3.5-flash-lite' },
      },
    ],
    { model: 'gemini-3.5-flash', mode: 'live', commit: 'abc1234', dirty: false }
  );
  assert.deepEqual(built.modelFallback, { from: 'gemini-3.5-flash', to: 'gemini-3.5-flash-lite' });
  assert.match(formatHistory([built])[0], /⚠ sustituido: gemini-3\.5-flash-lite/);
});

// ---- Quién contestó realmente en cada pasada ----

test('modelo que respondió · se lee de la respuesta del servidor, no del aviso', () => {
  assert.equal(readAnsweredModel({ model: 'gemini-3.5-flash' }), 'gemini-3.5-flash');
  assert.equal(readAnsweredModel({ model: '  gemini-3.6-flash  ' }), 'gemini-3.6-flash', 'sin espacios');
  assert.equal(readAnsweredModel({ model: '' }), null, 'vacío no es un modelo');
  assert.equal(readAnsweredModel({ model: 42 }), null);
  assert.equal(readAnsweredModel({}), null, 'una respuesta sin modelo no inventa uno');
  assert.equal(readAnsweredModel(null), null);
});

test('historial · la pasada guarda los modelos que contestaron, sin repetidos', () => {
  const built = buildRecord(
    [
      { id: 'a', passed: true, steps: 1, durationMs: 1, checks: [], answeredModels: ['m-b', 'm-a'] },
      { id: 'b', passed: true, steps: 1, durationMs: 1, checks: [], answeredModels: ['m-a'] },
    ],
    { model: 'm-a', mode: 'live', commit: 'abc1234', dirty: false }
  );

  assert.deepEqual(built.answeredModels, ['m-a', 'm-b'], 'unión ordenada de toda la pasada');
});

test('historial · sin datos de quién contestó no se escribe el campo', () => {
  const built = buildRecord(
    [{ id: 'a', passed: true, steps: 1, durationMs: 1, checks: [] }],
    { model: 'm-a', mode: 'live', commit: 'abc1234', dirty: false }
  );
  assert.equal('answeredModels' in built, false, 'los registros viejos siguen sin el campo');
});

test('historial · sólo se avisa cuando respondió otro modelo', () => {
  const tasks = [{ id: 'a', passed: true, failedChecks: [] }];

  const same = formatHistory([record({ tasks, model: 'm-a', answeredModels: ['m-a'] })])[0];
  assert.doesNotMatch(same, /respondió/, 'repetir el modelo pedido en cada línea es ruido');

  const other = formatHistory([record({ tasks, model: 'm-a', answeredModels: ['m-b'] })])[0];
  assert.match(other, /· respondió: m-b/, 'si contestó otro, queda escrito');

  const mixed = formatHistory([record({ tasks, model: 'm-a', answeredModels: ['m-a', 'm-b'] })])[0];
  assert.match(mixed, /⚠ respondió: m-a, m-b/, 'varios modelos en una pasada es una señal de alarma');

  const substituted = formatHistory([
    record({
      tasks,
      model: 'm-a',
      answeredModels: ['m-b'],
      modelFallback: { from: 'm-a', to: 'm-b' },
    }),
  ])[0];
  assert.match(substituted, /⚠ sustituido: m-b/);
  assert.doesNotMatch(substituted, /respondió/, 'con sustitución declarada no se duplica el aviso');
});

test('historial · la comparación dice si entre pasadas cambió quién contestaba', () => {
  const tasks = [{ id: 'a', passed: true, failedChecks: [] }];
  const prev = record({ tasks, model: 'm-a', answeredModels: ['m-a'] });
  const next = record({ tasks, model: 'm-a', answeredModels: ['m-b'] });

  assert.match(
    formatComparison(prev, next).join('\n'),
    /modelo que respondió: antes m-a · ahora m-b/,
    'mismo resultado con otro modelo no es la misma medida'
  );

  const sameModel = formatComparison(prev, record({ tasks, model: 'm-a', answeredModels: ['m-a'] }));
  assert.doesNotMatch(sameModel.join('\n'), /modelo que respondió/, 'sin cambio no hay línea');

  // Un registro antiguo no sabía quién contestó: no se inventa una diferencia.
  const legacy = formatComparison(record({ tasks, model: 'm-a' }), next);
  assert.doesNotMatch(legacy.join('\n'), /modelo que respondió/);
});

test('historial · una pasada live con modelo sustituido no se registra', () => {
  const fallback = { from: 'gemini-3.5-flash', to: 'gemini-3.5-flash-lite' };

  const skipped = decideRecording({ live: true, fallback });
  assert.equal(skipped.record, false, 'guardarla contaminaría la línea base del modelo pedido');
  assert.match(String(skipped.reason), /no midió el modelo pedido/);
  assert.match(String(skipped.reason), /gemini-3\.5-flash-lite/, 'el motivo dice quién contestó');

  assert.equal(
    decideRecording({ live: true }).record,
    true,
    'sin sustitución la pasada sí se mide y se guarda'
  );
  assert.equal(decideRecording({ live: true, fallback: null }).record, true, 'sin aviso no hay motivo');
});

test('historial · lo que no se registra por otras razones no culpa al modelo', () => {
  // Replay y `--only` ya se saltaban el historial: el motivo no debe hablar de
  // sustitución, porque el runner sólo enseña el motivo en ese caso.
  assert.equal(decideRecording({ live: false }).record, false);
  assert.doesNotMatch(String(decideRecording({ live: false }).reason), /modelo pedido/);
  assert.equal(decideRecording({ live: true, only: true }).record, false);
  assert.match(String(decideRecording({ live: true, only: true }).reason), /--only/);
  assert.equal(decideRecording({ live: true, noRecord: true }).record, false);
  assert.match(String(decideRecording({ live: true, noRecord: true }).reason), /EVAL_NO_RECORD/);
});

test('historial · el modo estricto sólo se escribe cuando se usó', () => {
  const outcomes: EvalOutcome[] = [
    { id: 'a', passed: true, steps: 1, durationMs: 1, checks: [] },
  ];
  const meta = { model: 'modelo-x', mode: 'live' as const, commit: 'abc1234', dirty: false };

  assert.equal(buildRecord(outcomes, meta).strictScope, undefined, 'sin flag no se inventa el modo');
  assert.equal(buildRecord(outcomes, meta).dirty, false);
  assert.equal(buildRecord(outcomes, { ...meta, strictScope: true }).strictScope, true);
});

test('historial · una pasada estricta roja por alcance se distingue al consultarla', () => {
  const strict = record({
    strictScope: true,
    tasks: [
      { id: 'limpia', passed: true, failedChecks: [] },
      { id: 'sospecha', passed: true, failedChecks: [], outOfScope: [{ path: 'sobra.txt', status: 'nuevo' }] },
    ],
  });

  // Sólo cuenta lo que el estricto añade: una tarea con checks rotos ya era roja.
  assert.deepEqual(strictScopeFailures(strict), ['sospecha']);
  assert.deepEqual(
    strictScopeFailures(record({ tasks: strict.tasks })),
    [],
    'sin el flag, el alcance no ponía la pasada en rojo'
  );

  const line = formatHistory([strict])[0];
  assert.match(line, /· estricto/);
  assert.match(line, /✖ alcance: sospecha/);
  assert.doesNotMatch(formatHistory([record({ tasks: strict.tasks })])[0], /alcance/);
});

test('historial · la comparación no borra el rojo estricto de la pasada anterior', () => {
  const tasks: EvalRunRecord['tasks'] = [
    { id: 'lectura', passed: true, failedChecks: [] },
    { id: 'sospecha', passed: true, failedChecks: [], outOfScope: [{ path: 'sobra.txt', status: 'nuevo' }] },
  ];
  const prev = record({ strictScope: true, tasks });
  // Misma medición repetida sin el flag: mismo veredicto por tarea, pero la
  // pasada anterior estaba en rojo y eso tiene que seguir leyéndose.
  const next = record({ tasks });

  const lines = formatComparison(prev, next).join('\n');
  assert.match(lines, /igual/);
  assert.match(lines, /la pasada anterior era estricta y falló por alcance: sospecha/);
});

test('historial · sin cambios de veredicto lo dice explícitamente', () => {
  const tasks = [{ id: 'a', passed: true, failedChecks: [] }];
  const lines = formatComparison(record({ tasks }), record({ tasks })).join('\n');
  assert.match(lines, /sin cambios por tarea/);
  assert.match(lines, /igual/);
});
