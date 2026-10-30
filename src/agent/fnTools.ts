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
    name: 'fs_propose_write',
    description: 'Proponer escribir un archivo (crear o sobreescribir) SIN tocar disco: devuelve un diff unificado y el archivo queda intacto. Funciona en modo plan.',
    parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, content: { type: 'STRING' } }, required: ['path', 'content'] },
  },
  {
    name: 'fs_propose_edit',
    description: 'Proponer un edit reemplazando texto exacto SIN tocar disco: devuelve un diff unificado. Funciona en modo plan.',
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
    description: 'Ejecutar comando allowlist (npm, node, git, tsc, vite...). Admite pipes `|` entre etapas permitidas. Con background:true lo lanza en segundo plano y devuelve id/pid/logPath.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'Comando; las etapas se separan con |' },
        timeoutMs: { type: 'NUMBER', description: 'Timeout en primer plano (máx 60000)' },
        background: { type: 'BOOLEAN', description: 'Dejarlo corriendo y devolver id para shell_job' },
      },
      required: ['command'],
    },
  },
  {
    name: 'shell_job',
    description: 'Trabajos en segundo plano: list, logs (tail de líneas) y stop por id. El pid de stop debe pertenecer al trabajo; no se puede matar un proceso ajeno.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['list', 'logs', 'stop'], description: 'Acción a ejecutar' },
        id: { type: 'STRING', description: 'Id del trabajo (requerido en logs/stop)' },
        tail: { type: 'NUMBER', description: 'Líneas de log a devolver (1-500, por defecto 40)' },
        pid: { type: 'NUMBER', description: 'Comprobación extra en stop: debe pertenecer al trabajo' },
      },
      required: ['action'],
    },
  },
  {
    name: 'browser',
    description: 'Navegador headless (Chromium). open: abre sesión (url opcional). navigate: va a una url http/https. snapshot: devuelve la página como árbol de texto con un uid por elemento (e1, e2…). click/type/press: actúan sobre el uid del ÚLTIMO snapshot; si la página cambia hay que volver a leerla. scroll: desplaza dy/dx px. screenshot: guarda un PNG (path opcional dentro del proyecto). logs: errores de consola y peticiones fallidas. close: cierra la sesión. list: sesiones abiertas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['open', 'navigate', 'snapshot', 'click', 'type', 'press', 'scroll', 'screenshot', 'logs', 'close', 'list'], description: 'Acción a ejecutar' },
        sessionId: { type: 'STRING', description: 'Sesión concreta (por defecto la última del proyecto)' },
        url: { type: 'STRING', description: 'Destino de open/navigate' },
        uid: { type: 'STRING', description: 'uid del elemento según el último snapshot' },
        text: { type: 'STRING', description: 'Texto de type' },
        submit: { type: 'BOOLEAN', description: 'Con type: pulsar Enter después' },
        key: { type: 'STRING', description: 'Tecla de press (Enter, Tab, Escape…)' },
        dy: { type: 'NUMBER', description: 'Píxeles a desplazar en vertical (scroll)' },
        dx: { type: 'NUMBER', description: 'Píxeles a desplazar en horizontal (scroll)' },
        path: { type: 'STRING', description: 'Ruta del PNG dentro del proyecto (screenshot)' },
        fullPage: { type: 'BOOLEAN', description: 'Capturar la página completa (screenshot)' },
        clear: { type: 'BOOLEAN', description: 'Vaciar los logs tras leerlos' },
      },
      required: ['action'],
    },
  },
  {
    name: 'preview',
    description: 'Preview de un dev server. open: arranca el comando en segundo plano (misma allowlist que shell_run) y espera a que el puerto responda; devuelve url y jobId, o ready:false con el final del log. check: ¿responde esta url? status: previews vivos. stop: para el trabajo por jobId.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['open', 'check', 'status', 'stop'], description: 'Acción a ejecutar' },
        command: { type: 'STRING', description: 'Comando a arrancar (open)' },
        url: { type: 'STRING', description: 'URL a sondear (check) o a fijar como destino (open)' },
        port: { type: 'NUMBER', description: 'Puerto del dev server (open)' },
        timeoutMs: { type: 'NUMBER', description: 'Espera máxima en ms (1000-180000)' },
        jobId: { type: 'STRING', description: 'Trabajo a parar (stop)' },
        pid: { type: 'NUMBER', description: 'Comprobación extra en stop: debe pertenecer al trabajo' },
      },
      required: ['action'],
    },
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
  {
    name: 'update_plan',
    description: 'Actualizar el plan visible de la tarea. Envía la lista completa de pasos en orden y marca done:true los terminados (o manda sólo {id, done} para cambiar el estado de un paso ya listado). No ejecuta nada en el workspace: sólo refleja el progreso.',
    parameters: {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          description: 'Pasos del plan, en orden',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'Id estable; reutilízalo para actualizar un paso existente' },
              text: { type: 'STRING', description: 'Descripción corta del paso' },
              done: { type: 'BOOLEAN', description: 'true si el paso ya está completado' },
            },
          },
        },
      },
      required: ['items'],
    },
  },
];

const FN_TO_TOOL: Record<string, string> = {
  fs_read: 'fs.read', fs_write: 'fs.write', fs_edit: 'fs.edit',
  fs_propose_write: 'fs.propose.write', fs_propose_edit: 'fs.propose.edit',
  fs_glob: 'fs.glob', fs_grep: 'fs.grep', shell_run: 'shell.run', shell_job: 'shell.job',
  browser: 'browser', preview: 'preview',
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
