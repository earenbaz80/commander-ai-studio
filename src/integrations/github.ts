/**
 * Conector GitHub.
 *
 * OAuth App con Authorization Code + PKCE (S256). GitHub exige client_secret
 * para canjear el código, aunque la app use PKCE. El token puede no expirar:
 * si GitHub no manda `expires_in`, el vault lo guarda sin fecha y no se
 * intenta refrescar.
 */
import type {
  ExchangeCodeInput,
  IntegrationAccount,
  OAuthProvider,
  RefreshTokenInput,
  RevokeTokenInput,
  TokenResponse,
} from './types';

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_API_URL = 'https://api.github.com';
export const GITHUB_SCOPES = ['repo', 'read:user'];

export function getGitHubClientId(): string | null {
  return process.env.GITHUB_CLIENT_ID?.trim() || null;
}

function getGitHubClientSecret(): string | null {
  return process.env.GITHUB_CLIENT_SECRET?.trim() || null;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok || !payload?.access_token) {
    const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new Error(`GitHub rechazó OAuth: ${String(detail).slice(0, 300)}`);
  }
  return payload as TokenResponse;
}

export async function exchangeGitHubCode(input: ExchangeCodeInput): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  });
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  return postToken(body);
}

export async function refreshGitHubToken(input: RefreshTokenInput): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  });
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  return postToken(body);
}

export async function fetchGitHubAccount(accessToken: string): Promise<IntegrationAccount> {
  const response = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'Commander-AI-Studio',
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok || !payload?.id) {
    throw new Error(`GitHub no devolvió el usuario autenticado (HTTP ${response.status}).`);
  }
  return {
    id: String(payload.id),
    name: String(payload.name || payload.login || payload.id),
    ...(payload.email ? { email: String(payload.email) } : {}),
  };
}

/** Revoca el token de una OAuth App. GitHub exige Basic auth con client_id/secret. */
export async function revokeGitHubToken(input: RevokeTokenInput): Promise<void> {
  if (!input.clientSecret) {
    throw new Error('Falta GITHUB_CLIENT_SECRET para revocar el token de GitHub.');
  }
  const credentials = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64');
  const response = await fetch(
    `${GITHUB_API_URL}/applications/${encodeURIComponent(input.clientId)}/token`,
    {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Commander-AI-Studio',
      },
      body: JSON.stringify({ access_token: input.accessToken }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (response.ok || response.status === 404) return;
  const payload = await response.json().catch(() => ({} as any));
  const detail = payload?.message || `HTTP ${response.status}`;
  throw new Error(`GitHub no pudo revocar el token: ${String(detail).slice(0, 300)}`);
}

export const GITHUB_PROVIDER: OAuthProvider = {
  id: 'github',
  label: 'GitHub',
  authorizeUrl: GITHUB_AUTHORIZE_URL,
  tokenUrl: GITHUB_TOKEN_URL,
  scopes: GITHUB_SCOPES,
  scopeSeparator: ' ',
  usesPkce: true,
  clientIdEnv: 'GITHUB_CLIENT_ID',
  clientSecretEnv: 'GITHUB_CLIENT_SECRET',
  requiresClientSecret: true,
  setupUrl: 'https://github.com/settings/developers',
  getClientId: getGitHubClientId,
  getClientSecret: getGitHubClientSecret,
  exchangeCode: exchangeGitHubCode,
  refreshToken: refreshGitHubToken,
  revokeToken: revokeGitHubToken,
  fetchAccount: fetchGitHubAccount,
};
