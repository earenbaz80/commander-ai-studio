/**
 * Selección del adaptador remoto.
 *
 * Sin credenciales se conserva el fake para que la UI y las pruebas sigan
 * funcionando offline. Con `VERCEL_TOKEN` y `VERCEL_PROJECT_ID` se activa el
 * adaptador real; el token nunca sale del proceso del servidor.
 */
import { FakeDeploymentAdapter } from './fakeAdapter';
import { PublisherRemoteStateStore } from './stateStore';
import { VercelDeploymentAdapter } from './vercelAdapter';
import type { DeploymentAdapter } from './types';

export function isVercelConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    String(env.VERCEL_TOKEN || '').trim() && String(env.VERCEL_PROJECT_ID || '').trim()
  );
}

export function createConfiguredDeploymentAdapter(
  env: NodeJS.ProcessEnv = process.env
): DeploymentAdapter {
  if (!isVercelConfigured(env)) return new FakeDeploymentAdapter();
  return new VercelDeploymentAdapter({
    token: env.VERCEL_TOKEN,
    projectId: env.VERCEL_PROJECT_ID,
    teamId: env.VERCEL_TEAM_ID,
    store: new PublisherRemoteStateStore(),
  });
}
