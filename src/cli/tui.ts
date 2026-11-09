/**
 * TUI mínima para el CLI (`commander agent`).
 *
 * Sin dependencias: solo secuencias ANSI y un spinner de Braille. Se degrada
 * con elegancia cuando la salida no es una TTY (CI, pipes, `--json`): no hay
 * color ni spinner y el streaming se imprime como texto plano.
 *
 * Colores: respeta `NO_COLOR` (https://no-color.org) y `TERM=dumb`.
 */
import type { EventEmitter } from 'node:events';
import type {
  ApprovalDecision,
  ApprovalRequestV2,
  CliEventV2,
  QuestionV2,
  SessionMode,
  SessionStateV2,
} from '../agent/sessionTypes';
import { DIFF_MAX_LINES, diffHunks, renderDiff, renderHunk } from './diff.js';
import { planGlyph, type PlanStatus } from '../agent/plan';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface TuiOptions {
  /** Forzar/desactivar modo interactivo (por defecto: `process.stdout.isTTY`). */
  interactive?: boolean;
  /** Forzar/desactivar color (por defecto: interactivo && !NO_COLOR). */
  color?: boolean;
}

export class Tui {
  readonly interactive: boolean;
  private readonly useColor: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private text = '';

  constructor(opts: TuiOptions = {}) {
    const isTTY = Boolean(process.stdout && process.stdout.isTTY);
    this.interactive = opts.interactive ?? (isTTY && process.env.TERM !== 'dumb');
    this.useColor = opts.color ?? (this.interactive && !process.env.NO_COLOR);
  }

  /** ¿Se están usando secuencias ANSI? El diff lo respeta para `NO_COLOR`. */
  get color(): boolean {
    return this.useColor;
  }

  private wrap(code: string, s: string): string {
    return this.useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
  }

  cyan = (s: string): string => this.wrap('36', s);
  yellow = (s: string): string => this.wrap('33', s);
  green = (s: string): string => this.wrap('32', s);
  red = (s: string): string => this.wrap('31', s);
  gray = (s: string): string => this.wrap('90', s);
  bold = (s: string): string => this.wrap('1', s);
  dim = (s: string): string => this.wrap('2', s);

  /** Escribe una línea completa en stdout. */
  line(s = ''): void {
    process.stdout.write(`${s}\n`);
  }

  /** Separador horizontal decorativo. */
  rule(width = 56): void {
    this.line(this.gray('─'.repeat(Math.max(8, width))));
  }

  /** Arranca (o reinicia el texto de) el spinner, en stderr para no ensuciar stdout. */
  startSpinner(text: string): void {
    this.text = text;
    if (!this.interactive) return;
    if (this.timer) {
      this.renderFrame();
      return;
    }
    this.frame = 0;
    this.renderFrame();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      this.renderFrame();
    }, 80);
    const t = this.timer as unknown as { unref?: () => void };
    t.unref?.();
  }

  setSpinner(text: string): void {
    this.text = text;
    if (this.timer) this.renderFrame();
  }

  stopSpinner(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.interactive) process.stderr.write('\r\x1b[K');
  }

  private renderFrame(): void {
    process.stderr.write(`\r\x1b[K${this.cyan(FRAMES[this.frame])} ${this.gray(this.text)}`);
  }
}

export interface AgentRendererOptions {
  task: string;
  model: string;
  maxSteps: number;
  serverUrl: string;
  mode?: SessionMode;
  tui?: Tui;
  /** `attach`: muestra una corrida existente en vez de iniciar una. */
  attach?: boolean;
  sessionId?: string;
  /** El REPL ya pintó su cabecera; los turnos siguientes no la repiten. */
  showHeader?: boolean;
}

/**
 * Consume los `CliAgentEvent` del bucle headless y los pinta en el terminal.
 *
 * Mantiene el estado del "streaming abierto" para intercalar sin problemas el
 * texto incremental del modelo con las líneas estructuradas (tools, pasos…).
 */
export class AgentRenderer {
  private readonly tui: Tui;
  private started = false;
  /** ¿Ya llegó algún evento del stream? Un resync posterior es una reconstrucción. */
  private sawEvent = false;
  /** ¿Hay texto de streaming pendiente de cerrar con un salto de línea? */
  private streamOpen = false;
  /** ¿Este paso ya emitió texto por streaming? (evita repetir el `thought`). */
  private streamedThisStep = false;

  constructor(private readonly opts: AgentRendererOptions) {
    this.tui = opts.tui ?? new Tui();
  }

  private ensureHeader(): void {
    if (this.started) return;
    this.started = true;
    if (this.opts.showHeader === false) return;
    const t = this.tui;
    if (this.opts.attach) {
      t.line(`${t.bold('[commander]')} ${t.cyan('adjunto')} → ${this.opts.serverUrl}`);
      t.line(`  ${t.gray('sesión')} ${t.yellow(this.opts.sessionId || this.opts.task)}`);
      t.line(
      `  ${t.gray('modelo')} ${t.yellow(this.opts.model)}   ${t.gray('objetivo')} ${this.opts.task}${this.opts.mode ? `   ${t.gray('modo')} ${t.yellow(this.opts.mode)}` : ''}`
    );
      t.rule();
      return;
    }
    t.line(`${t.bold('[commander]')} ${t.cyan('agente')} → ${this.opts.serverUrl}`);
    t.line(
      `  ${t.gray('modelo')} ${t.yellow(this.opts.model)}   ${t.gray('pasos máx')} ${this.opts.maxSteps}${this.opts.mode ? `   ${t.gray('modo')} ${t.yellow(this.opts.mode)}` : ''}`
    );
    t.line(`  ${t.gray('tarea ')} ${this.opts.task}`);
    t.rule();
  }

  /**
   * Pinta el estado que el servidor manda en un `resync`.
   *
   * Si ya se vieron eventos, se muestra sólo un aviso: el estado es
   * autoritativo, pero repetir pasos ya renderizados convertiría una caída de
   * red en un volcado duplicado. En la primera conexión sí se pinta el
   * historial, porque el buffer de la sesión se cargó de disco.
   */
  private planLine(item: SessionStateV2['plan'][number]): string {
    const status: PlanStatus = item.status ?? (item.done ? 'done' : 'pending');
    const glyph = planGlyph(status);
    const icon = status === 'done' ? this.tui.green(glyph)
      : status === 'in_progress' ? this.tui.cyan(glyph)
      : status === 'blocked' ? this.tui.yellow(glyph)
      : this.tui.gray(glyph);
    const extras: string[] = [];
    if (item.files?.length) extras.push(item.files.join(', '));
    if (item.criteria) extras.push(item.criteria);
    const detail = extras.length > 0 ? this.tui.gray(` · ${extras.join(' · ')}`) : '';
    return `  ${icon} ${item.text}${detail}`;
  }

  renderState(state: SessionStateV2): void {
    this.ensureHeader();
    this.tui.stopSpinner();
    this.closeStream();
    if (this.sawEvent) {
      this.tui.line(
        this.tui.gray(`  estado reconstruido: ${state.status} · ${state.steps.length} paso(s)`)
      );
      return;
    }
    this.sawEvent = true;
    for (const item of state.plan) {
      this.tui.line(this.planLine(item));
    }
    if (state.pendingApproval) {
      this.tui.line(
        `${this.tui.yellow('⚠')} ${this.tui.bold(state.pendingApproval.tool)} ${this.tui.gray(`espera aprobación (${state.pendingApproval.id})`)}`
      );
    }
    for (const step of state.steps) {
      if (step.type === 'tool_call') {
        this.tui.line(
          `${this.tui.cyan('  →')} ${this.tui.bold(step.toolId || step.title)} ${this.tui.gray(step.content)}`
        );
      } else if (step.type === 'tool_result') {
        const ok = step.status !== 'failed';
        this.tui.line(
          `      ${ok ? this.tui.green('✓') : this.tui.red('✗')} ${this.tui.gray(step.content)}`
        );
      } else if (step.content) {
        this.tui.line(this.tui.yellow(step.content));
      }
    }
    // El paso «Finalizado» ya contiene la respuesta; no la repetimos.
    const answerInSteps = Boolean(
      state.answer && state.steps.some((step) => step.content === state.answer)
    );
    if (state.answer && !answerInSteps) this.tui.line(this.tui.green(state.answer));
    else if (!state.answer) this.tui.line(this.tui.gray(`  estado ${state.status}`));
  }

  private closeStream(): void {
    if (this.streamOpen) {
      process.stdout.write('\n');
      this.streamOpen = false;
    }
  }

  handle(event: CliEventV2): void {
    this.ensureHeader();
    this.sawEvent = true;
    const t = this.tui;
    switch (event.type) {
      case 'status':
        this.closeStream();
        this.streamedThisStep = false;
        t.startSpinner(event.text);
        break;

      case 'chunk':
        t.stopSpinner();
        if (!this.streamOpen) {
          process.stdout.write(t.gray('  '));
          this.streamOpen = true;
        }
        process.stdout.write(event.text);
        this.streamedThisStep = true;
        break;

      case 'thought':
        // Si ya se mostró por streaming, no lo repetimos.
        if (this.streamedThisStep) break;
        t.stopSpinner();
        t.line(t.yellow(event.text));
        break;

      case 'tool_call':
        t.stopSpinner();
        this.closeStream();
        t.line(`${t.cyan('  →')} ${t.bold(event.tool)} ${t.gray(JSON.stringify(event.input))}`);
        break;

      case 'tool_result':
        this.closeStream();
        t.line(`      ${event.ok ? t.green('✓') : t.red('✗')} ${t.gray(event.summary)}`);
        break;

      case 'answer':
        t.stopSpinner();
        this.closeStream();
        if (!this.streamedThisStep) {
          t.line();
          t.line(t.green(event.text));
        }
        break;

      case 'session':
        // La cabecera ya pinta objetivo/modelo; el id solo interesa a --json.
        break;

      case 'plan':
        t.stopSpinner();
        this.closeStream();
        for (const item of event.plan) {
          t.line(this.planLine(item));
        }
        break;

      case 'approval_request':
        t.stopSpinner();
        this.closeStream();
        t.line(
          `${t.yellow('⚠')} ${t.bold(event.approval.tool)} ${t.gray(`espera aprobación (${event.approval.id})`)}`
        );
        break;

      case 'approval_result':
        t.line(
          `      ${event.decision === 'deny' ? t.red('✗') : t.green('✓')} ${t.gray(`aprobación ${event.decision}`)}`
        );
        break;

      case 'question':
        // El prompt de la pregunta se pinta desde `bin/commander.ts`; aquí solo
        // cerramos el stream para no mezclarlo con la entrada interactiva.
        t.stopSpinner();
        this.closeStream();
        break;

      case 'done':
        // `bin/commander.ts` imprime el cierre con el resumen de la corrida.
        break;

      case 'error':
        t.stopSpinner();
        this.closeStream();
        t.line(`${t.red('✗')} ${t.red(event.text)}`);
        break;
    }
  }

  finish(answer: string, steps: number): void {
    this.ensureHeader();
    this.tui.stopSpinner();
    this.closeStream();
    this.tui.rule();
    if (answer) {
      this.tui.line(
        `${this.tui.green('✔')} ${this.tui.bold('Listo')} ${this.tui.gray(`(${steps} paso(s))`)}`
      );
    } else {
      this.tui.line(`${this.tui.red('✗')} Sin respuesta final ${this.tui.gray(`(${steps} paso(s))`)}`);
    }
  }
}

export interface ApprovalPromptInput extends EventEmitter {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  resume?: () => unknown;
  pause?: () => unknown;
}

export interface ApprovalPromptOutput {
  isTTY?: boolean;
  write: (text: string) => unknown;
}

export interface ApprovalPromptOptions {
  tui: Tui;
  input?: ApprovalPromptInput;
  output?: ApprovalPromptOutput;
  signal?: AbortSignal;
  /** Ctrl+C durante la elección: el llamador decide si corta la corrida. */
  onInterrupt?: () => void;
}

const APPROVAL_CHOICES: ReadonlyArray<{
  value: ApprovalDecision;
  label: string;
  hint: string;
}> = [
  { value: 'allow', label: 'Permitir una vez', hint: 'ejecuta sólo esta llamada' },
  { value: 'deny', label: 'Denegar', hint: 'la tool no se ejecuta' },
  { value: 'allow-session', label: 'Permitir en esta sesión', hint: 'misma tool y objetivo' },
];

/** ¿Hay una terminal real para preguntar? Con pipes o `--json` decide el escritorio. */
export function canPromptApprovals(
  input: Pick<ApprovalPromptInput, 'isTTY'> = process.stdin as unknown as ApprovalPromptInput,
  output: Pick<ApprovalPromptOutput, 'isTTY'> = process.stdout as unknown as ApprovalPromptOutput
): boolean {
  return Boolean(input?.isTTY && output?.isTTY);
}

function approvalDetail(approval: ApprovalRequestV2): string {
  const input = (approval.input ?? {}) as Record<string, unknown>;
  const raw = typeof input.path === 'string'
    ? input.path
    : typeof input.command === 'string'
      ? input.command
      : typeof input.query === 'string'
        ? input.query
        : '';
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, 120);
}

type ApprovalKey =
  | 'up'
  | 'down'
  | 'enter'
  | 'escape'
  | 'interrupt'
  | '1'
  | '2'
  | '3'
  | 'j'
  | 'k'
  | 'a'
  | 'd'
  | 's'
  | 'q'
  | 'detail'
  | 'other';

/** Separa un chunk de stdin en teclas, incluidas las flechas ANSI. */
function parseApprovalKeys(data: string): ApprovalKey[] {
  const keys: ApprovalKey[] = [];
  for (let i = 0; i < data.length; i += 1) {
    const char = data[i];
    if (char === '\x1b') {
      const rest = data.slice(i);
      if (rest.startsWith('\x1b[A') || rest.startsWith('\x1bOA')) {
        keys.push('up');
        i += 2;
        continue;
      }
      if (rest.startsWith('\x1b[B') || rest.startsWith('\x1bOB')) {
        keys.push('down');
        i += 2;
        continue;
      }
      keys.push('escape');
      continue;
    }
    if (char === '\r' || char === '\n') {
      keys.push('enter');
      continue;
    }
    if (char === '\x03') {
      keys.push('interrupt');
      continue;
    }
    if (char === '1' || char === '2' || char === '3') {
      keys.push(char);
      continue;
    }
    if (char === 'j') {
      keys.push('j');
      continue;
    }
    if (char === 'k') {
      keys.push('k');
      continue;
    }
    if (char === 'a' || char === 'd' || char === 's' || char === 'q') {
      keys.push(char);
      continue;
    }
    if (char === '?') {
      keys.push('detail');
      continue;
    }
    keys.push('other');
  }
  return keys;
}

/**
 * Menú de una aprobación pendiente: allow, deny o allow-session.
 *
 * Devuelve `null` si se deja al escritorio (Esc), si el stream termina o si el
 * llamador aborta. Restaura el modo raw pase lo que pase.
 */
export function promptApprovalDecision(
  approval: ApprovalRequestV2,
  opts: ApprovalPromptOptions
): Promise<ApprovalDecision | null> {
  const input = opts.input ?? (process.stdin as unknown as ApprovalPromptInput);
  const output = opts.output ?? (process.stdout as unknown as ApprovalPromptOutput);
  const t = opts.tui;

  return new Promise<ApprovalDecision | null>((resolve) => {
    let index = 0;
    let detailIndex = 0;
    let settled = false;

    const cleanup = (): void => {
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('close', onEnd);
      input.removeListener('error', onEnd);
      opts.signal?.removeEventListener('abort', onAbort);
      try {
        input.setRawMode?.(false);
      } catch {
        /* la terminal ya se restauró */
      }
      try {
        input.pause?.();
      } catch {
        /* stdin cerrado */
      }
    };

    const finish = (decision: ApprovalDecision | null, note?: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (note) output.write(`${t.gray(`  ${note}`)}\n`);
      output.write('\n');
      resolve(decision);
    };

    const renderMenu = (redraw: boolean): void => {
      if (redraw) output.write(`\x1b[${APPROVAL_CHOICES.length}A\x1b[J`);
      APPROVAL_CHOICES.forEach((choice, i) => {
        const selected = i === index;
        output.write(
          `${selected ? t.cyan('❯') : ' '} ${t.bold(`${i + 1})`)} ${
            selected ? choice.label : t.gray(choice.label)
          }${selected ? t.gray(`  · ${choice.hint}`) : ''}\n`
        );
      });
    };

    const move = (delta: number): void => {
      index = (index + delta + APPROVAL_CHOICES.length) % APPROVAL_CHOICES.length;
      renderMenu(true);
    };

    const onData = (chunk: Buffer | string): void => {
      if (settled) return;
      for (const key of parseApprovalKeys(String(chunk))) {
        if (settled) return;
        if (key === 'up' || key === 'k') move(-1);
        else if (key === 'down' || key === 'j') move(1);
        else if (key === 'enter') finish(APPROVAL_CHOICES[index].value);
        else if (key === '1' || key === 'a') finish(APPROVAL_CHOICES[0].value);
        else if (key === '2' || key === 'd') finish(APPROVAL_CHOICES[1].value);
        else if (key === '3' || key === 's') finish(APPROVAL_CHOICES[2].value);
        else if (key === 'q') {
          finish('deny', 'denegado y detenido');
          opts.onInterrupt?.();
        } else if (key === 'detail') {
          const hunks = approval.diff ? diffHunks(approval.diff) : [];
          if (hunks.length > 0 && approval.diff) {
            output.write(`${t.gray(`  hunk ${detailIndex + 1}/${hunks.length}`)}\n`);
            for (const line of renderHunk(approval.diff, detailIndex, { color: t.color }) ?? []) {
              output.write(`${line}\n`);
            }
            detailIndex = (detailIndex + 1) % hunks.length;
          }
        }
        else if (key === 'escape') finish(null, 'decisión dejada al escritorio');
        else if (key === 'interrupt') {
          finish(null);
          opts.onInterrupt?.();
        }
      }
    };
    const onEnd = (): void => finish(null);
    const onAbort = (): void => finish(null);

    const detail = approvalDetail(approval);
    output.write(
      `${t.yellow('⚠')} ${t.bold(approval.tool)}${detail ? ` ${t.gray(detail)}` : ''} ${t.gray(`· ${approval.id}`)}\n`
    );
    if (approval.diff) {
      // Diff por hunk con números de línea; si no cabe, el propio render avisa.
      for (const line of renderDiff(approval.diff, { color: t.color, maxLines: DIFF_MAX_LINES }).lines) {
        output.write(`${line}\n`);
      }
    }
    renderMenu(false);
    output.write(
      t.gray(
        '  a permitir · d denegar · s en esta sesión · ? detalle del hunk · q detener\n' +
          '  ↑/↓ o j/k · Enter · 1/2/3 directo · Esc deja la decisión al escritorio\n'
      )
    );

    try {
      input.setRawMode?.(true);
    } catch {
      /* sin TTY real: el llamador ya comprobó canPromptApprovals */
    }
    input.resume?.();
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('close', onEnd);
    input.once('error', onEnd);
    if (opts.signal) {
      if (opts.signal.aborted) {
        finish(null);
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export interface QuestionPromptOptions extends ApprovalPromptOptions {
  /** Tiempo máximo de espera; por defecto 10 min (F1-06). */
  timeoutMs?: number;
}

export interface QuestionPromptResult {
  answer: string | null;
  reason?: 'cancelled' | 'timeout';
}

export const QUESTION_TIMEOUT_MS = 10 * 60 * 1000;

type QuestionKey =
  | { kind: 'enter' }
  | { kind: 'backspace' }
  | { kind: 'escape' }
  | { kind: 'interrupt' }
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'char'; value: string };

/** Separa un chunk de stdin en teclas para el prompt de `ask_user`. */
function parseQuestionKeys(data: string): QuestionKey[] {
  const keys: QuestionKey[] = [];
  for (let i = 0; i < data.length; i += 1) {
    const char = data[i];
    if (char === '\x1b') {
      const rest = data.slice(i);
      if (rest.startsWith('\x1b[A') || rest.startsWith('\x1bOA')) {
        keys.push({ kind: 'up' });
        i += 2;
        continue;
      }
      if (rest.startsWith('\x1b[B') || rest.startsWith('\x1bOB')) {
        keys.push({ kind: 'down' });
        i += 2;
        continue;
      }
      keys.push({ kind: 'escape' });
      continue;
    }
    if (char === '\r' || char === '\n') {
      keys.push({ kind: 'enter' });
      continue;
    }
    if (char === '\x7f' || char === '\x08') {
      keys.push({ kind: 'backspace' });
      continue;
    }
    if (char === '\x03') {
      keys.push({ kind: 'interrupt' });
      continue;
    }
    if (char >= ' ') keys.push({ kind: 'char', value: char });
  }
  return keys;
}

/**
 * Pregunta de `ask_user`: opciones numeradas, texto libre y cancelación con
 * `q`/Esc/Ctrl+C. Devuelve `null` con motivo `timeout` a los 10 minutos.
 *
 * A diferencia del menú de aprobaciones, las opciones no se recorren con
 * flechas: se eligen por número para que el texto libre siga siendo directo.
 * Restaura el modo raw y quita sus listeners pase lo que pase.
 */
export function promptQuestionAnswer(
  question: QuestionV2,
  opts: QuestionPromptOptions
): Promise<QuestionPromptResult> {
  const input = opts.input ?? (process.stdin as unknown as ApprovalPromptInput);
  const output = opts.output ?? (process.stdout as unknown as ApprovalPromptOutput);
  const t = opts.tui;
  const options = (question.options ?? [])
    .map((option) => String(option).trim())
    .filter(Boolean)
    .slice(0, 6);
  const allowFreeText = question.allowFreeText !== false;

  return new Promise<QuestionPromptResult>((resolve) => {
    let buffer = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('close', onEnd);
      input.removeListener('error', onEnd);
      opts.signal?.removeEventListener('abort', onAbort);
      try {
        input.setRawMode?.(false);
      } catch {
        /* la terminal ya se restauró */
      }
      try {
        input.pause?.();
      } catch {
        /* stdin cerrado */
      }
    };

    const finish = (result: QuestionPromptResult, note?: string, echo?: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result.answer) {
        output.write(echo ? `${echo}\n` : '\n');
      } else {
        output.write(`\n${t.gray(`  ${note ?? 'pregunta cancelada'}`)}\n`);
      }
      resolve(result);
    };

    const invalid = (detail: string): void => {
      output.write(
        `\n${t.red('  opción inválida')} ${t.gray(detail)}\n${t.cyan('  › ')}`
      );
    };

    const onData = (chunk: Buffer | string): void => {
      if (settled) return;
      for (const key of parseQuestionKeys(String(chunk))) {
        if (settled) return;
        if (key.kind === 'up' || key.kind === 'down') continue;
        if (key.kind === 'escape') {
          finish({ answer: null, reason: 'cancelled' }, 'pregunta cancelada');
          return;
        }
        if (key.kind === 'interrupt') {
          finish({ answer: null, reason: 'cancelled' }, 'pregunta cancelada');
          opts.onInterrupt?.();
          return;
        }
        if (key.kind === 'backspace') {
          if (!buffer) continue;
          buffer = buffer.slice(0, -1);
          output.write('\b \b');
          continue;
        }
        if (key.kind === 'enter') {
          const answer = buffer.trim();
          if (answer) finish({ answer });
          else if (options.length) invalid(`elige 1-${options.length} o escribe una respuesta`);
          else invalid('escribe una respuesta');
          continue;
        }

        const value = key.value;
        if (!buffer && options.length && /^\d$/.test(value)) {
          const option = options[Number(value) - 1];
          if (option) finish({ answer: option }, undefined, option);
          else invalid(`no hay opción ${value}; elige 1-${options.length}`);
          continue;
        }
        if (!buffer && value === 'q') {
          finish({ answer: null, reason: 'cancelled' }, 'pregunta cancelada');
          return;
        }
        if (!allowFreeText) {
          invalid(options.length ? 'elige una opción numerada' : 'esta pregunta no acepta texto libre');
          continue;
        }
        buffer += value;
        output.write(value);
      }
    };
    const onEnd = (): void =>
      finish({ answer: null, reason: 'cancelled' }, 'pregunta cancelada');
    const onAbort = (): void =>
      finish({ answer: null, reason: 'cancelled' }, 'pregunta cancelada');

    output.write(
      `${t.yellow('?')} ${t.bold(question.header?.trim() || 'Pregunta del agente')}\n`
    );
    output.write(`${question.text}\n`);
    options.forEach((option, i) => {
      output.write(`  ${t.cyan(`${i + 1})`)} ${option}\n`);
    });
    output.write(
      t.gray(
        allowFreeText
          ? '  Escribe la respuesta y pulsa Enter · q cancela\n'
          : '  Elige una opción · q cancela\n'
      )
    );
    output.write(t.cyan('  › '));

    timer = setTimeout(
      () => finish({ answer: null, reason: 'timeout' }, 'tiempo agotado'),
      Math.max(1, opts.timeoutMs ?? QUESTION_TIMEOUT_MS)
    );

    try {
      input.setRawMode?.(true);
    } catch {
      /* sin TTY real: el llamador ya comprobó canPromptApprovals */
    }
    input.resume?.();
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('close', onEnd);
    input.once('error', onEnd);
    if (opts.signal) {
      if (opts.signal.aborted) {
        finish({ answer: null, reason: 'cancelled' }, 'pregunta cancelada');
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
