export const AGENT_FUNCTION_DECLARATIONS = [
  {
    name: 'fs_read',
    description: 'Leer archivo del workspace por ventana. Sin offset/limit devuelve hasta 200 líneas; con offset/limit, esa ventana (máx 2000). Devuelve startLine/endLine/totalLines y truncated. content es texto literal: úsalo tal cual en fs_edit.oldString.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Ruta relativa al workspace' },
        offset: { type: 'NUMBER', description: 'Línea inicial, 1-based (opcional)' },
        limit: { type: 'NUMBER', description: 'Líneas a devolver desde offset (máx 2000)' },
        numberLines: { type: 'BOOLEAN', description: 'Prefijar cada línea con su número (solo para leer; no copiar en oldString)' },
      },
      required: ['path'],
    },
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
    description: 'Buscar texto en archivos del workspace, con contexto opcional antes/después de cada coincidencia (máx 100 coincidencias).',
    parameters: {
      type: 'OBJECT',
      properties: {
        pattern: { type: 'STRING' },
        path: { type: 'STRING' },
        include: { type: 'STRING' },
        before: { type: 'NUMBER', description: 'Líneas de contexto antes (0-20)' },
        after: { type: 'NUMBER', description: 'Líneas de contexto después (0-20)' },
        context: { type: 'NUMBER', description: 'Atajo: before y after a la vez (0-20)' },
      },
      required: ['pattern'],
    },
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
    name: 'git_worktree',
    description: 'Gestionar worktrees del workspace. list es de solo lectura; add/remove piden aprobación y la ruta debe quedar dentro del proyecto.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['list', 'add', 'remove'], description: 'Acción a ejecutar' },
        path: { type: 'STRING', description: 'Ruta relativa al workspace (requerida para add/remove)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'git_rebase',
    description: 'Iniciar, continuar o abortar un rebase. Requiere aprobación.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['start', 'continue', 'abort'], description: 'Acción a ejecutar' },
        branch: { type: 'STRING', description: 'Rama a rebasar (sólo en start)' },
        base: { type: 'STRING', description: 'Rama base del rebase (por defecto main)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'git_conflict',
    description: 'Conflictos de git. Sin argumentos devuelve el primer bloque con las dos versiones (ours/theirs) sin escribir nada; con all solo consulta el estado del merge (archivos, bloques, si están listos). Con resolve (ours|theirs) reescribe el/los archivo(s) aplicando esa versión; con stage marca con git add los que ya no tienen marcas para cerrar el merge; con commit completa la fusión con el commit de merge (solo con lo ya preparado); con abort deshace el merge en curso restaurando el árbol. Modificar requiere aprobación.',
    parameters: {
      type: 'OBJECT',
      properties: {
        output: { type: 'STRING', description: 'Salida de git merge/diff con marcas de conflicto (para inspeccionar un archivo)' },
        path: { type: 'STRING', description: 'Ruta relativa del archivo en conflicto (si la salida no la indica)' },
        all: { type: 'BOOLEAN', description: 'Trabajar sobre el merge en curso (sin resolve, stage, commit ni abort: solo consulta)' },
        resolve: { type: 'STRING', enum: ['ours', 'theirs'], description: 'Aplicar esta versión y escribir el archivo' },
        stage: { type: 'BOOLEAN', description: 'Con all: git add de los archivos que ya no tienen marcas de conflicto' },
        commit: { type: 'BOOLEAN', description: 'Con all: completar el merge con git commit --no-edit (o -m si hay message)' },
        message: { type: 'STRING', description: 'Mensaje del commit de merge (opcional; por defecto el de git)' },
        abort: { type: 'BOOLEAN', description: 'Con all: git merge --abort para deshacer el merge en curso' },
      },
      // Sin campos obligatorios: `output` sobra con all, y resolve sobra al consultar.
    },
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
