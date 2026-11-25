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
  ApprovalRenderFacts,
  ApprovalRequestV2,
  CliEventV2,
  QuestionV2,
  SessionMode,
  SessionStateV2,
} from '../agent/sessionTypes';
import { DIFF_MAX_LINES, diffHunks, renderDiff, renderHunk } from './diff.js';
import type { InputGate } from './stdinGate.js';
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
  /** Aprobaciones ya anunciadas: un resync no vuelve a sonar. */
  private readonly alertedApprovals = new Set<string>();
  /** Aprobación cuyo título está puesto ahora mismo. */
  private activeAlertId: string | null = null;

  constructor(opts: TuiOptions = {}) {
    const isTTY = Boolean(process.stdout && process.stdout.isTTY);
    this.interactive = opts.interactive ?? (isTTY && process.env.TERM !== 'dumb');
    this.useColor = opts.color ?? (this.interactive && !process.env.NO_COLOR);
  }

  /** ¿Se están usando secuencias ANSI? El diff lo respeta para `NO_COLOR`. */
  get color(): boolean {
    return this.useColor;
  }

  /**
   * Aviso de aprobación pendiente: campana, título de la terminal y renglón.
   *
   * El renglón no se repite cuando el prompt ya pinta su propia cabecera; para
   * ese caso está `approvalBell`, que sólo deja la campana y el título.
   */
  approvalAlert(approval: ApprovalRequestV2): void {
    if (!this.markApprovalAlert(approval)) return;
    if (this.interactive) process.stdout.write(approvalAlertText(approval));
    this.line(
      `${this.yellow('⚠')} ${this.bold(plainApprovalLabel(approval.tool))} ${this.gray(
        `espera aprobación (${plainApprovalLabel(approval.id)})${approvalQueueText(approval.queueDepth)}`
      )}`
    );
  }

  /** Campana y título de terminal, sin renglón: el prompt pinta el aviso. */
  approvalBell(approval: ApprovalRequestV2): void {
    if (!this.markApprovalAlert(approval)) return;
    if (this.interactive) process.stdout.write(approvalAlertText(approval));
  }

  /**
   * Restaura el título cuando la aprobación deja de estar pendiente.
   *
   * Si llega el resultado de una aprobación anterior mientras otra sigue
   * activa, no toca el título: el aviso vigente manda.
   */
  approvalResolved(approvalId?: string): void {
    if (approvalId !== undefined && this.activeAlertId !== approvalId) return;
    if (this.activeAlertId === null) return;
    this.activeAlertId = null;
    if (this.interactive) process.stdout.write(approvalTitleRestoreText());
  }

  private markApprovalAlert(approval: ApprovalRequestV2): boolean {
    if (this.alertedApprovals.has(approval.id)) return false;
    this.alertedApprovals.add(approval.id);
    this.activeAlertId = approval.id;
    // Primer aviso visible: un resync o un repintado no reescriben el instante.
    approval.noticeAt ??= Date.now();
    return true;
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
    if (state.pendingApproval) this.tui.approvalAlert(state.pendingApproval);
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
        t.approvalAlert(event.approval);
        break;

      case 'approval_result': {
        t.approvalResolved(event.approvalId);
        const desdetecla =
          event.decisionMs !== undefined ? ` · ${event.decisionMs} ms desde la primera tecla de lectura` : '';
        t.line(
          `      ${event.decision === 'deny' ? t.red('✗') : t.green('✓')} ${t.gray(
            `aprobación ${event.decision}${event.latencyMs !== undefined ? ` · ${event.latencyMs} ms` : ''}${desdetecla}`
          )}`
        );
        break;
      }

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
    this.tui.approvalResolved();
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

/** Fuente de `SIGWINCH`; por defecto `process`, los tests pasan un emisor falso. */
export interface ApprovalPromptResizeSource {
  on: (event: 'SIGWINCH', listener: () => void) => unknown;
  removeListener: (event: 'SIGWINCH', listener: () => void) => unknown;
}

/**
 * Cada cuánto se repinta el menú mientras espera.
 *
 * Una terminal puede perder lo pintado sin avisar (el caso de `CAL2-R16`: el
 * panel quedó en blanco con el prompt abierto). El latido devuelve la imagen sin
 * pedirle al operador que pulse `↓`/`↑`, y con una tecla pendiente no decide nada.
 */
export const APPROVAL_REPAINT_MS = 5_000;
export const APPROVAL_COUNTDOWN_MS = 1_000;
/** Aviso único cuando quedan 30 s o menos para que la aprobación caduque. */
export const APPROVAL_EXPIRY_WARNING_MS = 30_000;

/**
 * Cuarentena de las primeras teclas del menú.
 *
 * Al abrir el prompt, un Enter que ya estaba en stdin puede llegar antes de que
 * el operador vea las opciones. El prompt lo descarta durante esta ventana y lo
 * cuenta en `quarantinedKeys`; si la tecla habría decidido, además marca
 * `quarantinedDecision` para que la muestra se pueda revisar. Sólo se aplica sin
 * `InputGate`: con compuerta, lo previo al prompt ya se descartó y una segunda
 * ventana ciega sólo podría tragarse una tecla legítima.
 */
export const APPROVAL_KEY_QUARANTINE_MS = 150;

/** Quita controles para que una tool o un id no inyecten en la terminal. */
function plainApprovalLabel(value: unknown, max = 120): string {
  return String(value ?? '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .slice(0, max);
}

/** Campana más título ANSI/OSC; el `\x07` final cierra el título. */
export function approvalAlertText(approval: ApprovalRequestV2): string {
  const tool = plainApprovalLabel(approval.tool, 80) || 'tool';
  return `\x07\x1b]0;⚠ aprobación pendiente: ${tool}${approvalQueueText(approval.queueDepth)}\x07`;
}

/** Sufijo de cola del aviso; vacío cuando no hay otras aprobaciones delante. */
export function approvalQueueText(queueDepth?: number): string {
  return typeof queueDepth === 'number' && Number.isFinite(queueDepth) && queueDepth > 0
    ? ` · cola: ${queueDepth}`
    : '';
}

/**
 * Vuelve al título de la aplicación.
 *
 * No hay una forma portable de leer el título anterior del terminal; el CLI
 * usa el nombre de la app como estado seguro y evita dejar «⚠ aprobación
 * pendiente» después de decidir.
 */
export function approvalTitleRestoreText(): string {
  return '\x1b]0;commander\x07';
}

/** Texto de cuenta regresiva; vacío si el pedido no tiene expiración válida. */
export function approvalExpiryText(expiresAt: number, now = Date.now()): string {
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return '';
  const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1_000));
  return ` · expira en ${remaining}s`;
}

/**
 * Aviso único de expiración: sólo en la ventana de 30 s previos y nunca si el
 * pedido ya venció. La cuenta regresiva normal sigue mostrando el resto.
 */
export function approvalExpiryWarningText(
  expiresAt: number,
  now = Date.now(),
  warningMs = APPROVAL_EXPIRY_WARNING_MS
): string {
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return '';
  const remaining = expiresAt - now;
  if (remaining <= 0 || remaining > warningMs) return '';
  return `la aprobación caduca en ${Math.max(0, Math.ceil(remaining / 1_000))}s`;
}

export interface ApprovalPromptOptions {
  tui: Tui;
  input?: ApprovalPromptInput;
  output?: ApprovalPromptOutput;
  signal?: AbortSignal;
  /** Fuente del evento de resize (por defecto `process`). */
  resizeSource?: ApprovalPromptResizeSource;
  /** Latido de repintado en ms; `0` lo desactiva. */
  repaintMs?: number;
  /**
   * Ventana de cuarentena inicial en ms; `0` la desactiva (tests, prompt suelto).
   * Con `gate`, se ignora: la compuerta ya descarta lo tecleado antes del prompt.
   */
  quarantineMs?: number;
  /** Ctrl+C durante la elección: el llamador decide si corta la corrida. */
  onInterrupt?: () => void;
  /**
   * Compuerta de stdin de la corrida: descarta lo que se tecleó antes de que
   * este prompt abriera, para que una tecla sobrante del prompt anterior no se
   * lea como decisión. Sin ella se lee stdin directamente (tests, un prompt
   * suelto).
   */
  gate?: InputGate;
}

const APPROVAL_FOOTER =
  '  a permitir · d denegar · s en esta sesión · ?/¿/h detalle del hunk · q detener\n' +
  '  ↑/↓ o j/k · Enter · 1/2/3 directo · Esc deja la decisión al escritorio\n';
const APPROVAL_FOOTER_LINES = 2;
const APPROVAL_STATUS_LINES = 1;

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

/** Texto de terminal sin controles, pero conservando saltos y tabulaciones. */
function safeShellText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    // Se conservan \n (0x0a) y \t (0x09); se eliminan ESC y demás C0/C1.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/** Timeout efectivo que aplica el servidor: default 30 s y techo 60 s. */
function shellTimeoutText(input: Record<string, unknown>): string {
  const requested = Number(input.timeoutMs);
  if (!Number.isFinite(requested) || requested <= 0) return '30000 ms (por defecto)';
  if (requested > 60_000) return `60000 ms (solicitado ${requested} ms; máximo)`;
  return `${requested} ms`;
}

/** Cabecera de shell.run: comando completo, cwd, timeout y riesgo. */
function shellApprovalLines(approval: ApprovalRequestV2): string[] {
  const input = (approval.input ?? {}) as Record<string, unknown>;
  const command = safeShellText(input.command);
  const commandLines = command.length > 0 ? command.split('\n') : ['(vacío)'];
  const cwd = safeShellText(input.cwd).replace(/\s+/g, ' ').trim() || '(raíz del workspace)';
  const flags: string[] = [];
  if (input.allowUnlisted === true) flags.push('fuera de la allowlist');
  if (input.interactive === true) flags.push('stdin interactivo');
  if (input.background === true) flags.push('segundo plano');
  const risk = flags.length > 0
    ? `${flags.join(' · ')}; revisá el comando completo antes de permitir`
    : 'comando shell; revisá el comando completo antes de permitir';

  return [
    ...(approval.repeatOf
      ? [
          `  repetición: comando idéntico al anterior; confirmá explícitamente para volver a ejecutarlo`,
        ]
      : []),
    `  comando:`,
    ...commandLines.map((line) => `    ${line}`),
    `  cwd: ${cwd}`,
    `  timeout: ${shellTimeoutText(input)}`,
    `  riesgo: ${risk}`,
  ];
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

function isDecisionKey(key: ApprovalKey): boolean {
  return (
    key === 'enter' ||
    key === '1' ||
    key === '2' ||
    key === '3' ||
    key === 'a' ||
    key === 'd' ||
    key === 's' ||
    key === 'q'
  );
}

/** Esc y Ctrl+C cierran el prompt, pero no son una decisión de aprobación. */
function isExitKey(key: ApprovalKey): boolean {
  return key === 'escape' || key === 'interrupt';
}

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
    // `?` es la tecla documentada, pero no llega en todos los teclados: con
    // layout español la combinación puede entregar `¿` y en algunas terminales
    // no hay forma de escribir `?` en modo raw. `h` (hunk) es el atajo que
    // siempre está a mano, y las tres abren el detalle igual.
    if (char === '?' || char === '¿' || char === 'h') {
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
  approval.promptStartedAt = Date.now();
  // Si el prompt es la primera superficie visible (adjuntar una sesión o
  // `--json` con menú en stderr), el reloj del aviso arranca aquí.
  approval.noticeAt ??= approval.promptStartedAt;

  return new Promise<ApprovalDecision | null>((resolve) => {
    let index = 0;
    let detailIndex = 0;
    let settled = false;
    let detachGate: (() => void) | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let expiryWarningTimer: ReturnType<typeof setTimeout> | null = null;
    let repaintTimer: ReturnType<typeof setInterval> | null = null;
    let countdownTimer: ReturnType<typeof setInterval> | null = null;
    let expiryWarningShown = false;
    const resizeSource = opts.resizeSource ?? (process as unknown as ApprovalPromptResizeSource);
    /** Líneas pintadas debajo del pie desde el último repintado (aviso o detalle). */
    let linesBelowMenu = 0;
    /** Instante del primer pintado; 0 hasta que el menú está en pantalla. */
    let paintedAt = 0;
    // La compuerta ya es la autoridad sobre lo tecleado antes del prompt. Sumar
    // una cuarentena posterior sólo abriría otra ventana ciega.
    const quarantineMs = opts.gate ? 0 : Math.max(0, opts.quarantineMs ?? 0);
    // Evidencia de I2 (protocolo CAL2 §12.3): qué se pintó antes de decidir.
    const rendered: ApprovalRenderFacts = { diffShown: false, diffTruncated: false, detailOpened: false };

    const cleanup = (): void => {
      if (expiryTimer) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
      if (expiryWarningTimer) {
        clearTimeout(expiryWarningTimer);
        expiryWarningTimer = null;
      }
      if (repaintTimer) {
        clearInterval(repaintTimer);
        repaintTimer = null;
      }
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
      resizeSource.removeListener('SIGWINCH', repaint);
      if (detachGate) detachGate();
      else input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('close', onEnd);
      input.removeListener('error', onEnd);
      opts.signal?.removeEventListener('abort', onAbort);
      try {
        input.setRawMode?.(false);
      } catch {
        /* la terminal ya se restauró */
      }
      if (!opts.gate) {
        try {
          input.pause?.();
        } catch {
          /* stdin cerrado */
        }
      }
    };

    const finish = (decision: ApprovalDecision | null, note?: string): void => {
      if (settled) return;
      settled = true;
      approval.decisionAt = Date.now();
      // Copia, no la referencia: lo que se resuelva después no reescribe la evidencia.
      approval.render = { ...rendered };
      t.approvalResolved(approval.id);
      cleanup();
      if (note) output.write(`${t.gray(`  ${note}`)}\n`);
      output.write('\n');
      resolve(decision);
    };

    const statusLine = (): string => {
      const ageSeconds =
        Number.isFinite(approval.createdAt) && approval.createdAt > 0
          ? Math.max(0, Math.floor((Date.now() - approval.createdAt) / 1_000))
          : 0;
      const droppedDecision = approval.quarantinedDecision ? ' · tecla decisoria descartada' : '';
      const expiry = approvalExpiryText(approval.expiresAt);
      return t.gray(
        `  esperando hace ${ageSeconds}s${approvalQueueText(approval.queueDepth)}${droppedDecision}${expiry}`
      );
    };

    const expiryWarningLine = (): string => {
      const warning = approvalExpiryWarningText(approval.expiresAt);
      return warning ? `${t.yellow('⚠')} ${t.gray(warning)}` : '';
    };

    /** Pinta el aviso bajo el pie y lo cuenta para el próximo repintado. */
    const paintExpiryWarning = (bell: boolean): boolean => {
      const warning = expiryWarningLine();
      if (!warning) return false;
      output.write(`${bell ? '\x07' : ''}${warning}\n`);
      linesBelowMenu += 1;
      return true;
    };

    const showExpiryWarning = (): void => {
      if (settled || expiryWarningShown) return;
      // Campana sólo en el aviso puntual; en un repintado se conserva la línea,
      // no se vuelve a sonar.
      if (!paintExpiryWarning(true)) {
        // El `setTimeout` puede dispararse una fracción antes del umbral (Node
        // no garantiza el retardo mínimo) y entonces el texto todavía está
        // vacío. Se reprograma en vez de perder el único aviso para siempre.
        const remaining = approval.expiresAt - APPROVAL_EXPIRY_WARNING_MS - Date.now();
        if (!settled && remaining > 0) {
          expiryWarningTimer = setTimeout(showExpiryWarning, remaining + 1);
          expiryWarningTimer.unref?.();
        }
        return;
      }
      expiryWarningShown = true;
    };

    // Menú y pie se pintan juntos: así el repintado sabe exactamente cuántas
    // líneas tiene que recuperar para reescribirlas en la posición correcta.
    const renderMenu = (redraw: boolean): void => {
      if (redraw) {
        output.write(
          `\x1b[${APPROVAL_CHOICES.length + APPROVAL_FOOTER_LINES + APPROVAL_STATUS_LINES + linesBelowMenu}A\x1b[J`
        );
      }
      linesBelowMenu = 0;
      output.write(`${statusLine()}\n`);
      APPROVAL_CHOICES.forEach((choice, i) => {
        const selected = i === index;
        output.write(
          `${selected ? t.cyan('❯') : ' '} ${t.bold(`${i + 1})`)} ${
            selected ? choice.label : t.gray(choice.label)
          }${selected ? t.gray(`  · ${choice.hint}`) : ''}\n`
        );
      });
      output.write(t.gray(APPROVAL_FOOTER));
      if (expiryWarningShown) paintExpiryWarning(false);
    };

    /** Repinta sin leer ninguna tecla: sirve para resize y para el latido. */
    const repaint = (): void => {
      if (settled) return;
      renderMenu(true);
    };

    /**
     * Actualiza sólo el renglón de estado. No borra el aviso ni el detalle del
     * hunk: mueve el cursor al estado, lo reescribe y vuelve al punto donde estaba.
     */
    const refreshStatus = (): void => {
      if (settled) return;
      const above =
        APPROVAL_CHOICES.length + APPROVAL_FOOTER_LINES + APPROVAL_STATUS_LINES + linesBelowMenu;
      output.write(`\x1b7\x1b[${above}A\r\x1b[2K${statusLine()}\n\x1b8`);
    };

    const move = (delta: number): void => {
      index = (index + delta + APPROVAL_CHOICES.length) % APPROVAL_CHOICES.length;
      renderMenu(true);
    };

    const onData = (chunk: Buffer | string): void => {
      if (settled) return;
      const keys = parseApprovalKeys(String(chunk));
      if (keys.length === 0) return;
      const receivedAt = Date.now();
      // Un Enter heredado puede llegar en el primer instante: se descarta antes
      // de interpretarlo, no después de que ya aprobó la tool.
      if (quarantineMs > 0 && receivedAt - paintedAt < quarantineMs) {
        const droppedDecision = keys.some(isDecisionKey);
        const firstDroppedDecision = droppedDecision && approval.quarantinedDecision !== true;
        if (droppedDecision) approval.quarantinedDecision = true;
        approval.quarantinedKeys = (approval.quarantinedKeys ?? 0) + keys.length;
        if (firstDroppedDecision) {
          output.write(`${t.yellow('⚠')} ${t.gray('tecla de decisión descartada al abrir; repetí')}\n`);
          linesBelowMenu += 1;
        }
        return;
      }
      for (const key of keys) {
        if (settled) return;
        if (approval.firstInputAt === undefined) approval.firstInputAt = approval.firstKeyAt ?? receivedAt;
        if (approval.firstKeyAt === undefined) approval.firstKeyAt = approval.firstInputAt;
        // La lectura empieza con la primera tecla que no decide. Una decisión
        // directa no inventa `decisionMs ≈ 0`: queda marcada como tal.
        if (isDecisionKey(key)) {
          if (approval.firstNonDecisionKeyAt === undefined) approval.directDecision = true;
        } else if (!isExitKey(key) && approval.firstNonDecisionKeyAt === undefined) {
          approval.firstNonDecisionKeyAt = receivedAt;
        }
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
            rendered.detailOpened = true;
            output.write(`${t.gray(`  hunk ${detailIndex + 1}/${hunks.length}`)}\n`);
            const hunkLines = renderHunk(approval.diff, detailIndex, { color: t.color }) ?? [];
            for (const line of hunkLines) output.write(`${line}\n`);
            detailIndex = (detailIndex + 1) % hunks.length;
            // Lo pintado bajo el pie se cuenta para que el repintado suba por encima.
            linesBelowMenu += 1 + hunkLines.length;
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

    if (approval.tool === 'shell.run') {
      output.write(`${t.yellow('⚠')} ${t.bold(approval.tool)} ${t.gray(`· ${approval.id}`)}\n`);
      for (const line of shellApprovalLines(approval)) {
        output.write(`${t.gray(line)}\n`);
      }
    } else {
      const detail = approvalDetail(approval);
      output.write(
        `${t.yellow('⚠')} ${t.bold(approval.tool)}${detail ? ` ${t.gray(detail)}` : ''} ${t.gray(`· ${approval.id}`)}\n`
      );
    }
    if (approval.diff) {
      // Diff por hunk con números de línea; si no cabe, el propio render avisa.
      const block = renderDiff(approval.diff, { color: t.color, maxLines: DIFF_MAX_LINES });
      for (const line of block.lines) output.write(`${line}\n`);
      rendered.diffShown = block.lines.length > 0;
      rendered.diffTruncated = block.truncated;
    }
    renderMenu(false);
    paintedAt = Date.now();
    approval.promptPaintedAt = paintedAt;

    // Aviso único a los 30 s restantes. Si el prompt se abre dentro de esa
    // ventana (por ejemplo, después de una cola), avisa de inmediato.
    if (Number.isFinite(approval.expiresAt) && approval.expiresAt > 0) {
      const warningIn = approval.expiresAt - APPROVAL_EXPIRY_WARNING_MS - Date.now();
      if (warningIn <= 0) {
        showExpiryWarning();
      } else {
        expiryWarningTimer = setTimeout(showExpiryWarning, warningIn);
        expiryWarningTimer.unref?.();
      }
    }

    // La terminal puede perder lo pintado sin avisar: el menú se recupera solo con
    // un cambio de tamaño y con un latido mientras espera (CAL2-R16).
    resizeSource.on('SIGWINCH', repaint);
    const repaintMs = opts.repaintMs ?? APPROVAL_REPAINT_MS;
    if (repaintMs > 0) {
      repaintTimer = setInterval(repaint, repaintMs);
      // El latido no puede mantener vivo el proceso al cerrar el prompt.
      repaintTimer.unref?.();
    }
    if (Number.isFinite(approval.expiresAt) && approval.expiresAt > 0) {
      countdownTimer = setInterval(refreshStatus, APPROVAL_COUNTDOWN_MS);
      countdownTimer.unref?.();
    }

    // Un prompt sin operador delante no puede quedarse abierto horas: al pasar
    // de `expiresAt` se resuelve como `deny` y queda anotado en la evidencia.
    if (Number.isFinite(approval.expiresAt) && approval.expiresAt > 0) {
      expiryTimer = setTimeout(() => {
        rendered.expired = true;
        finish('deny', 'aprobación caducada: nadie la decidió antes de expiresAt');
      }, Math.max(0, approval.expiresAt - Date.now()));
    }

    try {
      input.setRawMode?.(true);
    } catch {
      /* sin TTY real: el llamador ya comprobó canPromptApprovals */
    }
    input.resume?.();
    if (opts.gate) detachGate = opts.gate.attach(onData);
    else input.on('data', onData);
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
    let detachGate: (() => void) | null = null;

    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (detachGate) detachGate();
      else input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('close', onEnd);
      input.removeListener('error', onEnd);
      opts.signal?.removeEventListener('abort', onAbort);
      try {
        input.setRawMode?.(false);
      } catch {
        /* la terminal ya se restauró */
      }
      if (!opts.gate) {
        try {
          input.pause?.();
        } catch {
          /* stdin cerrado */
        }
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
    if (opts.gate) detachGate = opts.gate.attach(onData);
    else input.on('data', onData);
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
