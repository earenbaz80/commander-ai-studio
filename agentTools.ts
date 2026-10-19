import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { SHELL_BLOCKED, SHELL_OPERATORS, SHELL_ALLOW_PREFIX, AGENT_TOOLS, sanitizeGitMessage } from './security';
import { assertSafeOutboundUrl, safeFetch } from './ssrf';
import { listRoots, resolveProjectPath } from './projects';
import { snapshotPath } from './checkpoints';
import { uid } from './src/agent/id';
import { invalidateIndex } from './repoIndex';
import { getPermissions, enforceTool, enforcePath } from './permissions';
import { executeTask, getSession } from './agentSession';
import { listServerTools, callServerTool } from './src/mcp/client';

const AGENT_ROOT = process.cwd();

/** Directorios que nunca se recorren en fs.glob / fs.grep (build, VCS, caches) */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'release', 'out', 'coverage',
  '.git', '.next', '.nuxt', '.cache', '.vite', '.turbo', '.parcel-cache',
  '.commander',
]);

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
export async function executeAgentTool(toolId: string, input: any): Promise<ToolResult> {
  const rootHint = input?.root ? String(input.root).slice(0, 1024) : undefined;

  // ── Permisos por proyecto (modo plan/readonly + tools + globs) ──
  // Se resuelve el root canónico para que el modelo no pueda eludir los
  // permisos cambiando `input.root`.
  const permRoot = rootHint ? resolveProjectPath('.', rootHint).abs : AGENT_ROOT;
  const perms = getPermissions(permRoot);
  const toolErr = enforceTool(perms, toolId);
  if (toolErr) return { ok: false, error: toolErr, status: 403 };

  if (toolId === 'fs.read') {
    const p = String(input.path || '').slice(0, 500);
    if (!p) return { ok: false, error: 'path requerido' };
    const pathErr = enforcePath(perms, p, 'read');
    if (pathErr) return { ok: false, error: pathErr, status: 403 };
    const target = agentSafePath(p, rootHint);
    if (!fs.existsSync(target)) return { ok: false, error: `No existe: ${p}` };
    const stats = fs.statSync(target);
    if (stats.isDirectory()) return { ok: false, error: 'Es directorio, usa fs.glob' };
    const content = fs.readFileSync(target, 'utf8').slice(0, 2000000);
    return { ok: true, data: { content, bytes: content.length, exists: true } };
  }

  if (toolId === 'fs.write') {
    const p = String(input.path || '').slice(0, 500);
    const content = String(input.content || '').slice(0, 5000000);
    if (!p) return { ok: false, error: 'path requerido' };
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
    return { ok: true, data: { path: p, bytes: content.length } };
  }

  if (toolId === 'fs.edit') {
    const p = String(input.path || '').slice(0, 500);
    const oldStr = String(input.oldString || '');
    const newStr = String(input.newString || '');
    if (!p || !oldStr) return { ok: false, error: 'path y oldString requeridos' };
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
    return { ok: true, data: { path: p, replaced: count } };
  }

  // Roots a recorrer: el proyecto activo primero; todos si no se indica.
  const searchRoots = (rootHint ? listRoots().filter((r) => r.replace(/\\/g, '/').toLowerCase().endsWith(rootHint.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '')) ) : listRoots());
  const roots = searchRoots.length ? searchRoots : listRoots();

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
            if (rel.includes(pattern) || pattern.includes('*') && rel.includes(pattern.replace('**', '').replace('*', ''))) {
              files.push(rel);
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
      const pathErr = enforcePath(perms, String(input.path), 'read');
      if (pathErr) return { ok: false, error: pathErr, status: 403 };
    }
    const matches: { file: string; line: number; text: string }[] = [];
    const walkGrep = (dir: string, root: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) walkGrep(full, root);
          } else {
            const rel = path.relative(root, full);
            try {
              const content = fs.readFileSync(full, 'utf8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length && matches.length < 100; i++) {
                if (lines[i].includes(pattern)) {
                  matches.push({ file: rel, line: i + 1, text: lines[i].slice(0, 200) });
                }
              }
            } catch { /* binario */ }
          }
        }
      } catch { /* sin acceso */ }
    };
    for (const root of roots) {
      walkGrep(root, root);
      if (matches.length >= 100) break;
    }
    return { ok: true, data: { matches, roots } };
  }

  if (toolId === 'read_diagnostics') {
    const only = input.path ? String(input.path).slice(0, 500) : undefined;
    return runReadDiagnostics(rootHint, only);
  }

  if (toolId === 'shell.run') {
    const { spawn } = await import('child_process');
    const cmd = String(input.command || '').slice(0, 2000);
    if (!cmd.trim()) return { ok: false, error: 'command requerido' };
    const lower = cmd.toLowerCase().trim();
    if (SHELL_BLOCKED.some((b) => lower.includes(b))) {
      return { ok: false, error: 'Comando bloqueado por seguridad', status: 403 };
    }
    if (SHELL_OPERATORS.some((op) => cmd.includes(op))) {
      return { ok: false, error: 'Operadores de shell no permitidos (|, ;, &&, ||, `, $(), etc.)', status: 403 };
    }
    const allowed = SHELL_ALLOW_PREFIX.some((a) => lower.startsWith(a));
    if (!allowed) {
      return { ok: false, error: 'Comando no permitido. Usa npm/npx/node/python/git/ls/cat/echo/tsc/vite.', status: 403 };
    }
    const tokens = cmd.split(/\s+/).filter(Boolean);
    const [bin, ...args] = tokens;
    if (!bin) return { ok: false, error: 'comando vacío' };
    for (const t of args) {
      if (t.startsWith('-') || !/[\\/:]|\.\./.test(t)) continue;
      try {
        resolveProjectPath(t, rootHint);
      } catch {
        return { ok: false, error: `Ruta fuera de los proyectos permitidos: ${t}`, status: 403 };
      }
    }
    // El comando corre en el root del proyecto activo (siempre uno registrado).
    const cwd = rootHint ? resolveProjectPath('.', rootHint).abs : AGENT_ROOT;
    const timeout = Math.min(Number(input.timeoutMs) || 30000, 60000);
    try {
      const start = Date.now();
      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
        let child;
        if (process.platform === 'win32') {
          // Windows: echo/dir/type/copy/move/del/rmdir son builtins de cmd.exe y npm/npx
          // son .cmd — spawn directo falla con ENOENT/EINVAL (CVE-2024-27980).
          // El comando viaja como UN solo arg (sin concatenación) vía cmd /d /s /c.
          child = spawn(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', cmd], {
            cwd, timeout, windowsHide: true, windowsVerbatimArguments: true,
          });
        } else {
          child = spawn(bin, args, { cwd, timeout, windowsHide: true });
        }
        let stdout = ''; let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 20000) stdout = stdout.slice(-20000); });
        child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 5000) stderr = stderr.slice(-5000); });
        child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
        child.on('error', reject);
      });
      return { ok: true, data: { stdout: result.stdout.slice(0, 20000), stderr: result.stderr.slice(0, 5000), exitCode: result.code, durationMs: Date.now() - start } };
    } catch (e: any) {
      return { ok: true, data: { stdout: '', stderr: String(e.message || '').slice(0, 5000), exitCode: 1, durationMs: 0 } };
    }
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
    const { execSync } = await import('child_process');
    const cwd = rootHint ? resolveProjectPath('.', rootHint).abs : AGENT_ROOT;
    const run = (cmd: string) => execSync(cmd, { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    try {
      if (toolId === 'git.status') {
        return { ok: true, data: { output: String(run('git status --short --branch')).slice(0, 10000) } };
      }
      if (toolId === 'git.log') {
        const n = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
        return { ok: true, data: { output: String(run(`git log --oneline -${n}`)).slice(0, 10000) } };
      }
      if (toolId === 'git.diff') {
        const p = input.path ? String(input.path).slice(0, 500).replace(/"/g, '') : '';
        const out = String(run(p ? `git diff -- "${p}"` : 'git diff --stat')).slice(0, 20000);
        return { ok: true, data: { output: out } };
      }
      const message = sanitizeGitMessage(input.message);
      if (!message) return { ok: false, error: 'message requerido para commit' };
      run('git add -A');
      const out = String(run(`git commit -m "${message}"`)).slice(0, 5000);
      return { ok: true, data: { output: out } };
    } catch (e: any) {
      return { ok: false, error: String(e.message || e).slice(0, 2000) };
    }
  }

  if (toolId === 'git.worktree' || toolId === 'git.rebase' || toolId === 'git.conflict') {
    const { execSync } = await import('child_process');
    const cwd = rootHint ? resolveProjectPath('.', rootHint).abs : AGENT_ROOT;
    const run = (cmd: string) => execSync(cmd, { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    try {
      if (toolId === 'git.worktree') {
        const action = String(input.action || '').trim().toLowerCase();
        if (action === 'list') {
          const w = String(execSync('git worktree list --porcelain', { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 }));
          const lines = w.split('\n').filter(l => l.trim());
          const worktrees = lines.map(line => {
            const parts = line.split(' ');
            return { path: parts[0], branch: parts.slice(1).join(' ') || '(HEAD)' };
          });
          return { ok: true, data: { worktrees } };
        }
        if (action === 'add') {
          const newWt = String(input.path || '').trim();
          if (!newWt) return { ok: false, error: 'path requerido para worktree add' };
          // Verificar que la ruta no existe ya
          if (fs.existsSync(path.join(cwd, newWt))) return { ok: false, error: 'Path already exists' };
          run(`git worktree add "${newWt}"`);
          return { ok: true, data: { path: newWt, created: true } };
        }
        if (action === 'remove') {
          const wtPath = String(input.path || '').trim();
          if (!wtPath) return { ok: false, error: 'path requerido para worktree remove' };
          // No permitir remover el worktree activo
          const currentWt = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 });
          if (wtPath.trim() === currentWt) return { ok: false, error: 'No se puede remover el worktree activo' };
          run(`git worktree remove "${wtPath}"`);
          return { ok: true, data: { path: wtPath, removed: true } };
        }
        return { ok: false, error: `action desconocido: ${action}` };
      }

      if (toolId === 'git.rebase') {
        const action = String(input.action || '').trim().toLowerCase();
        if (action === 'start') {
          const branch = String(input.branch || '').trim();
          if (!branch) return { ok: false, error: 'branch requerido para rebase start' };
          // Verificar que la branch existe localmente
          try {
            execSync(`git show-ref --verify -- quiet refs/heads/${branch}`, { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 });
          } catch {
            return { ok: false, error: `Branch '${branch}' no existe localmente` };
          }
          // Hacer checkout a la branch base si no estamos en ella
          if (execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 }) !== branch) {
            run(`git checkout "${branch}"`);
          }
          // Iniciar rebase interactivo sobre main (o la branch por defecto)
          const base = String(input.base || 'main').trim();
          run(`git rebase "${base}"`);
          return { ok: true, data: { started: true, branch, base } };
        }
        if (action === 'continue') {
          run('git rebase --continue');
          return { ok: true, data: { continued: true } };
        }
        if (action === 'abort') {
          run('git rebase --abort');
          return { ok: true, data: { aborted: true } };
        }
        return { ok: false, error: `action desconocido: ${action}` };
      }

      if (toolId === 'git.conflict') {
        const output = String(input?.output || '');
        if (!output) return { ok: false, error: 'Sin output de git diff/merge' };
        // Buscar el primer bloque de conflicto: ^<<<<<<<, ^=======, ^>>>>>>>>
        const re = /^<<<<<<< [^\n]+\n(.+?)\n======+\n(.+?)\n>>>>>>>/ms;
        const m = output.match(re);
        if (!m) return { ok: false, error: 'No hay bloque de conflicto detectable' };
        const ours = m[1].trim();
        const theirs = m[2].trim();
        return {
          ok: true,
          data: {
            conflictId: uid('conflict'),
            ours,
            theirs,
          },
        };
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
    const { goal, instructions, model, allowedTools, mode, maxSteps } = input || {};
    if (!goal || typeof goal !== 'string') return { ok: false, error: 'goal requerido', status: 400 };
    const parentSessionId = input.parentSessionId;
    if (!parentSessionId) return { ok: false, error: 'parentSessionId requerido para task', status: 400 };
    const parent = getSession(parentSessionId);
    if (!parent) return { ok: false, error: `Sesión padre no encontrada: ${parentSessionId}`, status: 404 };
    // Claves del padre (se pasan en la creación de la sesión)
    const keys = input.keys; // opcional: claves específicas para el subagente
    return executeTask(parentSessionId, { goal, instructions, model, allowedTools, mode, maxSteps }, keys);
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
