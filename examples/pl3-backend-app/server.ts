/**
 * Arranque local de la app de ejemplo de PL3.
 *
 *   npx tsx examples/pl3-backend-app/server.ts
 *   npx tsx examples/pl3-backend-app/server.ts --env-file <ruta>
 *
 * No es el server de Commander ni un despliegue: sirve para ver la app
 * funcionando contra SQLite con sus migraciones aplicadas de verdad. Los datos
 * caen en `examples/pl3-backend-app/.data` (ignorado por git salvo el código).
 *
 * Con `--env-file <ruta>` o `PL3_RELEASE_ENV=<ruta>` arranca con las
 * credenciales que el publicador dejó en el entorno de la release: las carga en
 * `process.env` y sólo registra sus nombres.
 */
import { startExampleServer } from './startup';

startExampleServer()
  .then((server) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        void server.close().then(() => process.exit(0));
      });
    }
  })
  .catch((error) => {
    console.error('[pl3-example] no arrancó:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
