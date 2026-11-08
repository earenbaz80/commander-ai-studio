import type { ToolDefinition } from '../types';
import { callAgentTool } from './runTool';

export interface LinearToolInput {
  action: 'whoami' | 'list_teams' | 'list_issues' | 'create_issue';
  teamId?: string;
  title?: string;
  description?: string;
  limit?: number;
}

/**
 * Linear escribe fuera del workspace, así que la creación de issues pide
 * aprobación. Las consultas son de sólo lectura y no la piden.
 */
export const linearTool: ToolDefinition<LinearToolInput, any> = {
  id: 'linear',
  description:
    'Conector Linear (OAuth). whoami devuelve la cuenta; list_teams lista equipos con su id; ' +
    'list_issues lista issues (teamId opcional, limit 1-50); create_issue crea un issue ' +
    '(requiere teamId y title). El token vive cifrado en el servidor.',
  danger: true,
  requiresApproval: (input) => input?.action === 'create_issue',
  run: async (input) => callAgentTool('linear', input ?? {}, { withRoot: false }),
};
