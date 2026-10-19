/**
 * Terminal persistente vía WebSocket (P3).
 *
 * Abre una shell REAL por conexión (cmd.exe en Windows, bash/sh en Unix)
 * y hace streaming bidireccional en crudo:
 *   • cliente → servidor: input del teclado (incluye \r, \x03 Ctrl+C…)
 *     o JSON {"type":"resize","cols":n,"rows":m}.
 *   • servidor → cliente: salida cruda de stdout/stderr del proceso.
 *
 * A diferencia de la terminal "comando a comando", aquí la shell se mantiene
 * viva: el cwd, variables de entorno y programas interactivos (vim, REPLs…)
 * funcionan entre mensajes.
 *
 * Nota: usa child_process.spawn (sin PTY nativo/node-pty) para evitar
 * compilación nativa. Es un shell persistente real; el control de tamaño de
 * terminal (ANSI window size) es best-effort vía COLUMNS/LINES + `stty`.
 */
import type { Server } from 'http';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

interface ResizeMsg {
  type: 'resize';
  cols: number;
  rows: number;
}

function isResizeMsg(data: unknown): data is ResizeMsg {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as ResizeMsg).type === 'resize'
  );
}

/** Devuelve el shell y args adecuados según la plataforma. */
function pickShell(): { shell: string; args: string[]; useStty: boolean } {
  if (process.platform === 'win32') {
    return { shell: process.env.COMSPEC || 'cmd.exe', args: [], useStty: false };
  }
  const sh = process.env.SHELL || '/bin/bash';
  // -i: interactivo (prompts, historial). Fallback a sh si no existe bash.
  return { shell: sh, args: ['-i'], useStty: true };
}

/** Adjunta el WebSocket de terminal a un servidor HTTP existente. */
export function attachTerminalWs(server: Server, opts?: { projectPath?: string }): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws/terminal' });

  wss.on('connection', (ws: WebSocket) => {
    const cwd = opts?.projectPath && opts.projectPath.trim()
      ? opts.projectPath
      : process.cwd();

    const { shell, args, useStty } = pickShell();
    const cols = 80;
    const rows = 24;

    // COLUMNS/LINES iniciales ayudan a programas que consultan el tamaño.
    const env = {
      ...process.env,
      TERM: process.env.TERM || 'xterm-256color',
      COLUMNS: String(cols),
      LINES: String(rows),
    };

    let child: ChildProcess;
    try {
      child = spawn(shell, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      ws.send(`\r\n[terminal] No se pudo iniciar la shell: ${err instanceof Error ? err.message : String(err)}\r\n`);
      ws.close();
      return;
    }

    // Banner de bienvenida dentro de la propia terminal.
    ws.send(`\x1b[36mCommander AI Studio — terminal persistente (${path.basename(shell)})\x1b[0m\r\n`);

    // stdout/stderr del proceso → cliente.
    child.stdout?.on('data', (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk.toString('utf-8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk.toString('utf-8'));
    });

    child.on('exit', (code) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n\x1b[33m[proceso terminado con código ${code ?? 0}]\x1b[0m\r\n`);
        ws.close();
      }
    });
    child.on('error', (err) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n\x1b[31m[error de shell: ${err.message}]\x1b[0m\r\n`);
      }
    });

    // Cliente → proceso.
    ws.on('message', (raw: WebSocket.RawData) => {
      if (child.killed || child.exitCode !== null) return;
      const text = raw.toString();

      // Mensaje de control (resize) en JSON; si no parsea, es input crudo.
      if (text.startsWith('{')) {
        try {
          const parsed = JSON.parse(text);
          if (isResizeMsg(parsed)) {
            const { cols: c, rows: r } = parsed;
            // Best-effort: informa a la shell interactiva (bash/sh).
            if (useStty && c > 0 && r > 0) {
              child.stdin?.write(`stty cols ${c} rows ${r}\n`);
            }
            return;
          }
        } catch {
          /* no era JSON válido: tratar como input crudo */
        }
      }

      child.stdin?.write(text);
    });

    // Limpieza al cerrar.
    ws.on('close', () => {
      try {
        child.kill();
      } catch {
        /* ya terminó */
      }
    });

    ws.on('error', () => {
      try {
        child.kill();
      } catch {
        /* ignorar */
      }
    });
  });

  return wss;
}

export default attachTerminalWs;
