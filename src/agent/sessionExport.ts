import type { AgentStep } from './types';

/**
 * Exporta una corrida a Markdown.
 *
 * El objetivo es que el chat se pueda archivar o pegar en un issue sin leer
 * JSON: tarea, ficheros tocados y, por cada paso, qué hizo, sobre qué y con qué
 * resultado. El input/output crudo se conserva en bloques JSON porque a veces
 * es lo único que explica un fallo.
 *
 * Este módulo es puro (ni `document` ni `Blob`) para que la suite de lógica
 * pueda probarlo; la descarga en el navegador vive en `sessionDownload.ts`.
 */
export interface ExportableRun {
  task?: string;
  steps: AgentStep[];
}

const TYPE_LABEL: Record<string, string> = {
  thought: 'Pensamiento',
  tool_call: 'Acción',
  tool_result: 'Resultado',
  plan: 'Plan',
  subagent: 'Subagente',
};

/** Ruta, comando o patrón del paso; vacío si no aplica. */
function targetOf(step: AgentStep): string {
  const input = (step.input ?? {}) as any;
  if (typeof input.path === 'string' && input.path) return input.path;
  if (typeof input.command === 'string' && input.command) return input.command;
  if (typeof input.url === 'string' && input.url) return input.url;
  if (typeof input.pattern === 'string' && input.pattern) return input.pattern;
  return '';
}

function fencedJson(value: unknown): string[] {
  const body = JSON.stringify(value, null, 2);
  return ['  ```json', ...body.split('\n').map((line) => '  ' + line), '  ```'];
}

export function sessionToMarkdown(run: ExportableRun, title = 'Sesión del agente'): string {
  const out: string[] = ['# ' + title, '', 'Fecha: ' + new Date().toISOString(), ''];

  if (run.task) out.push('## Tarea', '', run.task, '');

  const files = new Set<string>();
  for (const step of run.steps) {
    if (step.type !== 'tool_call') continue;
    const input = (step.input ?? {}) as any;
    if (step.toolId === 'fs.write' || step.toolId === 'fs.edit') {
      if (typeof input.path === 'string' && input.path) files.add(input.path);
    }
    if (step.toolId === 'code.fix' && Array.isArray(input.paths)) {
      for (const path of input.paths) if (typeof path === 'string' && path) files.add(path);
    }
  }
  if (files.size > 0) {
    out.push('## Ficheros tocados', '', ...Array.from(files).map((path) => '- `' + path + '`'), '');
  }

  out.push('## Actividad', '');
  if (run.steps.length === 0) out.push('_Sin pasos._', '');

  for (const step of run.steps) {
    const etiqueta = TYPE_LABEL[step.type] || step.type;
    out.push('- **' + etiqueta + '**' + (step.toolId ? ' `' + step.toolId + '`' : ''));
    const target = targetOf(step);
    if (target) out.push('  - objetivo: `' + target + '`');
    if (step.status) out.push('  - estado: ' + step.status);
    if (typeof step.durationMs === 'number') out.push('  - duración: ' + step.durationMs + ' ms');
    if (step.content) out.push('', '  ' + String(step.content).replace(/\n/g, '\n  '), '');
    if (step.input != null) out.push(...fencedJson(step.input));
    if (step.output != null) out.push(...fencedJson(step.output));
  }

  return out.join('\n') + '\n';
}

/** Nombre con marca de tiempo para no pisar exports anteriores. */
export function sessionFileName(prefix = 'sesion-agente'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return prefix + '-' + stamp + '.md';
}
