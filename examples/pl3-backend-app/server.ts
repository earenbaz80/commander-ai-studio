/**
 * Arranque local de la app de ejemplo de PL3.
 *
 *   npx tsx examples/pl3-backend-app/server.ts
 *
 * No es el server de Commander ni un despliegue: sirve para ver la app
 * funcionando contra SQLite con sus migraciones aplicadas de verdad. Los datos
 * caen en `examples/pl3-backend-app/.data` (ignorado por git salvo el código).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExampleApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4300);
const dataDir = path.resolve(process.env.PL3_EXAMPLE_DATA_DIR || path.join(here, '.data'));
const example = createExampleApp({ dataDir });

example.app.listen(port, '127.0.0.1', () => {
  console.log(`[pl3-example] http://127.0.0.1:${port} · datos en ${dataDir}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    example.close();
    process.exit(0);
  });
}
