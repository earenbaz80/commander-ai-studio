/**
 * Tareas reales de F4A-1: leer, editar y revisar.
 *
 * Este módulo es puro (no importa `vscode`) para que el prompt de cada tarea se
 * pueda revisar y probar sin levantar el editor. La extensión sólo aporta el
 * archivo/rango activo y la instrucción del operador.
 */

export type TaskKind = 'read' | 'edit' | 'review';

export interface EditorContext {
  /** Ruta relativa al workspace, tal como la lee el agente. */
  file?: string;
  startLine?: number;
  endLine?: number;
}

const TITLES: Record<TaskKind, string> = {
  read: 'Leer',
  edit: 'Editar',
  review: 'Revisar',
};

export function taskTitle(kind: TaskKind): string {
  return TITLES[kind];
}

function target(ctx: EditorContext): string {
  if (!ctx.file) return 'el proyecto abierto';
  if (ctx.startLine && ctx.endLine && ctx.endLine !== ctx.startLine) {
    return `${ctx.file} (líneas ${ctx.startLine}–${ctx.endLine})`;
  }
  if (ctx.startLine) return `${ctx.file} (línea ${ctx.startLine})`;
  return ctx.file;
}

/**
 * Prompts mínimos. No incrustan el código seleccionado: el agente lee el
 * archivo con sus tools, así el contexto no viaja dos veces ni se escapa en la
 * línea de comandos.
 */
export function buildTask(kind: TaskKind, instruction: string, ctx: EditorContext): string {
  const extra = instruction.trim();
  const focus = extra ? `\n\nFoco: ${extra}` : '';

  switch (kind) {
    case 'read':
      return (
        `Lee ${target(ctx)} y explícame qué hace, de qué depende y qué riesgos ves. ` +
        `No modifiques archivos.${focus}`
      );
    case 'edit':
      return (
        `Edita ${target(ctx)} para: ${extra}. ` +
        'Aplica el cambio mínimo, no toques archivos fuera de eso y espera la aprobación del diff.'
      );
    case 'review':
      return (
        'Revisa los cambios sin commitear de este workspace (incluido lo staged) con git diff ' +
        `y señálame errores, riesgos y qué falta probar. Si hay un archivo abierto, prioriza ${target(ctx)}. ` +
        `No modifiques archivos.${focus}`
      );
  }
}
