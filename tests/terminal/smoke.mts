// Prueba aislada del WebSocket de terminal (backend).
// Ejecutar: node --import tsx tests/terminal/smoke.mts
import http from 'http';
import { attachTerminalWs } from '../../src/terminal/wsServer.ts';
import WebSocket from 'ws';

const server = http.createServer((_req, res) => res.end('ok'));
attachTerminalWs(server);

server.listen(3999, () => {
  const ws = new WebSocket('ws://localhost:3999/ws/terminal');
  let out = '';
  let done = false;

  const finish = (ok: boolean, msg: string) => {
    if (done) return;
    done = true;
    console.log(JSON.stringify({ ok, msg, outLen: out.length }));
    try { ws.close(); } catch {}
    server.close();
    process.exit(ok ? 0 : 1);
  };

  ws.on('open', () => {
    // Prueba de PERSISTENCIA: define una variable y la lee en otro comando.
    // Si es la misma shell viva, el segundo echo debe imprimir 'hello_persist'.
    ws.send('set MYPERSIST=hello_persist\r\n');
    setTimeout(() => ws.send('echo %MYPERSIST%\r\n'), 400);
  });

  ws.on('message', (data) => {
    out += data.toString();
    if (out.includes('hello_persist')) {
      finish(true, 'variable persiste entre comandos (shell viva)');
    }
  });

  ws.on('error', (e) => finish(false, 'ws error: ' + e.message));

  // Timeout de seguridad.
  setTimeout(() => finish(false, 'timeout esperando eco'), 8000);
});
