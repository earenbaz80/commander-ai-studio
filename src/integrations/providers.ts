import type { IntegrationId, OAuthProvider } from './types';
import { GITHUB_PROVIDER } from './github';
import { LINEAR_PROVIDER } from './linear';

export const INTEGRATION_PROVIDERS: Record<IntegrationId, OAuthProvider> = {
  linear: LINEAR_PROVIDER,
  github: GITHUB_PROVIDER,
};

export function getIntegrationProvider(id: string): OAuthProvider | null {
  return INTEGRATION_PROVIDERS[id as IntegrationId] || null;
}

export function listIntegrationProviders(): OAuthProvider[] {
  return Object.values(INTEGRATION_PROVIDERS);
}
