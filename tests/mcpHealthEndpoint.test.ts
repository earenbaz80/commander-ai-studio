/**
 * `/api/mcp/health` de punta a punta: la ruta lee la config, ejecuta el comando
 * de cada servidor MCP y devuelve su stdout. `mcpHealthOutput` ya tiene su test
 * unitario; esto cubre el cableado (config -> spawn -> JSON), que es donde un
 * cambio podía volver a devolver el stdout crudo.
 *
 * No usa el server compartido de `startServer()`: ése busca `commander.json`
 * desde el cwd del repo, que trae los servidores MCP reales del operador
 * (`npx`, un python de su máquina...) y el health los ejecutaría todos. Un
 * server del arnés con su config en un temporal es la única forma de que la
 * ruta ejecute sólo los servidores falsos de este archivo.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnServer, type ServerHarness } from './helpers/serverHarness.js';

/** Secreto del entorno del server: `redactSecrets` lo reconoce por el nombre. */
const SECRET = 'secreto-de-arranque-9f3c1a2b';
/** Token con formato conocido, que se imprime sin estar en el entorno. */
const TOKEN = 'sbp_ABCDEFGH12345678';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-mcp-health-'));
const project = path.join(dir, 'proyecto');
const fakeScript = path.join(dir, 'fake-mcp.mjs');
const cutScript = path.join(dir, 'fake-mcp-corte.mjs');
let srv: ServerHarness | null = null;

fs.mkdirSync(project, { recursive: true });

// Lo que hace un MCP real al arrancar: contar algo útil y volcar su config.
fs.writeFileSync(
  fakeScript,
  [
    "process.stdout.write('fake-mcp listo');",
    "process.stdout.write(`\\n${process.env.MCP_HEALTH_SECRET}\\n" +
      "${'sbp_ABCDEFGH12345678'}\\npuerto 3000`);",
  ].join('\n'),
  'utf8'
);

// El secreto empieza en el carácter 190: si la ruta recortara antes de sanear,
// sus primeros diez caracteres viajarían en la respuesta.
fs.writeFileSync(
  cutScript,
  [
    "const relleno = 'a'.repeat(190);",
    "process.stdout.write(relleno + process.env.MCP_HEALTH_SECRET + 'cola');",
  ].join('\n'),
  'utf8'
);

fs.writeFileSync(
  path.join(project, 'commander.json'),
  JSON.stringify({
    tools: {
      mcp: {
        enabled: true,
        servers: {
          fake: { command: process.execPath, args: [fakeScript] },
          corte: { command: process.execPath, args: [cutScript] },
          // `spawnSync` no llega a lanzarlo: valida los args y lanza un error
          // que repite el valor, que es justo lo que no debe salir.
          roto: { command: process.execPath, args: [`--token=${SECRET}\u0000`] },
        },
      },
    },
  }),
  'utf8'
);

after(async () => {
  await srv?.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('/api/mcp/health devuelve el arranque del MCP redactado y acotado', async () => {
  srv = await spawnServer({ cwd: project, env: { MCP_HEALTH_SECRET: SECRET } });

  const res = await srv.request('GET', '/api/mcp/health');

  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.status, 'ready');
  assert.equal(res.body.total, 3);
  assert.equal(res.body.summary.healthy, 2);
  assert.equal(res.body.summary.unknown, 1);

  const [fake, corte, roto] = res.body.servers;
  assert.equal(fake.name, 'fake');
  assert.equal(typeof fake.output, 'string');
  assert.match(fake.output, /fake-mcp listo/);
  assert.match(fake.output, /puerto 3000/);
  assert.match(fake.output, /\[redactado\]/);
  assert.ok(fake.output.length <= 200);

  assert.equal(corte.name, 'corte');
  assert.equal(corte.output.length, 200);
  assert.ok(corte.output.startsWith('a'.repeat(190)));
  assert.ok(!corte.output.includes(SECRET.slice(0, 10)));

  assert.equal(roto.status, 'unknown');
  assert.match(roto.error, /must be a string without null bytes/);
  assert.ok(!roto.error.includes(SECRET));

  assert.ok(!res.raw.includes(SECRET), 'el secreto no debe viajar en la respuesta');
  assert.ok(!res.raw.includes(TOKEN), 'el token no debe viajar en la respuesta');
});
