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
      child = spawn(cfg.command, cfg.args || [], {
        env: { ...process.env, ...(cfg.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
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
        child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
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
