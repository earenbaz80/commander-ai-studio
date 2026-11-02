import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  SHELL_BLOCKED,
  SHELL_ALLOW_PREFIX,
  AGENT_TOOLS,
  SENSITIVE_READ_MESSAGE,
  isSensitivePath,
  sanitizeGitMessage,
} from './security';
import { diffLines, toUnifiedDiff } from './src/utils/patch';
import { diagnoseProposed } from './src/agent/proposedDiagnostics';
import { splitPipeline } from './src/agent/shellCommand';
import { listJobs, readJobLog, runPipeline, startJob, stopJob } from './shellJobs';
import { assertSafeOutboundUrl, safeFetch } from './ssrf';
import { displayPath, listRoots, resolveProjectPath } from './projects';
import { createWorktree } from './worktrees';
import { snapshotPath } from './checkpoints';
import { uid } from './src/agent/id';
import { invalidateIndex } from './repoIndex';
import { getPermissions, enforceTool, enforcePath } from './permissions';
import { executeTask, getSession } from './agentSession';
import { listServerTools, callServerTool } from './src/mcp/client';
import { runBrowserAction } from './browserSession';
import { checkPreview, listPreviews, openPreview, stopPreview } from './previewServer';

const AGENT_ROOT = process.cwd();

/** Directorios que nunca se recorren en fs.glob / fs.grep (build, VCS, caches) */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'release', 'out', 'coverage',
  '.git', '.next', '.nuxt', '.cache', '.vite', '.turbo', '.parcel-cache',
  '.commander',
  // Artefactos de build que no son código del usuario: un `target` de Rust
  // puede tener miles de binarios de varios MB.
  'target',
]);

/** fs.grep no abre archivos más grandes que esto: son binarios o bundles minificados. */
const GREP_MAX_BYTES = 512 * 1024;
const GREP_MAX_MATCHES = 100;
/** Líneas que devuelve `fs.read` cuando no se pide una ventana concreta. */
const READ_WINDOW_LINES = 200;
/** Tope duro de una ventana: más que esto ya no cabe en el contexto del modelo. */
const READ_MAX_LINES = 2000;

/**
 * Marcas de conflicto de git, una por bloque:
 *   <<<<<<< ours
 *   ||||||| base   (sólo con merge.conflictStyle=diff3)
 *   =======
 *   >>>>>>> theirs
 * Grupos: 1 = ours, 2 = base (opcional), 3 = theirs.
 */
function conflictBlockPattern(): RegExp {
  return /^<<<<<<< [^\n]*\r?\n([\s\S]*?)(?:^\|\|\|\|\|\|\| [^\n]*\r?\n([\s\S]*?))?^======= *\r?\n([\s\S]*?)^>>>>>>> [^\n]*\r?\n?/gm;
}

/**
 * Ruta del archivo en conflicto según la salida de `git merge` / `git status`.
 * Devuelve '' si la salida no la nombra (p. ej. marcas pegadas a mano).
 */
function detectConflictPath(output: string): string {
  const patterns = [
    /Merge conflict in (\S+)\s*$/m,
    /^\s*both modified:\s+(\S+)\s*$/m,
    /^CONFLICT \([^)]*\):\s+(\S+?)\s+(?:deleted|modified|renamed|added)\b/m,
    /^CONFLICT \([^)]*\):.*?\bin (\S+)\s*$/m,
  ];
  for (const re of patterns) {
    const m = output.match(re);
    if (m) return m[1];
  }
  return '';
}

/**
 * Resuelve una ruta dentro de los proyectos permitidos.
 * Ya no estamos atados a process.cwd(): el agente puede trabajar en cualquier
 * root registrado, pero nunca fuera de ellos.
 */
function agentSafePath(p: string, root?: string): string {
  return resolveProjectPath(p, root).abs;
}

function agentRateOk(ip: string): boolean {
  const now = Date.now();
  const e = (agentRate as Map<string, { count: number; reset: number }>).get(ip);
  if (!e || now > e.reset) {
    (agentRate as Map<string, { count: number; reset: number }>).set(ip, { count: 1, reset: now + 60_000 });
    return true;
  }
  e.count++;
  return e.count <= 60;
}

const agentRate = new Map<string, { count: number; reset: number }>();

/** Diagnóstico devuelto por `read_diagnostics` (una entrada por mensaje de tsc). */
export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

const DIAG_FORMAT = /^(.*?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.*)$/;
const DIAG_GLOBAL = /^(error|warning)\s+(TS\d+):\s*(.*)$/;
const DIAG_TIMEOUT_MS = 60_000;
const DIAG_TTL_MS = 30_000;

/**
 * Parsea la salida de `tsc --noEmit --pretty false`.
 * Formato por diagnóstico: `ruta/archivo.ts(12,5): error TS2322: mensaje`.
 * Los errores globales (sin posición) también se capturan y quedan con file ''.
 */
export function parseTscOutput(stdout: string, limit = 300): {
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
} {
  const diagnostics: Diagnostic[] = [];
  let errorCount = 0;
  let warningCount = 0;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = DIAG_FORMAT.exec(line);
    if (m) {
      const severity = m[4] as Diagnostic['severity'];
      if (severity === 'error') errorCount++;
      else warningCount++;
      if (diagnostics.length < limit) {
        diagnostics.push({
          file: m[1].replace(/\\/g, '/'),
          line: Number(m[2]),
          column: Number(m[3]),
          severity,
          code: m[5],
          message: m[6].trim(),
        });
      }
      continue;
    }
    const g = DIAG_GLOBAL.exec(line);
    if (g) {
      const severity = g[1] as Diagnostic['severity'];
      if (severity === 'error') errorCount++;
      else warningCount++;
      if (diagnostics.length < limit) {
        diagnostics.push({ file: '', line: 0, column: 0, severity, code: g[2], message: g[3].trim() });
      }
    }
  }
  return { diagnostics, errorCount, warningCount };
}

/** Normaliza una ruta relativa para compararla con la salida de tsc. */
function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** Ejecuta `tsc --noEmit` en el root del proyecto. */
async function computeDiagnostics(rootAbs: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  if (!fs.existsSync(path.join(rootAbs, 'tsconfig.json'))) {
    return {
      ok: true,
      data: {
        diagnostics: [], errorCount: 0, warningCount: 0, root: rootAbs,
        note: 'Sin tsconfig.json: read_diagnostics solo analiza proyectos TypeScript.',
      },
    };
  }
  const localTsc = path.join(rootAbs, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(localTsc)) {
    return {
      ok: true,
      data: {
        diagnostics: [], errorCount: 0, warningCount: 0, root: rootAbs,
        note: 'typescript no está instalado en este proyecto (npm i -D typescript).',
      },
    };
  }
  const { spawn } = await import('child_process');
  const start = Date.now();
  const run = await new Promise<{ out: string; code: number; timedOut: boolean }>((resolve) => {
    const child = spawn(process.execPath, [localTsc, '--noEmit', '--pretty', 'false'], {
      cwd: rootAbs,
      windowsHide: true,
    });
    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, DIAG_TIMEOUT_MS);
    const sink = (chunk: Buffer | string) => {
      out += chunk;
      if (out.length > 400_000) out = out.slice(-400_000);
    };
    child.stdout.on('data', sink);
    child.stderr.on('data', sink);
    child.on('close', (code) => { clearTimeout(timer); resolve({ out, code: code ?? 0, timedOut }); });
    child.on('error', () => { clearTimeout(timer); resolve({ out, code: 1, timedOut: false }); });
  });
  if (run.timedOut) return { ok: false, error: 'tsc excedió el tiempo límite (60s)' };
  const parsed = parseTscOutput(run.out);
  return {
    ok: true,
    data: {
      diagnostics: parsed.diagnostics,
      errorCount: parsed.errorCount,
      warningCount: parsed.warningCount,
      exitCode: run.code,
      durationMs: Date.now() - start,
      root: rootAbs,
    },
  };
}

// Caché + deduplicación por proyecto (evita re-compilar en llamadas seguidas).
const DIAG_CACHE = new Map<string, { at: number; res: { ok: boolean; data?: any; error?: string } }>();
const DIAG_INFLIGHT = new Map<string, Promise<{ ok: boolean; data?: any; error?: string }>>();

/** Diagnósticos del proyecto (con caché). `only` filtra a un único archivo. */
async function runReadDiagnostics(
  rootHint: string | undefined,
  onlyFile?: string
): Promise<{ ok: boolean; data?: any; error?: string }> {
  const rootAbs = rootHint ? resolveProjectPath('.', rootHint).abs : AGENT_ROOT;
  const only = onlyFile ? normalizeRel(onlyFile) : '';
  const cached = DIAG_CACHE.get(rootAbs);
  let res: { ok: boolean; data?: any; error?: string };
  if (cached && Date.now() - cached.at < DIAG_TTL_MS) {
    res = cached.res;
  } else {
    let inflight = DIAG_INFLIGHT.get(rootAbs);
    if (!inflight) {
      inflight = computeDiagnostics(rootAbs).finally(() => DIAG_INFLIGHT.delete(rootAbs));
      DIAG_INFLIGHT.set(rootAbs, inflight);
    }
    res = await inflight;
    if (res.ok) DIAG_CACHE.set(rootAbs, { at: Date.now(), res });
  }
  if (!only || !res.ok || !res.data) return res;
  const diagnostics: Diagnostic[] = ((res.data.diagnostics as Diagnostic[]) || []).filter((d) => d.file === only);
  return {
    ok: true,
    data: {
      ...res.data,
      diagnostics,
      errorCount: diagnostics.filter((d) => d.severity === 'error').length,
      warningCount: diagnostics.filter((d) => d.severity === 'warning').length,
      filteredTo: only,
    },
  };
}

// ── Resultado de ejecutar una tool (lo consume HTTP y el agente del servidor) ──

export interface ToolResult {
  ok: boolean;
  data?: any;
  error?: string;
  /** Status HTTP a usar (403/400/500). Default 200. */
  status?: number;
}

/**
 * Ejecuta una tool del agente con validación de permisos y sandbox.
 * Es el núcleo compartido por `handleAgentRunTool` (HTTP) y las sesiones de
 * agente en el servidor (P1 #6): devuelve un ToolResult en vez de escribir
 * en `res`, de modo que pueda invocarse sin un Request/Response.
 */
/**
 * Valida un pipeline etapa por etapa con la allowlist de `shell.run`.
 *
 * Lo comparten `shell.run` y `preview.open`: si la validación viviera sólo en
 * una de las dos, la otra sería un bypass (un `preview` que arranca `curl | sh`
 * en segundo plano).
 */
export function checkShellSegments(
  command: unknown,
  rootHint?: string,
): { ok: true; segments: string[]; command: string } | { ok: false; error: string; status: number } {
  const parsed = splitPipeline(command);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 403 };
  // Cada etapa se valida por separado: un pipeline no puede colar un comando
  // que solo no pasaría (p. ej. `cat x | sh`).
  for (const segment of parsed.segments) {
    const lower = segment.toLowerCase();
    const blocked = SHELL_BLOCKED.find((b) => lower.includes(b));
    if (blocked) {
      return { ok: false, error: `Comando bloqueado por seguridad (${blocked.trim()})`, status: 403 };
    }
    if (!SHELL_ALLOW_PREFIX.some((a) => lower.startsWith(a))) {
      return {
        ok: false,
        error: `Comando no permitido: ${segment.slice(0, 80)}. Usa npm/npx/node/python/git/ls/cat/echo/tsc/vite.`,
        status: 403,
      };
    }
    const tokens = segment.split(/\s+/).filter(Boolean);
    for (const t of tokens.slice(1)) {
      if (t.startsWith('-') || !/[\\/:]|\.\./.test(t)) continue;
      try {
        resolveProjectPath(t, rootHint);
      } catch {
        return { ok: false, error: `Ruta fuera de los proyectos permitidos: ${t}`, status: 403 };
      }
    }
  }
  return { ok: true, segments: parsed.segments, command: String(command).trim() };
}

/** Caracteres que hay que neutralizar para que el glob sea un literal. */
const BACKSLASH = String.fromCharCode(92);
const REGEX_SPECIAL = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', BACKSLASH]);

/** Rutas siempre en POSIX, también en Windows. */
function normalizeSlashes(value: string): string {
  return value.split(BACKSLASH).join('/');
}

/**
 * Convierte un patrón glob en regex sobre rutas POSIX relativas.
 *
 * El doble asterisco cruza directorios, el simple se queda en un segmento y
 * `?` es un carácter. Sin esto el patrón se comparaba como subcadena contra la
 * ruta del sistema, que en Windows usa otro separador: un patrón con doble
 * asterisco no encontraba nada y el modelo se quedaba buscando un fichero que
 * sí estaba en su workspace.
 */
function globToRegExp(pattern: string): RegExp {
  const posix = normalizeSlashes(pattern);
  let source = '';
  for (let i = 0; i < posix.length; i++) {
    const ch = posix[i];
    if (ch === '*') {
      if (posix[i + 1] === '*') {
        i += 1;
        if (posix[i + 1] === '/') {
          i += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      source += '[^/]';
      continue;
    }
    source += REGEX_SPECIAL.has(ch) ? BACKSLASH + ch : ch;
  }
  return new RegExp(`^${source}$`);
}

/** `true` si la ruta relativa (POSIX) casa con el patrón. */
function matchesGlob(rel: string, pattern: string): boolean {
  const candidate = normalizeSlashes(rel);
  // Un patrón sin comodines sigue siendo una búsqueda por subcadena: así
  // `shellCommand.ts` encuentra `src/agent/shellCommand.ts`, como antes.
  if (!/[*?]/.test(pattern)) return candidate.includes(pattern);
  return globToRegExp(pattern).test(candidate);
}

/**
 * Raíces que recorren `fs.glob` y `fs.grep`.
 *
 * El `root` de la petición es el workspace donde el agente está trabajando, así
 * que manda si se puede resolver — es lo que ya hacen `fs.read` y `fs.edit`.
 * Antes sólo se buscaba entre los roots REGISTRADOS y, al no encontrar el
 * workspace, se recaía en todos: un workspace temporal (evaluaciones, sesiones
 * con root explícito) acababa buscando en el repo real, y el modelo recibía
 * rutas que no existían en su workspace. Se quedaba dando vueltas sin editar.
 */
function searchRootsFor(rootHint?: string): string[] {
  if (rootHint) {
    try {
      return [resolveProjectPath('.', rootHint).abs];
    } catch {
      /* pista no resoluble: se intenta por nombre entre los roots registrados */
    }
    const normalize = (value: string) => {
      let text = normalizeSlashes(value).toLowerCase();
      while (text.endsWith('/')) text = text.slice(0, -1);
      return text;
    };
    const hint = normalize(rootHint);
    const matched = listRoots().filter((root) => normalize(root).endsWith(hint));
    if (matched.length > 0) return matched;
  }
  return listRoots();
}

/**
 * Diff unificado de un cambio propuesto, calculado en memoria y sin escribir.
 * Es el corazón de las tools `fs.propose.*`: el modelo ve el cambio exacto y el
 * archivo queda intacto hasta que el usuario apruebe.
 */
function proposal(p: string, before: string, after: string, exists: boolean) {
  const result = diffLines(before, after, 3);
  if (result.hunks.length === 0) {
    return {
      path: p,
      changed: false,
      exists,
      additions: 0,
      deletions: 0,
      diff: '',
      hint: 'Sin cambios: el archivo ya tiene ese contenido.',
    };
  }
  return {
    path: p,
    changed: true,
    exists,
    additions: result.additions,
    deletions: result.deletions,
    diff: toUnifiedDiff(p, result, { exists }),
  };
}

/**
 * Hooks de cambio de archivo: corre el formateador (prettier) sobre el archivo
 * recién escrito/editado. Nunca bloquea la operación: si falla, se reporta.
 */
async function runFileChangeHooks(absPath: string, root: string): Promise<{ ran: boolean; output?: string; error?: string }> {
  const ext = path.extname(absPath).toLowerCase();
  if (!['.ts', '.tsx', '.js', '.jsx', '.css', '.json', '.md'].includes(ext)) {
    return { ran: false };
  }
  try {
    const { execFileSync } = await import('child_process');
    const out = execFileSync('npx', ['prettier', '--write', absPath], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    return { ran: true, output: String(out).slice(0, 2000) };
  } catch (e: any) {
    return { ran: true, error: String(e.message || e).slice(0, 500) };
  }
}

/**
 * ¿La llamada sólo consulta, aunque la tool figure entre las que ejecutan?
 *
 * `EXEC_TOOLS` bloquea en plan/readonly todo lo que pueda modificar algo de
 * forma indirecta, y es la clasificación correcta para el caso general. Pero
 * varias de esas tools tienen una variante que sólo lee:
 *   • `git.worktree action=list` lista los worktrees;
 *   • `git.conflict` sin `resolve` (ni `stage`/`commit`/`abort` sobre `all`)
 *     inspecciona marcas y stages. Bloquearla dejaba al agente sin poder ni
 *     mirar un conflicto en modo plan, y al panel sin su consulta de estado;
 *   • `mcp.call` con `method: 'tools/list'` enumera las tools de un servidor
 *     MCP. Es el camino del descubrimiento remoto (`src/agent/mcp.ts`), así
 *     que bloquearlo dejaba al agente de plan sin saber que esos servidores
 *     existen: el bucle capturaba el 403 como «servidor caído».
 *
 * Las variantes que sí escriben siguen cayendo en `enforceTool`, y además
 * `git.conflict` revalida modo y globs de `files.write` dentro de su propia
 * rama de `resolve`: el límite no depende de este atajo. Para MCP no hay
 * equivalente: `tools/call` puede ser cualquier cosa y sólo el servidor, que
 * es de terceros, sabe si su tool escribe. Los hints `readOnlyHint` del
 * protocolo son una promesa del propio servidor y aquí no se usan.
 */
function isReadOnlyCall(toolId: string, input: any): boolean {
  if (toolId === 'git.worktree') {
    return String(input?.action || '').toLowerCase() === 'list';
  }
  if (toolId === 'git.conflict') {
    const side = String(input?.resolve || '').trim().toLowerCase();
    const mutatesAll = !!input?.all && (!!input?.stage || !!input?.commit || !!input?.abort);
    return !side && !mutatesAll;
  }
  if (toolId === 'mcp.call') {
    // Sin `method` la rama MCP asume `tools/call`, que sigue bloqueado.
    return String(input?.method || '').trim().toLowerCase() === 'tools/list';
  }
  return false;
}

/**
 * Ejecuta una tool. `opts.signal` es la cancelación de la sesión que la pidió y
 * se pasa a lo que pueda quedarse en vuelo (hoy, el proceso de `shell.run`).
 */
export async function executeAgentTool(toolId: string, input: any, opts?: { signal?: AbortSignal }): Promise<ToolResult> {
  const rootHint = input?.root ? String(input.root).slice(0, 1024) : undefined;

  // ── Permisos por proyecto (modo plan/readonly + tools + globs) ──
  // Se resuelve el root canónico para que el modelo no pueda eludir los
  // permisos cambiando `input.root`.
  const permRoot = rootHint ? resolveProjectPath('.', rootHint).abs : AGENT_ROOT;
  const perms = getPermissions(permRoot);
  // Las variantes de sólo consulta se permiten incluso en modo plan/readonly
  // (las listas de tools permitidas/denegadas siguen aplicando dentro).
  const toolErr = enforceTool(perms, toolId, { readOnly: isReadOnlyCall(toolId, input) });
  if (toolErr) return { ok: false, error: toolErr, status: 403 };

  if (toolId === 'fs.read') {
    const p = String(input.path || '').slice(0, 500);
    if (!p) return { ok: false, error: 'path requerido' };
    if (isSensitivePath(p)) return { ok: false, error: SENSITIVE_READ_MESSAGE, status: 403 };
    const pathErr = enforcePath(perms, p, 'read');
    if (pathErr) return { ok: false, error: pathErr, status: 403 };
    const target = agentSafePath(p, rootHint);
    if (!fs.existsSync(target)) return { ok: false, error: `No existe: ${p}` };
    const stats = fs.statSync(target);
    if (stats.isDirectory()) return { ok: false, error: 'Es directorio, usa fs.glob' };
    // Lectura por ventana: sin `offset`/`limit` un archivo corto se devuelve
    // entero (compatibilidad) y uno largo se recorta. Antes se metían hasta
    // 2 MB de un solo archivo en el contexto, que es la forma más rápida de
    // dejar ciego al modelo para el resto de la tarea.
    const raw = fs.readFileSync(target, 'utf8');
    const allLines = raw.split('\n');
    const totalLines = raw === '' ? 0 : allLines.length - (raw.endsWith('\n') ? 1 : 0);
    const requestedLimit = Number(input.limit);
    const offset = Math.max(1, Math.trunc(Number(input.offset) || 1));
    const limit = Math.min(
      Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.trunc(requestedLimit) : READ_WINDOW_LINES,
      READ_MAX_LINES,
    );
    // Pedir una ventana más allá del final no devuelve la última línea por
    // sorpresa: ventana vacía y un aviso de qué rango existe.
    const outside = totalLines > 0 && offset > totalLines;
    const startLine = outside ? offset : Math.max(1, Math.min(offset, Math.max(totalLines, 1)));
    const endLine = outside ? offset - 1 : Math.min(startLine + limit - 1, totalLines);
    const windowLines = outside || totalLines === 0 ? [] : allLines.slice(startLine - 1, endLine);
    const truncated = outside || startLine > 1 || endLine < totalLines;
    const numberLines = input.numberLines === true;
    const isWholeFile = startLine === 1 && endLine === totalLines;
    // `content` es texto literal del archivo: si se numerara por defecto, el
    // modelo pegaría el prefijo "  12| " en `fs.edit.oldString` y fallaría.
    const content = isWholeFile && !numberLines
      ? raw
      : numberLines
        ? windowLines.map((l, i) => `${String(startLine + i).padStart(5)}| ${l}`).join('\n')
        : windowLines.join('\n');
    const data: Record<string, unknown> = {
      content,
      bytes: content.length,
      exists: true,
      startLine,
      endLine,
      totalLines,
      truncated,
    };
    if (outside) {
      data.hint = `offset ${offset} fuera del archivo (${totalLines} líneas).`;
    } else if (truncated) {
      data.hint = `Ventana ${startLine}-${endLine} de ${totalLines} líneas. Pide offset/limit para leer otra parte (máx ${READ_MAX_LINES} por lectura).`;
    }
    return { ok: true, data };
  }

  if (toolId === 'fs.write') {
    const p = String(input.path || '').slice(0, 500);
    const content = String(input.content || '').slice(0, 5000000);
    if (!p) return { ok: false, error: 'path requerido' };
    if (isSensitivePath(p)) return { ok: false, error: SENSITIVE_READ_MESSAGE, status: 403 };
    const pathErr = enforcePath(perms, p, 'write');
    if (pathErr) return { ok: false, error: pathErr, status: 403 };
    const target = agentSafePath(p, rootHint);
    if (fs.existsSync(target) && !input.overwrite) {
      return { ok: false, error: 'Archivo existe. Usa overwrite: true' };
    }
    // Snapshot del estado previo (undo). Nunca debe bloquear la escritura.
    let rootAbs = target;
    try {
      const resolved = resolveProjectPath(p, rootHint);
      rootAbs = resolved.root;
      const rel = path.relative(resolved.root, resolved.abs).split(path.sep).join('/');
      if (rel) snapshotPath(resolved.root, rel, `fs.write ${p}`, 'fs.write');
    } catch { /* ignore */ }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    try { invalidateIndex(rootAbs); } catch { /* ignore */ }
    // Hooks de cambio de archivo: formateador sobre el archivo recién escrito.
    const hooks = await runFileChangeHooks(target, rootAbs);
    return { ok: true, data: { path: p, bytes: content.length, hooks } };
  }

  if (toolId === 'fs.edit') {
    const p = String(input.path || '').slice(0, 500);
    const oldStr = String(input.oldString || '');
    const newStr = String(input.newString || '');
    if (!p || !oldStr) return { ok: false, error: 'path y oldString requeridos' };
    if (isSensitivePath(p)) return { ok: false, error: SENSITIVE_READ_MESSAGE, status: 403 };
    const pathErr = enforcePath(perms, p, 'write');
    if (pathErr) return { ok: false, error: pathErr, status: 403 };
    const target = agentSafePath(p, rootHint);
    if (!fs.existsSync(target)) return { ok: false, error: `No existe: ${p}` };
    const content = fs.readFileSync(target, 'utf8');
    if (!content.includes(oldStr)) return { ok: false, error: 'oldString no encontrado en el archivo' };
    const count = input.replaceAll
      ? content.split(oldStr).length - 1
      : 1;
    const updated = input.replaceAll
      ? content.replace(new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), () => newStr)
      : content.replace(oldStr, () => newStr);
    // Snapshot del estado previo (undo). Nunca debe bloquear la escritura.
    let rootAbs = target;
    try {
      const resolved = resolveProjectPath(p, rootHint);
      rootAbs = resolved.root;
      const rel = path.relative(resolved.root, resolved.abs).split(path.sep).join('/');
      if (rel) snapshotPath(resolved.root, rel, `fs.edit ${p}`, 'fs.edit');
    } catch { /* ignore */ }
    fs.writeFileSync(target, updated, 'utf8');
    try { invalidateIndex(rootAbs); } catch { /* ignore */ }
    // Hooks de cambio de archivo: formateador sobre el archivo recién editado.
    const hooks = await runFileChangeHooks(target, rootAbs);
    return { ok: true, data: { path: p, replaced: count, hooks } };
  }

  // ── Dry-run: proponer un cambio sin tocar disco ──
  //
  // Estas tools sólo leen, así que funcionan incluso en modo plan (donde
  // `fs.write`/`fs.edit` responden 403). Devuelven un diff unificado para que el
  // modelo razone sobre el cambio exacto y el usuario decida si se aplica.
  if (toolId === 'fs.propose.edit') {
    const p = String(input.path || '').slice(0, 500);
    const oldStr = String(input.oldString || '');
    const newStr = String(input.newString || '');
    if (!p || !oldStr) return { ok: false, error: 'path y oldString requeridos' };
    if (isSensitivePath(p)) return { ok: false, error: SENSITIVE_READ_MESSAGE, status: 403 };
    const pathErr = enforcePath(perms, p, 'read');
    if (pathErr) return { ok: false, error: pathErr, status: 403 };
    const target = agentSafePath(p, rootHint);
    if (!fs.existsSync(target)) return { ok: false, error: `No existe: ${p}` };
    const before = fs.readFileSync(target, 'utf8');
    if (!before.includes(oldStr)) return { ok: false, error: 'oldString no encontrado en el archivo' };
    const after = input.replaceAll
      ? before.split(oldStr).join(newStr)
      : before.replace(oldStr, () => newStr);
    const data: any = proposal(p, before, after, true);
    if (data.changed && input.diagnose === true) {
      data.diagnostics = diagnoseProposed(permRoot, p, after);
    }
    return { ok: true, data };
  }

  if (toolId === 'fs.propose.write') {
    const p = String(input.path || '').slice(0, 500);
    const content = String(input.content || '').slice(0, 5000000);
    if (!p) return { ok: false, error: 'path requerido' };
    if (isSensitivePath(p)) return { ok: false, error: SENSITIVE_READ_MESSAGE, status: 403 };
    const pathErr = enforcePath(perms, p, 'read');
    if (pathErr) return { ok: false, error: pathErr, status: 403 };
    const target = agentSafePath(p, rootHint);
    const isFile = fs.existsSync(target) && !fs.statSync(target).isDirectory();
    const before = isFile ? fs.readFileSync(target, 'utf8') : '';
    const data: any = proposal(p, before, content, isFile);
    if (data.changed && input.diagnose === true) {
      data.diagnostics = diagnoseProposed(permRoot, p, content);
    }
    return { ok: true, data };
  }

  if (toolId === 'run_file_change_hooks') {
    const p = String(input.path || '').slice(0, 500);
    if (!p) return { ok: false, error: 'path requerido' };
    const target = agentSafePath(p, rootHint);
    const root = rootHint ? resolveProjectPath('.', rootHint).abs : AGENT_ROOT;
    const hooks = await runFileChangeHooks(target, root);
    return { ok: true, data: hooks };
  }

  if (toolId === 'worktree.create') {
    // El cliente entra por `POST /api/worktrees`; esto cubre a quien llame al
    // run-tool con el mismo id, para que estar en AGENT_TOOLS no sea media
    // verdad. `projectPath` se resuelve contra los roots conocidos: crear un
    // worktree corre git y npm, y no debe poder apuntar a cualquier carpeta.
    const threadId = String(input.threadId || input.id || '').slice(0, 128);
    if (!threadId) return { ok: false, error: 'threadId requerido' };
    const projectPath = String(input.projectPath || '').slice(0, 2000);
    if (!projectPath) return { ok: false, error: 'projectPath requerido' };
    const { root } = resolveProjectPath('.', projectPath);
    return { ok: true, data: createWorktree(threadId, root) };
  }


  const roots = searchRootsFor(rootHint);

  if (toolId === 'fs.glob') {
    const pattern = String(input.pattern || '').slice(0, 500);
    if (!pattern) return { ok: false, error: 'pattern requerido' };
    const files: string[] = [];
    const walk = (dir: string, root: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) walk(full, root);
          } else {
            const rel = path.relative(root, full);
            if (isSensitivePath(rel)) continue;
            if (matchesGlob(rel, pattern)) {
              // Siempre en POSIX: el modelo pide rutas con `/`, también en Windows.
              files.push(rel.split(path.sep).join('/'));
            }
          }
        }
      } catch { /* sin acceso */ }
    };
    for (const root of roots) {
      walk(root, root);
      if (files.length >= 500) break;
    }
    return { ok: true, data: { files: files.slice(0, 500), roots } };
  }

  if (toolId === 'fs.grep') {
    const pattern = String(input.pattern || '').slice(0, 500);
    if (!pattern) return { ok: false, error: 'pattern requerido' };
    if (input.path) {
      if (isSensitivePath(String(input.path))) {
        return { ok: false, error: SENSITIVE_READ_MESSAGE, status: 403 };
      }
      const pathErr = enforcePath(perms, String(input.path), 'read');
      if (pathErr) return { ok: false, error: pathErr, status: 403 };
    }
    // Contexto por coincidencia: `before`/`after` (o `context` para ambos).
    // Sin esto, un grep solo devuelve la línea que coincide y el modelo tiene
    // que volver a leer el archivo entero para saber qué la rodea.
    const clampContext = (v: unknown) => {
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 0;
    };
    const beforeN = clampContext(input.before ?? input.context);
    const afterN = clampContext(input.after ?? input.context);
    const matches: { file: string; line: number; text: string; before?: string[]; after?: string[] }[] = [];
    const walkGrep = (dir: string, root: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) walkGrep(full, root);
          } else {
            const rel = path.relative(root, full);
            if (isSensitivePath(rel)) continue;
            try {
              // Sin este corte, un directorio de artefactos (p. ej. un empaquetado
              // con `target/` de Rust) bloquea el event loop leyendo GB de binarios.
              if (fs.statSync(full).size > GREP_MAX_BYTES) continue;
              const content = fs.readFileSync(full, 'utf8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length && matches.length < GREP_MAX_MATCHES; i++) {
                if (lines[i].includes(pattern)) {
                  const match: { file: string; line: number; text: string; before?: string[]; after?: string[] } = {
                    file: rel,
                    line: i + 1,
                    text: lines[i].slice(0, 200),
                  };
                  if (beforeN) match.before = lines.slice(Math.max(0, i - beforeN), i).map((l) => l.slice(0, 200));
                  if (afterN) match.after = lines.slice(i + 1, i + 1 + afterN).map((l) => l.slice(0, 200));
                  matches.push(match);
                }
              }
            } catch { /* binario */ }
          }
        }
      } catch { /* sin acceso */ }
    };
    for (const root of roots) {
      walkGrep(root, root);
      if (matches.length >= GREP_MAX_MATCHES) break;
    }
    return {
      ok: true,
      data: {
        matches,
        roots,
        truncated: matches.length >= GREP_MAX_MATCHES,
        ...(beforeN || afterN ? { context: { before: beforeN, after: afterN } } : {}),
      },
    };
  }

  if (toolId === 'read_diagnostics') {
    const only = input.path ? String(input.path).slice(0, 500) : undefined;
    return runReadDiagnostics(rootHint, only);
  }

  if (toolId === 'shell.run') {
    // Allowlist, denylist y rutas: las mismas reglas que usa `preview`, para que
    // arrancar un dev server no sea una puerta trasera al shell.
    const checked = checkShellSegments(input.command, rootHint);
    if (!checked.ok) return checked;
    const cmd = checked.command;
    const segments = checked.segments;
    // El comando corre en el root del proyecto activo (siempre uno registrado).
    const cwd = rootHint ? resolveProjectPath('.', rootHint).abs : AGENT_ROOT;

    // Segundo plano: el proceso escribe a un log y se consulta por id. Nada de
    // esperar a que termine un servidor de desarrollo.
    if (input.background === true) {
      const started = startJob(cmd, segments, cwd);
      if (!started.ok) return { ok: false, error: started.error };
      return {
        ok: true,
        data: {
          ...started.job,
          background: true,
          hint: `Sigue la salida con shell.job { action: "logs", id: "${started.job.id}" } y páralo con { action: "stop", id: "${started.job.id}" }.`,
        },
      };
    }

    const timeout = Math.min(Number(input.timeoutMs) || 30000, 60000);
    const start = Date.now();
    const result = await runPipeline(segments, cwd, timeout, opts?.signal);
    // Cortado por la cancelación: antes el proceso seguía hasta el final aunque
    // el panel ya dijera «cancelado» (un `vite build` terminaba de escribir
    // `dist/` después de pulsar «parar»).
    if (result.aborted) return { ok: false, error: 'Cancelado por el usuario' };
    const cap = 8000;
    const clip = (s: string) => (s.length > cap ? s.slice(0, cap) + `\n… [${s.length - cap} caracteres omitidos]` : s);
    return {
      ok: true,
      data: {
        stdout: clip(result.stdout),
        stderr: clip(result.stderr),
        exitCode: result.exitCode,
        durationMs: Date.now() - start,
        stdoutBytes: result.stdout.length,
        stderrBytes: result.stderr.length,
        ...(result.stdout.length > cap || result.stderr.length > cap ? { truncated: true, hint: 'Salida recortada. Para comandos largos usa background:true y shell.job { action: "logs" }.' } : {}),
        ...(result.timedOut ? { timedOut: true } : {}),
      },
    };
  }

  if (toolId === 'shell.job') {
    const action = String(input.action || 'list');
    if (action === 'list') return { ok: true, data: { jobs: listJobs() } };
    if (action === 'logs') {
      const id = String(input.id || '').slice(0, 100);
      if (!id) return { ok: false, error: 'id requerido para logs' };
      const res = readJobLog(id, Number(input.tail) || 40);
      return res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error };
    }
    if (action === 'stop') {
      const id = String(input.id || '').slice(0, 100);
      if (!id) return { ok: false, error: 'id requerido para stop' };
      const pid = input.pid === undefined || input.pid === null ? undefined : Number(input.pid);
      if (pid !== undefined && !Number.isFinite(pid)) return { ok: false, error: 'pid inválido' };
      const res = await stopJob(id, pid);
      return res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error };
    }
    return { ok: false, error: 'action debe ser list, logs o stop' };
  }

  if (toolId === 'browser') {
    const action = String(input.action || '').trim().toLowerCase();
    // La ruta del PNG se resuelve aquí: el sandbox de rutas y los permisos de
    // escritura son política de la tool, no del driver (que sólo escribe donde
    // se le dice).
    let screenshot: { absPath: string; relPath: string } | undefined;
    if (action === 'screenshot') {
      const requested = String(input.path || '').trim();
      if (requested) {
        const pathErr = enforcePath(perms, requested, 'write');
        if (pathErr) return { ok: false, error: pathErr, status: 403 };
      }
      const rel = requested || `.commander/screenshots/${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      try {
        const resolved = resolveProjectPath(rel, rootHint);
        // `displayPath` cae al absoluto cuando la relativa se escapa: en Windows
        // el realpath de un directorio puede volver en forma corta (8.3), y una
        // relativa calculada contra él saldría con "..\..".
        screenshot = { absPath: resolved.abs, relPath: displayPath(resolved.abs, resolved.root) };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e).slice(0, 300), status: 403 };
      }
    }
    return runBrowserAction({
      ...input,
      action,
      root: rootHint ? resolveProjectPath('.', rootHint).abs : AGENT_ROOT,
      ...(screenshot ? { screenshot } : {}),
    });
  }

  if (toolId === 'preview') {
    const action = String(input.action || '').trim().toLowerCase();
    if (action === 'check') {
      const r = await checkPreview(input.url);
      return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
    }
    if (action === 'status') {
      return { ok: true, data: { previews: await listPreviews() } };
    }
    if (action === 'stop') {
      const jobId = String(input.jobId || input.id || '').slice(0, 100);
      if (!jobId) return { ok: false, error: 'jobId requerido para stop' };
      const pid = input.pid === undefined || input.pid === null ? undefined : Number(input.pid);
      if (pid !== undefined && !Number.isFinite(pid)) return { ok: false, error: 'pid inválido' };
      const res = await stopPreview(jobId, pid);
      return res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error };
    }
    if (action === 'open') {
      const checked = checkShellSegments(input.command, rootHint);
      if (!checked.ok) return checked;
      const cwd = rootHint ? resolveProjectPath('.', rootHint).abs : AGENT_ROOT;
      const r = await openPreview({
        command: checked.command,
        segments: checked.segments,
        cwd,
        url: input.url,
        port: input.port,
        timeoutMs: input.timeoutMs,
      });
      return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
    }
    return { ok: false, error: 'action debe ser open, check, status o stop' };
  }

  if (toolId === 'web.fetch') {
    const url = String(input.url || '').slice(0, 2000);
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'URL debe ser http/https' };
    try {
      await assertSafeOutboundUrl(url);
    } catch (e: any) {
      return { ok: false, error: e.message || 'URL bloqueada por seguridad', status: 403 };
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const r = await safeFetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'CommanderAIStudio/2.5' } });
      clearTimeout(t);
      const text = await r.text();
      return { ok: r.ok, data: { status: r.status, content: text.slice(0, 20000) } };
    } catch (e: any) {
      return { ok: false, error: e.message || 'fetch falló' };
    }
  }

  if (toolId === 'web.search') {
    const q = String(input.query || '').slice(0, 300);
    if (!q) return { ok: false, error: 'query requerida' };
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'CommanderAIStudio/2.5' } });
      const html = await r.text();
      const results: { title: string; url: string }[] = [];
      const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) && results.length < (input.limit ?? 8)) {
        results.push({ url: m[1].slice(0, 500), title: m[2].replace(/<[^>]+>/g, '').slice(0, 200) });
      }
      return { ok: true, data: { results } };
    } catch (e: any) {
      return { ok: false, error: e.message || 'search falló' };
    }
  }

  if (toolId === 'code.run') {
    // Deshabilitado por defecto: el sandbox `vm` no es una frontera real de
    // seguridad. Solo se permite con opt-in explícito del operador.
    if (process.env.AGENT_ALLOW_CODE_RUN !== '1') {
      return { ok: false, error: 'code.run deshabilitado. Actívalo con AGENT_ALLOW_CODE_RUN=1 si confías en el código a ejecutar.', status: 403 };
    }
    const code = String(input.code || '').slice(0, 20000);
    if (!code.trim()) return { ok: false, error: 'code requerido' };
    try {
      const vm = await import('vm');
      const logs: string[] = [];
      // Sandbox con prototipo NULL: `this` es el objeto sandbox, y si heredase de
      // Object.prototype (realm del HOST) entonces `this.constructor.constructor`
      // alcanzaría el Function del host y con él el `process` real.
      // Los intrínsecos (Math/JSON/Date/Array...) se resuelven dentro del contexto.
      const sandbox: any = Object.assign(Object.create(null), {
        console: { log: (...a: any) => logs.push(a.map(String).join(' ')) },
      });
      vm.createContext(sandbox);
      vm.runInContext(
        'globalThis.Function = undefined; globalThis.eval = undefined;',
        sandbox
      );
      const out = vm.runInContext(`"use strict"; ${code}`, sandbox, { timeout: Math.min(Number(input.timeoutMs) || 5000, 10000) });
      return { ok: true, data: { result: typeof out === 'string' ? out.slice(0, 10000) : JSON.stringify(out)?.slice(0, 10000), logs: logs.slice(0, 50) } };
    } catch (e: any) {
      return { ok: false, error: String(e.message || e).slice(0, 2000) };
    }
  }

  if (toolId === 'git.status' || toolId === 'git.diff' || toolId === 'git.log' || toolId === 'git.commit') {
    const { execFileSync } = await import('child_process');
    const cwd = rootHint ? resolveProjectPath('.', rootHint).abs : AGENT_ROOT;
    // execFile (sin shell): la ruta y el mensaje viajan como argv y no se
    // reinterpretan, así que comillas, `;`, `&` o `$()` no encadenan comandos.
    const run = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    try {
      if (toolId === 'git.status') {
        return { ok: true, data: { output: String(run(['status', '--short', '--branch'])).slice(0, 10000) } };
      }
      if (toolId === 'git.log') {
        const n = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
        return { ok: true, data: { output: String(run(['log', '--oneline', '-n', String(n)])).slice(0, 10000) } };
      }
      if (toolId === 'git.diff') {
        const p = input.path ? String(input.path).slice(0, 500) : '';
        const out = String(run(p ? ['diff', '--', p] : ['diff', '--stat'])).slice(0, 20000);
        return { ok: true, data: { output: out } };
      }
      const message = sanitizeGitMessage(input.message);
      if (!message) return { ok: false, error: 'message requerido para commit' };
      run(['add', '-A']);
      const out = String(run(['commit', '-m', message])).slice(0, 5000);
      return { ok: true, data: { output: out } };
    } catch (e: any) {
      return { ok: false, error: String(e.message || e).slice(0, 2000) };
    }
  }

  if (toolId === 'git.worktree' || toolId === 'git.rebase' || toolId === 'git.conflict') {
    const { execFileSync } = await import('child_process');
    const cwd = rootHint ? resolveProjectPath('.', rootHint).abs : AGENT_ROOT;
    // execFile (sin shell): las rutas y ramas viajan como argv, así que un `;`
    // o un `&` dentro del valor no puede encadenar comandos.
    const run = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    // Un valor que empieza por '-' se interpretaría como opción de git.
    const arg = (value: unknown, what: string): string => {
      const s = String(value || '').trim();
      if (!s) throw new Error(`${what} requerido`);
      if (s.startsWith('-')) throw new Error(`${what} inválido: no puede empezar por '-'`);
      return s;
    };
    // Un worktree tiene que vivir dentro del root: `../x` o una ruta absoluta
    // crearían directorios fuera del proyecto (mismo límite que fs.write).
    const insideRoot = (value: unknown, what: string): { raw: string; abs: string } => {
      const raw = arg(value, what);
      const abs = path.resolve(cwd, raw);
      const rel = path.relative(cwd, abs);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`${what} fuera del proyecto: ${raw}`);
      }
      // Un directorio intermedio con symlink podría apuntar fuera del root.
      try {
        const realParent = fs.realpathSync(path.dirname(abs));
        const relParent = path.relative(fs.realpathSync(cwd), realParent);
        if (relParent.startsWith('..') || path.isAbsolute(relParent)) {
          throw new Error(`${what} fuera del proyecto (symlink): ${raw}`);
        }
      } catch (e: any) {
        if (/fuera del proyecto/.test(String(e?.message))) throw e;
        // El padre todavía no existe: git lo creará dentro del root.
      }
      return { raw, abs };
    };
    try {
      if (toolId === 'git.worktree') {
        const action = String(input.action || '').trim().toLowerCase();
        if (action === 'list') {
          // La salida porcelain es un bloque por worktree, no una línea:
          //   worktree <ruta> / HEAD <sha> / branch refs/heads/<rama>
          const w = String(run(['worktree', 'list', '--porcelain']));
          const worktrees = w.split(/\r?\n\r?\n/)
            .map(b => b.trim())
            .filter(Boolean)
            .map(block => {
              const lines = block.split(/\r?\n/);
              const field = (key: string) => {
                const line = lines.find(l => l.startsWith(`${key} `));
                return line ? line.slice(key.length + 1).trim() : '';
              };
              const branch = field('branch');
              return {
                path: field('worktree'),
                branch: branch ? branch.replace(/^refs\/heads\//, '') : '(detached)',
                head: field('HEAD').slice(0, 7),
              };
            });
          return { ok: true, data: { worktrees } };
        }
        if (action === 'add') {
          const { raw, abs } = insideRoot(input.path, 'path');
          if (fs.existsSync(abs)) return { ok: false, error: 'Path already exists' };
          run(['worktree', 'add', raw]);
          return { ok: true, data: { path: raw, created: true } };
        }
        if (action === 'remove') {
          const { raw, abs } = insideRoot(input.path, 'path');
          // No permitir remover el worktree activo (antes se comparaba una ruta
          // contra el nombre de la rama, así que nunca coincidía).
          if (abs === fs.realpathSync(cwd)) return { ok: false, error: 'No se puede remover el worktree activo' };
          run(['worktree', 'remove', raw]);
          return { ok: true, data: { path: raw, removed: true } };
        }
        return { ok: false, error: `action desconocido: ${action}` };
      }

      if (toolId === 'git.rebase') {
        const action = String(input.action || '').trim().toLowerCase();
        if (action === 'start') {
          const branch = arg(input.branch, 'branch');
          // Verificar que la branch existe localmente
          try {
            run(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
          } catch {
            return { ok: false, error: `Branch '${branch}' no existe localmente` };
          }
          // Hacer checkout a la branch base si no estamos en ella
          if (String(run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim() !== branch) {
            run(['checkout', branch]);
          }
          // Iniciar rebase sobre main (o la branch por defecto)
          const base = arg(input.base || 'main', 'base');
          run(['rebase', base]);
          return { ok: true, data: { started: true, branch, base } };
        }
        if (action === 'continue') {
          run(['rebase', '--continue']);
          return { ok: true, data: { continued: true } };
        }
        if (action === 'abort') {
          run(['rebase', '--abort']);
          return { ok: true, data: { aborted: true } };
        }
        return { ok: false, error: `action desconocido: ${action}` };
      }

      if (toolId === 'git.conflict') {
        const side = String(input?.resolve || '').trim().toLowerCase();
        if (side && side !== 'ours' && side !== 'theirs') {
          return { ok: false, error: `resolve inválido: ${side} (ours|theirs)` };
        }
        const modo = perms.mode === 'plan' ? 'Plan' : 'Sólo lectura';

        /**
         * Stages presentes en el índice: 2 = ours, 3 = theirs. En un
         * modify/delete falta uno de los dos, y eso distingue «no hay marcas
         * porque el archivo se borró» de «archivo limpio sin conflictos».
         */
        const stageMap = (only?: string): Map<string, { ours?: boolean; theirs?: boolean }> => {
          const args = ['ls-files', '-u', '-z'];
          if (only) args.push('--', only);
          const map = new Map<string, { ours?: boolean; theirs?: boolean }>();
          for (const entry of String(run(args)).split('\0')) {
            const tab = entry.indexOf('\t');
            if (tab < 0) continue;
            const stage = entry.slice(0, tab).trim().split(/\s+/)[2];
            const rel = entry.slice(tab + 1);
            const rec = map.get(rel) || {};
            if (stage === '2') rec.ours = true;
            if (stage === '3') rec.theirs = true;
            map.set(rel, rec);
          }
          return map;
        };
        /** modify/delete (o borrado en ambos lados): no hay texto que fusionar. */
        const isNonTextConflict = (s?: { ours?: boolean; theirs?: boolean }) =>
          !!s && !(s.ours && s.theirs);

        // `all`: resuelve de una vez todos los archivos no fusionados del merge
        // en curso, sin necesidad de pegar la salida de `git merge`.
        if (input?.all) {
          const stage = !!input?.stage;
          const commit = !!input?.commit;
          const abort = !!input?.abort;
          const unmerged = String(run(['diff', '--name-only', '--diff-filter=U', '-z']))
            .split('\0')
            .map((s) => s.trim())
            .filter(Boolean);
          const mergeHead = String(run(['rev-parse', '--git-path', 'MERGE_HEAD'])).trim();
          const inMerge = !!mergeHead && fs.existsSync(path.resolve(cwd, mergeHead));
          const stages = stageMap();

          // Sin `resolve`, `stage`, `commit` ni `abort` es una consulta: el panel
          // la usa al abrirse para no obligar a pegar la salida de `git merge`.
          if (!side && !stage && !commit && !abort) {
            const files = unmerged.map((rel) => {
              const s = stages.get(rel);
              // Un modify/delete no tiene marcas que contar: el archivo se borró
              // en un lado. Antes esto devolvía conflicts: -1 y el panel no podía
              // hacer nada con él.
              if (isNonTextConflict(s)) {
                const both = !s!.ours && !s!.theirs;
                return {
                  path: rel,
                  conflicts: 0,
                  ready: false,
                  kind: both ? 'both-deleted' : 'modify-delete',
                  deletedBy: both ? 'both' : (s!.ours ? 'theirs' : 'ours'),
                };
              }
              try {
                const content = fs.readFileSync(path.resolve(cwd, rel), 'utf8');
                const conflicts = (content.match(conflictBlockPattern()) || []).length;
                return { path: rel, conflicts, ready: conflicts === 0 };
              } catch {
                return { path: rel, conflicts: -1, ready: false, kind: 'unreadable' };
              }
            });
            return { ok: true, data: { conflictId: uid('conflict'), inMerge, files, total: files.length } };
          }

          if (perms.mode !== 'build') {
            return { ok: false, error: `Modo ${modo}: no se puede modificar el merge.`, status: 403 };
          }

          // `abort`: deshacer el merge en curso y dejar el árbol como estaba antes
          // de intentarlo. Va antes que el resto porque también aplica sin archivos
          // pendientes (un `git merge --no-commit` sin conflictos).
          if (abort) {
            if (!inMerge) return { ok: false, error: 'No hay merge en curso: MERGE_HEAD no existe' };
            try {
              run(['merge', '--abort']);
            } catch (e: any) {
              // git se niega si hay cambios locales que pisaría: no se fuerza.
              return { ok: false, error: `No se pudo abortar el merge: ${String(e?.stderr || e?.message || e).trim().slice(0, 500)}` };
            }
            // `discarded` es la lista de archivos que estaban en conflicto y
            // quedaron descartados; se nombra distinto de `files` porque no es
            // el mismo tipo que la lista de resoluciones.
            return { ok: true, data: { conflictId: uid('conflict'), aborted: true, discarded: unmerged } };
          }

          // `commit` sí tiene sentido sin archivos pendientes: es justo el estado
          // que queda tras `stage`, con el índice listo y MERGE_HEAD vivo.
          if (!unmerged.length && !commit) return { ok: false, error: 'No hay archivos en conflicto' };

          const files: Array<{ path: string; resolved: number; kind?: string; kept?: boolean }> = [];
          const skipped: Array<{ path: string; error: string }> = [];
          if (side) {
            for (const rel of unmerged) {
              const pathErr = enforcePath(perms, rel, 'write');
              if (pathErr) {
                skipped.push({ path: rel, error: pathErr });
                continue;
              }
              try {
                const { abs } = insideRoot(rel, 'path');
                const st = stages.get(rel);
                if (isNonTextConflict(st)) {
                  const kept = side === 'ours' ? !!st!.ours : !!st!.theirs;
                  if (kept) {
                    // Conservar el lado elegido: se materializa desde su stage.
                    run(['checkout', `--${side}`, '--', rel]);
                    run(['add', '--', rel]);
                  } else {
                    // Ese lado borró el archivo: aceptar el borrado.
                    run(['rm', '-f', '--', rel]);
                  }
                  files.push({ path: rel, resolved: 0, kind: 'modify-delete', kept });
                  continue;
                }
                const before = fs.readFileSync(abs, 'utf8');
                let n = 0;
                const after = before.replace(conflictBlockPattern(), (_all, ours, _base, theirs) => {
                  n++;
                  return side === 'ours' ? ours : theirs;
                });
                if (n === 0) {
                  skipped.push({ path: rel, error: 'sin marcas de conflicto' });
                  continue;
                }
                fs.writeFileSync(abs, after, 'utf8');
                files.push({ path: rel, resolved: n });
              } catch (e: any) {
                skipped.push({ path: rel, error: String(e?.message || e).slice(0, 500) });
              }
            }
          }

          // `stage`: cerrar el merge con `git add`, pero sólo con archivos que ya
          // no tengan marcas. Marcar como resuelto un archivo con marcas deja el
          // conflicto dentro del commit.
          const staged: string[] = [];
          const unstaged: Array<{ path: string; error: string }> = [];
          if (stage) {
            for (const rel of unmerged) {
              const pathErr = enforcePath(perms, rel, 'write');
              if (pathErr) {
                unstaged.push({ path: rel, error: pathErr });
                continue;
              }
              // Sin resolver, un modify/delete no tiene marcas que mirar: no se
              // marca como resuelto por su cuenta, porque eso decidiría el
              // borrado sin preguntar.
              if (isNonTextConflict(stages.get(rel))) {
                unstaged.push({ path: rel, error: 'modify/delete sin decidir: usa resolve ours|theirs' });
                continue;
              }
              try {
                const { abs } = insideRoot(rel, 'path');
                if (conflictBlockPattern().test(fs.readFileSync(abs, 'utf8'))) {
                  unstaged.push({ path: rel, error: 'aún tiene marcas de conflicto' });
                  continue;
                }
                staged.push(rel);
              } catch (e: any) {
                unstaged.push({ path: rel, error: String(e?.message || e).slice(0, 500) });
              }
            }
            if (staged.length) run(['add', '--', ...staged]);
          }

          // `commit`: completar el merge con el commit de fusión. A diferencia de
          // `git.commit` no hace `git add -A`: sólo entra lo que ya estaba
          // preparado, para no arrastrar cambios ajenos al merge.
          if (commit) {
            if (!inMerge) return { ok: false, error: 'No hay merge en curso: MERGE_HEAD no existe' };
            // Releer el índice tras un posible `stage`: la lista de arriba es previa.
            const still = String(run(['diff', '--name-only', '--diff-filter=U', '-z']))
              .split('\0')
              .map((s) => s.trim())
              .filter(Boolean);
            if (still.length) {
              return {
                ok: false,
                error: `Faltan ${still.length} archivo(s) por preparar: ${still.slice(0, 5).join(', ')}; usa stage para cerrarlos`,
              };
            }
            const msg = input?.message ? sanitizeGitMessage(input.message) : '';
            // Sin mensaje, `--no-edit` reutiliza el MERGE_MSG que preparó git.
            const out = String(run(msg ? ['commit', '-m', msg] : ['commit', '--no-edit'])).slice(0, 2000);
            const hash = String(run(['rev-parse', '--short', 'HEAD'])).trim();
            return {
              ok: true,
              data: { conflictId: uid('conflict'), committed: true, hash, files, skipped, staged, unstaged, output: out },
            };
          }

          // Nada resuelto ni preparado es un fallo, no un éxito vacío. El caso
          // más común es reintentar tras resolver sin pedir `stage`.
          if (!files.length && !staged.length) {
            if (!stage && skipped.length && skipped.every((s) => s.error === 'sin marcas de conflicto')) {
              return {
                ok: false,
                error: `${skipped.length} archivo(s) sin marcas de conflicto: ya están resueltos, falta \`git add\` para cerrar el merge`,
              };
            }
            const detail = [...skipped, ...unstaged].map((s) => `${s.path}: ${s.error}`).join('; ');
            return { ok: false, error: `No se pudo modificar el merge${detail ? `: ${detail}` : ''}`.slice(0, 2000) };
          }
          return {
            ok: true,
            data: { conflictId: uid('conflict'), side: side || undefined, files, skipped, staged, unstaged, count: files.length },
          };
        }

        const output = String(input?.output || '');

        // Sin `resolve` sólo se inspecciona el primer bloque (no escribe nada).
        if (!side) {
          if (!output) return { ok: false, error: 'Sin output de git diff/merge' };
          const re = /^<<<<<<< [^\n]+\n(.+?)\n======+\n(.+?)\n>>>>>>>/ms;
          const m = output.match(re);
          if (!m) return { ok: false, error: 'No hay bloque de conflicto detectable' };
          return {
            ok: true,
            data: {
              conflictId: uid('conflict'),
              ours: m[1].trim(),
              theirs: m[2].trim(),
              path: detectConflictPath(output),
            },
          };
        }

        // La ruta sale del campo `path` o de la salida de merge. Un archivo
        // pegado a mano no la lleva, así que ahí el campo es obligatorio.
        const target = String(input?.path || '').trim() || detectConflictPath(output);
        if (!target) {
          return { ok: false, error: 'path requerido para resolver: la salida no indica el archivo' };
        }
        // Resolver escribe el archivo: respeta el mismo límite que fs.write
        // (modo build + globs de `files.write`), no sólo el de la tool.
        if (perms.mode !== 'build') {
          return { ok: false, error: `Modo ${modo}: no se puede escribir ${target}.`, status: 403 };
        }
        const pathErr = enforcePath(perms, target, 'write');
        if (pathErr) return { ok: false, error: pathErr, status: 403 };
        const { abs } = insideRoot(target, 'path');

        // Un modify/delete se resuelve por el stage elegido, sin marcas que
        // escribir. Queda preparado en el acto: aceptar un borrado con `git rm`
        // no se deshace con un checkout, así que no se deja a medias.
        const targetStage = stageMap(target).get(target);
        if (isNonTextConflict(targetStage)) {
          const kept = side === 'ours' ? !!targetStage!.ours : !!targetStage!.theirs;
          if (kept) {
            run(['checkout', `--${side}`, '--', target]);
            run(['add', '--', target]);
          } else {
            run(['rm', '-f', '--', target]);
          }
          return {
            ok: true,
            data: { conflictId: uid('conflict'), path: target, side, resolved: 0, kind: 'modify-delete', kept, staged: true },
          };
        }

        let stat: fs.Stats;
        try {
          stat = fs.statSync(abs);
        } catch {
          return { ok: false, error: `Archivo no encontrado: ${target}` };
        }
        if (!stat.isFile()) return { ok: false, error: `No es un archivo: ${target}` };

        const before = fs.readFileSync(abs, 'utf8');
        let resolved = 0;
        const after = before.replace(conflictBlockPattern(), (_all, ours, _base, theirs) => {
          resolved++;
          return side === 'ours' ? ours : theirs;
        });
        if (resolved === 0) return { ok: false, error: `No hay marcas de conflicto en ${target}` };

        fs.writeFileSync(abs, after, 'utf8');
        // No se hace `git add`: dejar el archivo sin stagear es reversible con
        // un checkout, mientras que marcarlo resuelto en el índice no lo es.
        return { ok: true, data: { conflictId: uid('conflict'), path: target, side, resolved } };
      }
      return { ok: false, error: 'Tool no implementada en este bloque' };
    } catch (e: any) {
      return { ok: false, error: String(e.message || e).slice(0, 2000) };
    }
  }

  if (toolId === 'mcp.call' || toolId === 'mcp.list') {
    // Servidor LOCAL del registro (stdio por comando). Si viene `server`
    // (nombre de tools.mcp.servers), se enruta por el cliente stdio.
    const serverName = String(input.server || input.serverName || '').slice(0, 200);
    if (serverName) {
      if (toolId === 'mcp.list') {
        const r = await listServerTools(serverName);
        return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
      }
      const tool = String(input.tool || '');
      if (!tool) return { ok: false, error: 'tool requerido para mcp.call local' };
      const r = await callServerTool(serverName, tool, input.args ?? {});
      return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
    }

    // Servidor REMOTO por URL (JSON-RPC sobre HTTP), flujo original.
    const serverUrl = String(input.serverUrl || input.url || '').slice(0, 2000);
    if (!/^https?:\/\//i.test(serverUrl)) return { ok: false, error: 'serverUrl debe ser http/https' };
    try {
      await assertSafeOutboundUrl(serverUrl);
    } catch (e: any) {
      return { ok: false, error: e.message || 'MCP server bloqueado', status: 403 };
    }
    try {
      const method = toolId === 'mcp.list' ? 'tools/list' : String(input.method || 'tools/call');
      const params = input.params ?? (toolId === 'mcp.call' && input.tool ? { name: input.tool, arguments: input.args ?? {} } : input.args ?? {});
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const fwdHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
      const inHeaders = (input.headers || {}) as Record<string, unknown>;
      for (const k of ['authorization', 'x-api-key']) {
        const v = Object.entries(inHeaders).find(([hk]) => hk.toLowerCase() === k)?.[1];
        if (typeof v === 'string' && v.length > 0 && v.length <= 2000) {
          fwdHeaders[k === 'authorization' ? 'Authorization' : 'X-Api-Key'] = v.slice(0, 2000);
        }
      }
      const r = await safeFetch(serverUrl, {
        method: 'POST',
        signal: ctrl.signal,
        headers: fwdHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      });
      clearTimeout(t);
      const text = await r.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 10000) }; }
      return { ok: r.ok, data: parsed };
    } catch (e: any) {
      return { ok: false, error: e.message || 'MCP falló' };
    }
  }

  if (toolId === 'task') {
    const { goal, instructions, model, allowedTools, mode, maxSteps, template } = input || {};
    if (!goal || typeof goal !== 'string') return { ok: false, error: 'goal requerido', status: 400 };
    const parentSessionId = input.parentSessionId;
    if (!parentSessionId) return { ok: false, error: 'parentSessionId requerido para task', status: 400 };
    const parent = getSession(parentSessionId);
    if (!parent) return { ok: false, error: `Sesión padre no encontrada: ${parentSessionId}`, status: 404 };
    const keys = input.keys;
    // Resolver plantilla si se pidió
    let resolvedAllowed = allowedTools;
    let resolvedMode = mode;
    let resolvedMax = maxSteps;
    if (template) {
      const { getTemplate } = await import('./src/agent/subagentTemplates');
      const tpl = getTemplate(String(template));
      if (tpl) {
        resolvedAllowed = allowedTools ?? tpl.allowedTools;
        resolvedMode = mode ?? tpl.defaultMode;
        resolvedMax = maxSteps ?? tpl.defaultMaxSteps;
      }
    }
    return executeTask(parentSessionId, { goal, instructions, model, allowedTools: resolvedAllowed, mode: resolvedMode, maxSteps: resolvedMax }, keys);
  }

  if (toolId === 'spawn_agents') {
    const parentSessionId = input?.parentSessionId;
    if (!parentSessionId) return { ok: false, error: 'parentSessionId requerido', status: 400 };
    const parent = getSession(parentSessionId);
    if (!parent) return { ok: false, error: `Sesión padre no encontrada: ${parentSessionId}`, status: 404 };
    const agents = Array.isArray(input?.agents) ? input.agents : [];
    if (agents.length === 0) return { ok: false, error: 'agents requerido (array)', status: 400 };
    const capped = agents.slice(0, 6);
    const results = await Promise.allSettled(
      capped.map((a: any) => executeTask(parentSessionId, {
        goal: String(a.goal || ''),
        instructions: a.instructions,
        model: a.model,
        allowedTools: a.allowedTools,
        mode: a.mode,
        maxSteps: a.maxSteps,
        template: a.template,
      }, input?.keys))
    );
    const out = results.map((r, i) => ({
      index: i,
      ok: r.status === 'fulfilled' ? (r.value as any).ok : false,
      cancelled: r.status === 'fulfilled' ? (r.value as any).cancelled : undefined,
      answer: r.status === 'fulfilled' ? (r.value as any).answer : undefined,
      error: r.status === 'rejected' ? String(r.reason) : (r.status === 'fulfilled' ? (r.value as any).error : undefined),
    }));
    return { ok: true, data: { results: out, spawned: capped.length, capped: agents.length > 6 } };
  }

  if (toolId === 'skill') {
    const name = String(input?.name || input?.skill || '').trim();
    if (!name) return { ok: false, error: 'name requerido', status: 400 };
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return { ok: false, error: 'nombre de skill inválido', status: 400 };
    if (name.length > 64) return { ok: false, error: 'nombre demasiado largo', status: 400 };
    // Buscar SKILL.md en skills/<name>/SKILL.md, skills/commands/<name>.md,
    // skills/agents/<name>.md y skills/templates/<name>.md, primero en el
    // proyecto abierto y después en el catálogo del propio Commander. Sin esto
    // la tool sólo veía los skills del cwd del servidor: abrir otro proyecto y
    // pedir su skill daba 404 con el archivo delante.
    const roots: string[] = [];
    if (rootHint) {
      try { roots.push(resolveProjectPath('.', rootHint).root); } catch { /* root inválido: queda el catálogo */ }
    }
    roots.push(process.cwd());
    const candidates = roots.flatMap((r) => [
      path.join(r, 'skills', name, 'SKILL.md'),
      path.join(r, 'skills', 'commands', name + '.md'),
      path.join(r, 'skills', 'agents', name + '.md'),
      path.join(r, 'skills', 'templates', name + '.md'),
    ]);
    let found: string | null = null;
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) { found = c; break; }
    }
    if (!found) return { ok: false, error: `Skill no encontrada: ${name}`, status: 404 };
    const raw = fs.readFileSync(found, 'utf8');
    // Validar front-matter YAML sobre una copia con saltos normalizados: un
    // checkout de Windows con `core.autocrlf=true` (o un editor que guarde CRLF)
    // entrega `---\r\n`, y el front-matter es exactamente el mismo. Sin esto, el
    // catálogo de skills del propio repo sólo se leía en máquinas con LF.
    const fmMatch = raw.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return { ok: false, error: 'SKILL.md sin front-matter YAML', status: 400 };
    const descMatch = fmMatch[1].match(/^description:\s*(.+)$/m);
    const desc = descMatch ? descMatch[1].trim() : '';
    if (desc.length > 1024) return { ok: false, error: 'description demasiado larga (>1024)', status: 400 };
    return { ok: true, data: { name, path: found, description: desc, content: raw } };
  }
  return { ok: false, error: `Tool desconocida: ${toolId}`, status: 400 };
}

/** HTTP wrapper delgado sobre `executeAgentTool` (rate-limit + respuesta JSON). */
export async function handleAgentRunTool(req: Request, res: Response) {
  try {
    const ip = (req.ip || req.socket?.remoteAddress || 'local').toString();
    if (!agentRateOk(ip)) return res.status(429).json({ ok: false, error: 'Rate limit agent (60/min)' });

    const { toolId, input } = req.body || {};
    if (typeof toolId !== 'string' || !AGENT_TOOLS.has(toolId)) {
      return res.status(400).json({ ok: false, error: `toolId inválido: ${String(toolId).slice(0, 50)}` });
    }
    if (!input || typeof input !== 'object') return res.status(400).json({ ok: false, error: 'input requerido' });

    const result = await executeAgentTool(toolId, input);
    const body: Record<string, unknown> = { ok: result.ok };
    if (result.data !== undefined) body.data = result.data;
    if (result.error) body.error = result.error;
    return res.status(result.status || 200).json(body);
  } catch (error: any) {
    // Violación del sandbox = error del cliente (403), no del servidor.
    const msg = error?.message || 'agent run-tool falló';
    if (/fuera de los proyectos|Path fuera|symlink/i.test(msg)) {
      return res.status(403).json({ ok: false, error: msg });
    }
    return res.status(500).json({ ok: false, error: msg });
  }
}
