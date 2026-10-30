/**
 * Runner de la suite node con UN servidor para todos los archivos.
 *
 * `node --test` abre cada archivo en su propio proceso, así que cada uno
 * pagaría su arranque (~9 s con tsx, medido). Este padre escucha un canal de
 * control y compila el server **sólo cuando un archivo lo pide** con
 * `startServer()`: una corrida de un test que no toca HTTP no paga nada. Al
 * terminar la suite, para el server (si hubo) y borra su base temporal.
 *
 * Uso: `npm run test:node` (los argumentos extra se pasan al runner, p. ej.
 * `npm run test:node -- tests/persistence.test.ts`).
 */
import { spawn } from 'node:child_process';
import { createServerBroker, SHARED_CONTROL_ENV } from '../tests/helpers/serverHarness.js';

const patterns = process.argv.slice(2);
const files = patterns.length > 0 ? patterns : ['tests/*.test.ts'];

const broker = await createServerBroker((srv) => {
  console.log(`[test:node] server compartido en ${srv.baseUrl} (base: ${srv.dbPath})`);
});

const runner = spawn(process.execPath, ['--import', 'tsx', '--test', ...files], {
  stdio: 'inherit',
  env: { ...process.env, [SHARED_CONTROL_ENV]: broker.address },
});

/** Cierra también con Ctrl+C: sin esto el server quedaría escuchando. */
let closing = false;
const shutdown = async (code: number) => {
  if (closing) return;
  closing = true;
  try { runner.kill('SIGTERM'); } catch { /* ya terminó */ }
  await broker.stop();
  process.exit(code);
};
process.on('SIGINT', () => void shutdown(130));
process.on('SIGTERM', () => void shutdown(143));

const code = await new Promise<number>((resolve) => {
  runner.once('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
});

// Si algo falló, el log del server compartido es la única pista de si murió.
if (code !== 0) console.error(`\n[test:node] log del server compartido:\n${broker.logs()}\n`);

await broker.stop();

// Sin peticiones no hay server: decirlo evita que alguien lo busque en los logs.
if (broker.requests() === 0) {
  console.log('[test:node] ningún archivo usó HTTP: no se arrancó el server');
}

process.exit(code);
