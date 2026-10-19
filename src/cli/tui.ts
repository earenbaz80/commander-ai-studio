/**
 * TUI mínima para el CLI (`commander agent`).
 *
 * Sin dependencias: solo secuencias ANSI y un spinner de Braille. Se degrada
 * con elegancia cuando la salida no es una TTY (CI, pipes, `--json`): no hay
 * color ni spinner y el streaming se imprime como texto plano.
 *
 * Colores: respeta `NO_COLOR` (https://no-color.org) y `TERM=dumb`.
 */
import type { CliAgentEvent } from './agentClient';

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
  tui?: Tui;
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
    const t = this.tui;
    t.line(`${t.bold('[commander]')} ${t.cyan('agente')} → ${this.opts.serverUrl}`);
    t.line(
      `  ${t.gray('modelo')} ${t.yellow(this.opts.model)}   ${t.gray('pasos máx')} ${this.opts.maxSteps}`
    );
    t.line(`  ${t.gray('tarea ')} ${this.opts.task}`);
    t.rule();
  }

  private closeStream(): void {
    if (this.streamOpen) {
      process.stdout.write('\n');
      this.streamOpen = false;
    }
  }

  handle(event: CliAgentEvent): void {
    this.ensureHeader();
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
