export const AGENT_FUNCTION_DECLARATIONS = [
  {
    name: 'fs_read',
    description: 'Leer archivo del workspace. Devuelve contenido (cap 2MB).',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING', description: 'Ruta relativa al workspace' } }, required: ['path'] },
  },
  {
    name: 'fs_write',
    description: 'Crear o reescribir archivo del workspace.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, content: { type: 'STRING' }, overwrite: { type: 'BOOLEAN' } }, required: ['path', 'content'] },
  },
  {
    name: 'fs_edit',
    description: 'Editar archivo reemplazando texto exacto (oldString debe coincidir al carácter).',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, oldString: { type: 'STRING' }, newString: { type: 'STRING' }, replaceAll: { type: 'BOOLEAN' } }, required: ['path', 'oldString', 'newString'] },
  },
  {
    name: 'fs_glob',
    description: 'Listar archivos por patrón glob (p. ej. src/**/*.tsx).',
    parameters: { type: 'OBJECT', properties: { pattern: { type: 'STRING' } }, required: ['pattern'] },
  },
  {
    name: 'fs_grep',
    description: 'Buscar texto/regex en archivos del workspace.',
    parameters: { type: 'OBJECT', properties: { pattern: { type: 'STRING' }, path: { type: 'STRING' }, include: { type: 'STRING' } }, required: ['pattern'] },
  },
  {
    name: 'shell_run',
    description: 'Ejecutar comando shell allowlist (npm, node, git, tsc, vite...).',
    parameters: { type: 'OBJECT', properties: { command: { type: 'STRING' } }, required: ['command'] },
  },
  {
    name: 'read_diagnostics',
    description: 'Diagnósticos estáticos TypeScript del proyecto (tsc --noEmit). Opcional path para filtrar un archivo.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING', description: 'Ruta relativa a filtrar (opcional)' } } },
  },
  {
    name: 'task',
    description: 'Lanza un subagente (task tool) con su propio objetivo y contexto. Devuelve la respuesta final del subagente.',
    parameters: {
      type: 'OBJECT',
      properties: {
        goal: { type: 'STRING', description: 'Objetivo del subagente' },
        instructions: { type: 'STRING', description: 'Instrucciones adicionales (opcional)' },
        model: { type: 'STRING', description: 'Modelo a usar (por defecto el de la sesión padre)' },
        allowedTools: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Tools permitidas (null = todas las del padre)' },
        mode: { type: 'STRING', enum: ['build', 'plan', 'readonly'], description: 'Modo del subagente' },
        maxSteps: { type: 'NUMBER', description: 'Límite de pasos' },
        parentSessionId: { type: 'STRING', description: 'ID de la sesión padre (requerido)' },
      },
      required: ['goal', 'parentSessionId'],
    },
  },
  {
    name: 'git_status',
    description: 'git status corto del workspace.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'git_diff',
    description: 'git diff (opcional path para un archivo).',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } } },
  },
  {
    name: 'git_log',
    description: 'Últimos commits (oneline).',
    parameters: { type: 'OBJECT', properties: { limit: { type: 'NUMBER' } } },
  },
  {
    name: 'git_commit',
    description: 'git add -A + commit con mensaje. Requiere aprobación.',
    parameters: { type: 'OBJECT', properties: { message: { type: 'STRING' } }, required: ['message'] },
  },
  {
    name: 'web_fetch',
    description: 'Descargar URL como texto.',
    parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' } }, required: ['url'] },
  },
  {
    name: 'web_search',
    description: 'Buscar en la web.',
    parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] },
  },
  {
    name: 'code_run',
    description: 'Ejecutar snippet JS en sandbox del servidor.',
    parameters: { type: 'OBJECT', properties: { code: { type: 'STRING' } }, required: ['code'] },
  },
  {
    name: 'mcp_call',
    description: 'Llamar tool de un servidor MCP. Para servidores locales del registro usa `server` (nombre); para remotos usa `serverUrl`.',
    parameters: { type: 'OBJECT', properties: { server: { type: 'STRING', description: 'Nombre del servidor MCP local (registro commander.json)' }, serverUrl: { type: 'STRING', description: 'URL del servidor MCP remoto (alternativa a server)' }, tool: { type: 'STRING', description: 'Nombre de la tool a invocar' }, args: { type: 'OBJECT', description: 'Argumentos de la tool' } }, required: ['tool'] },
  },
];

const FN_TO_TOOL: Record<string, string> = {
  fs_read: 'fs.read', fs_write: 'fs.write', fs_edit: 'fs.edit',
  fs_glob: 'fs.glob', fs_grep: 'fs.grep', shell_run: 'shell.run',
  read_diagnostics: 'read_diagnostics',
  task: 'task',
  git_status: 'git.status', git_diff: 'git.diff', git_log: 'git.log', git_commit: 'git.commit', git_worktree: 'git.worktree', git_rebase: 'git.rebase', git_conflict: 'git.conflict',
  web_fetch: 'web.fetch', web_search: 'web.search', code_run: 'code.run',
  mcp_call: 'mcp.call',
};

export function mapFunctionCall(name: string, args: any): { tool: string; input: unknown } | null {
  const tool = FN_TO_TOOL[name];
  if (!tool) return null;
  return { tool, input: args || {} };
}
