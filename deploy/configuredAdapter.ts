/**
 * Selección del adaptador remoto.
 *
 * El único backend de producción es Vercel. Sin `VERCEL_TOKEN` o
 * `VERCEL_PROJECT_ID` el adaptador queda `configured: false`: la UI explica
 * qué falta y desactiva el deploy. No hay fallback fake silencioso.
 * El token nunca sale del proceso del servidor.
 */
import { PublisherRemoteStateStore } from './stateStore';
import { VercelDeploymentAdapter } from './vercelAdapter';
import type { DeploymentAdapter } from './types';

export function createConfiguredDeploymentAdapter(
  env: NodeJS.ProcessEnv = process.env
): DeploymentAdapter {
  return new VercelDeploymentAdapter({
    token: env.VERCEL_TOKEN,
    projectId: env.VERCEL_PROJECT_ID,
    teamId: env.VERCEL_TEAM_ID,
    store: new PublisherRemoteStateStore(),
  });
}
