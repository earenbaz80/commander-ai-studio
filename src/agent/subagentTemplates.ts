// Subagent templates: named presets that pre-fill model/tools/mode.
// Mirrors Freebuff's helper-agent roster but kept minimal.

export interface SubagentTemplate {
  name: string;
  description: string;
  role: 'researcher' | 'coder' | 'reviewer' | 'planner' | 'custom';
  defaultMode: 'build' | 'plan' | 'readonly';
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
};

export function getTemplate(name: string): SubagentTemplate | undefined {
  return SUBAGENT_TEMPLATES[name];
}

export function listTemplates(): SubagentTemplate[] {
  return Object.values(SUBAGENT_TEMPLATES);
}
