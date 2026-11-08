import type { ToolDefinition } from '../types';
import { callAgentTool } from './runTool';

export interface GithubPrInput {
  /** `owner/repo`. Alternativa a `url`. */
  repo?: string;
  /** URL del PR (`https://github.com/owner/repo/pull/12`). */
  url?: string;
  number?: number;
}

export interface GithubCommentInput extends GithubPrInput {
  body: string;
}

/**
 * Lectura de un PR: metadatos, cuerpo y diff por archivo.
 *
 * Es de sólo lectura, así que no pide aprobación; el token vive en el servidor
 * y no viaja al navegador ni al modelo.
 */
export const githubPrTool: ToolDefinition<GithubPrInput, any> = {
  id: 'github.pr',
  description:
    'Lee un pull request de GitHub: título, estado, autor, cuerpo y diff por archivo (recortado). ' +
    'Acepta `repo` ("owner/repo") + `number`, o `url` del PR. Usa el conector OAuth o GITHUB_TOKEN.',
  danger: false,
  requiresApproval: () => false,
  // No toca rutas del proyecto: el root no pinta nada aquí.
  run: async (input) => callAgentTool('github.pr', input ?? {}, { withRoot: false }),
};

/** Comentario en un PR. Escribe fuera del repo, así que siempre pide permiso. */
export const githubCommentTool: ToolDefinition<GithubCommentInput, any> = {
  id: 'github.comment',
  description:
    'Publica un comentario en un pull request de GitHub. Requiere aprobación y un token con permiso de escritura (conector OAuth o GITHUB_TOKEN).',
  danger: true,
  requiresApproval: () => true,
  run: async (input) => callAgentTool('github.comment', input ?? {}, { withRoot: false }),
};
