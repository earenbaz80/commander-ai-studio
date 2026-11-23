/**
 * Rutas HTTP del backend gestionado (PL3).
 *
 * El router no conoce al proveedor: recibe un `BackendAdapter` o `null`. Con
 * `null` responde «deshabilitado» y no inventa un backend; con un adaptador,
 * traduce `provision` y `status` sin tocar credenciales —los valores de los
 * secretos no viajan por estas rutas, sólo nombres.
 *
 * Se monta bajo `/api/backend/manage` porque `/api/backend` completo pertenece
 * al backend multiinquilino de las apps (`backend/routes.ts`), que tiene su
 * propio catch-all.
 */
import express, { type Request, type Response } from 'express';
import type { BackendAdapter, BackendBindingKind } from './types';

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

export function createBackendRouter(adapter: BackendAdapter | null) {
  const router = express.Router();

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
    if (!adapter) {
      return res.status(503).json({
        success: false,
        error:
          'El backend gestionado no está habilitado; todavía no hay proveedor elegido (G3). ' +
          'Para probar el contrato, define COMMANDER_BACKEND_FAKE=1.',
      });
    }
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

  router.use((_req: Request, res: Response) =>
    res.status(404).json({ success: false, error: 'Ruta de backend gestionado no encontrada' })
  );

  return router;
}
