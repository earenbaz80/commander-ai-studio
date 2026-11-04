/**
 * Terminal persistente vía WebSocket (PTY real).
 *
 * Abre una shell REAL por conexión con `node-pty`, así que el proceso ve un
 * terminal de verdad (`isatty` cierto): vim, top, REPLs y TUIs de pantalla
 * completa funcionan, igual que el tamaño de ventana.
 *
 * Protocolo:
 *   • cliente → servidor: input del teclado en crudo (incluye \r, \x03 Ctrl+C…)
 *     o JSON {"type":"resize","cols":n,"rows":m}.
 *   • servidor → cliente: salida cruda del PTY, sin transformar.
 *
 * Seguridad: esto lanza un shell, así que la conexión pasa por dos filtros antes
 * de arrancar nada. `Host` con la misma guardia anti-rebinding que la API, y
 * `Origin` limitado al mismo host o a loopback (una página ajena del navegador
 * no puede abrir esta terminal). Sin `Origin` se acepta: son clientes que no son
 * navegadores (tests, CLI).
 *
 * `node-pty` es un módulo nativo con N-API: el prebuild sirve para Node y para
 * Electron sin recompilar. En el paquete viaja como `extraResources`
 * (`resources/node_modules/node-pty`), porque el server empaquetado se carga
 * desde `resources/server.cjs` y resuelve desde ahí.
 */
import type { IncomingMessage, Server } from 'http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn as spawnPty, type IPty } from 'node-pty';
import { allowedHostsFromEnv, isAllowedHost } from '../../hostGuard.js';
import { killPtyTree } from '../../ptySessions.js';

/** Tope de un mensaje de entrada: pegar un archivo entero no debe reventar la shell. */
const MAX_INPUT_CHARS = 64 * 1024;

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function clampInt(value: unknown, min: number, max: number): number | null {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

/**
 * Shells que el cliente puede pedir con `?shell=`. Es una lista cerrada a
 * propósito: el valor llega por la URL y no puede convertirse en «lanza lo que
 * diga la query». Cualquier otro valor cae al shell por defecto.
 */
const SHELLS_WIN: Record<string, { shell: string; args: string[] }> = {
  cmd: { shell: process.env.COMSPEC || 'cmd.exe', args: [] },
  powershell: { shell: 'powershell.exe', args: ['-NoLogo'] },
  pwsh: { shell: 'pwsh.exe', args: ['-NoLogo'] },
};

const SHELLS_POSIX: Record<string, { shell: string; args: string[] }> = {
  bash: { shell: '/bin/bash', args: ['-i'] },
  sh: { shell: '/bin/sh', args: ['-i'] },
  zsh: { shell: '/bin/zsh', args: ['-i'] },
};

/** Shells seleccionables en el workbench para esta plataforma. */
export function availableShells(): string[] {
  return Object.keys(process.platform === 'win32' ? SHELLS_WIN : SHELLS_POSIX);
}

/** Devuelve el shell y args adecuados según la plataforma y la preferencia. */
function pickShell(preferred?: string | null): { shell: string; args: string[] } {
  const key = String(preferred || '').trim().toLowerCase();
  if (process.platform === 'win32') {
    return (key && SHELLS_WIN[key]) || SHELLS_WIN.cmd;
  }
  if (key && SHELLS_POSIX[key]) return SHELLS_POSIX[key];
  // -i: interactivo (prompts, historial). Fallback al shell del usuario.
  return { shell: process.env.SHELL || '/bin/bash', args: ['-i'] };
}

/**
 * ¿Puede esta conexión abrir una terminal? El `Host` se valida con la misma
 * guardia que la API; el `Origin` tiene que ser el mismo host o loopback.
 */
export function terminalOriginAllowed(req: IncomingMessage): boolean {
  if (!isAllowedHost(req.headers.host, allowedHostsFromEnv())) return false;

  const origin = req.headers.origin;
  if (!origin) return true;

  try {
    const url = new URL(origin);
    if (url.host === String(req.headers.host || '')) return true;
    const name = url.hostname.toLowerCase();
    return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** Adjunta el WebSocket de terminal a un servidor HTTP existente. */
export function attachTerminalWs(server: Server, opts?: { projectPath?: string }): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws/terminal' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // El filtro va antes de crear el proceso: una conexión rechazada no deja
    // una shell viva de propina.
    if (!terminalOriginAllowed(req)) {
      ws.close(1008, 'origen no permitido');
      return;
    }

    const wanted = opts?.projectPath && opts.projectPath.trim() ? opts.projectPath : '';
    const cwd = wanted && isDirectory(wanted) ? wanted : process.cwd();
    // `?shell=` elige entre la lista cerrada; sin él, el shell por defecto.
    let preferido: string | null = null;
    try {
      preferido = new URL(req.url || '/', 'http://localhost').searchParams.get('shell');
    } catch {
      /* URL rara: se usa el shell por defecto */
    }
    const { shell, args } = pickShell(preferido);

    let term: IPty;
    try {
      term = spawnPty(shell, args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' } as { [key: string]: string },
      });
    } catch (err) {
      ws.send(`\r\n[terminal] No se pudo iniciar la shell: ${err instanceof Error ? err.message : String(err)}\r\n`);
      ws.close();
      return;
    }

    // Banner de bienvenida dentro de la propia terminal.
    ws.send(`\x1b[36mCommander AI Studio — terminal PTY (${path.basename(shell)})\x1b[0m\r\n`);

    // PTY → cliente: crudo, xterm.js ya interpreta el ANSI.
    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    term.onExit(({ exitCode }: { exitCode: number }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n\x1b[33m[proceso terminado con código ${exitCode ?? 0}]\x1b[0m\r\n`);
        ws.close();
      }
    });

    // Cliente → PTY.
    ws.on('message', (raw: WebSocket.RawData) => {
      const text = raw.toString();
      if (!text || text.length > MAX_INPUT_CHARS) return;

      // Mensaje de control (resize) en JSON; si no parsea, es input crudo.
      if (text.startsWith('{')) {
        try {
          const parsed = JSON.parse(text) as { type?: unknown; cols?: unknown; rows?: unknown };
          if (parsed?.type === 'resize') {
            const cols = clampInt(parsed.cols, 2, 500);
            const rows = clampInt(parsed.rows, 1, 300);
            if (cols !== null && rows !== null) {
              try {
                term.resize(cols, rows);
              } catch {
                /* tamaño que el PTY no acepta: se ignora, no se corta la sesión */
              }
            }
            return;
          }
        } catch {
          /* no era JSON válido: tratar como input crudo */
        }
      }

      term.write(text);
    });

    // Limpieza al cerrar: se mata el árbol de ConPTY entero y se sueltan los
    // handles (taskkill + kill de node-pty, ver killPtyTree).
    const cerrar = () => {
      killPtyTree(term);
    };
    ws.on('close', cerrar);
    ws.on('error', cerrar);
  });

  return wss;
}

export default attachTerminalWs;
