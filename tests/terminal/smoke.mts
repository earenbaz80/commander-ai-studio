// Prueba aislada del WebSocket de terminal (backend).
// Ejecutar: node --import tsx tests/terminal/smoke.mts
import http from 'http';
import { attachTerminalWs } from '../../src/terminal/wsServer.ts';
import WebSocket from 'ws';

const server = http.createServer((_req, res) => res.end('ok'));
attachTerminalWs(server);

// Puerto efímero: el 3999 fijo chocaba con un dev server o con otra corrida del
// smoke, y el fallo se veía como "ws error: ECONNREFUSED" sin decir por qué.
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  console.log(`[terminal-smoke] ws://127.0.0.1:${port}/ws/terminal`);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal`);
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
