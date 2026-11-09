// Subagent templates: named presets that pre-fill model/tools/mode.
// Mirrors Freebuff's helper-agent roster. `spawn_agents` mantiene los nombres
// históricos para no romper llamadas existentes.

import { AGENT_TOOLS } from '../../security';

export type SubagentMode = 'build' | 'plan' | 'readonly';

export interface SubagentTemplate {
  name: string;
  description: string;
  role: 'researcher' | 'coder' | 'reviewer' | 'planner' | 'tester' | 'custom';
  defaultMode: SubagentMode;
  allowedTools: string[] | null;
  defaultMaxSteps: number;
}

export const SUBAGENT_TEMPLATES: Record<string, SubagentTemplate> = {
  'file-explorer': {
    name: 'file-explorer',
    description: 'Explores the codebase read-only: find files, read, grep. Fast, no edits.',
    role: 'researcher',
    defaultMode: 'readonly',
    allowedTools: ['fs.read', 'fs.glob', 'fs.grep', 'shell.run'],
    defaultMaxSteps: 12,
  },
  'researcher': {
    name: 'researcher',
    description: 'Researches via web search + file reads. No edits.',
    role: 'researcher',
    defaultMode: 'readonly',
    allowedTools: ['fs.read', 'fs.glob', 'fs.grep', 'web.fetch', 'web.search'],
    defaultMaxSteps: 16,
  },
  'reviewer': {
    name: 'reviewer',
    description: 'Reviews code changes. Read-only. Reports issues.',
    role: 'reviewer',
    defaultMode: 'readonly',
    allowedTools: ['fs.read', 'fs.glob', 'fs.grep', 'git.diff', 'git.log', 'read_diagnostics'],
    defaultMaxSteps: 16,
  },
  'planner': {
    name: 'planner',
    description: 'Designs a plan without building. Read-only.',
    role: 'planner',
    defaultMode: 'plan',
    allowedTools: ['fs.read', 'fs.glob', 'fs.grep', 'git.status', 'git.diff', 'git.log'],
    defaultMaxSteps: 20,
  },
  'coder': {
    name: 'coder',
    description: 'Implements changes: reads, edits and runs the project. Writes in build mode.',
    role: 'coder',
    defaultMode: 'build',
    allowedTools: ['fs.read', 'fs.write', 'fs.edit', 'fs.glob', 'fs.list', 'fs.grep', 'shell.run', 'read_diagnostics'],
    defaultMaxSteps: 24,
  },
  'tester': {
    name: 'tester',
    description: 'Reproduces failures, edits tests and runs the suite. Writes in build mode.',
    role: 'tester',
    defaultMode: 'build',
    allowedTools: ['fs.read', 'fs.edit', 'shell.run', 'read_diagnostics'],
    defaultMaxSteps: 20,
  },
};

export interface SubagentPolicy {
  allowedTools: string[] | null;
  mode: SubagentMode;
  maxSteps: number;
}

export type PolicyResolution =
  | { ok: true; policy: SubagentPolicy }
  | { ok: false; error: string };

const MODES: SubagentMode[] = ['build', 'plan', 'readonly'];

/**
 * Tools que no pueden entrar en una allowlist de plan/readonly. `shell.run`
 * queda fuera de esta lista a propósito: las plantillas de sólo lectura ya lo
 * usan para inspeccionar y su allowlist de comandos es la que manda.
 */
const MODE_BLOCKED = new Set([
  'fs.write',
  'fs.edit',
  'git.commit',
  'shell.pty',
  'code.run',
  'browser',
  'preview',
  'git.rebase',
  'git.conflict',
  'run_file_change_hooks',
  'code.fix',
  'worktree.create',
  'mcp.call',
]);

/** Valida la allowlist contra el registro y el modo antes de crear la sesión. */
export function validateAllowedTools(
  allowedTools: string[] | null,
  mode: SubagentMode
): string | null {
  if (!allowedTools) return null;
  for (const tool of allowedTools) {
    if (!AGENT_TOOLS.has(tool)) return `Tool desconocida en allowedTools: ${tool}`;
    if (mode !== 'build' && MODE_BLOCKED.has(tool)) {
      return `Modo ${mode}: la allowlist de un subagente no puede incluir ${tool}`;
    }
  }
  return null;
}

/**
 * Resuelve plantilla + overrides. Una plantilla desconocida o una tool fuera
 * del registro falla cerrado con error estructurado; no se ignora en silencio.
 */
export function resolveSubagentPolicy(input: {
  template?: unknown;
  allowedTools?: unknown;
  mode?: unknown;
  maxSteps?: unknown;
}): PolicyResolution {
  const rawTemplate = typeof input.template === 'string' ? input.template.trim() : '';
  const template = rawTemplate ? SUBAGENT_TEMPLATES[rawTemplate] : undefined;
  if (rawTemplate && !template) {
    return { ok: false, error: `Plantilla de subagente desconocida: ${rawTemplate}` };
  }

  const mode = (input.mode ?? template?.defaultMode ?? 'build') as SubagentMode;
  if (!MODES.includes(mode)) {
    return { ok: false, error: `Modo de subagente inválido: ${String(input.mode)}` };
  }

  let allowedTools: string[] | null;
  if (input.allowedTools === undefined || input.allowedTools === null) {
    allowedTools = template?.allowedTools ?? null;
  } else if (Array.isArray(input.allowedTools)) {
    allowedTools = [...new Set(input.allowedTools.map(String))];
  } else {
    return { ok: false, error: 'allowedTools debe ser un array de ids o null' };
  }

  const invalid = validateAllowedTools(allowedTools, mode);
  if (invalid) return { ok: false, error: invalid };

  const rawSteps = Number(input.maxSteps ?? template?.defaultMaxSteps ?? 8);
  const maxSteps = Math.min(Math.max(Number.isFinite(rawSteps) ? Math.trunc(rawSteps) : 8, 1), 50);
  return { ok: true, policy: { allowedTools, mode, maxSteps } };
}

export function getTemplate(name: string): SubagentTemplate | undefined {
  return SUBAGENT_TEMPLATES[name];
}

export function listTemplates(): SubagentTemplate[] {
  return Object.values(SUBAGENT_TEMPLATES);
}
