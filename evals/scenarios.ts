/**
 * Escenarios de producto de la línea base F0: T6, T7, T9 y T10.
 *
 * A diferencia de `runTask`, estos escenarios no ejecutan el bucle en el
 * proceso del runner:
 *
 *   • T6/T9/T10 usan las sesiones autoritativas del servidor, que es donde
 *     viven browser, `--resume` y `spawn_agents`.
 *   • T7 usa el publicador local (`/api/publish/*`) sobre una copia de
 *     `examples/vite-static`, sin depender de Vercel.
 *
 * El modelo se puede sustituir por `evals/scriptedProvider.ts` para probar la
 * maquinaria; la baseline le pasa el modelo real. Ningún escenario inventa un
 * resultado: si falta un paso, la comprobación falla con el estado observado.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import type { AgentStep } from '../src/agent/types.js';
import {
  EVAL_ROOT,
  detectModelFallback,
  resolveTaskBudget,
  type EvalCheck,
  type EvalOutcome,
  type EvalStopReason,
} from './harness.js';

export interface ScenarioOptions {
  /** Servidor real de la app (sesiones, browser, publish). */
  baseUrl: string;
  /** Modelo que usará la sesión; en pruebas, `custom/eval`. */
  model: string;
  /** Claves en memoria para el proveedor custom de las pruebas. */
  keys?: Record<string, string>;
  timeoutMs?: number;
  /** Observa los pasos según van llegando, igual que `runTask`. */
  onStep?: (step: AgentStep) => void;
}

interface SessionState {
  id: string;
  goal: string;
  cwd: string;
  status: string;
  answer?: string;
  error?: string;
  steps: AgentStep[];
  turns: Array<{ role: string; text: string; ts: number }>;
  pendingApproval?: { id: string } | null;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** Distingue el vencimiento del presupuesto de un fallo del modelo o del server. */
class ScenarioTimeoutError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string, message: string) {
    super(message);
    this.name = 'ScenarioTimeoutError';
    this.sessionId = sessionId;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function tempDir(prefix: string): string {
  fs.mkdirSync(EVAL_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(EVAL_ROOT, prefix));
}

/**
 * Política del proyecto temporal: permite escribir sin modal.
 *
 * La sesión autoritativa no tiene un humano al otro lado. En vez de inventar
 * un bypass en el servidor, el escenario declara la misma regla que el usuario
 * pondría en `.commander/permissions.json`; T10 la commitea para que el
 * worktree del subagente también la reciba.
 */
function allowWrites(dir: string): void {
  const policyDir = path.join(dir, '.commander');
  fs.mkdirSync(policyDir, { recursive: true });
  fs.writeFileSync(path.join(policyDir, 'permissions.json'), JSON.stringify({
    mode: 'build',
    allowedTools: null,
    deniedTools: [],
    files: { read: [], write: [] },
    rules: [
      { tool: 'fs.write', pattern: '**', decision: 'allow' },
      { tool: 'fs.edit', pattern: '**', decision: 'allow' },
    ],
  }, null, 2), 'utf8');
}

function normalizeRequestPath(value: string): string {
  return value.replace(/\\/g, '/');
}

/** Petición JSON con el error del servidor si no es 2xx. */
async function api(
  baseUrl: string,
  method: string,
  route: string,
  body?: unknown,
  timeoutMs = 30_000
): Promise<any> {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  if (!res.ok) {
    throw new Error(
      `${method} ${route} -> HTTP ${res.status}: ${String(json?.error ?? raw).slice(0, 500)}`
    );
  }
  return json;
}

async function getState(baseUrl: string, id: string): Promise<SessionState> {
  const body = await api(baseUrl, 'GET', `/api/agent/sessions/${encodeURIComponent(id)}`);
  if (!body?.state) throw new Error('respuesta sin estado de sesión');
  return body.state as SessionState;
}

/** Cancelar detiene el bucle; borrar impide que quede una sesión viva en el server. */
async function cancelAndDeleteSession(baseUrl: string, id: string): Promise<void> {
  if (!id) return;
  try {
    await api(baseUrl, 'POST', `/api/agent/sessions/${encodeURIComponent(id)}/cancel`);
  } catch { /* la sesión pudo terminar justo antes de cancelar */ }
  await deleteSession(baseUrl, id);
}

/**
 * Espera el estado terminal y entrega los pasos nuevos a `onStep`.
 *
 * La sesión avanza en el servidor; el runner sólo la observa. No usa sleeps
 * fijos para decidir que terminó: el estado es la única fuente de verdad.
 */
async function waitForTerminal(
  baseUrl: string,
  id: string,
  opts: { timeoutMs: number; onStep?: (step: AgentStep) => void }
): Promise<SessionState> {
  const deadline = Date.now() + opts.timeoutMs;
  const seen = new Set<string>();
  let last: SessionState | null = null;
  while (Date.now() < deadline) {
    last = await getState(baseUrl, id);
    for (const step of last.steps) {
      if (seen.has(step.id)) continue;
      seen.add(step.id);
      opts.onStep?.(step);
    }
    if (last.pendingApproval?.id) {
      // La baseline no tiene UI: una aprobación pendiente colgaría el turno
      // cinco minutos. Se resuelve como lo haría el panel y se sigue mirando.
      try {
        await api(
          baseUrl,
          'POST',
          `/api/agent/sessions/${encodeURIComponent(id)}/approvals/${encodeURIComponent(last.pendingApproval.id)}`,
          { decision: 'allow', reason: 'baseline F0 sin UI' }
        );
      } catch { /* la sesión pudo terminar entre la lectura y la decisión */ }
    }
    if (TERMINAL.has(last.status)) return last;
    await sleep(150);
  }
  // Ningún escenario debe dejar una sesión viva cuando abandona por tiempo:
  // primero se detiene el bucle y después se borra el estado persistido.
  await cancelAndDeleteSession(baseUrl, id);
  throw new ScenarioTimeoutError(
    id,
    `la sesión ${id} no terminó en ${opts.timeoutMs}ms ` +
      `(último estado: ${last?.status ?? 'sin estado'})`
  );
}

async function runSession(
  opts: ScenarioOptions,
  input: { goal: string; cwd: string; maxSteps?: number }
): Promise<SessionState> {
  const created = await api(opts.baseUrl, 'POST', '/api/agent/sessions', {
    goal: input.goal,
    cwd: input.cwd,
    model: opts.model,
    maxSteps: input.maxSteps ?? 20,
    run: true,
    ...(opts.keys ? { keys: opts.keys } : {}),
  });
  const id = String(created?.session?.id ?? created?.state?.id ?? '');
  if (!id) throw new Error('el servidor no devolvió el id de la sesión');
  return waitForTerminal(opts.baseUrl, id, {
    timeoutMs: opts.timeoutMs ?? resolveTaskBudget({ live: true, timeoutMs: opts.timeoutMs }),
    onStep: opts.onStep,
  });
}

function answerOf(state: SessionState | undefined): string {
  if (!state) return '';
  return state.answer || [...state.steps].reverse().find((step) => step.title === 'Finalizado')?.content || '';
}

function toolResults(state: SessionState | undefined, tool: string): Array<{ step: AgentStep; data: any; error?: string }> {
  return (state?.steps ?? [])
    .filter((step) => step.type === 'tool_result' && step.toolId === tool)
    .map((step) => ({
      step,
      data: (step.output as any) ?? null,
      ...(step.status !== 'completed' ? { error: String(step.content ?? 'tool falló') } : {}),
    }));
}

async function checksOf(checks: EvalCheck[]): Promise<EvalOutcome['checks']> {
  const out: EvalOutcome['checks'] = [];
  for (const check of checks) {
    try {
      await check.run(undefined as any);
      out.push({ name: check.name });
    } catch (e: any) {
      out.push({ name: check.name, error: e?.message || String(e) });
    }
  }
  return out;
}

async function outcomeOf(
  id: string,
  started: number,
  state: SessionState | undefined,
  checks: EvalCheck[],
  error?: string,
  meta: { stopReason?: EvalStopReason; timedOut?: boolean } = {}
): Promise<EvalOutcome> {
  const results = await checksOf(checks);
  return {
    id,
    passed: results.every((check) => !check.error) && !error,
    steps: state?.steps.length ?? 0,
    durationMs: Date.now() - started,
    checks: results,
    stopReason: meta.stopReason ?? (error ? 'error' : 'completed'),
    timedOut: meta.timedOut === true,
    ...(error ? { error } : {}),
    ...(state ? { modelFallback: detectModelFallback(state.steps) ?? undefined } : {}),
  };
}

async function deleteSession(baseUrl: string, id: string): Promise<void> {
  try { await api(baseUrl, 'DELETE', `/api/agent/sessions/${encodeURIComponent(id)}`); } catch { /* limpieza */ }
}

// ---------------------------------------------------------------- T6 browser

const T6_HTML = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Preview T6</title></head>
  <body>
    <main>
      <h1>Preview de evaluación</h1>
      <button id="verify" type="button">Interacción verificada: <strong id="count">0</strong></button>
      <p id="status">Listo para verificar.</p>
    </main>
    <script>
      console.log('preview listo');
      console.error('error de consola esperado');
      fetch('/api/health').then((r) => r.json()).then(() => console.log('red verificada')).catch(() => {});
      document.getElementById('verify').addEventListener('click', () => {
        document.getElementById('count').textContent = '1';
        document.getElementById('status').textContent = 'Click verificado.';
        console.log('click verificado');
      });
    </script>
  </body>
</html>
`;

async function startPreviewFixture(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(T6_HTML);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

/** T6: abrir un preview local, comprobar un elemento y guardar consola/red. */
export async function runT6(opts: ScenarioOptions): Promise<EvalOutcome> {
  const started = Date.now();
  const dir = tempDir('T6-');
  const preview = await startPreviewFixture();
  let state: SessionState | undefined;
  let sessionId = '';
  let browserId = '';
  let error: string | undefined;
  let stopReason: EvalStopReason = 'completed';
  let timedOut = false;
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), T6_HTML);
    // El id del navegador se captura mientras llegan los pasos: si el timeout
    // ocurre después de `open`, el estado final ya no llegará, pero la sesión
    // de Playwright sigue viva y hay que poder cerrarla.
    const onStep = (step: AgentStep) => {
      if (step.type === 'tool_result' && step.toolId === 'browser') {
        const id = (step.output as any)?.sessionId;
        if (id) browserId = String(id);
      }
      opts.onStep?.(step);
    };
    state = await runSession({ ...opts, onStep }, {
      cwd: dir,
      maxSteps: 20,
      goal:
        `T6: abre ${preview.url} con la tool browser (action open), haz un snapshot, ` +
        'haz click en el botón «Interacción verificada», vuelve a hacer snapshot y llama a logs. ' +
        'Responde si el contador quedó en 1 y si viste el error de consola. No cierres la sesión del navegador.',
    });
    sessionId = state.id;
    for (const result of toolResults(state, 'browser')) {
      if (result.data?.sessionId) browserId = String(result.data.sessionId);
    }
  } catch (e: any) {
    error = e?.message || String(e);
    timedOut = e instanceof ScenarioTimeoutError;
    stopReason = timedOut ? 'timeout' : 'error';
  }

  const snapshots = toolResults(state, 'browser').filter(
    (result) => result.data && 'text' in result.data
  );
  const logs = toolResults(state, 'browser').filter(
    (result) => result.data && (Array.isArray(result.data.console) || Array.isArray(result.data.network))
  );
  const checks: EvalCheck[] = [
    {
      name: 'usó la tool browser',
      run: () => {
        // Igual que en T9, `AgentSession` sólo persiste el resultado, no el
        // evento `tool_call`; el resultado ya demuestra que la tool se usó.
        assert.ok(toolResults(state, 'browser').length > 0, 'la sesión no hizo ninguna llamada a browser');
      },
    },
    {
      name: 'abrió el preview local',
      run: () => {
        const opened = toolResults(state, 'browser').some(
          (result) => result.data?.page?.url?.startsWith(preview.url) || result.data?.url?.startsWith(preview.url)
        );
        assert.ok(opened, 'ningún resultado de browser confirma la navegación al preview');
      },
    },
    {
      name: 'encontró el botón en un snapshot',
      run: () => {
        assert.ok(
          snapshots.some((result) => String(result.data.text).includes('Interacción verificada')),
          'los snapshots no contienen el botón del preview'
        );
      },
    },
    {
      name: 'el click dejó el contador en 1',
      run: () => {
        assert.ok(
          toolResults(state, 'browser').some((result) => result.data?.clicked),
          'no hay ningún resultado de click'
        );
        assert.ok(
          snapshots.some((result) => /Interacción verificada:\s*1/.test(String(result.data.text))),
          'después del click ningún snapshot muestra el contador en 1'
        );
      },
    },
    {
      name: 'guardó consola y red',
      run: () => {
        const consoleEntries = logs.flatMap((result) => result.data.console ?? []);
        const networkEntries = logs.flatMap((result) => result.data.network ?? []);
        assert.ok(
          consoleEntries.some((entry: any) => String(entry.text).includes('preview listo')),
          'faltó el log de carga del preview'
        );
        assert.ok(
          consoleEntries.some((entry: any) => String(entry.text).includes('click verificado')),
          'faltó el log del click'
        );
        assert.ok(
          networkEntries.some((entry: any) => String(entry.url).includes('/api/health')),
          'faltó la petición de red del preview'
        );
      },
    },
    {
      name: 'respondió con el resultado',
      run: () => {
        assert.match(answerOf(state).toLowerCase(), /1|uno/, 'la respuesta final no confirma el contador');
      },
    },
  ];

  const result = await outcomeOf('T6', started, state, checks, error, { stopReason, timedOut });
  if (browserId) {
    try { await api(opts.baseUrl, 'DELETE', `/api/browser/session/${encodeURIComponent(browserId)}`); } catch { /* ya cerrada */ }
  }
  if (sessionId) await deleteSession(opts.baseUrl, sessionId);
  await preview.close();
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

// ---------------------------------------------------------------- T7 deploy

function runViteBuild(project: string): void {
  const vite = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) throw new Error(`no encuentro Vite en ${vite}`);
  execFileSync(process.execPath, [vite, 'build', '--outDir', 'dist'], {
    cwd: project,
    stdio: 'pipe',
    timeout: 120_000,
  });
}

async function published(
  baseUrl: string,
  slug: string,
  environment: 'preview' | 'production'
): Promise<{ status: number; text: string; contentType: string; url: string }> {
  const url = `${baseUrl}/published/${encodeURIComponent(slug)}/${environment}/`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  return {
    status: res.status,
    text: await res.text(),
    contentType: String(res.headers.get('content-type') ?? ''),
    url,
  };
}

/** T7: preview + promoción + rollback de una copia de `examples/vite-static`. */
export async function runT7(opts: Pick<ScenarioOptions, 'baseUrl'>): Promise<EvalOutcome> {
  const started = Date.now();
  const project = tempDir('T7-');
  const example = path.join(process.cwd(), 'examples', 'vite-static');
  let slug = '';
  const checks: EvalCheck[] = [];
  let error: string | undefined;
  try {
    fs.cpSync(example, project, { recursive: true });
    runViteBuild(project);

    const first = await api(opts.baseUrl, 'POST', '/api/publish/preview', {
      root: project,
      outputDir: 'dist',
      build: false,
    });
    const firstId = String(first?.release?.id ?? '');
    slug = String(first?.status?.project?.slug ?? '');
    assert.ok(firstId, 'la primera release no tiene id');
    assert.ok(slug, 'el estado de publicación no tiene slug');

    const firstPreview = await published(opts.baseUrl, slug, 'preview');
    assert.equal(firstPreview.status, 200, firstPreview.text.slice(0, 200));
    assert.match(firstPreview.text, /Una release\./, 'el preview no sirve el HTML de la primera release');

    const promotedFirst = await api(opts.baseUrl, 'POST', '/api/publish/production', {
      root: project,
      releaseId: firstId,
    });
    assert.equal(promotedFirst?.status?.production?.id, firstId, 'la primera release no llegó a producción');

    const htmlPath = path.join(project, 'index.html');
    fs.writeFileSync(
      htmlPath,
      fs.readFileSync(htmlPath, 'utf8').replace('Una release.', 'Segunda release.'),
      'utf8'
    );
    runViteBuild(project);

    const second = await api(opts.baseUrl, 'POST', '/api/publish/preview', {
      root: project,
      outputDir: 'dist',
      build: false,
    });
    const secondId = String(second?.release?.id ?? '');
    assert.ok(secondId && secondId !== firstId, 'la segunda release no es distinta');

    await api(opts.baseUrl, 'POST', '/api/publish/production', {
      root: project,
      releaseId: secondId,
    });
    const secondProduction = await published(opts.baseUrl, slug, 'production');
    assert.equal(secondProduction.status, 200, secondProduction.text.slice(0, 200));
    assert.match(secondProduction.text, /Segunda release\./, 'producción no sirve la segunda release');

    const rolledBack = await api(opts.baseUrl, 'POST', '/api/publish/rollback', { root: project });
    assert.equal(rolledBack?.status?.production?.id, firstId, 'el rollback no volvió a la primera release');

    const restored = await published(opts.baseUrl, slug, 'production');
    assert.equal(restored.status, 200, restored.text.slice(0, 200));
    assert.match(restored.text, /Una release\./, 'producción no quedó restaurada tras el rollback');

    const stillPreview = await published(opts.baseUrl, slug, 'preview');
    assert.match(stillPreview.text, /Segunda release\./, 'el rollback no debe tocar preview');

    const scriptSrc = /<script[^>]+src="([^"]+)"/.exec(restored.text)?.[1];
    assert.ok(scriptSrc, 'el HTML publicado no referencia ningún JS');
    const assetUrl = new URL(scriptSrc, restored.url).toString();
    const asset = await fetch(assetUrl, { signal: AbortSignal.timeout(15_000) });
    assert.equal(asset.status, 200, `el asset ${assetUrl} no responde`);
    assert.match(String(asset.headers.get('content-type') ?? ''), /javascript/i, 'el asset no se sirve como JS');

    const remote = await api(
      opts.baseUrl,
      'GET',
      `/api/deploy/status?root=${encodeURIComponent(project)}`
    );
    assert.equal(remote?.configured, false, 'el adaptador remoto no debe fingir un deploy');

    checks.push(
      { name: 'creó y sirvió preview', run: () => {} },
      { name: 'promovió a producción', run: () => {} },
      { name: 'el rollback restauró la release anterior', run: () => {} },
      { name: 'preview no cambió con el rollback', run: () => {} },
      { name: 'el asset JS se sirve', run: () => {} },
      { name: 'el deploy remoto sigue desactivado', run: () => {} }
    );
  } catch (e: any) {
    error = e?.message || String(e);
  }
  const result = await outcomeOf('T7', started, undefined, checks, error);
  if (slug) {
    try { fs.rmSync(path.join(process.cwd(), '.commander', 'publish', slug), { recursive: true, force: true }); } catch { /* ya no está */ }
  }
  fs.rmSync(project, { recursive: true, force: true });
  return result;
}

// ------------------------------------------------------------------ T9 resume

/** T9: continuar una sesión persistida sin repetir la tool del primer turno. */
export async function runT9(opts: ScenarioOptions): Promise<EvalOutcome> {
  const started = Date.now();
  const dir = tempDir('T9-');
  let first: SessionState | undefined;
  let second: SessionState | undefined;
  let error: string | undefined;
  let stopReason: EvalStopReason = 'completed';
  let timedOut = false;
  try {
    allowWrites(dir);
    first = await runSession(opts, {
      cwd: dir,
      maxSteps: 12,
      goal:
        'T9 PRIMER TURNO: escribe `hito.txt` con el texto `uno` usando fs.write y termina. ' +
        'No vuelvas a escribir el archivo en turnos posteriores.',
    });
    if (first.status === 'completed') {
      await api(opts.baseUrl, 'POST', `/api/agent/sessions/${encodeURIComponent(first.id)}/message`, {
        text:
          'T9 SEGUNDO TURNO: reanuda esta sesión. Comprueba que `hito.txt` sigue existiendo, ' +
          'no vuelvas a escribirlo y responde con el contenido del hito.',
      });
      second = await waitForTerminal(opts.baseUrl, first.id, {
        timeoutMs: opts.timeoutMs ?? resolveTaskBudget({ live: true, timeoutMs: opts.timeoutMs }),
        onStep: opts.onStep,
      });
    }
  } catch (e: any) {
    error = e?.message || String(e);
    timedOut = e instanceof ScenarioTimeoutError;
    stopReason = timedOut ? 'timeout' : 'error';
  }

  const state = second ?? first;
  // `AgentSession` persiste el resultado de la tool, no el evento `tool_call`
  // (que sólo va por el SSE). El resultado conserva `input`, así que sigue
  // sirviendo para contar la escritura y detectar una repetición.
  const writes = (state?.steps ?? []).filter((step) => {
    if (step.type !== 'tool_result' || step.toolId !== 'fs.write') return false;
    return normalizeRequestPath(String((step.input as any)?.path ?? '')) === 'hito.txt';
  });
  const firstIds = new Set((first?.steps ?? []).map((step) => step.id));
  const checks: EvalCheck[] = [
    {
      name: 'el primer turno terminó',
      run: () => assert.equal(first?.status, 'completed', `primer turno: ${first?.status ?? 'sin estado'}`),
    },
    {
      name: 'la reanudación terminó',
      run: () => assert.equal(second?.status, 'completed', `segundo turno: ${second?.status ?? 'no se ejecutó'}`),
    },
    {
      name: 'conservó la misma sesión y el historial',
      run: () => {
        assert.equal(second?.id, first?.id, 'la reanudación creó otra sesión');
        assert.ok(
          (second?.turns.length ?? 0) > (first?.turns.length ?? 0),
          'la reanudación no añadió turnos'
        );
        for (const id of firstIds) assert.ok(second?.steps.some((step) => step.id === id), `se perdió el paso ${id}`);
      },
    },
    {
      name: 'no duplicó la tool del primer turno',
      run: () => {
        assert.equal(writes.length, 1, `fs.write sobre hito.txt apareció ${writes.length} veces`);
        assert.equal(fs.readFileSync(path.join(dir, 'hito.txt'), 'utf8'), 'uno', 'el hito cambió o no existe');
      },
    },
    {
      name: 'respondió en la reanudación',
      run: () => assert.ok(answerOf(second).trim().length > 0, 'la reanudación no dejó respuesta final'),
    },
  ];

  const result = await outcomeOf('T9', started, state, checks, error, { stopReason, timedOut });
  if (state?.id) await deleteSession(opts.baseUrl, state.id);
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

// --------------------------------------------------------------- T10 subagents

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'eval@commander.local'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Commander Eval'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# repo de evaluación T10\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: dir, stdio: 'pipe' });
}

function worktreeCount(dir: string): number {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split(/\r?\n/).filter((line) => line.startsWith('worktree ')).length;
}

/** T10: dos subagentes en paralelo, con allowlist y worktree aislado. */
export async function runT10(opts: ScenarioOptions): Promise<EvalOutcome> {
  const started = Date.now();
  const dir = tempDir('T10-');
  let state: SessionState | undefined;
  let error: string | undefined;
  let stopReason: EvalStopReason = 'completed';
  let timedOut = false;
  try {
    initGitRepo(dir);
    allowWrites(dir);
    execFileSync('git', ['add', '-f', path.join('.commander', 'permissions.json')], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-q', '-m', 'permisos de evaluación'], { cwd: dir, stdio: 'pipe' });
    state = await runSession(opts, {
      cwd: dir,
      maxSteps: 30,
      goal:
        'T10: usa spawn_agents con dos subagentes en paralelo. Ambos deben llevar worktree:true y ' +
        "allowedTools:['fs.read','fs.write']. Hijo A debe intentar shell.run una vez (debe ser denegado) " +
        'y luego escribir `hijo-a.txt`; Hijo B debe escribir `hijo-b.txt`. No escribas en el árbol principal. ' +
        'Al final responde cuántos hijos terminaron.',
    });
  } catch (e: any) {
    error = e?.message || String(e);
    timedOut = e instanceof ScenarioTimeoutError;
    stopReason = timedOut ? 'timeout' : 'error';
  }

  const spawnResults = toolResults(state, 'spawn_agents');
  const data = spawnResults.find((result) => Array.isArray(result.data?.results))?.data;
  const children: any[] = Array.isArray(data?.results) ? data.results : [];
  const checks: EvalCheck[] = [
    {
      name: 'el padre terminó',
      run: () => assert.equal(state?.status, 'completed', `padre: ${state?.status ?? 'sin estado'}`),
    },
    {
      name: 'lanzó dos subagentes',
      run: () => {
        assert.equal(data?.spawned, 2, `spawned=${String(data?.spawned)}`);
        assert.equal(children.length, 2, `resultados=${children.length}`);
      },
    },
    {
      name: 'los dos subagentes terminaron',
      run: () => {
        for (const [index, child] of children.entries()) {
          assert.equal(child.ok, true, `hijo ${index + 1}: ${child.error ?? 'sin detalle'}`);
          assert.match(String(child.answer ?? '').toLowerCase(), /listo/, `hijo ${index + 1} sin respuesta`);
        }
      },
    },
    {
      name: 'la allowlist denegó shell en el hijo',
      run: () => {
        assert.ok(
          children.some((child) => /denegad|no permit|allowlist/i.test(String(child.answer ?? ''))),
          `ningún hijo informó que shell.run fuera denegado: ${JSON.stringify(children).slice(0, 500)}`
        );
        assert.equal(fs.existsSync(path.join(dir, 'prohibido.txt')), false, 'la allowlist dejó escribir prohibido.txt');
      },
    },
    {
      name: 'los worktrees no ensuciaron el árbol principal',
      run: () => {
        assert.equal(fs.existsSync(path.join(dir, 'hijo-a.txt')), false, 'hijo-a.txt llegó al árbol principal');
        assert.equal(fs.existsSync(path.join(dir, 'hijo-b.txt')), false, 'hijo-b.txt llegó al árbol principal');
        assert.equal(worktreeCount(dir), 1, 'quedaron worktrees sin limpiar');
      },
    },
    {
      name: 'respondió con el resultado',
      run: () => assert.match(answerOf(state).toLowerCase(), /2|dos/, 'el padre no confirma dos hijos'),
    },
  ];

  const result = await outcomeOf('T10', started, state, checks, error, { stopReason, timedOut });
  if (state?.id) await deleteSession(opts.baseUrl, state.id);
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}
