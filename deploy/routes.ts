/**
 * Rutas HTTP de despliegue.
 *
 * El router no conoce al proveedor: recibe un `DeploymentAdapter` y traduce
 * releases locales a su contrato. El fake y Vercel comparten exactamente el
 * mismo ciclo de preview, promoción, rollback y logs.
 */
import express, { type Response } from 'express';
import { getReleaseForDeploy } from '../publisher';
import type {
  DeploymentAdapter,
  ProjectDescriptor,
  ReleaseDescriptor,
} from './types';

function deployError(res: Response, error: any) {
  return res.status(400).json({ success: false, error: error?.message || 'Despliegue falló' });
}

export function createDeployRouter(
  resolveProjectRoot: (value: unknown) => string,
  adapter: DeploymentAdapter
) {
  const router = express.Router();

  async function projectFor(root: string): Promise<ProjectDescriptor> {
    return adapter.detectProject(root);
  }

  async function releaseFor(root: string, value: unknown): Promise<ReleaseDescriptor> {
    const releaseId = typeof value === 'string' ? value.trim() : undefined;
    const local = await getReleaseForDeploy(root, releaseId);
    if (!local) {
      throw new Error(
        releaseId
          ? 'La release local indicada no existe'
          : 'No hay una release local en preview; crea una primero'
      );
    }
    return {
      id: local.release.id,
      dir: local.dir,
      fileCount: local.release.fileCount,
      bytes: local.release.bytes,
    };
  }

  router.get('/status', async (req, res) => {
    try {
      const root = resolveProjectRoot(req.query.root);
      const project = await projectFor(root);
      return res.json({ success: true, status: await adapter.status(project) });
    } catch (error: any) {
      return deployError(res, error);
    }
  });

  router.get('/preflight', async (req, res) => {
    try {
      const root = resolveProjectRoot(req.query.root);
      const project = await projectFor(root);
      const release = await releaseFor(root, req.query.releaseId);
      const preflight = await adapter.preflight({ project, release });
      return res.json({
        success: true,
        provider: adapter.id,
        releaseId: release.id,
        preflight,
      });
    } catch (error: any) {
      return deployError(res, error);
    }
  });

  router.post('/preview', async (req, res) => {
    try {
      const body = req.body || {};
      const root = resolveProjectRoot(body.root);
      const project = await projectFor(root);
      const release = await releaseFor(root, body.releaseId);
      const deployment = await adapter.deploy({ project, release, environment: 'preview' });
      return res.json({
        success: true,
        deployment,
        provider: adapter.id,
        status: await adapter.status(project),
      });
    } catch (error: any) {
      return deployError(res, error);
    }
  });

  router.post('/production', async (req, res) => {
    try {
      const body = req.body || {};
      const root = resolveProjectRoot(body.root);
      const project = await projectFor(root);
      const current = await adapter.status(project);
      const deploymentId =
        (typeof body.deploymentId === 'string' ? body.deploymentId.trim() : '') ||
        current.preview?.id ||
        '';
      if (!deploymentId) throw new Error('No hay un deployment en preview para promover');
      const deployment = await adapter.promote({
        project,
        deploymentId,
        environment: 'production',
      });
      return res.json({
        success: true,
        deployment,
        provider: adapter.id,
        status: await adapter.status(project),
      });
    } catch (error: any) {
      return deployError(res, error);
    }
  });

  router.post('/rollback', async (req, res) => {
    try {
      const root = resolveProjectRoot(req.body?.root);
      const project = await projectFor(root);
      const deployment = await adapter.rollback(project);
      return res.json({
        success: true,
        deployment,
        provider: adapter.id,
        status: await adapter.status(project),
      });
    } catch (error: any) {
      return deployError(res, error);
    }
  });

  router.get('/logs', async (req, res) => {
    try {
      const root = resolveProjectRoot(req.query.root);
      const deploymentId =
        typeof req.query.deploymentId === 'string' ? req.query.deploymentId.trim() : '';
      if (!deploymentId) throw new Error('Deployment requerido');
      const project = await projectFor(root);
      const status = await adapter.status(project);
      if (!status.deployments.some((deployment) => deployment.id === deploymentId)) {
        throw new Error('Deployment no encontrado en este proyecto');
      }
      return res.json({ success: true, log: await adapter.logs(deploymentId) });
    } catch (error: any) {
      return deployError(res, error);
    }
  });

  return router;
}
