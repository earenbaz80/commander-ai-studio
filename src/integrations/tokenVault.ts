/**
 * Vault local para tokens OAuth.
 *
 * Los tokens se cifran con AES-256-GCM antes de tocar disco. La clave sale de
 * `COMMANDER_VAULT_KEY` (32 bytes en base64 o 64 hex) o, si no está definida,
 * de un fichero aleatorio de 32 bytes en el directorio de datos del usuario.
 * El fichero de tokens nunca contiene access/refresh tokens en claro.
 *
 * Esto no es `safeStorage` de Electron: el servidor también corre fuera de
 * Electron y en tests. Con `COMMANDER_VAULT_KEY` la clave puede vivir fuera del
 * disco de datos; sin ella, el keyfile queda protegido por permisos del sistema.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { IntegrationId, OAuthToken } from './types';

const VAULT_VERSION = 1 as const;
const AAD_PREFIX = 'commander:integrations:';

interface VaultEntry {
  iv: string;
  tag: string;
  data: string;
  updatedAt: number;
}

interface VaultFile {
  version: typeof VAULT_VERSION;
  entries: Record<string, VaultEntry>;
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

function vaultDir(): string {
  const override = process.env.COMMANDER_VAULT_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.commander', 'vault');
}

function vaultPath(): string {
  return path.join(vaultDir(), 'integrations.json');
}

function keyPath(): string {
  return path.join(vaultDir(), 'vault.key');
}

function ensureDir(): void {
  fs.mkdirSync(vaultDir(), { recursive: true, mode: 0o700 });
}

function readKey(): Buffer {
  const fromEnv = process.env.COMMANDER_VAULT_KEY?.trim();
  if (fromEnv) {
    const base64 = Buffer.from(fromEnv, 'base64');
    if (base64.length === 32) return base64;
    if (/^[0-9a-f]{64}$/i.test(fromEnv)) return Buffer.from(fromEnv, 'hex');
    throw new VaultError(
      'COMMANDER_VAULT_KEY inválida: usa 32 bytes en base64 o 64 caracteres hexadecimales.',
    );
  }

  ensureDir();
  try {
    const existing = fs.readFileSync(keyPath());
    if (existing.length !== 32) {
      throw new VaultError('El keyfile del vault no tiene 32 bytes; bórralo y vuelve a conectar.');
    }
    return existing;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(keyPath(), generated, { mode: 0o600 });
    return generated;
  }
}

function emptyVault(): VaultFile {
  return { version: VAULT_VERSION, entries: {} };
}

function readVault(): VaultFile {
  let raw: string;
  try {
    raw = fs.readFileSync(vaultPath(), 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return emptyVault();
    throw new VaultError('No se pudo leer el vault de integraciones.');
  }

  try {
    const parsed = JSON.parse(raw) as VaultFile;
    if (parsed?.version !== VAULT_VERSION || !parsed.entries || typeof parsed.entries !== 'object') {
      throw new Error('formato inesperado');
    }
    return parsed;
  } catch {
    throw new VaultError('El vault de integraciones está corrupto.');
  }
}

function writeVault(vault: VaultFile): void {
  ensureDir();
  const target = vaultPath();
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(vault, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* sin permisos: no hay nada más que hacer */ }
    throw new VaultError('No se pudo guardar el vault de integraciones.');
  }
}

function aad(provider: IntegrationId): Buffer {
  return Buffer.from(`${AAD_PREFIX}${provider}:v1`, 'utf8');
}

function encryptToken(provider: IntegrationId, token: OAuthToken): VaultEntry {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', readKey(), iv);
  cipher.setAAD(aad(provider));
  const data = Buffer.concat([cipher.update(JSON.stringify(token), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
    updatedAt: Date.now(),
  };
}

function decryptToken(provider: IntegrationId, entry: VaultEntry): OAuthToken {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', readKey(), Buffer.from(entry.iv, 'base64'));
    decipher.setAAD(aad(provider));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    const raw = Buffer.concat([
      decipher.update(Buffer.from(entry.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const token = JSON.parse(raw) as OAuthToken;
    if (!token || typeof token.accessToken !== 'string' || !token.accessToken) {
      throw new Error('token vacío');
    }
    return token;
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError(
      'No se pudo descifrar el token de integración. El vault o su clave cambiaron; vuelve a conectar.',
    );
  }
}

export function saveToken(provider: IntegrationId, token: OAuthToken): void {
  if (!token?.accessToken) throw new VaultError('El proveedor no devolvió un access token.');
  const vault = readVault();
  vault.entries[provider] = encryptToken(provider, token);
  writeVault(vault);
}

export function getToken(provider: IntegrationId): OAuthToken | null {
  const entry = readVault().entries[provider];
  if (!entry) return null;
  return decryptToken(provider, entry);
}

export function deleteToken(provider: IntegrationId): boolean {
  const vault = readVault();
  if (!vault.entries[provider]) return false;
  delete vault.entries[provider];
  writeVault(vault);
  return true;
}

/** Para diagnóstico y tests: ruta del fichero cifrado (nunca la clave). */
export function getVaultFilePath(): string {
  return vaultPath();
}
