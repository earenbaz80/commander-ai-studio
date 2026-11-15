#!/usr/bin/env node
/**
 * Preview local para T6 del dogfooding G1.
 *
 *   npm run g1:preview                                  # sirve d3-t6-01 en el 3411
 *   npm run g1:preview -- --dir tests/tmp-g1/d3-t6-02 --port 3412
 *
 * Sirve `index.html` del directorio indicado y responde `/api/health`, que es
 * la petición que la propia página hace para dejar una entrada de red. Es el
 * mismo HTML que usa `evals/scenarios.ts` en F0 (sale de `evals/g1Fixtures.ts`),
 * así que la corrida mide lo mismo aunque el servidor lo levante a mano.
 *
 * No arranca navegador ni sesión de agente: eso lo hace la corrida del CLI.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
const valueOf = (name: string, fallback: string): string => {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : fallback;
};

const dir = path.resolve(process.cwd(), valueOf('--dir', 'tests/tmp-g1/d3-t6-01'));
const port = Number(valueOf('--port', '3411'));
const indexFile = path.join(dir, 'index.html');

if (!fs.existsSync(indexFile)) {
  console.error(`[g1-preview] no existe ${indexFile}. Siembra primero: npm run g1:seed -- --day 3`);
  process.exit(1);
}
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`[g1-preview] puerto inválido: ${valueOf('--port', '3411')}`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.url?.split('?')[0] === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(indexFile));
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`[g1-preview] no se pudo escuchar en el ${port}: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[g1-preview] ${dir} en http://127.0.0.1:${port}/`);
});
