/**
 * Guardias de llamadas idénticas, compartidas por el cliente del CLI y el bucle
 * del servidor.
 *
 * Dos causas y un mismo contador: una escritura repetida no cambia nada
 * (`CAL2-R19` gastó 24 pasos con la misma edición) y una lectura repetida no
 * informa nada nuevo aunque no haya ninguna edición (`G1-D1-04`: 42 `fs.read`
 * sobre dos archivos, 0 mutaciones). Los mensajes las distinguen; el umbral y la
 * escalada son los mismos.
 *
 * La clave ordena las claves del input porque el proveedor reordena argumentos
 * entre turnos; sin eso, la misma llamada parecería distinta.
 */

/** Repeticiones de una escritura ya aplicada antes de cortar. */
const MAX_IDENTICAL_MUTATIONS = 4;

/** Repeticiones de una lectura sin progreso antes de cortar. */
const MAX_IDENTICAL_READS = 4;

export type LoopGuardCause = 'mutations' | 'reads';

/** Qué disparó el corte, para medirlo desde el estado y no desde el PTY. */
export interface LoopCut {
  guard: LoopGuardCause;
  tool: string;
  /** Llamadas contadas para esa clave, incluida la primera. */
  attempts: number;
}

export type LoopVerdict =
  | { action: 'warn' | 'refuse'; message: string }
  | { action: 'cut'; message: string; cut: LoopCut };

/**
 * Escrituras cuyo mismo input ya aplicado no puede aportar nada nuevo.
 * `shell.run` queda fuera: repetir una verificación es el bucle normal de
 * trabajo y, si el comando no avanza, eso lo sabe el comando.
 */
const IDENTICAL_MUTATION_TOOLS = new Set(['fs.write', 'fs.edit', 'git.commit']);

/** Lecturas: repetirlas no trae información nueva. `browser` fuera porque releer la página tras un click es legítimo. */
export const IDENTICAL_READ_TOOLS = new Set(['fs.read', 'fs.list', 'fs.propose.edit', 'fs.propose.write']);

/**
 * Su éxito vacía la ventana de lecturas. Incluye los cambios indirectos (un
 * subagente edita, un hook reescribe, una tool MCP escribe): la lectura anterior
 * ya no refleja el workspace. Ante la duda se incluye; reiniciar la ventana sólo
 * permite releer.
 */
export const WORKSPACE_WRITE_TOOLS = new Set([
  'fs.write',
  'fs.edit',
  'shell.run',
  'shell.job',
  'shell.pty',
  'git.commit',
  'git.rebase',
  'git.conflict',
  'git.worktree',
  'worktree.create',
  'spawn_agents',
  'task',
  'mcp.call',
  'run_file_change_hooks',
]);

function stableInput(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableInput).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableInput(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function callKeyFor(tool: string, input: unknown): string {
  return `${tool}\u0000${stableInput(input)}`;
}

/**
 * Un no-op no es un éxito que el modelo pueda leer como avance: devolverle «sin
 * cambios» a secas hace que repita la edición. La primera repetición avisa; las
 * siguientes son un fallo explícito.
 */
function duplicateMutationMessage(tool: string, repeats: number): string {
  return repeats === 1
    ? `Sin cambios: ${tool} ya se aplicó con el mismo input en esta sesión. No repitas la edición: verifica con shell.run o responde.`
    : `ERROR: bucle de ${tool}: el mismo input ya se aplicó y no se ejecuta. Ejecuta la verificación (shell.run) o responde.`;
}

function loopCutMessage(tool: string, attempts: number): string {
  return (
    `Bucle de ${tool}: ${attempts} llamadas idénticas y la edición ya estaba aplicada. ` +
    'Se corta la ejecución para no gastar los pasos que quedan; la tarea queda sin verificar.'
  );
}

function repeatedReadMessage(tool: string, repeats: number): string {
  return repeats === 1
    ? `Ya pediste el mismo input a ${tool}; usa lo que devolvió en vez de repetir la lectura.`
    : `ERROR: bucle de lectura: el mismo ${tool} ya se ejecutó y no se repite. Usa lo que devolvió o cambia de enfoque.`;
}

function readLoopMessage(tool: string, attempts: number): string {
  return (
    `Bucle de lectura: ${attempts} llamadas idénticas a \`${tool}\` sin que el workspace cambie. ` +
    'Se corta la ejecución para no gastar los pasos que quedan; la tarea queda sin verificar.'
  );
}

interface LoopMessages {
  /** Texto de aviso o fallo; `repeats` cuenta desde 1 (la segunda llamada). */
  repeat: (tool: string, repeats: number) => string;
  /** Texto del corte; `attempts` cuenta la primera llamada. */
  cut: (tool: string, attempts: number) => string;
}

const MUTATION_MESSAGES: LoopMessages = { repeat: duplicateMutationMessage, cut: loopCutMessage };
const READ_MESSAGES: LoopMessages = { repeat: repeatedReadMessage, cut: readLoopMessage };

/** La 2.ª llamada avisa, la 3.ª falla y la 4.ª corta. */
function verdict(
  guard: LoopGuardCause,
  tool: string,
  attempts: number,
  max: number,
  messages: LoopMessages
): LoopVerdict {
  if (attempts >= max) {
    return { action: 'cut', message: messages.cut(tool, attempts), cut: { guard, tool, attempts } };
  }
  return {
    action: attempts === 2 ? 'warn' : 'refuse',
    message: messages.repeat(tool, attempts - 1),
  };
}

/**
 * Las dos causas de una sesión en un solo objeto: `repeat` dice qué hacer con
 * una llamada y `succeeded` mantiene el estado cuando una tool termina bien. Una
 * causa nueva se añade aquí y los dos bucles la heredan.
 */
export class LoopGuard {
  /** Escrituras aplicadas → llamadas vistas (1 al aplicarse, 2 en la primera repetición). */
  private readonly applied = new Map<string, number>();
  /** Lecturas → llamadas vistas desde el último progreso. */
  private readonly reads = new Map<string, number>();

  /** Veredicto para esta llamada, o `null` si hay que ejecutarla. */
  repeat(tool: string, input: unknown): LoopVerdict | null {
    if (IDENTICAL_MUTATION_TOOLS.has(tool)) {
      const key = callKeyFor(tool, input);
      const seen = this.applied.get(key);
      if (seen === undefined) return null;
      this.applied.set(key, seen + 1);
      return verdict('mutations', tool, seen + 1, MAX_IDENTICAL_MUTATIONS, MUTATION_MESSAGES);
    }
    if (!IDENTICAL_READ_TOOLS.has(tool)) return null;
    const key = callKeyFor(tool, input);
    const attempts = (this.reads.get(key) ?? 0) + 1;
    this.reads.set(key, attempts);
    return attempts === 1
      ? null
      : verdict('reads', tool, attempts, MAX_IDENTICAL_READS, READ_MESSAGES);
  }

  /** La tool terminó bien: marca la escritura y vacía la ventana de lecturas. */
  succeeded(tool: string, input: unknown): void {
    if (IDENTICAL_MUTATION_TOOLS.has(tool)) this.applied.set(callKeyFor(tool, input), 1);
    if (WORKSPACE_WRITE_TOOLS.has(tool)) this.reads.clear();
  }
}
