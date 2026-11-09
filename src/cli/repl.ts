/**
 * REPL interactivo del CLI (F1-08).
 *
 * Reutiliza el mismo bucle local que `commander agent`: cada turno llama a
 * `runAgent` con el estado de la sesión anterior, así que el contexto, el plan
 * y los pasos sobreviven entre turnos sin crear una sesión nueva.
 *
 * La entrada usa `node:readline/promises`, sin dependencias. En una terminal
 * real hay prompt y color; con un pipe/CI el mismo flujo corre en modo líneas,
 * sin spinner ni secuencias ANSI.
 */
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import { GEMINI_DEFAULT_MODEL, GEMINI_MODEL_CHAIN } from '../config/geminiModels.js';
import { getCliPreferences, saveCliPreferences, type CliPreferences } from '../config/index.js';
import { ALL_MODELS } from '../data/models.js';
import { modelSupportsTools } from '../agent/providers.js';
import {
  RECENT_TURNS,
  TURNS_BUDGET_CHARS,
  compactTurns,
} from '../agent/contextBudget.js';
import {
  createSessionState,
  type SessionMode,
  type SessionStateV2,
  type SessionTurnV2,
} from '../agent/sessionTypes.js';
import { getTemplate, listTemplates } from '../agent/subagentTemplates.js';
import { checkpointPaths, nextUndoCandidate } from '../agent/undoRedo.js';
import type { CheckpointMeta } from '../utils/checkpointsApi.js';
import {
  checkHealth,
  forkServerSession,
  listServerSessions,
  loadServerSession,
  normalizeServerUrl,
  runAgent as runAgentImpl,
  saveServerState,
  type RunAgentOptions,
  type RunAgentResult,
  type ServerSessionSummary,
} from './agentClient.js';
import {
  AgentRenderer,
  canPromptApprovals,
  promptQuestionAnswer,
  Tui,
  type QuestionPromptResult,
} from './tui.js';

export interface CheckpointListResult {
  checkpoints: CheckpointMeta[];
  error?: string;
}

export interface CheckpointRestoreResult {
  ok: boolean;
  restored?: string[];
  deleted?: string[];
  error?: string;
}

export type RunAgentFn = (opts: RunAgentOptions) => Promise<RunAgentResult>;

export interface ReplDeps {
  runAgent: RunAgentFn;
  checkHealth: typeof checkHealth;
  loadSession: typeof loadServerSession;
  forkSession: typeof forkServerSession;
  listSessions: typeof listServerSessions;
  listCheckpoints: (serverUrl: string, cwd: string) => Promise<CheckpointListResult>;
  restoreCheckpoint: (
    serverUrl: string,
    cwd: string,
    id: string
  ) => Promise<CheckpointRestoreResult>;
  saveState: (serverUrl: string, state: SessionStateV2) => Promise<void>;
  savePreferences: (prefs: CliPreferences) => Promise<void> | void;
  promptQuestion: typeof promptQuestionAnswer;
}

export interface ReplSessionOptions {
  serverUrl: string;
  cwd?: string;
  model?: string;
  mode?: SessionMode;
  maxSteps?: number;
  stream?: boolean;
  state?: SessionStateV2;
  agent?: string;
  /** Preferencias ya cargadas; los tests las inyectan para no tocar disco. */
  preferences?: CliPreferences;
  tui?: Tui;
  deps?: Partial<ReplDeps>;
}

export interface ReplRunOptions extends ReplSessionOptions {
  input?: Readable;
  output?: Writable;
  /** Fuerza el modo interactivo; por defecto lo deduce el Tui. */
  interactive?: boolean;
}

function readCliPreferences(cwd: string): CliPreferences {
  try {
    return getCliPreferences({ cwd });
  } catch {
    // Una config inválida no debe impedir arrancar el REPL; los defaults siguen.
    return {};
  }
}

/**
 * Catálogo estable que se puede ofrecer sin consultar proveedores en vivo.
 *
 * Incluye Gemini y los modelos de los proveedores que soportan function
 * calling. El modelo activo se conserva aunque venga de un flag o de una
 * sesión, para poder marcarlo en `/model`.
 */
export function availableModelIds(current?: string): string[] {
  const active = current?.trim() || '';
  const ids = [
    ...(active ? [active] : []),
    ...GEMINI_MODEL_CHAIN,
    ...ALL_MODELS.map((model) => model.id),
  ];
  return Array.from(
    new Set(ids.filter((id) => id === active || modelSupportsTools(id)))
  );
}

const HELP_LINES = [
  '/help                 muestra esta ayuda',
  '/plan                 cambia a modo plan (sólo lectura)',
  '/build                cambia a modo build (puede escribir)',
  '/review               cambia a modo revisión (sólo lectura)',
  '/compact              resume el historial con el presupuesto de contexto',
  '/undo                 revierte el último checkpoint de escritura',
  '/resume [id]          reanuda una sesión; sin id lista las últimas',
  '/fork [id]            bifurca una sesión; sin id lista las últimas',
  '/model [id]           muestra o cambia el modelo',
  '/agent [plantilla]    muestra o cambia la plantilla de agente',
  '/exit                 sale del REPL',
  '',
  'Multilínea: termina la línea con \\',
  'Ctrl+C cancela el turno en vuelo; Ctrl+D sale.',
];

function normalizeSessionSummary(s: ServerSessionSummary): ServerSessionSummary | null {
  if (!s || typeof s.id !== 'string' || !s.id) return null;
  return s;
}

/** Lista de checkpoints del servidor, con el root del REPL (no el del browser). */
async function fetchCheckpoints(serverUrl: string, cwd: string): Promise<CheckpointListResult> {
  try {
    const res = await fetch(
      `${normalizeServerUrl(serverUrl)}/api/checkpoints?root=${encodeURIComponent(cwd)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      checkpoints?: unknown;
      error?: string;
    };
    if (!res.ok || !body.success) {
      return { checkpoints: [], error: body.error || `HTTP ${res.status}` };
    }
    return {
      checkpoints: Array.isArray(body.checkpoints)
        ? (body.checkpoints as CheckpointMeta[])
        : [],
    };
  } catch (error) {
    return { checkpoints: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Restaura un checkpoint file-based usando el root del REPL. */
async function restoreCheckpoint(
  serverUrl: string,
  cwd: string,
  id: string
): Promise<CheckpointRestoreResult> {
  try {
    const res = await fetch(`${normalizeServerUrl(serverUrl)}/api/checkpoints/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: cwd, id }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      restored?: string[];
      deleted?: string[];
      error?: string;
    };
    if (!res.ok || !body.success) {
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }
    return {
      ok: true,
      restored: Array.isArray(body.restored) ? body.restored : [],
      deleted: Array.isArray(body.deleted) ? body.deleted : [],
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Estado y comandos del REPL.
 *
 * Se separa del readline para poder probar comandos y cancelación sin una TTY.
 */
export class ReplSession {
  readonly tui: Tui;
  readonly serverUrl: string;
  readonly cwd: string;
  readonly history: string[] = [];
  readonly undone = new Set<string>();
  state?: SessionStateV2;
  model: string;
  maxSteps: number;
  mode: SessionMode;
  agent?: string;

  private readonly deps: ReplDeps;
  private turns = 0;
  private controller: AbortController | null = null;
  private running = false;

  constructor(opts: ReplSessionOptions) {
    this.serverUrl = normalizeServerUrl(opts.serverUrl);
    this.cwd = opts.cwd || process.cwd();
    this.tui = opts.tui ?? new Tui();
    this.state = opts.state;
    const prefs = opts.preferences ?? readCliPreferences(this.cwd);
    const requestedAgent = (opts.agent || prefs.lastAgent || '').trim();
    const template = requestedAgent ? getTemplate(requestedAgent) : undefined;
    const requestedSteps = Number(opts.maxSteps);
    this.model =
      opts.model?.trim() ||
      opts.state?.model?.trim() ||
      prefs.lastModel?.trim() ||
      GEMINI_DEFAULT_MODEL;
    this.maxSteps =
      Number.isFinite(requestedSteps) && requestedSteps > 0
        ? Math.max(1, Math.floor(requestedSteps))
        : template?.defaultMaxSteps ?? 25;
    this.mode = opts.mode || opts.state?.mode || prefs.lastMode || template?.defaultMode || 'build';
    this.agent = template?.name;
    this.deps = {
      runAgent: runAgentImpl,
      checkHealth,
      loadSession: loadServerSession,
      forkSession: forkServerSession,
      listSessions: listServerSessions,
      listCheckpoints: fetchCheckpoints,
      restoreCheckpoint,
      saveState: saveServerState,
      savePreferences: (next) => {
        saveCliPreferences(next, { cwd: this.cwd });
      },
      promptQuestion: promptQuestionAnswer,
      ...opts.deps,
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Ctrl+C: aborta el fetch/tool en vuelo; el REPL queda usable. */
  cancelTurn(): void {
    this.controller?.abort();
  }

  adoptState(state: SessionStateV2): void {
    this.state = state;
    this.model = state.model || this.model;
    this.mode = state.mode || 'build';
    this.turns = 0;
    this.undone.clear();
  }

  /** Persiste sólo `cli.*`, no la sesión ni secretos del entorno. */
  private async persistPreferences(): Promise<void> {
    const prefs: CliPreferences = { lastModel: this.model, lastMode: this.mode };
    if (this.agent) prefs.lastAgent = this.agent;
    try {
      await this.deps.savePreferences(prefs);
    } catch (error) {
      this.tui.line(
        `${this.tui.red('✗')} ${this.tui.gray(
          `no se pudo guardar la preferencia: ${error instanceof Error ? error.message : String(error)}`
        )}`
      );
    }
  }

  /** Procesa una línea completa (o un bloque multilínea). */
  async handleLine(raw: string): Promise<boolean> {
    const input = raw.trim();
    if (!input) return true;
    this.history.push(input);
    if (input.startsWith('/')) return this.command(input);
    await this.runTurn(input);
    return true;
  }

  private async runTurn(task: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    const renderer = new AgentRenderer({
      task,
      model: this.model,
      maxSteps: this.maxSteps,
      mode: this.mode,
      serverUrl: this.serverUrl,
      tui: this.tui,
      showHeader: this.turns === 0,
    });
    const onProcessSigint = (): void => this.cancelTurn();
    process.on('SIGINT', onProcessSigint);
    const askUser =
      this.tui.interactive && canPromptApprovals()
        ? (question: Parameters<NonNullable<RunAgentOptions['askUser']>>[0]) =>
            this.deps.promptQuestion(question, {
              tui: this.tui,
              signal: controller.signal,
            })
        : undefined;

    try {
      const result = await this.deps.runAgent({
        serverUrl: this.serverUrl,
        task,
        cwd: this.cwd,
        model: this.model,
        maxSteps: this.maxSteps,
        stream: true,
        mode: this.mode,
        agent: this.agent,
        resumeFrom: this.state,
        goal: this.state?.goal,
        persistSession: !this.state,
        signal: controller.signal,
        askUser,
        onEvent: (event) => renderer.handle(event),
      });
      if (result.state) this.state = result.state;
      this.turns += 1;
      if (!result.cancelled) renderer.finish(result.answer, result.steps);
    } catch (error) {
      if (!controller.signal.aborted) {
        renderer.handle({
          schemaVersion: 2,
          seq: 1,
          sessionId: this.state?.id || 'cli',
          type: 'error',
          text: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      process.removeListener('SIGINT', onProcessSigint);
      this.running = false;
      this.controller = null;
    }
  }

  private async command(line: string): Promise<boolean> {
    const match = line.slice(1).trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
    const name = (match?.[1] || '').toLowerCase();
    const arg = (match?.[2] || '').trim();

    switch (name) {
      case 'help':
        for (const item of HELP_LINES) this.tui.line(item);
        return true;

      case 'exit':
        this.tui.line(this.tui.gray('Hasta luego.'));
        return false;

      case 'plan':
        await this.setMode('plan', 'plan', 'sólo lectura');
        return true;

      case 'build':
        await this.setMode('build', 'build', 'puede escribir');
        return true;

      case 'review':
        await this.setMode('readonly', 'revisión', 'sólo lectura');
        return true;

      case 'model':
        await this.handleModel(arg);
        return true;

      case 'agent':
        await this.handleAgent(arg);
        return true;

      case 'compact':
        await this.compact();
        return true;

      case 'undo':
        await this.undo();
        return true;

      case 'resume':
        await this.switchSession(arg, false);
        return true;

      case 'fork':
        await this.switchSession(arg, true);
        return true;

      default:
        this.tui.line(
          `${this.tui.red('✗')} ${this.tui.gray(`comando desconocido: /${name || ''} · usa /help`)}`
        );
        return true;
    }
  }

  private async setMode(mode: SessionMode, label: string, hint: string): Promise<void> {
    this.mode = mode;
    this.tui.line(`${this.tui.cyan('modo')} ${this.tui.bold(label)} ${this.tui.gray(`· ${hint}`)}`);
    await this.persistPreferences();
  }

  private printModels(): void {
    for (const model of availableModelIds(this.model)) {
      this.tui.line(`  ${model === this.model ? this.tui.cyan('›') : ' '} ${model}`);
    }
  }

  private async handleModel(arg: string): Promise<void> {
    if (!arg) {
      this.tui.line(`${this.tui.cyan('modelo actual')} ${this.tui.bold(this.model)}`);
      this.printModels();
      return;
    }
    const id = arg.trim();
    if (!availableModelIds(this.model).includes(id)) {
      this.tui.line(`${this.tui.red('✗')} ${this.tui.gray(`modelo desconocido: ${id}`)}`);
      this.tui.line(this.tui.gray('disponibles:'));
      this.printModels();
      return;
    }
    this.model = id;
    this.tui.line(`${this.tui.cyan('modelo')} → ${this.tui.bold(this.model)}`);
    await this.persistPreferences();
  }

  private async handleAgent(arg: string): Promise<void> {
    if (!arg) {
      this.tui.line(
        `${this.tui.cyan('agente actual')} ${this.tui.bold(this.agent || '(sin plantilla)')}`
      );
      for (const template of listTemplates()) {
        const active = template.name === this.agent;
        this.tui.line(
          `  ${active ? this.tui.cyan('›') : ' '} ${this.tui.bold(template.name)} ${this.tui.gray(`· ${template.defaultMode} · ${template.description}`)}`
        );
      }
      return;
    }
    if (arg === 'none' || arg === 'default') {
      this.agent = undefined;
      this.mode = 'build';
      this.maxSteps = 25;
      this.tui.line(this.tui.gray('plantilla de agente eliminada; modo build'));
      await this.persistPreferences();
      return;
    }
    const template = getTemplate(arg);
    if (!template) {
      this.tui.line(`${this.tui.red('✗')} plantilla desconocida: ${arg}`);
      this.tui.line(
        this.tui.gray(`disponibles: ${listTemplates().map((item) => item.name).join(', ')}`)
      );
      return;
    }
    this.agent = template.name;
    this.mode = template.defaultMode;
    this.maxSteps = template.defaultMaxSteps;
    this.tui.line(
      `${this.tui.cyan('agente')} → ${this.tui.bold(template.name)} ${this.tui.gray(`· ${template.description}`)}`
    );
    await this.persistPreferences();
  }

  private async compact(): Promise<void> {
    if (!this.state || this.state.turns.length === 0) {
      this.tui.line(this.tui.gray('no hay historial que compactar'));
      return;
    }
    const before = this.state.turns.length;
    const compacted = compactTurns(
      this.state.turns.map((turn) => ({ role: turn.role, text: turn.text })),
      { maxChars: TURNS_BUDGET_CHARS, keepRecent: RECENT_TURNS }
    );
    const now = Date.now();
    this.state.turns = compacted.map((turn) => {
      const role: SessionTurnV2['role'] =
        turn.role === 'assistant' || turn.role === 'tool' ? turn.role : 'user';
      return { role, text: turn.text, ts: now };
    });
    this.state.updatedAt = now;
    try {
      await this.deps.saveState(this.serverUrl, this.state);
    } catch {
      /* el siguiente turno reintenta el checkpoint */
    }
    this.tui.line(
      `${this.tui.green('✔')} ${this.tui.gray(`historial compactado: ${before} → ${this.state.turns.length} turno(s)`)}`
    );
  }

  private async undo(): Promise<void> {
    const listed = await this.deps.listCheckpoints(this.serverUrl, this.cwd);
    if (listed.error) {
      this.tui.line(`${this.tui.red('✗')} ${this.tui.gray(listed.error)}`);
      return;
    }
    const candidate = nextUndoCandidate(listed.checkpoints, this.undone);
    if (!candidate) {
      this.tui.line(this.tui.gray('no hay checkpoints de escritura para deshacer'));
      return;
    }
    const result = await this.deps.restoreCheckpoint(this.serverUrl, this.cwd, candidate.id);
    if (!result.ok) {
      this.tui.line(`${this.tui.red('✗')} ${this.tui.gray(result.error || 'no se pudo deshacer')}`);
      return;
    }
    this.undone.add(candidate.id);
    const paths = checkpointPaths(candidate);
    const files = [...(result.restored || []), ...(result.deleted || [])];
    this.tui.line(
      `${this.tui.green('✔')} ${this.tui.gray(`deshecho ${candidate.label || candidate.id}${files.length ? `: ${files.join(', ')}` : paths.length ? `: ${paths.join(', ')}` : ''}`)}`
    );
  }

  private async switchSession(arg: string, fork: boolean): Promise<void> {
    if (!arg) {
      try {
        const sessions = (await this.deps.listSessions(this.serverUrl))
          .map(normalizeSessionSummary)
          .filter((item): item is ServerSessionSummary => item !== null)
          .slice(0, 10);
        if (sessions.length === 0) {
          this.tui.line(this.tui.gray('no hay sesiones guardadas'));
          return;
        }
        this.tui.line(this.tui.cyan('últimas sesiones'));
        for (const session of sessions) {
          this.tui.line(
            `  ${this.tui.bold(session.id)} ${this.tui.gray(`· ${session.status || 'idle'} · ${session.goal}`)}`
          );
        }
      } catch (error) {
        this.tui.line(
          `${this.tui.red('✗')} ${this.tui.gray(error instanceof Error ? error.message : String(error))}`
        );
      }
      return;
    }

    try {
      const state = fork
        ? await this.deps.forkSession(this.serverUrl, arg)
        : await this.deps.loadSession(this.serverUrl, arg);
      this.adoptState(state);
      this.tui.line(
        `${this.tui.green('✔')} ${this.tui.gray(`${fork ? 'bifurcada' : 'reanudada'} ${state.id} · ${state.goal}`)}`
      );
    } catch (error) {
      this.tui.line(
        `${this.tui.red('✗')} ${this.tui.gray(error instanceof Error ? error.message : String(error))}`
      );
    }
  }
}

/**
 * Arranca el REPL. Devuelve el código de salida del proceso (0 normal, 1 si el
 * servidor no está disponible).
 */
export async function runRepl(opts: ReplRunOptions): Promise<number> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const interactive =
    opts.interactive ??
    Boolean(
      (input as Readable & { isTTY?: boolean }).isTTY &&
        (output as Writable & { isTTY?: boolean }).isTTY &&
        process.env.TERM !== 'dumb'
    );
  const tui = opts.tui ?? new Tui({ interactive });
  const deps = opts.deps || {};
  const health = await (deps.checkHealth ?? checkHealth)(opts.serverUrl);
  if (!health.ok) {
    tui.line(
      `${tui.red('✗')} Servidor no disponible en ${opts.serverUrl} (${health.detail || 'sin detalle'}).`
    );
    tui.line(tui.gray('  Arráncalo con: npm run dev   (o: commander serve)'));
    return 1;
  }

  const session = new ReplSession({ ...opts, tui });
  tui.line(`${tui.bold('[commander]')} ${tui.cyan('REPL')} ${tui.gray(`→ ${opts.serverUrl}`)}`);
  tui.line(
    `  ${tui.gray('modelo')} ${tui.yellow(session.model)}   ${tui.gray('modo')} ${tui.yellow(session.mode)}`
  );
  tui.line(tui.gray('  /help para comandos · Ctrl+D para salir'));
  tui.rule();

  const rl = createInterface({
    input,
    output,
    terminal: interactive,
    historySize: 100,
  });
  const onSigint = (): void => {
    if (session.isRunning) {
      session.cancelTurn();
      return;
    }
    tui.line(tui.gray('Ctrl+C: nada en vuelo · usa /exit para salir'));
  };
  rl.on('SIGINT', onSigint);

  let pending: string[] = [];
  let exitRequested = false;
  try {
    const iterator = rl[Symbol.asyncIterator]();
    for (;;) {
      if (interactive) {
        output.write(pending.length ? tui.gray('… ') : tui.cyan('› '));
      }
      const next = await iterator.next();
      if (next.done) break;
      const line = String(next.value);
      if (/\\\s*$/.test(line)) {
        pending.push(line.replace(/\\\s*$/, ''));
        continue;
      }
      pending.push(line);
      const complete = pending.join('\n').trim();
      pending = [];
      if (!complete) continue;
      if (!(await session.handleLine(complete))) {
        exitRequested = true;
        break;
      }
    }
    // Un bloque multilínea sin salto final también se ejecuta al cerrar stdin.
    if (!exitRequested && pending.length > 0) {
      await session.handleLine(pending.join('\n'));
    }
  } finally {
    rl.removeListener('SIGINT', onSigint);
    rl.close();
  }
  return 0;
}

/** Crea una sesión local para tests o para un REPL sin servidor de sesiones. */
export function createReplState(opts: {
  id?: string;
  goal?: string;
  cwd: string;
  model?: string;
  mode?: SessionMode;
}): SessionStateV2 {
  return createSessionState({
    id: opts.id || 'sess_repl',
    goal: opts.goal || 'REPL',
    cwd: opts.cwd,
    model: opts.model || GEMINI_DEFAULT_MODEL,
    mode: opts.mode,
  });
}

export type { QuestionPromptResult };
