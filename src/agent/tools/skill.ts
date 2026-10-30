import type { ToolDefinition } from '../types';
import { callAgentTool } from './runTool';

export interface SkillInput { name: string; }
export interface SkillOutput { name: string; path: string; description: string; content: string; }

export const skillTool: ToolDefinition<SkillInput, SkillOutput> = {
  id: 'skill',
  description:
    'Lee un skill (SKILL.md) del proyecto abierto o del catálogo de skills y devuelve su contenido. ' +
    'Resuelve recursos relativos a su directorio.',
  danger: false,
  requiresApproval: () => false,
  run: async (input) => callAgentTool('skill', input),
};
