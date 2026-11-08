/**
 * Conector Linear.
 *
 * Linear soporta Authorization Code + PKCE para clientes públicos, así que el
 * `client_secret` es opcional. El access token dura 24 h y el refresh token
 * rota en cada refresco.
 */
import type {
  ExchangeCodeInput,
  IntegrationAccount,
  OAuthProvider,
  RefreshTokenInput,
  RevokeTokenInput,
  TokenResponse,
} from './types';

export const LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
export const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
export const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke';
export const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';
export const LINEAR_SCOPES = ['read', 'write'];

export function getLinearClientId(): string | null {
  return process.env.LINEAR_CLIENT_ID?.trim() || null;
}

function getLinearClientSecret(): string | null {
  return process.env.LINEAR_CLIENT_SECRET?.trim() || null;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(LINEAR_TOKEN_URL, {
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
    throw new Error(`Linear rechazó OAuth: ${String(detail).slice(0, 300)}`);
  }
  return payload as TokenResponse;
}

export async function exchangeLinearCode(input: ExchangeCodeInput): Promise<TokenResponse> {
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

export async function refreshLinearToken(input: RefreshTokenInput): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  });
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  return postToken(body);
}

async function revokeOneLinearToken(
  token: string,
  tokenTypeHint: 'access_token' | 'refresh_token',
): Promise<void> {
  const response = await fetch(LINEAR_REVOKE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ token, token_type_hint: tokenTypeHint }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  // 400 significa que ya estaba revocado; para el usuario es éxito.
  if (response.ok || response.status === 400) return;
  const payload = await response.json().catch(() => ({} as any));
  const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
  throw new Error(`Linear no pudo revocar el token: ${String(detail).slice(0, 300)}`);
}

/** Linear permite revocar access y refresh por separado; se intentan los dos. */
export async function revokeLinearToken(input: RevokeTokenInput): Promise<void> {
  await revokeOneLinearToken(input.accessToken, 'access_token');
  if (input.refreshToken) {
    await revokeOneLinearToken(input.refreshToken, 'refresh_token');
  }
}

export interface LinearGraphqlResult<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

export async function linearGraphql<T = any>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables: variables || {} }),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = await response.json().catch(() => ({} as LinearGraphqlResult<T>));
  if (!response.ok) {
    throw new Error(`Linear respondió HTTP ${response.status}`);
  }
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    const message = payload.errors.map((e: any) => e?.message).filter(Boolean).join('; ');
    throw new Error(`Linear GraphQL: ${String(message || 'error desconocido').slice(0, 500)}`);
  }
  return payload?.data as T;
}

export async function fetchLinearAccount(accessToken: string): Promise<IntegrationAccount> {
  const data = await linearGraphql<{ viewer?: { id?: string; name?: string; email?: string } }>(
    accessToken,
    'query CommanderViewer { viewer { id name email } }',
  );
  const viewer = data?.viewer;
  if (!viewer?.id) throw new Error('Linear no devolvió el usuario autenticado.');
  return {
    id: String(viewer.id),
    name: String(viewer.name || viewer.email || viewer.id),
    ...(viewer.email ? { email: String(viewer.email) } : {}),
  };
}

export const LINEAR_PROVIDER: OAuthProvider = {
  id: 'linear',
  label: 'Linear',
  authorizeUrl: LINEAR_AUTHORIZE_URL,
  tokenUrl: LINEAR_TOKEN_URL,
  scopes: LINEAR_SCOPES,
  scopeSeparator: ',',
  usesPkce: true,
  clientIdEnv: 'LINEAR_CLIENT_ID',
  clientSecretEnv: 'LINEAR_CLIENT_SECRET',
  requiresClientSecret: false,
  setupUrl: 'https://linear.app/settings/api/applications/new',
  getClientId: getLinearClientId,
  getClientSecret: getLinearClientSecret,
  exchangeCode: exchangeLinearCode,
  refreshToken: refreshLinearToken,
  revokeToken: revokeLinearToken,
  fetchAccount: fetchLinearAccount,
};
