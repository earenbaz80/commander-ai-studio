import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { deleteToken, getToken, saveToken } from '../../src/integrations/tokenVault';
import {
  completeOAuth,
  disconnectIntegration,
  getAccessToken,
  getIntegrationStatus,
  startOAuth,
} from '../../src/integrations/oauth';
import { executeLinearAction } from '../../src/integrations/linearActions';
import { LINEAR_TOKEN_URL } from '../../src/integrations/linear';
import type { OAuthToken } from '../../src/integrations/types';

let vaultDir: string;
let previousDir: string | undefined;
let previousKey: string | undefined;
let previousClientId: string | undefined;
let previousClientSecret: string | undefined;
let previousGithubClientId: string | undefined;
let previousGithubClientSecret: string | undefined;

beforeEach(() => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-integrations-'));
  previousDir = process.env.COMMANDER_VAULT_DIR;
  previousKey = process.env.COMMANDER_VAULT_KEY;
  previousClientId = process.env.LINEAR_CLIENT_ID;
  previousClientSecret = process.env.LINEAR_CLIENT_SECRET;
  previousGithubClientId = process.env.GITHUB_CLIENT_ID;
  previousGithubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  process.env.COMMANDER_VAULT_DIR = vaultDir;
  delete process.env.COMMANDER_VAULT_KEY;
  delete process.env.LINEAR_CLIENT_ID;
  delete process.env.LINEAR_CLIENT_SECRET;
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
});

afterEach(() => {
  if (previousDir === undefined) delete process.env.COMMANDER_VAULT_DIR;
  else process.env.COMMANDER_VAULT_DIR = previousDir;
  if (previousKey === undefined) delete process.env.COMMANDER_VAULT_KEY;
  else process.env.COMMANDER_VAULT_KEY = previousKey;
  if (previousClientId === undefined) delete process.env.LINEAR_CLIENT_ID;
  else process.env.LINEAR_CLIENT_ID = previousClientId;
  if (previousClientSecret === undefined) delete process.env.LINEAR_CLIENT_SECRET;
  else process.env.LINEAR_CLIENT_SECRET = previousClientSecret;
  if (previousGithubClientId === undefined) delete process.env.GITHUB_CLIENT_ID;
  else process.env.GITHUB_CLIENT_ID = previousGithubClientId;
  if (previousGithubClientSecret === undefined) delete process.env.GITHUB_CLIENT_SECRET;
  else process.env.GITHUB_CLIENT_SECRET = previousGithubClientSecret;
  vi.unstubAllGlobals();
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

function token(overrides: Partial<OAuthToken> = {}): OAuthToken {
  return {
    accessToken: 'lin_access_super_secreto',
    refreshToken: 'lin_refresh_super_secreto',
    tokenType: 'Bearer',
    scope: 'read write',
    expiresAt: Date.now() + 86_400_000,
    account: { id: 'usr_1', name: 'Ada', email: 'ada@example.com' },
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('tokenVault', () => {
  it('guarda y recupera el token sin escribirlo en claro', () => {
    saveToken('linear', token());

    const stored = getToken('linear');
    expect(stored?.accessToken).toBe('lin_access_super_secreto');
    expect(stored?.refreshToken).toBe('lin_refresh_super_secreto');
    expect(stored?.account?.name).toBe('Ada');

    const raw = fs.readFileSync(path.join(vaultDir, 'integrations.json'), 'utf8');
    expect(raw).not.toContain('lin_access_super_secreto');
    expect(raw).not.toContain('lin_refresh_super_secreto');
    expect(raw).not.toContain('"accessToken"');
  });

  it('detecta un ciphertext manipulado', () => {
    saveToken('linear', token());
    const file = path.join(vaultDir, 'integrations.json');
    const vault = JSON.parse(fs.readFileSync(file, 'utf8'));
    vault.entries.linear.data = Buffer.from('manipulado').toString('base64');
    fs.writeFileSync(file, JSON.stringify(vault), 'utf8');

    expect(() => getToken('linear')).toThrow(/descifrar/);
  });

  it('borra el token y permite volver a empezar', () => {
    saveToken('linear', token());
    expect(deleteToken('linear')).toBe(true);
    expect(getToken('linear')).toBeNull();
    expect(deleteToken('linear')).toBe(false);
  });
});

describe('OAuth Linear', () => {
  it('genera una URL PKCE con callback y scopes correctos', () => {
    process.env.LINEAR_CLIENT_ID = 'client_123';

    const started = startOAuth('linear', 'http://localhost:3280');
    const url = new URL(started.authorizeUrl);

    expect(url.origin).toBe('https://linear.app');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client_123');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3280/api/integrations/linear/callback');
    expect(url.searchParams.get('scope')).toBe('read,write');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(url.searchParams.get('state')).toBe(started.state);
    expect(started.redirectUri).toBe('http://localhost:3280/api/integrations/linear/callback');
  });

  it('rechaza un state que no existe antes de llamar a la red', async () => {
    process.env.LINEAR_CLIENT_ID = 'client_123';
    await expect(completeOAuth('linear', 'code', 'state-inventado')).rejects.toThrow(/State OAuth/);
  });

  it('no arranca sin client id y lo explica', () => {
    expect(() => startOAuth('linear', 'http://localhost:3280')).toThrow(/LINEAR_CLIENT_ID/);
  });

  it('el estado inicial no está conectado', () => {
    process.env.LINEAR_CLIENT_ID = 'client_123';
    const status = getIntegrationStatus('linear');
    expect(status.configured).toBe(true);
    expect(status.connected).toBe(false);
    expect(status.scopes).toEqual(['read', 'write']);
  });

  it('intercambia el código, guarda el token cifrado y lee la cuenta', async () => {
    process.env.LINEAR_CLIENT_ID = 'client_123';
    process.env.LINEAR_CLIENT_SECRET = 'secret_123';
    const started = startOAuth('linear', 'http://localhost:3280');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'lin_access_nuevo',
            refresh_token: 'lin_refresh_nuevo',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'read,write',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { viewer: { id: 'usr_1', name: 'Ada', email: 'ada@example.com' } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const status = await completeOAuth('linear', 'code_123', started.state);
    expect(status.connected).toBe(true);
    expect(status.account?.name).toBe('Ada');
    expect(getToken('linear')?.accessToken).toBe('lin_access_nuevo');
    expect(getToken('linear')?.refreshToken).toBe('lin_refresh_nuevo');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(LINEAR_TOKEN_URL);
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('grant_type=authorization_code');
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('code_verifier=');
    const raw = fs.readFileSync(path.join(vaultDir, 'integrations.json'), 'utf8');
    expect(raw).not.toContain('lin_access_nuevo');
    expect(raw).not.toContain('lin_refresh_nuevo');
  });

  it('refresca Linear y conserva el refresh token si el proveedor no lo rota', async () => {
    process.env.LINEAR_CLIENT_ID = 'client_123';
    process.env.LINEAR_CLIENT_SECRET = 'secret_123';
    saveToken('linear', token({ expiresAt: Date.now() - 1_000 }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'lin_refrescado', token_type: 'Bearer', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAccessToken('linear')).resolves.toBe('lin_refrescado');
    expect(getToken('linear')?.refreshToken).toBe('lin_refresh_super_secreto');
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('grant_type=refresh_token');
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('refresh_token=lin_refresh_super_secreto');
  });
});

describe('OAuth GitHub', () => {
  it('genera una URL PKCE con scopes de repositorio y usuario', () => {
    process.env.GITHUB_CLIENT_ID = 'gh_client';
    process.env.GITHUB_CLIENT_SECRET = 'gh_secret';

    const started = startOAuth('github', 'http://localhost:3280');
    const url = new URL(started.authorizeUrl);
    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('repo read:user');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3280/api/integrations/github/callback',
    );
  });

  it('no arranca si falta el client secret, que GitHub exige', () => {
    process.env.GITHUB_CLIENT_ID = 'gh_client';
    expect(() => startOAuth('github', 'http://localhost:3280')).toThrow(/GITHUB_CLIENT_SECRET/);
  });

  it('guarda un token de GitHub sin expiración y lee la cuenta', async () => {
    process.env.GITHUB_CLIENT_ID = 'gh_client';
    process.env.GITHUB_CLIENT_SECRET = 'gh_secret';
    const started = startOAuth('github', 'http://localhost:3280');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'gh_token', token_type: 'bearer', scope: 'repo,read:user' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 42, login: 'octocat', name: 'The Octocat', email: 'octo@example.com' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const status = await completeOAuth('github', 'code_gh', started.state);
    expect(status.connected).toBe(true);
    expect(status.account?.name).toBe('The Octocat');
    const stored = getToken('github');
    expect(stored?.accessToken).toBe('gh_token');
    expect(stored?.expiresAt).toBeUndefined();
    await expect(getAccessToken('github')).resolves.toBe('gh_token');
  });
});

describe('revocación remota', () => {
  it('GitHub revoca el token con Basic auth y borra el vault', async () => {
    process.env.GITHUB_CLIENT_ID = 'gh_client';
    process.env.GITHUB_CLIENT_SECRET = 'gh_secret';
    saveToken(
      'github',
      token({ accessToken: 'gh_access', refreshToken: undefined, expiresAt: undefined }),
    );
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await disconnectIntegration('github');

    expect(result.revoked).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.status.connected).toBe(false);
    expect(getToken('github')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/applications/gh_client/token');
    expect(init?.method).toBe('DELETE');
    const headers = (init?.headers || {}) as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('gh_client:gh_secret').toString('base64')}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({ access_token: 'gh_access' });
  });

  it('Linear revoca access y refresh y tolera 400 de ya revocado', async () => {
    process.env.LINEAR_CLIENT_ID = 'client_123';
    saveToken('linear', token());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await disconnectIntegration('linear');

    expect(result.revoked).toBe(true);
    expect(result.status.connected).toBe(false);
    expect(getToken('linear')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.linear.app/oauth/revoke');
    const access = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(access.get('token')).toBe('lin_access_super_secreto');
    expect(access.get('token_type_hint')).toBe('access_token');
    const refresh = new URLSearchParams(String(fetchMock.mock.calls[1][1]?.body));
    expect(refresh.get('token')).toBe('lin_refresh_super_secreto');
    expect(refresh.get('token_type_hint')).toBe('refresh_token');
  });

  it('si el proveedor falla, borra el token local y devuelve warning', async () => {
    process.env.GITHUB_CLIENT_ID = 'gh_client';
    process.env.GITHUB_CLIENT_SECRET = 'gh_secret';
    saveToken(
      'github',
      token({ accessToken: 'gh_access', refreshToken: undefined, expiresAt: undefined }),
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await disconnectIntegration('github');

    expect(result.revoked).toBe(false);
    expect(result.warning).toMatch(/no pudo revocar/i);
    expect(result.status.connected).toBe(false);
    expect(getToken('github')).toBeNull();
  });
});

describe('tool linear', () => {
  it('sin token devuelve 401 con una instrucción accionable', async () => {
    const result = await executeLinearAction({ action: 'whoami' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toMatch(/no está conectado/i);
    expect(result.error).toMatch(/Integraciones/);
  });

  it('rechaza acciones desconocidas antes de buscar token', async () => {
    const result = await executeLinearAction({ action: 'borrar_todo' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/action inválida/);
  });
});
