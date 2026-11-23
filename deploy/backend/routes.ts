/**
 * Rutas HTTP del backend gestionado (PL3).
 *
 * El router no conoce al proveedor: recibe un `BackendAdapter` o `null`. Con
 * `null` responde «deshabilitado» y no inventa un backend; con un adaptador,
 * traduce `provision`, `migrate`, `status` y `rotate` sin tocar credenciales
 * —los valores de los secretos no viajan por estas rutas, sólo nombres. Los
 * valores que emite la rotación van al `sink` del router (por defecto, la
 * memoria que leerá el despliegue), nunca al cuerpo de la respuesta.
 *
 * Se monta bajo `/api/backend/manage` porque `/api/backend` completo pertenece
 * al backend multiinquilino de las apps (`backend/routes.ts`), que tiene su
 * propio catch-all.
 */
import express, { type Request, type Response } from 'express';
import { createPendingDeploymentSink } from './secretSink';
import { isBackendBindingKind } from './types';
import type {
  BackendAdapter,
  BackendBindingKind,
  BackendMigration,
  BackendSecretSink,
} from './types';

export interface BackendRouterOptions {
  /**
   * Destino de los valores rotados: el entorno de la app publicada, nunca la
   * respuesta HTTP. Por defecto van a `createPendingDeploymentSink`, que los
   * guarda en memoria hasta que G3 conecte el despliegue.
   */
  createSink?: (projectId: string) => BackendSecretSink;
}

function backendError(res: Response, error: any) {
  return res.status(400).json({ success: false, error: error?.message || 'Backend falló' });
}

function notConfigured(res: Response) {
  return res.json({
    success: true,
    provider: 'none',
    configured: false,
    enabled: false,
    status: null,
    missingConfig: ['COMMANDER_BACKEND_FAKE'],
  });
}

/** 503 común de las rutas que necesitan un adaptador (`status` no lo es). */
function notEnabled(res: Response) {
  return res.status(503).json({
    success: false,
    error:
      'El backend gestionado no está habilitado; todavía no hay proveedor elegido (G3). ' +
      'Para probar el contrato, define COMMANDER_BACKEND_FAKE=1.',
  });
}

function readMigrations(value: unknown): BackendMigration[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Hay que enviar al menos una migración');
  }
  return value.map((migration: any, index: number) => {
    const id = typeof migration?.id === 'string' ? migration.id.trim() : '';
    if (!id) throw new Error(`La migración ${index + 1} no tiene id`);
    if (typeof migration?.sql !== 'string' || !migration.sql.trim()) {
      throw new Error(`La migración ${id} no tiene SQL`);
    }
    return { id, sql: migration.sql };
  });
}

function readKinds(value: unknown): BackendBindingKind[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error('`kinds` debe ser una lista de bindings');
  return value.map((kind) => {
    if (!isBackendBindingKind(kind)) throw new Error(`Binding desconocido: ${String(kind)}`);
    return kind;
  });
}

export function createBackendRouter(
  adapter: BackendAdapter | null,
  options: BackendRouterOptions = {}
) {
  const router = express.Router();
  const createSink = options.createSink ?? createPendingDeploymentSink;

  router.get('/status', async (req: Request, res: Response) => {
    if (!adapter) return notConfigured(res);
    try {
      const projectId = String(req.query.projectId ?? '').trim();
      return res.json({
        success: true,
        provider: adapter.id,
        configured: adapter.configured,
        enabled: true,
        status: await adapter.status(projectId),
      });
    } catch (error: any) {
      return backendError(res, error);
    }
  });

  router.post('/provision', async (req: Request, res: Response) => {
    if (!adapter) return notEnabled(res);
    try {
      const body = req.body || {};
      const bindings = Array.isArray(body.bindings)
        ? (body.bindings as BackendBindingKind[])
        : [];
      const status = await adapter.provision({
        projectId: String(body.projectId ?? ''),
        bindings,
      });
      return res.json({ success: true, provider: adapter.id, status });
    } catch (error: any) {
      return backendError(res, error);
    }
  });

  router.post('/migrate', async (req: Request, res: Response) => {
    if (!adapter) return notEnabled(res);
    try {
      const body = req.body || {};
      const result = await adapter.migrate({
        projectId: String(body.projectId ?? ''),
        migrations: readMigrations(body.migrations),
      });
      return res.json({ success: true, provider: adapter.id, result });
    } catch (error: any) {
      return backendError(res, error);
    }
  });

  router.post('/rotate', async (req: Request, res: Response) => {
    if (!adapter) return notEnabled(res);
    try {
      const body = req.body || {};
      const projectId = String(body.projectId ?? '').trim();
      const rotation = await adapter.rotateSecrets({
        projectId,
        kinds: readKinds(body.kinds),
        // El valor sale una sola vez, hacia el sink; la respuesta sólo lleva
        // los nombres rotados.
        sink: createSink(projectId),
      });
      return res.json({ success: true, provider: adapter.id, rotation });
    } catch (error: any) {
      return backendError(res, error);
    }
  });

  router.use((_req: Request, res: Response) =>
    res.status(404).json({ success: false, error: 'Ruta de backend gestionado no encontrada' })
  );

  return router;
}
