/**
 * Flujo OAuth genérico para conectores nativos.
 *
 * - Authorization Code + PKCE (S256).
 * - `state` de un solo uso, con TTL de 10 minutos.
 * - Los tokens se guardan en `tokenVault` (AES-256-GCM), nunca en la config.
 * - Refresh con un solo vuelo por proveedor para no consumir dos veces un
 *   refresh token rotatorio.
 */
import crypto from 'crypto';
import type { IntegrationId, IntegrationStatus, OAuthToken, TokenResponse } from './types';
import { getIntegrationProvider, listIntegrationProviders } from './providers';
import { deleteToken, getToken, saveToken } from './tokenVault';

const FLOW_TTL_MS = 10 * 60 * 1000;

interface PendingFlow {
  providerId: IntegrationId;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

const pendingFlows = new Map<string, PendingFlow>();
const refreshFlights = new Map<string, Promise<string>>();

export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly code: string = 'integration_error',
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}

export class IntegrationNotConnectedError extends IntegrationError {
  constructor(label: string) {
    super(
      `${label} no está conectado. Abre Ajustes → Extensiones → Integraciones y pulsa Conectar.`,
      401,
      'not_connected',
    );
    this.name = 'IntegrationNotConnectedError';
  }
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function pruneFlows(): void {
  const now = Date.now();
  for (const [state, flow] of pendingFlows) {
    if (now - flow.createdAt > FLOW_TTL_MS) pendingFlows.delete(state);
  }
}

function providerFor(id: string) {
  const provider = getIntegrationProvider(id);
  if (!provider) throw new IntegrationError(`Conector desconocido: ${id}`, 404);
  return provider;
}

function normalizeScope(scope: TokenResponse['scope']): string | undefined {
  if (Array.isArray(scope)) return scope.join(' ');
  if (typeof scope === 'string' && scope.trim()) return scope.trim();
  return undefined;
}

function tokenFromResponse(providerId: IntegrationId, response: TokenResponse, account?: OAuthToken['account']): OAuthToken {
  if (!response?.access_token) {
    throw new IntegrationError(`${providerId} no devolvió un access token.`, 502);
  }
  const expiresIn = Number(response.expires_in);
  const expiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined;
  return {
    accessToken: String(response.access_token),
    ...(response.refresh_token ? { refreshToken: String(response.refresh_token) } : {}),
    tokenType: String(response.token_type || 'Bearer'),
    ...(normalizeScope(response.scope) ? { scope: normalizeScope(response.scope) } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(account ? { account } : {}),
    createdAt: Date.now(),
  };
}

export interface StartedOAuth {
  authorizeUrl: string;
  state: string;
  redirectUri: string;
}

export function startOAuth(providerId: string, redirectBase: string): StartedOAuth {
  const provider = providerFor(providerId);
  const clientId = provider.getClientId();
  if (!clientId) {
    throw new IntegrationError(
      `Falta ${provider.clientIdEnv}. Crea una OAuth app de ${provider.label} y añade su Client ID al .env.`,
      400,
      'not_configured',
    );
  }
  if (provider.requiresClientSecret && !provider.getClientSecret()) {
    throw new IntegrationError(
      `Falta ${provider.clientSecretEnv}. Añade el Client Secret de ${provider.label} al .env.`,
      400,
      'not_configured',
    );
  }

  let base: URL;
  try {
    base = new URL(redirectBase);
  } catch {
    throw new IntegrationError('La URL base para el callback no es válida.', 400);
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new IntegrationError('El callback OAuth sólo puede usar http o https.', 400);
  }

  pruneFlows();
  const state = base64Url(crypto.randomBytes(24));
  const { verifier, challenge } = pkce();
  const redirectUri = `${base.origin}/api/integrations/${provider.id}/callback`;
  pendingFlows.set(state, {
    providerId: provider.id,
    codeVerifier: verifier,
    redirectUri,
    createdAt: Date.now(),
  });

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', provider.scopes.join(provider.scopeSeparator));
  url.searchParams.set('state', state);
  if (provider.usesPkce) {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return { authorizeUrl: url.toString(), state, redirectUri };
}

export async function completeOAuth(providerId: string, code: string, state: string): Promise<IntegrationStatus> {
  const provider = providerFor(providerId);
  const flow = pendingFlows.get(state);
  if (!flow || flow.providerId !== provider.id || Date.now() - flow.createdAt > FLOW_TTL_MS) {
    throw new IntegrationError('State OAuth inválido o expirado. Vuelve a iniciar la conexión.', 400, 'invalid_state');
  }
  pendingFlows.delete(state);

  const clientId = provider.getClientId();
  if (!clientId) {
    throw new IntegrationError(`Falta ${provider.clientIdEnv}.`, 400, 'not_configured');
  }
  const clientSecret = provider.getClientSecret();
  if (provider.requiresClientSecret && !clientSecret) {
    throw new IntegrationError(`Falta ${provider.clientSecretEnv}.`, 400, 'not_configured');
  }

  const response = await provider.exchangeCode({
    code,
    redirectUri: flow.redirectUri,
    codeVerifier: flow.codeVerifier,
    clientId,
    clientSecret,
  });

  let account: OAuthToken['account'];
  try {
    account = await provider.fetchAccount(response.access_token);
  } catch {
    // El token sigue siendo válido aunque no se pueda leer el perfil: no se
    // pierde la conexión por un fallo transitorio de la API.
  }

  saveToken(provider.id, tokenFromResponse(provider.id, response, account));
  return getIntegrationStatus(provider.id);
}

function refreshToken(providerId: IntegrationId, current: OAuthToken): Promise<string> {
  const existing = refreshFlights.get(providerId);
  if (existing) return existing;

  const provider = providerFor(providerId);
  const clientId = provider.getClientId();
  if (!clientId) {
    throw new IntegrationError(`Falta ${provider.clientIdEnv}.`, 400, 'not_configured');
  }
  const clientSecret = provider.getClientSecret();
  if (provider.requiresClientSecret && !clientSecret) {
    throw new IntegrationError(`Falta ${provider.clientSecretEnv}.`, 400, 'not_configured');
  }
  if (!current.refreshToken) {
    throw new IntegrationError(
      `${provider.label} necesita volver a conectarse: el token expiró y no hay refresh token.`,
      401,
      'reauth_required',
    );
  }

  const flight = (async () => {
    const response = await provider.refreshToken({
      refreshToken: current.refreshToken!,
      clientId,
      clientSecret,
    });
    const next = tokenFromResponse(provider.id, response, current.account);
    // Algunos proveedores rotan el refresh token y otros lo omiten en el
    // refresh: no se pierde el anterior si la respuesta no trae uno nuevo.
    if (!next.refreshToken) next.refreshToken = current.refreshToken;
    saveToken(provider.id, next);
    return next.accessToken;
  })().finally(() => {
    refreshFlights.delete(providerId);
  });

  refreshFlights.set(providerId, flight);
  return flight;
}

/** Devuelve un access token válido, refrescándolo si está por expirar. */
export async function getAccessToken(providerId: string): Promise<string> {
  const provider = providerFor(providerId);
  const current = getToken(provider.id);
  if (!current) throw new IntegrationNotConnectedError(provider.label);
  if (!current.expiresAt || current.expiresAt - Date.now() > 60_000) return current.accessToken;
  return refreshToken(provider.id, current);
}

export function getIntegrationStatus(providerId: string): IntegrationStatus {
  const provider = providerFor(providerId);
  const token = getToken(provider.id);
  const clientId = provider.getClientId();
  const clientSecret = provider.getClientSecret();
  const missingConfig = !clientId
    ? provider.clientIdEnv
    : provider.requiresClientSecret && !clientSecret
      ? provider.clientSecretEnv
      : undefined;
  return {
    id: provider.id,
    label: provider.label,
    configured: !missingConfig,
    connected: Boolean(token),
    ...(token?.account ? { account: token.account } : {}),
    ...(token?.expiresAt ? { expiresAt: token.expiresAt } : {}),
    scopes: token?.scope ? token.scope.split(/[\s,]+/).filter(Boolean) : provider.scopes,
    ...(missingConfig ? { missingConfig } : {}),
    clientIdEnv: provider.clientIdEnv,
    clientSecretEnv: provider.clientSecretEnv,
    requiresClientSecret: provider.requiresClientSecret,
    setupUrl: provider.setupUrl,
  };
}

export function listIntegrationStatuses(): IntegrationStatus[] {
  return listIntegrationProviders().map((provider) => getIntegrationStatus(provider.id));
}

export interface DisconnectResult {
  status: IntegrationStatus;
  revoked: boolean;
  warning?: string;
}

/**
 * Borra el token local siempre. Antes intenta revocarlo en el proveedor; si
 * esa llamada falla, el token local igualmente desaparece y se devuelve un
 * warning para que la UI no afirme una revocación que no ocurrió.
 */
export async function disconnectIntegration(providerId: string): Promise<DisconnectResult> {
  const provider = providerFor(providerId);
  const current = getToken(provider.id);
  let revoked = false;
  let warning: string | undefined;

  if (current) {
    try {
      const clientId = provider.getClientId();
      if (!clientId) throw new Error(`Falta ${provider.clientIdEnv}.`);
      const clientSecret = provider.getClientSecret();
      if (provider.requiresClientSecret && !clientSecret) {
        throw new Error(`Falta ${provider.clientSecretEnv}.`);
      }
      await provider.revokeToken({
        accessToken: current.accessToken,
        ...(current.refreshToken ? { refreshToken: current.refreshToken } : {}),
        clientId,
        clientSecret,
      });
      revoked = true;
    } catch (error: any) {
      warning = error instanceof Error ? error.message : 'El proveedor no confirmó la revocación.';
    } finally {
      deleteToken(provider.id);
    }
  }

  return {
    status: getIntegrationStatus(provider.id),
    revoked,
    ...(warning ? { warning } : {}),
  };
}
