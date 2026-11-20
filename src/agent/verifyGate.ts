/**
 * Gate de verificación del bucle.
 *
 * El fallo que deja T4 en 0/2 no es de herramientas: el modelo implementa
 * `maxLength`, responde «listo» y nunca corre `node --test` (G1-D1-05). El gate
 * exige una ejecución de verificación **posterior a la última edición de
 * código**, expone su salida al historial y no deja cerrar mientras esté en
 * rojo ni sin haber verificado.
 */

/** Cierres rechazados antes de dar la corrida por fallida. */
export const MAX_VERIFY_REFUSALS = 2;

/** Comandos que verifican: tests, build, typecheck o lint del proyecto. */
const VERIFY_COMMAND =
  /^(?:node\s+--test|npm\s+(?:test|run\s+(?:test|build|typecheck|verify|lint))|npx\s+(?:vitest|jest|tsc)|pnpm\s+(?:test|run\s+\w+)|yarn\s+(?:test|run\s+\w+)|bun\s+test|vitest|jest|tsc\b|pytest|python\s+-m\s+pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+\w*test|gradlew?\s+\w*test)/i;

/** Archivos cuyo cambio obliga a verificar. */
const CODE_FILE =
  /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|kts|cs|php|swift|c|cc|cpp|h|hpp|sh|bash|ps1|sql)$/i;

/** Archivo de test: la forma canónica que ya usa el CLI. */
const TEST_FILE = /(?:^|[\\/])[^\\/]+\.(?:test|spec)\.[cm]?[jt]sx?$/i;

export function isCodePath(path: unknown): boolean {
  return typeof path === 'string' && CODE_FILE.test(path.trim());
}

export function isTestPath(path: unknown): boolean {
  return typeof path === 'string' && TEST_FILE.test(path.trim());
}

export function isVerificationCommand(command: unknown): boolean {
  return typeof command === 'string' && VERIFY_COMMAND.test(command.trim());
}

export interface VerifyEvidence {
  command: string;
  /** `null` cuando el comando no llegó a ejecutarse (denegado, error de red). */
  exitCode: number | null;
  ok: boolean;
  /** Cola de la salida, para devolverla al modelo cuando está en rojo. */
  output: string;
  /** Paso del bucle en que se ejecutó. */
  step: number;
}

/** Lo que devuelve `runTool`: `{ ok, data }` con el sobre `{ ok, data }` dentro. */
interface ToolRunLike {
  ok: boolean;
  data?: unknown;
  error?: unknown;
}

function payloadOf(result: ToolRunLike | undefined): Record<string, unknown> {
  const outer = result?.data;
  if (outer && typeof outer === 'object' && !Array.isArray(outer)) {
    const inner = (outer as Record<string, unknown>).data;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner as Record<string, unknown>;
    }
    return outer as Record<string, unknown>;
  }
  return {};
}

function exitCodeOf(result: ToolRunLike | undefined): number | null {
  if (!result) return null;
  const raw = payloadOf(result).exitCode;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function outputTail(result: ToolRunLike | undefined, max = 1200): string {
  if (!result) return '';
  const payload = payloadOf(result);
  const parts: string[] = [];
  for (const key of ['stderr', 'stdout'] as const) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) parts.push(value.trim());
  }
  const error = (result as { error?: unknown }).error;
  if (parts.length === 0 && typeof error === 'string') parts.push(error);
  const text = parts.join('\n').trim();
  return text.length > max ? `…${text.slice(-max)}` : text;
}

/**
 * Estado de verificación de la corrida.
 *
 * `noteEdit` invalida la evidencia anterior: una verificación vieja no cubre
 * código nuevo. `noteRun` guarda la última ejecución de verificación con su
 * paso y su código de salida.
 */
export class VerifyGate {
  private lastEditStep = 0;
  private lastEvidence: VerifyEvidence | null = null;
  private lastTestFile: string | null = null;
  private lastCodeFile: string | null = null;
  private refusals = 0;

  /** Registra una edición aplicada; sólo cuenta si toca código. */
  noteEdit(path: unknown, step: number): void {
    if (!isCodePath(path)) return;
    this.lastEditStep = step;
    this.lastEvidence = null;
    const normalized = String(path).replace(/\\/g, '/');
    if (isTestPath(normalized)) this.lastTestFile = normalized;
    else this.lastCodeFile = normalized;
  }

  /** Registra una ejecución de verificación (roja o verde). */
  noteRun(command: unknown, result: ToolRunLike | undefined, step: number): void {
    if (!isVerificationCommand(command)) return;
    const exitCode = exitCodeOf(result);
    const ranOk = !result || result.ok !== false;
    const ok = ranOk && (exitCode === null ? true : exitCode === 0);
    this.lastEvidence = {
      command: String(command).trim(),
      exitCode,
      ok,
      output: outputTail(result),
      step,
    };
    if (ok) this.refusals = 0;
  }

  /** ¿Hay que verificar antes de cerrar? */
  needsVerification(): boolean {
    if (this.lastEditStep === 0) return false;
    const evidence = this.lastEvidence;
    if (!evidence) return true;
    if (!evidence.ok) return true;
    return evidence.step <= this.lastEditStep;
  }

  evidence(): VerifyEvidence | null {
    return this.lastEvidence;
  }

  /** Comando sugerido al modelo cuando no hay verificación posterior. */
  suggestedCommand(): string {
    if (this.lastTestFile) return `node --test ${this.lastTestFile}`;
    if (this.lastCodeFile) {
      const base = this.lastCodeFile.replace(/\.[^.]+$/, '');
      return `node --test ${base}.test.mjs`;
    }
    return 'node --test';
  }

  /** Suma un cierre rechazado y devuelve el total. */
  refusal(): number {
    this.refusals += 1;
    return this.refusals;
  }

  refusalsSoFar(): number {
    return this.refusals;
  }
}

/** Decisión de cierre: o se permite, o se devuelve el motivo al modelo. */
export interface ClosingDecision {
  allow: boolean;
  /** Texto para el modelo (o el motivo del fallo). */
  text?: string;
  /** Tras `MAX_VERIFY_REFUSALS` rechazos, la corrida no se cierra: falla. */
  fatal?: boolean;
}

/**
 * Aplica el gate a un intento de cierre.
 *
 * Vive acá y no en cada bucle porque la regla es la misma en el CLI, el
 * servidor y el bucle de escritorio: sin una ejecución de verificación en
 * verde **posterior a la última edición de código** no hay respuesta final. El
 * primer rechazo devuelve el motivo al modelo con la salida real del comando;
 * tras `MAX_VERIFY_REFUSALS`, la corrida falla en vez de repetir para siempre.
 */
export function refusalForClosing(gate: VerifyGate): ClosingDecision {
  if (!gate.needsVerification()) return { allow: true };
  const evidence = gate.evidence();
  const enRojo = Boolean(evidence && !evidence.ok);
  const rechazos = gate.refusal();

  if (rechazos > MAX_VERIFY_REFUSALS) {
    return {
      allow: false,
      fatal: true,
      text:
        enRojo && evidence
          ? `Gate de verificación: \`${evidence.command}\` salió con exit ${evidence.exitCode ?? 'no disponible'} después de la última edición. No se cierra la tarea sin verde.`
          : `Gate de verificación: no se verificó después de la última edición de código: ejecuta \`${gate.suggestedCommand()}\` y no cierres hasta que salga en verde.`,
    };
  }

  return {
    allow: false,
    text:
      enRojo && evidence
        ? `Gate de verificación: \`${evidence.command}\` sigue en rojo (exit ${evidence.exitCode ?? 'desconocido'}) después de tu última edición. No cierres: corrige el fallo y vuelve a ejecutar la verificación.${evidence.output ? `\n${evidence.output}` : ''}`
        : `Gate de verificación: editaste código y no hay una verificación posterior. Ejecuta \`${gate.suggestedCommand()}\` con shell.run antes de cerrar; si sale en rojo, corrige y repite.`,
  };
}
