/**
 * Cliente MCP sobre stdio (P3) — conecta con servidores MCP locales por
 * comando (los del registro en `commander.json` → tools.mcp.servers).
 *
 * Protocolo JSON-RPC 2.0 delimitado por saltos de línea sobre stdin/stdout:
 *   1. initialize → 2. notifications/initialized → 3. tools/list | tools/call.
 *
 * Modelo "one-shot" (spawn → handshake → petición → kill): robusto y sin
 * lifecycle que gestionar. Suficiente para servidores MCP sin estado
 * (filesystem, git, fetch, etc.). Para servidores con sesión persistente
 * haría falta mantener el proceso vivo.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { getToolsConfig } from '../config/index.js';

interface JsonRpcMsg {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface StdioMcpResult {
  ok: boolean;
  data?: any;
  error?: string;
}

/**
 * Sustituye `${VAR}` por su valor del entorno (que incluye lo cargado de `.env`).
 *
 * La configuración se versiona, así que la credencial de un servidor MCP no
 * puede vivir en su bloque `env`: se guarda `"GEMINI_API_KEY":
 * "${PIXELFORGE_GEMINI_API_KEY}"` y el valor real queda en `.env`. La
 * indirección hace falta —y no basta con heredar `GEMINI_API_KEY`— cuando la
 * app ya usa ese mismo nombre para su propia credencial: el servidor recibiría
 * la de la app en vez de la suya.
 *
 * Una referencia sin valor se deja tal cual: en el error del servidor se ve qué
 * variable falta, mientras que un valor vacío parecería una clave inválida.
 */
export function expandEnvValue(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => env[name] ?? whole);
}

/**
 * Cita una pieza para `cmd.exe`.
 *
 * Sólo se usa cuando hay que pasar por el shell (`.cmd`/`.bat`): dentro de unas
 * comillas cmd no interpreta `& | < > ^ ( )`, así que basta con entrecomillar
 * lo que tenga espacios o metacaracteres. Las comillas literales se escapan con
 * `\"`, que es lo que esperan los programas de consola de Windows.
 */
export function quoteForCmd(value: string): string {
  if (value === '') return '""';
  if (!/[\s"&|<>^()]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Cómo lanzar el servidor MCP: comando, args y si hace falta shell.
 *
 * En Windows `shell: true` concatena comando y argumentos en una línea de
 * cmd.exe **sin entrecomillar** —node lo avisa con DEP0190—, así que cualquier
 * ruta con espacios se partía: el `index.js` de pixelforge, que vive bajo
 * `C:\Users\<nombre con espacios>\AppData\…`, le llegaba a node como
 * `C:\Users\Edel` y el servidor moría con `Cannot find module` antes de hablar
 * el protocolo. Le pasaba a todo el registro, porque todas sus rutas cuelgan de
 * un directorio de usuario con espacios.
 *
 * La regla es no usar shell cuando se pueda. Un ejecutable se lanza directo y
 * Node entrecomilla por su cuenta cada argumento, espacios incluidos; el shell
 * sólo es obligatorio para `.cmd`/`.bat` —Node se niega a ejecutarlos sin él— y
 * para un nombre suelto, que puede ser un shim de esos en el PATH (`npx`,
 * `rea`). En ese caso se cita a mano porque cmd no lo hace.
 */
export function spawnSpec(
  cfg: { command: string; args?: string[] },
  platform: NodeJS.Platform = process.platform
): { command: string; args: string[]; shell: boolean } {
  const command = String(cfg.command || '').trim();
  const args = [...(cfg.args || [])];
  if (platform !== 'win32') return { command, args, shell: false };

  const isBatch = /\.(cmd|bat)$/i.test(command);
  const isBareName = !/\.[a-z0-9]+$/i.test(command) && !existsSync(command);
  if (!isBatch && !isBareName) return { command, args, shell: false };

  return { command: quoteForCmd(command), args: args.map(quoteForCmd), shell: true };
}

/** Aplica `expandEnvValue` a un bloque `env` completo, sin mutar el original. */
export function resolveServerEnv(
  cfgEnv: Record<string, string> | undefined,
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(cfgEnv || {})) out[name] = expandEnvValue(value, env);
  return out;
}

/**
 * Ejecuta una petición JSON-RPC contra un servidor MCP local por nombre.
 * @param name Nombre del servidor en tools.mcp.servers.
 * @param method 'tools/list' | 'tools/call'.
 * @param params Parámetros del método (para tools/call: {name, arguments}).
 */
export function stdioMcpRequest(
  name: string,
  method: string,
  params?: unknown,
  opts?: { timeoutMs?: number }
): Promise<StdioMcpResult> {
  const cfg = getToolsConfig().mcp?.servers?.[name];
  if (!cfg) {
    return Promise.resolve({ ok: false, error: `Servidor MCP "${name}" no configurado` });
  }

  const timeoutMs = opts?.timeoutMs ?? 20000;

  return new Promise<StdioMcpResult>((resolve) => {
    let settled = false;
    let child: ReturnType<typeof spawn>;
    const timer = setTimeout(() => {
      finish({ ok: false, error: `Timeout (${timeoutMs}ms) esperando a ${name}` });
    }, timeoutMs);

    function finish(r: StdioMcpResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child?.kill('SIGKILL');
      } catch {
        /* ya terminó */
      }
      resolve(r);
    }

    try {
      const spec = spawnSpec(cfg);
      child = spawn(spec.command, spec.args, {
        env: { ...process.env, ...resolveServerEnv(cfg.env) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: spec.shell,
      });
    } catch (e) {
      clearTimeout(timer);
      return resolve({ ok: false, error: `No se pudo iniciar "${name}": ${e instanceof Error ? e.message : String(e)}` });
    }

    let buffer = '';
    let nextId = 1;
    const pending = new Map<number, (msg: JsonRpcMsg) => void>();

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: JsonRpcMsg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        return; // línea no-JSON (logs del servidor): ignorar
      }
      if (typeof msg.id === 'number' && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    };

    child.stdout?.on('data', (d: Buffer) => {
      buffer += d.toString('utf-8');
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    });

    child.stderr?.on('data', () => {
      /* stderr del servidor: logs/debug, no rompe el protocolo */
    });

    child.on('error', (err) => {
      finish({ ok: false, error: `Error de proceso "${name}": ${err.message}` });
    });
    child.on('exit', (code) => {
      // Si salió antes de resolver, es un fallo.
      finish({ ok: false, error: `"${name}" terminó (código ${code ?? 0})` });
    });

    function request(m: string, p?: unknown): Promise<JsonRpcMsg> {
      const id = nextId++;
      return new Promise<JsonRpcMsg>((res) => {
        pending.set(id, res);
        const payload: JsonRpcMsg = { jsonrpc: '2.0', id, method: m, params: p ?? {} };
        try {
          child.stdin?.write(JSON.stringify(payload) + '\n');
        } catch {
          finish({ ok: false, error: 'No se pudo escribir al servidor MCP' });
        }
      });
    }

    (async () => {
      try {
        await request('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'commander-ai-studio', version: '1.0.0' },
        });
        await new Promise((r) => setTimeout(r, 100));
        child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        await new Promise((r) => setTimeout(r, 100));
        const r = await request(method, params ?? {});
        if (r.error) {
          finish({ ok: false, error: JSON.stringify(r.error).slice(0, 1000) });
        } else {
          finish({ ok: true, data: r.result });
        }
      } catch (e) {
        finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });
}

/** Lista las tools que expone un servidor MCP local. */
export function listServerTools(name: string): Promise<StdioMcpResult> {
  return stdioMcpRequest(name, 'tools/list', undefined, { timeoutMs: 15000 });
}

/** Invoca una tool de un servidor MCP local. */
export function callServerTool(name: string, tool: string, args: unknown): Promise<StdioMcpResult> {
  return stdioMcpRequest(name, 'tools/call', { name: tool, arguments: args ?? {} }, { timeoutMs: 30000 });
}
