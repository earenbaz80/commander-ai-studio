/**
 * Arnés de evaluaciones del agente.
 *
 * Una evaluación es una tarea con dos mitades:
 *   • `script`  — qué "dice" el modelo en cada turno (modo replay), o el modelo
 *                 real (modo `--live`).
 *   • `checks`  — cómo se comprueba el resultado en el workspace.
 *
 * Modos:
 *   • replay (por defecto): sin red y sin claves. Ejercita el camino real
 *     completo — `AgentLoop` → `/api/agent/run-tool` → `executeAgentTool` —
 *     pero el modelo es un guion. Mide la maquinaria: enrutado de tools,
 *     edición exacta, presupuesto de contexto y puerta de aprobación. Es lo
 *     que corre en CI.
 *   • live (`--live`): el mismo camino con el modelo de verdad, contra un
 *     servidor de la app ya arrancado. Eso sí mide juicio del modelo, pero
 *     cuesta dinero y no es determinista, así que no va en CI.
 *
 * Cada tarea trabaja sobre COPIAS de ficheros reales del repo en un directorio
 * temporal: el repo original nunca se toca.
 */
import fs from 'node:fs';
import path from 'node:path';
import { executeAgentTool } from '../agentTools.js';
import { GEMINI_DEFAULT_MODEL } from '../src/config/geminiModels.js';
import { AgentLoop, defaultAgentLLMClient, type AgentLLMClient } from '../src/agent/loop.js';
import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import type { AgentStep, ApprovalRequest } from '../src/agent/types.js';
import { DEFAULT_BASE_URL } from './server.js';

/** Los workspaces temporales viven bajo `tests/tmp-*`, que tsc ya excluye. */
export const EVAL_ROOT = path.join(process.cwd(), 'tests', 'tmp-evals');

/** Modelo por defecto de la app: se importa para no duplicar el id en el repo. */
export const DEFAULT_MODEL = GEMINI_DEFAULT_MODEL;

/**
 * Tope de seguridad por tarea. En replay el modelo es un guion y sobra: un
 * bucle colgado no debe colgar CI. En live cada paso es una llamada real al
 * modelo (decenas de segundos con modelos lentos), así que 20s abortaban todas
 * las tareas antes de que el agente hiciera nada.
 */
export const REPLAY_TASK_TIMEOUT_MS = 20_000;
export const LIVE_TASK_TIMEOUT_MS = 300_000;

/**
 * Pasos por tarea. Cada tool cuesta dos pasos (llamada + resultado) y cada
 * turno de razonamiento uno, así que 10 pasos ≈ tres tools: suficiente para un
 * guion de replay que va directo al fichero, y no para un modelo que tiene que
 * buscar dónde está el fallo antes de editar (se quedaba sin presupuesto sin
 * haber tocado nada).
 */
export const REPLAY_MAX_STEPS = 10;
export const LIVE_MAX_STEPS = 30;

/** Pasos de una tarea: los que declare, o el presupuesto del modo. */
export function resolveTaskSteps(opts: { live?: boolean; maxSteps?: number } = {}): number {
  if (opts.maxSteps !== undefined && Number.isFinite(opts.maxSteps) && opts.maxSteps > 0) {
    return opts.maxSteps;
  }
  return opts.live ? LIVE_MAX_STEPS : REPLAY_MAX_STEPS;
}

/**
 * Un parche enorme no se lee en un log de CI, y el workspace se borra al
 * terminar: el diff hay que recortarlo aquí, no al imprimirlo.
 */
const MAX_PATCH_LINES = 40;

/** Un fichero mayor que esto no se fotografía ni se diffea. */
const MAX_SNAPSHOT_BYTES = 256 * 1024;

/**
 * Estado interno de la app, no trabajo del agente. `executeAgentTool` crea
 * checkpoints bajo `<root>/.commander/checkpoints/` en el propio workspace, así
 * que sin esto cada diff saldría lleno de ficheros "nuevos" que nadie pidió.
 * Misma lista que `snapshotProject` (checkpoints.ts).
 */
const IGNORED_DIRS = new Set(['.git', '.commander', 'node_modules']);

/** Contrato real de las tools del cliente (ver `src/agent/tools/fs.ts`). */
const TOOL_ENDPOINT = '/api/agent/run-tool';

/** Único tráfico que se permite en modo live: la llamada al modelo. */
const GENERATE_ENDPOINT = /^\/api\/[a-z]+\/generate$/;

export interface EvalTurn {
  thought?: string;
  /** Nombres de `AGENT_FUNCTION_DECLARATIONS`: fs_read, fs_edit, shell_run… */
  calls?: Array<{ name: string; args: Record<string, unknown> }>;
}

export interface EvalWorkspace {
  dir: string;
  read(rel: string): string;
}

export interface EvalContext extends EvalWorkspace {
  /** Contenido del fichero antes de que el agente lo tocara. */
  original(rel: string): string;
  steps: AgentStep[];
  /**
   * Llamadas a una tool. `where` filtra por input: el bucle hace lecturas
   * propias (AGENTS.md) antes de la tarea, así que "la primera" no sirve.
   */
  calls(tool: string, where?: (input: any) => boolean): Array<{ input: any; status: string }>;
  results(tool: string, where?: (input: any) => boolean): Array<{ ok: boolean; data: any; error?: string }>;
  /** Texto del paso "Finalizado", o cadena vacía. */
  answer: string;
}

export interface EvalCheck {
  name: string;
  /**
   * Debe lanzar si la comprobación falla. Puede ser async: así una tarea puede
   * importar el código que el agente acaba de parchear y ejecutarlo, que es un
   * veredicto mucho más fuerte que mirar el texto del archivo.
   */
  run(ctx: EvalContext): void | Promise<void>;
}

export interface EvalTask {
  id: string;
  goal: string;
  /** Ficheros reales del repo que se copian al workspace (rutas relativas). */
  files: string[];
  /**
   * Rutas que la tarea espera que el agente cree o toque además de `files`.
   * Sin esto, "crea un fichero nuevo" sería sospechoso por definición. Una
   * entrada terminada en `/` vale como prefijo de directorio.
   */
  allowChanges?: string[];
  maxSteps?: number;
  script: (ws: EvalWorkspace) => EvalTurn[];
  /** Política de aprobación; por defecto se aprueba todo. */
  approve?: (req: ApprovalRequest) => { approved: boolean; reason?: string };
  /** Ficheros extra propios de la tarea (canarios, etc.). */
  setup?: (dir: string) => void;
  checks: EvalCheck[];
}

export interface EvalChangedFile {
  path: string;
  status: 'modificado' | 'nuevo' | 'borrado';
}

export interface EvalDiff extends EvalChangedFile {
  /** Diff unificado recortado, listo para imprimir. */
  patch: string;
}

export interface EvalOutcome {
  id: string;
  passed: boolean;
  steps: number;
  durationMs: number;
  checks: Array<{ name: string; error?: string }>;
  /** La tarea no llegó a correr (premisa rota, timeout, excepción). */
  error?: string;
  /**
   * Qué cambió el agente respecto al workspace inicial. Es el diagnóstico de
   * un fallo: el workspace temporal se borra y sin esto sólo queda el nombre
   * de la comprobación rota.
   */
  diffs?: EvalDiff[];
  /**
   * El modelo pedido no respondió y otro generó la respuesta: la pasada no mide
   * lo que dice medir.
   */
  modelFallback?: EvalModelFallback;
  /**
   * Modelos que contestaron de verdad durante la tarea, según la respuesta del
   * servidor. Sirve para no creerse sólo el aviso de sustitución: si la cadena
   * cambia de modelo sin dejar paso, esto lo delata igual.
   */
  answeredModels?: string[];
  /**
   * Cambios en ficheros que la tarea no declara. Es una SOSPECHA, no un fallo:
   * los checks pueden pasar y aun así el agente haber tocado de más. Un
   * arreglo que funciona por la vía equivocada no debe pasar desapercibido.
   */
  outOfScope?: EvalChangedFile[];
}

export interface EvalOptions {
  live?: boolean;
  model?: string;
  /** Origen del servidor de la app para el modo live. */
  baseUrl?: string;
  /** Presupuesto por tarea; por defecto depende del modo (ver `resolveTaskBudget`). */
  timeoutMs?: number;
  /** Observa cada paso mientras ocurre (diagnóstico de una pasada live). */
  onStep?: (step: AgentStep) => void;
  /** Se llama con el modelo que declara el servidor en cada respuesta live. */
  onAnswer?: (answered: string) => void;
}

/**
 * Modelo que el servidor declara como autor de una respuesta (`model`).
 *
 * No se deduce del texto ni del aviso de sustitución: el servidor ya lo dice, y
 * leerlo aquí es lo que permite registrar quién contestó aunque no hubiera
 * aviso. Cualquier cosa que no sea un id no vacío se ignora.
 */
export function readAnsweredModel(body: unknown): string | null {
  const value = (body as any)?.model;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Presupuesto de una tarea: explícito, o el del modo. */
/**
 * Aviso que antepone el servidor cuando el modelo pedido no responde y la
 * respuesta la genera otro (cuota agotada, modelo retirado). Sin detectarlo, el
 * historial atribuye los resultados al modelo pedido y la comparación miente.
 */
const FALLBACK_NOTICE = /Aviso:\s*(.+?)\s+no respondió[^\]]*?Respuesta generada con\s+([^\]\n]+)/;

export interface EvalModelFallback {
  from: string;
  to: string;
}

/**
 * Modelo sustituido que aparece en los pasos, si lo hubo.
 *
 * Primero el paso estructurado que escribe el bucle con lo que declara el
 * servidor; el aviso en el texto queda como respaldo para servidores antiguos.
 */
export function detectModelFallback(steps: AgentStep[]): EvalModelFallback | null {
  for (const step of steps) {
    const content = String(step.content ?? '');
    if (step.title === 'Modelo sustituido') {
      const structured = /^(.+?) no respondió; respondió (.+)$/.exec(content.trim());
      if (structured) return { from: structured[1].trim(), to: structured[2].trim() };
    }
    const match = FALLBACK_NOTICE.exec(content);
    if (match) return { from: match[1].trim(), to: match[2].trim() };
  }
  return null;
}

export function resolveTaskBudget(opts: { live?: boolean; timeoutMs?: number } = {}): number {
  if (opts.timeoutMs !== undefined && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0) {
    return opts.timeoutMs;
  }
  return opts.live ? LIVE_TASK_TIMEOUT_MS : REPLAY_TASK_TIMEOUT_MS;
}

export interface EvalSummary {
  passed: number;
  total: number;
  suspicious: number;
  /** En modo estricto, tocar fuera de alcance también cuenta como fallo. */
  failed: boolean;
}

/**
 * Veredicto de una pasada completa. Vive aquí y no en el runner para poder
 * probarlo sin lanzar un proceso: el modo estricto es una política, no salida
 * por consola.
 */
export function summarize(
  outcomes: EvalOutcome[],
  opts: { strictScope?: boolean; requireModel?: boolean } = {}
): EvalSummary {
  const passed = outcomes.filter((outcome) => outcome.passed).length;
  const suspicious = outcomes.filter((outcome) => outcome.outOfScope?.length).length;
  // `requireModel`: medir otro modelo no es un resultado peor, es no medir.
  const substituted = opts.requireModel === true && outcomes.some((outcome) => outcome.modelFallback);
  return {
    passed,
    total: outcomes.length,
    suspicious,
    failed: passed !== outcomes.length || (opts.strictScope === true && suspicious > 0) || substituted,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toLines = (text: string): string[] => (text === '' ? [] : text.split('\n'));

function clampPatch(lines: string[]): string {
  if (lines.length <= MAX_PATCH_LINES) return lines.join('\n');
  const rest = lines.length - MAX_PATCH_LINES;
  return [...lines.slice(0, MAX_PATCH_LINES), `… (${rest} líneas más)`].join('\n');
}

/**
 * Diff unificado mínimo: recorta el prefijo y el sufijo comunes y emite el
 * tramo central con dos líneas de contexto. Sin dependencias y suficiente para
 * un workspace de evaluación, donde los cambios son pocos y contiguos.
 */
function unifiedDiff(rel: string, before: string, after: string): string {
  const a = toLines(before);
  const b = toLines(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const context = 2;
  const from = Math.max(0, start - context);
  const toA = Math.min(a.length, endA + context);
  const toB = Math.min(b.length, endB + context);

  const lines = [
    `--- ${rel}`,
    `+++ ${rel}`,
    `@@ -${from + 1},${toA - from} +${from + 1},${toB - from} @@`,
  ];
  for (let i = from; i < start; i++) lines.push(` ${a[i]}`);
  for (let i = start; i < endA; i++) lines.push(`-${a[i]}`);
  for (let i = start; i < endB; i++) lines.push(`+${b[i]}`);
  for (let i = endA; i < toA; i++) lines.push(` ${a[i]}`);
  return clampPatch(lines);
}

function addedFile(rel: string, content: string): string {
  return clampPatch([`--- /dev/null`, `+++ ${rel}`, ...toLines(content).map((line) => `+${line}`)]);
}

function removedFile(rel: string, before: string): string {
  return clampPatch([`--- ${rel}`, `+++ /dev/null`, ...toLines(before).map((line) => `-${line}`)]);
}

/**
 * Foto de todos los ficheros de texto del workspace. Se toma DESPUÉS de
 * `setup` para que los ficheros propios de la tarea (un canario, por ejemplo)
 * no aparezcan como cambios del agente.
 */
function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        if (fs.statSync(full).size > MAX_SNAPSHOT_BYTES) continue;
        const text = fs.readFileSync(full, 'utf8');
        // Binario: no hay diff legible que mostrar.
        if (text.includes('\0')) continue;
        files.set(path.relative(dir, full).split(path.sep).join('/'), text);
      } catch {
        /* ilegible: se omite */
      }
    }
  };
  walk(dir);
  return files;
}

function computeDiffs(dir: string, baseline: Map<string, string>): EvalDiff[] {
  const diffs: EvalDiff[] = [];
  const now = snapshot(dir);

  for (const [rel, before] of baseline) {
    const after = now.get(rel);
    if (after === undefined) {
      // Puede haberse borrado o simplemente haber dejado de ser texto.
      if (!fs.existsSync(path.join(dir, rel))) {
        diffs.push({ path: rel, status: 'borrado', patch: removedFile(rel, before) });
      }
      continue;
    }
    if (after !== before) {
      diffs.push({ path: rel, status: 'modificado', patch: unifiedDiff(rel, before, after) });
    }
  }

  for (const [rel, content] of now) {
    if (!baseline.has(rel)) diffs.push({ path: rel, status: 'nuevo', patch: addedFile(rel, content) });
  }

  return diffs;
}

function isDeclared(rel: string, allowed: string[]): boolean {
  return allowed.some((entry) => (entry.endsWith('/') ? rel.startsWith(entry) : rel === entry));
}

/** Cambios fuera de lo que la tarea declara (`files` + `allowChanges`). */
function outOfScopeChanges(task: EvalTask, diffs: EvalDiff[]): EvalChangedFile[] {
  const allowed = [...task.files, ...(task.allowChanges ?? [])];
  return diffs
    .filter((diff) => !isDeclared(diff.path, allowed))
    .map((diff) => ({ path: diff.path, status: diff.status }));
}

/** Respuesta mínima compatible con lo que esperan las tools del cliente. */
function jsonResponse(body: unknown, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any;
}

/**
 * Redirige las tools hacia su implementación de servidor, en el workspace
 * temporal, sin abrir un puerto ni salir a internet.
 */
function installFetchShim(dir: string, opts: EvalOptions): () => void {
  const original = globalThis.fetch;
  const shim = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);

    if (url === TOOL_ENDPOINT) {
      const body = JSON.parse(init?.body ?? '{}');
      // `root` al final: la evaluación manda sobre cualquier root activo.
      const result = await executeAgentTool(body.toolId, { ...(body.input || {}), root: dir });
      return jsonResponse(result, result.ok ? 200 : 400);
    }

    if (opts.live && GENERATE_ENDPOINT.test(url)) {
      const response = await original(`${opts.baseUrl ?? DEFAULT_BASE_URL}${url}`, init);
      // Se lee una COPIA: el agente tiene que recibir el cuerpo intacto. Sin
      // esto sólo quedaría el aviso de sustitución, que es opcional por
      // naturaleza (un servidor viejo no lo manda).
      try {
        const body = await response.clone().json();
        const answered = readAnsweredModel(body);
        if (answered) opts.onAnswer?.(answered);
      } catch {
        /* cuerpo no-JSON: no hay modelo que anotar */
      }
      return response;
    }

    // Checkpoints, MCP, /api/keys…: nada de eso debe tocar el repo ni la red.
    return jsonResponse({ ok: false, error: `eval: endpoint fuera de alcance (${url})` }, 501);
  };
  globalThis.fetch = shim as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** Cliente LLM de replay: devuelve el guion turno a turno y luego cierra. */
function replayClient(turns: EvalTurn[]): AgentLLMClient {
  let index = 0;
  return {
    callJson: async () => ({ thought: 'replay', finish: true, answer: '' }),
    callTools: async () => {
      const turn = turns[index++] ?? { thought: 'sin más pasos' };
      return { thought: turn.thought ?? '', calls: turn.calls ?? [] };
    },
  } as AgentLLMClient;
}

function buildContext(
  dir: string,
  originals: Map<string, string>,
  steps: AgentStep[]
): EvalContext {
  return {
    dir,
    read: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
    original: (rel) => {
      const text = originals.get(rel);
      if (text === undefined) throw new Error(`la tarea no declaró "${rel}" en files`);
      return text;
    },
    steps,
    calls: (tool, where) =>
      steps
        .filter((s) => s.type === 'tool_call' && s.toolId === tool)
        .filter((s) => (where ? where(s.input) : true))
        .map((s) => ({ input: s.input, status: s.status })),
    results: (tool, where) =>
      steps
        .filter((s) => s.type === 'tool_result' && s.toolId === tool)
        .filter((s) => (where ? where(s.input) : true))
        .map((s) => ({
          ok: s.status === 'completed',
          data: (s.output as any)?.data,
          error: (s.output as any)?.error,
        })),
    answer: [...steps].reverse().find((s) => s.title === 'Finalizado')?.content ?? '',
  };
}

/** Ejecuta una tarea de principio a fin y devuelve su veredicto. */
export async function runTask(task: EvalTask, opts: EvalOptions = {}): Promise<EvalOutcome> {
  const dir = path.join(
    EVAL_ROOT,
    `${task.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  );
  const originals = new Map<string, string>();
  const steps: AgentStep[] = [];
  const started = Date.now();
  let restoreFetch: (() => void) | null = null;
  let baseline: Map<string, string> | null = null;
  /** Quién contestó, en orden de aparición y sin repetidos. */
  const answeredModels: string[] = [];

  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const rel of task.files) {
      const from = path.join(process.cwd(), rel);
      if (!fs.existsSync(from)) {
        throw new Error(`la tarea perdió su premisa: no existe ${rel}`);
      }
      const content = fs.readFileSync(from, 'utf8');
      originals.set(rel, content);
      const to = path.join(dir, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, content);
    }
    task.setup?.(dir);
    baseline = snapshot(dir);

    const ws: EvalWorkspace = {
      dir,
      read: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
    };
    const turns = task.script(ws);
    restoreFetch = installFetchShim(dir, {
      ...opts,
      onAnswer: (answered) => {
        if (!answeredModels.includes(answered)) answeredModels.push(answered);
        opts.onAnswer?.(answered);
      },
    });

    const orchestrator = new AgentOrchestrator({
      cwd: dir,
      onStep: (step) => {
        steps.push(step);
        opts.onStep?.(step);
      },
      onPlanChange: () => {},
      onStateChange: () => {},
      approve: async (req) => (task.approve ? task.approve(req) : { approved: true }),
    });

    const loop = new AgentLoop(
      orchestrator,
      opts.model ?? DEFAULT_MODEL,
      opts.live ? defaultAgentLLMClient : replayClient(turns)
    );

    await loop.start({
      id: task.id,
      goal: task.goal,
      cwd: dir,
      maxSteps: resolveTaskSteps({ live: opts.live, maxSteps: task.maxSteps }),
    });

    const deadline = Date.now() + resolveTaskBudget(opts);
    while (orchestrator.getState().running && Date.now() < deadline) {
      await sleep(40);
    }
    loop.stop();

    const ctx = buildContext(dir, originals, steps);
    // En serie (no en paralelo): una comprobación async puede importar el
    // módulo parcheado y no queremos que dos importaciones se pisen.
    const checks: EvalOutcome['checks'] = [];
    for (const check of task.checks) {
      try {
        await check.run(ctx);
        checks.push({ name: check.name });
      } catch (e: any) {
        checks.push({ name: check.name, error: e?.message || String(e) });
      }
    }

    const diffs = computeDiffs(dir, baseline);
    return {
      id: task.id,
      passed: checks.every((c) => !c.error),
      steps: steps.length,
      durationMs: Date.now() - started,
      checks,
      diffs,
      outOfScope: outOfScopeChanges(task, diffs),
      modelFallback: detectModelFallback(steps) ?? undefined,
      ...(answeredModels.length ? { answeredModels: [...answeredModels] } : {}),
    };
  } catch (e: any) {
    // Un fallo a mitad también puede dejar cambios a medias: se reportan, pero
    // sin tapar el error original si el diff falla.
    let diffs: EvalDiff[] | undefined;
    if (baseline) {
      try {
        diffs = computeDiffs(dir, baseline);
      } catch {
        diffs = undefined;
      }
    }
    return {
      id: task.id,
      passed: false,
      steps: steps.length,
      durationMs: Date.now() - started,
      checks: [],
      error: e?.message || String(e),
      diffs,
      outOfScope: diffs ? outOfScopeChanges(task, diffs) : undefined,
      modelFallback: detectModelFallback(steps) ?? undefined,
      ...(answeredModels.length ? { answeredModels: [...answeredModels] } : {}),
    };
  } finally {
    restoreFetch?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
