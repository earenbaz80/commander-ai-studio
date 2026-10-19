/**
 * OAuth Providers (P1 #10) - Autenticación con proveedores externos.
 *
 * Soporta: Google, GitHub, GitLab, Microsoft.
 * Usa cookies httpOnly para sesiones seguras.
 */

import type { Request, Response } from 'express';
import crypto from 'crypto';

// Configuración de proveedores OAuth
export interface OAuthProviderConfig {
  name: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string[];
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  userInfoField: string; // campo para obtener el ID único (ej: 'id', 'sub', 'email')
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: {
    name: 'Google',
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`,
    scope: ['openid', 'email', 'profile'],
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    userInfoField: 'sub',
  },
  github: {
    name: 'GitHub',
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    redirectUri: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/github/callback`,
    scope: ['read:user', 'user:email'],
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    userInfoField: 'id',
  },
  gitlab: {
    name: 'GitLab',
    clientId: process.env.GITLAB_CLIENT_ID || '',
    clientSecret: process.env.GITLAB_CLIENT_SECRET || '',
    redirectUri: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/gitlab/callback`,
    scope: ['read_user', 'email'],
    authorizeUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    userInfoUrl: 'https://gitlab.com/api/v4/user',
    userInfoField: 'id',
  },
  microsoft: {
    name: 'Microsoft',
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    redirectUri: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/microsoft/callback`,
    scope: ['openid', 'email', 'profile', 'User.Read'],
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    userInfoField: 'id',
  },
};

// Sesiones en memoria (en producción usar Redis/DB)
const sessions = new Map<string, { userId: string; email: string; name: string; provider: string; expiresAt: number }>();

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function setSessionCookie(res: Response, sessionToken: string): void {
  res.cookie('ai_studio_session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días
    path: '/',
  });
}

/**
 * Inicia el flujo OAuth redirigiendo al proveedor.
 */
export function handleOAuthLogin(req: Request, res: Response) {
  const provider = req.params.provider as string;
  const config = OAUTH_PROVIDERS[provider];

  if (!config || !config.clientId) {
    return res.status(400).json({ success: false, error: `Proveedor ${provider} no configurado` });
  }

  const state = crypto.randomBytes(16).toString('hex');
  // Guardar state en cookie temporal para validar callback
  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000, // 10 min
    path: '/',
  });

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scope.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  const authUrl = `${config.authorizeUrl}?${params.toString()}`;
  return res.redirect(authUrl);
}

/**
 * Callback de OAuth - intercambia código por token y crea sesión.
 */
export async function handleOAuthCallback(req: Request, res: Response) {
  const provider = req.params.provider as string;
  const config = OAUTH_PROVIDERS[provider];

  if (!config) {
    return res.status(400).json({ success: false, error: `Proveedor ${provider} no soportado` });
  }

  const code = req.query.code as string;
  const state = req.query.state as string;
  const storedState = req.cookies?.oauth_state;

  if (!code || !state || state !== storedState) {
    return res.status(400).json({ success: false, error: 'Estado OAuth inválido' });
  }

  // Limpiar state cookie
  res.clearCookie('oauth_state', { path: '/' });

  try {
    // Intercambiar código por access token
    const tokenParams = new URLSearchParams({
      client_id: OAUTH_PROVIDERS[provider].clientId,
      client_secret: OAUTH_PROVIDERS[provider].clientSecret,
      code: code as string,
      redirect_uri: OAUTH_PROVIDERS[provider].redirectUri,
      grant_type: 'authorization_code',
    });

    const tokenRes = await fetch(OAUTH_PROVIDERS[provider].tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: tokenParams.toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      console.error('Error intercambiando código:', err);
      return res.status(400).json({ success: false, error: 'Error obteniendo token' });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Obtener info de usuario
    const userRes = await fetch(OAUTH_PROVIDERS[provider].userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });

    if (!userRes.ok) {
      return res.status(400).json({ success: false, error: 'Error obteniendo info de usuario' });
    }

    const userInfo = await userRes.json();
    const userId = String(userInfo[OAUTH_PROVIDERS[provider].userInfoField] || '');
    const email = userInfo.email || userInfo.email_addresses?.[0]?.email || '';
    const name = userInfo.name || userInfo.login || userInfo.display_name || email;

    if (!userId || !email) {
      return res.status(400).json({ success: false, error: 'Info de usuario incompleta' });
    }

    // Crear sesión
    const sessionToken = generateSessionToken();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 días
    sessions.set(sessionToken, {
      userId,
      email,
      name,
      provider,
      expiresAt,
    });

    setSessionCookie(res, sessionToken);

    // Redirigir al frontend
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/?auth=success`);
  } catch (error: any) {
    console.error('Error en OAuth callback:', error);
    return res.status(500).json({ success: false, error: 'Error en autenticación' });
  }
}

/**
 * Cierra la sesión del usuario.
 */
export function handleLogout(req: Request, res: Response) {
  const sessionToken = req.cookies?.['ai_studio_session'];
  if (sessionToken) sessions.delete(sessionToken);
  res.clearCookie('ai_studio_session', { path: '/' });
  return res.json({ success: true });
}

/**
 * Obtiene usuario actual de la sesión.
 */
export function getCurrentUser(req: Request): { userId: string; email: string; name: string; provider: string } | null {
  const sessionToken = (req.cookies || {})['ai_studio_session'];
  if (!sessionToken) return null;
  const session = sessions.get(sessionToken);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sessionToken);
    return null;
  }
  return { userId: session.userId, email: session.email, name: session.name, provider: session.provider };
}

/**
 * Middleware para requerir autenticación.
 */
export function requireAuth(req: Request, res: Response, next: Function) {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'No autenticado' });
  (req as any).user = user;
  next();
}

export { sessions };