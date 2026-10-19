/**
 * MCP OAuth (P2) - Authorization Code flow con PKCE para servidores MCP remotos.
 *
 * Sigue el mismo patrón que `oauth.ts` (crypto + estado temporal), pero:
 *   • Los tokens se almacenan POR SERVIDOR MCP (no por usuario de la app).
 *   • Usa PKCE (S256) para clientes públicos (sin client_secret).
 *   • Refresca automáticamente el access_token cuando expira.
 *
 * Nota: el store de tokens es en memoria (como las sesiones de oauth.ts).
 * En producción debería persistirse cifrado o en un secreto del sistema.
 */
import crypto from 'crypto';
import { getToolsConfig } from '../config/index.js';

// ==================== Tipos ====================

export interface McpAuthConfig {
  type: 'oauth2' | 'bearer';
  clientId: string;
  clientSecret?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  bearerToken?: string;
}

interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
  tokenType: string;
  scope?: string;
}

// Flujo en vuelo: guarda code_verifier + server para validar el callback.
interface PendingFlow {
  serverName: string;
  codeVerifier: string;
  createdAt: number;
}

// ==================== Estado ====================

const tokenStore = new Map<string, StoredToken>();
const pendingFlows = new Map<string, PendingFlow>(); // key: state

const FLOW_TTL_MS = 10 * 60 * 1000; // 10 min

// ==================== Helpers ====================

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Genera el par PKCE (verifier + challenge S256). */
function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function getCallbackBase(): string {
  return process.env.BASE_URL || process.env.PUBLIC_URL || 'http://localhost:3000';
}

/** Recupera la config de auth de un servidor MCP desde commander.json. */
export function getMcpAuthConfig(serverName: string): McpAuthConfig | null {
  const auth = getToolsConfig().mcp?.servers?.[serverName]?.auth;
  return auth ?? null;
}

/** Limpia flows expirados. */
function pruneFlows(): void {
  const now = Date.now();
  for (const [state, flow] of pendingFlows) {
    if (now - flow.createdAt > FLOW_TTL_MS) pendingFlows.delete(state);
  }
}

// ==================== API ====================

/**
 * Inicia el flujo OAuth para un servidor MCP.
 * Devuelve la authorizeUrl a la que debe navegar el cliente y el state.
 */
export function startMcpOAuth(serverName: string): { authorizeUrl: string; state: string } {
  const authCfg = getMcpAuthConfig(serverName);
  if (!authCfg || authCfg.type !== 'oauth2') {
    throw new Error(`Servidor "${serverName}" no tiene auth OAuth2 configurado`);
  }
  if (!authCfg.authorizeUrl || !authCfg.tokenUrl) {
    throw new Error(`Servidor "${serverName}" requiere authorizeUrl y tokenUrl`);
  }

  pruneFlows();
  const state = base64UrlEncode(crypto.randomBytes(16));
  const { verifier, challenge } = generatePkce();
  const redirectUri = `${getCallbackBase()}/api/mcp/${encodeURIComponent(serverName)}/auth/callback`;

  pendingFlows.set(state, { serverName, codeVerifier: verifier, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: authCfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  if (authCfg.scopes?.length) params.set('scope', authCfg.scopes.join(' '));

  return { authorizeUrl: `${authCfg.authorizeUrl}?${params.toString()}`, state };
}

/**
 * Procesa el callback: valida state, intercambia code+verifier por token
 * y lo almacena para el servidor.
 */
export async function handleMcpOAuthCallback(
  serverName: string,
  code: string,
  state: string
): Promise<void> {
  const flow = pendingFlows.get(state);
  if (!flow || flow.serverName !== serverName) {
    throw new Error('State OAuth inválido o expirado');
  }
  pendingFlows.delete(state);

  const authCfg = getMcpAuthConfig(serverName);
  if (!authCfg || !authCfg.tokenUrl) {
    throw new Error(`Servidor "${serverName}" sin tokenUrl`);
  }

  const redirectUri = `${getCallbackBase()}/api/mcp/${encodeURIComponent(serverName)}/auth/callback`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: authCfg.clientId,
    code_verifier: flow.codeVerifier,
  });
  // Cliente confidencial: incluye secret. Público (PKCE): se omite.
  if (authCfg.clientSecret) body.set('client_secret', authCfg.clientSecret);

  const tokenRes = await fetch(authCfg.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error(`Error obteniendo token: ${err?.error_description || err?.error || tokenRes.status}`);
  }

  const data = await tokenRes.json();
  storeToken(serverName, data);
}

/** Guarda/actualiza el token de un servidor. */
function storeToken(serverName: string, data: any): void {
  const expiresIn = Number(data.expires_in ?? 3600);
  tokenStore.set(serverName, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
    tokenType: data.token_type || 'Bearer',
    scope: data.scope,
  });
}

/** Refresca el access_token usando el refresh_token. */
async function refreshToken(serverName: string, authCfg: McpAuthConfig): Promise<void> {
  const current = tokenStore.get(serverName);
  if (!current?.refreshToken || !authCfg.tokenUrl) {
    throw new Error('No hay refresh_token disponible; requiere re-autenticación');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
    client_id: authCfg.clientId,
  });
  if (authCfg.clientSecret) body.set('client_secret', authCfg.clientSecret);

  const res = await fetch(authCfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });

  if (!res.ok) {
    tokenStore.delete(serverName);
    throw new Error('Refresh falló; requiere re-autenticación');
  }
  storeToken(serverName, await res.json());
}

/**
 * Devuelve un access token válido para el servidor (refresca si está por expirar).
 * Para type=bearer devuelve el token estático de la config.
 */
export async function getMcpAccessToken(serverName: string): Promise<string | null> {
  const authCfg = getMcpAuthConfig(serverName);
  if (!authCfg) return null;

  if (authCfg.type === 'bearer') {
    return authCfg.bearerToken || null;
  }

  const token = tokenStore.get(serverName);
  if (!token) return null;

  // Refresca si expira en menos de 60s.
  if (token.expiresAt - Date.now() < 60_000) {
    try {
      await refreshToken(serverName, authCfg);
    } catch {
      return null;
    }
    const refreshed = tokenStore.get(serverName);
    return refreshed ? refreshed.accessToken : null;
  }
  return token.accessToken;
}

/** Estado de autenticación de un servidor (para la UI). */
export function getMcpAuthStatus(serverName: string): {
  authenticated: boolean;
  expiresAt: number | null;
  canRefresh: boolean;
  type: string | null;
} {
  const authCfg = getMcpAuthConfig(serverName);
  if (!authCfg) {
    return { authenticated: false, expiresAt: null, canRefresh: false, type: null };
  }
  if (authCfg.type === 'bearer') {
    return {
      authenticated: !!authCfg.bearerToken,
      expiresAt: null,
      canRefresh: false,
      type: 'bearer',
    };
  }
  const token = tokenStore.get(serverName);
  return {
    authenticated: !!token && token.expiresAt > Date.now(),
    expiresAt: token?.expiresAt ?? null,
    canRefresh: !!token?.refreshToken,
    type: 'oauth2',
  };
}

/** Cierra sesión del servidor: borra token almacenado. */
export function logoutMcp(serverName: string): void {
  tokenStore.delete(serverName);
}

/** Expone el store (para tests/debug). */
export const mcpTokenStore = tokenStore;
