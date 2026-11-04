import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { attachTerminalWs } from '../src/terminal/wsServer.js';

/**
 * La terminal del workbench: PTY real por WebSocket.
 *
 * Se prueba lo que puede romperse sin abrir un navegador: que un Origin ajeno
 * no consiga shell, que el mismo origen sí, que el comando se ejecute de verdad
 * (prueba de que hay un proceso vivo, no un eco) y que un resize no corte la
 * sesión.
 *
 * Un solo servidor para todo el archivo: crear uno por test y cerrar solo el
 * último dejaba handles abiertos y el runner de node:test no terminaba nunca.
 */

let servidor: http.Server;
let app: WebSocketServer;
let host = '';
const abiertos: WebSocket[] = [];

before(async () => {
  servidor = http.createServer((_req, res) => res.writeHead(404).end());
  app = attachTerminalWs(servidor, { projectPath: process.cwd() });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  host = `127.0.0.1:${(servidor.address() as { port: number }).port}`;
});

after(async () => {
  for (const ws of abiertos) {
    try {
      ws.terminate();
    } catch {
      /* ya cerrado */
    }
  }
  await new Promise<void>((resolve) => app.close(() => resolve()));
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  // El PTY mata su árbol al cerrar el socket; este respiro deja que el hijo
  // termine antes de que el runner revise los handles abiertos.
  await new Promise((resolve) => setTimeout(resolve, 300));
});

function conectar(origin: string): WebSocket {
  const ws = new WebSocket(`ws://${host}/ws/terminal`, { headers: { Origin: origin } });
  abiertos.push(ws);
  return ws;
}

test('un Origin ajeno no abre la terminal', async () => {
  const ws = conectar('http://evil.example');

  const cerrado = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    const listo = (valor: boolean) => {
      clearTimeout(timer);
      resolve(valor);
    };
    ws.on('close', () => listo(true));
    ws.on('error', () => listo(true));
    // Si abriera y mandara banner, esto lo delata.
    ws.on('message', () => listo(false));
  });

  assert.equal(cerrado, true, 'la conexión de otro origen debe cerrarse sin shell');
});

test('el mismo origen ejecuta un comando en el PTY', async () => {
  const ws = conectar(`http://${host}`);

  let salida = '';
  ws.on('message', (data) => {
    salida += data.toString();
  });

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

  // El PTY arranca el shell por defecto de la plataforma: \r ejecuta en ambos.
  ws.send('echo PTY_ECO_123\r');

  // Sondeo acotado: la shell tarda lo que tarde en escribir.
  for (let i = 0; i < 100 && !salida.includes('PTY_ECO_123'); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.match(salida, /PTY_ECO_123/, 'el PTY debe devolver la salida del comando');

  // Un resize válido no debe romper la sesión ni cerrarla.
  ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ws.readyState, WebSocket.OPEN, 'la sesión sigue viva tras el resize');
});

test('no destruye upgrades ajenos (el HMR de Vite sobrevive)', async () => {
  // Este es el fallo que hacía «reiniciarse» la app en desarrollo: con
  // `{ server }`, la librería `ws` cerraba cualquier upgrade que no fuera
  // `/ws/terminal`, incluido el WebSocket del HMR de Vite («Invalid frame
  // header» → «server connection lost. Polling for restart…»). El servidor de la
  // prueba hace de Vite: su propio `upgrade` tiene que seguir funcionando.
  const hmr = new WebSocketServer({ noServer: true });
  const onUpgrade = (req: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    if (new URL(req.url || '/', 'http://localhost').pathname !== '/hmr') return;
    hmr.handleUpgrade(req, socket, head, (ws) => hmr.emit('connection', ws, req));
  };
  servidor.on('upgrade', onUpgrade);
  hmr.on('connection', (socket) => socket.on('message', (data) => socket.send(data)));

  const ws = new WebSocket(`ws://${host}/hmr`);
  abiertos.push(ws);
  try {
    const eco = await new Promise<string>((resolve, reject) => {
      ws.on('open', () => ws.send('ping-hmr'));
      ws.on('message', (data) => resolve(data.toString()));
      ws.on('error', reject);
      ws.on('close', () => reject(new Error('el upgrade ajeno se cerró: la terminal lo destruyó')));
    });
    assert.equal(eco, 'ping-hmr', 'los frames del HMR deben viajar enteros');
  } finally {
    servidor.off('upgrade', onUpgrade);
    hmr.close();
  }
});
