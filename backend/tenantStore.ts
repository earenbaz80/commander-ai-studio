/**
 * Almacén multiinquilino del backend de Commander.
 *
 * Cada registro crea un `tenant` y un usuario propietario. Toda consulta de
 * datos o archivos se filtra por `tenant_id`; el cliente nunca aporta ese id.
 * SQLite guarda metadatos y sesiones; los bytes de los archivos viven en disco
 * bajo un id generado, nunca bajo un nombre elegido por el usuario.
 *
 * Es una base separada de `studio.db` para no mezclar el historial del agente
 * con datos de aplicaciones/usuarios. No introduce dependencias: usa
 * `node:sqlite`, `node:crypto` y `node:fs`.
 */
import { DatabaseSync } from 'node:sqlite';
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TENANT_FILE_MAX_BYTES = 10 * 1024 * 1024;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_BYTES = 64;
const MAX_PASSWORD_LENGTH = 200;

export class TenantStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = 'TenantStoreError';
  }
}

export interface TenantStoreOptions {
  dbPath?: string;
  storageDir?: string;
  sessionTtlMs?: number;
  maxFileBytes?: number;
}

export interface TenantAuth {
  tenantId: string;
  userId: string;
  email: string;
  name: string;
  tenantName: string;
}

export interface TenantSummary {
  id: string;
  name: string;
}

export interface TenantUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface TenantSession {
  token: string;
  expiresAt: number;
  user: TenantUser;
  tenant: TenantSummary;
}

export interface TenantRecord {
  id: string;
  tenantId: string;
  ownerId: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantFile {
  id: string;
  tenantId: string;
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  password_hash: string;
  password_salt: string;
  created_at: number;
}

interface SessionRow {
  tenant_id: string;
  user_id: string;
  email: string;
  name: string;
  tenant_name: string;
  expires_at: number;
}

interface RecordRow {
  id: string;
  tenant_id: string;
  owner_id: string;
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}

interface FileRow {
  id: string;
  tenant_id: string;
  owner_id: string;
  name: string;
  mime: string;
  size: number;
  created_at: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isUniqueError(error: unknown): boolean {
  return String((error as any)?.message || '').includes('UNIQUE constraint failed');
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function requiredText(value: unknown, field: string, max: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new TenantStoreError(400, `${field} es obligatorio`);
  if (text.length > max) throw new TenantStoreError(400, `${field} supera ${max} caracteres`);
  return text;
}

function optionalText(value: unknown, field: string, max: number): string {
  const text = value === undefined || value === null ? '' : String(value);
  if (text.length > max) throw new TenantStoreError(400, `${field} supera ${max} caracteres`);
  return text;
}

function validatePassword(value: unknown): string {
  const password = String(value ?? '');
  if (password.length < 8) {
    throw new TenantStoreError(400, 'La contraseña debe tener al menos 8 caracteres');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new TenantStoreError(400, `La contraseña supera ${MAX_PASSWORD_LENGTH} caracteres`);
  }
  return password;
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, Buffer.from(salt, 'base64'), PASSWORD_BYTES).toString('base64');
}

function verifyPassword(password: string, salt: string, expected: string): boolean {
  const expectedBytes = Buffer.from(expected, 'base64');
  if (expectedBytes.byteLength !== PASSWORD_BYTES) return false;
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), PASSWORD_BYTES);
  return timingSafeEqual(actual, expectedBytes);
}

function normalizeFileName(value: unknown): string {
  const base = path
    .basename(String(value ?? '').trim().replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .trim()
    .slice(0, 200);
  return base || 'archivo.bin';
}

function normalizeMime(value: unknown): string {
  const mime = String(value ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime.slice(0, 120) : 'application/octet-stream';
}

function toRecord(row: RecordRow): TenantRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ownerId: row.owner_id,
    title: row.title,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toFile(row: FileRow): TenantFile {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ownerId: row.owner_id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class TenantStore {
  private readonly db: DatabaseSync;
  private readonly storageDir: string;
  private readonly sessionTtlMs: number;
  private readonly maxFileBytes: number;

  constructor(options: TenantStoreOptions = {}) {
    const dbPath =
      options.dbPath ||
      process.env.COMMANDER_TENANT_DB_PATH ||
      path.join(process.cwd(), '.commander', 'tenants.db');
    const storageDir =
      options.storageDir ||
      process.env.COMMANDER_TENANT_STORAGE_DIR ||
      path.join(process.cwd(), '.commander', 'tenant-storage');

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.storageDir = path.resolve(storageDir);
    this.sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL_MS;
    this.maxFileBytes = options.maxFileBytes ?? TENANT_FILE_MAX_BYTES;
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tenant_users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_tenant_users_tenant ON tenant_users(tenant_id);

      CREATE TABLE IF NOT EXISTS tenant_sessions (
        token_hash TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_tenant_sessions_expiry ON tenant_sessions(expires_at);

      CREATE TABLE IF NOT EXISTS tenant_records (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_tenant_records_tenant
        ON tenant_records(tenant_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS tenant_files (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_tenant_files_tenant
        ON tenant_files(tenant_id, created_at DESC);
    `);
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* la transacción ya estaba cerrada */
      }
      throw error;
    }
  }

  private findUserByEmail(email: string): UserRow | null {
    const row = this.db
      .prepare('SELECT * FROM tenant_users WHERE email = ?')
      .get(email) as unknown as UserRow | undefined;
    return row ?? null;
  }

  private createSession(input: {
    tenantId: string;
    userId: string;
    email: string;
    name: string;
    tenantName: string;
    createdAt: number;
  }): TenantSession {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.sessionTtlMs;
    this.db
      .prepare(
        `INSERT INTO tenant_sessions (token_hash, tenant_id, user_id, created_at, expires_at)
         VALUES (?,?,?,?,?)`
      )
      .run(hashToken(token), input.tenantId, input.userId, Date.now(), expiresAt);
    return {
      token,
      expiresAt,
      user: {
        id: input.userId,
        email: input.email,
        name: input.name,
        createdAt: new Date(input.createdAt).toISOString(),
      },
      tenant: { id: input.tenantId, name: input.tenantName },
    };
  }

  register(input: {
    email: unknown;
    password: unknown;
    name: unknown;
    tenantName?: unknown;
  }): TenantSession {
    const email = normalizeEmail(input.email);
    if (!validEmail(email)) throw new TenantStoreError(400, 'Email inválido');
    const password = validatePassword(input.password);
    const name = requiredText(input.name, 'name', 120);
    const tenantName = requiredText(input.tenantName || name, 'tenantName', 120);
    if (this.findUserByEmail(email)) {
      throw new TenantStoreError(409, 'Ese email ya está registrado', 'email_taken');
    }

    const salt = randomBytes(16).toString('base64');
    const passwordHash = hashPassword(password, salt);
    const tenantId = randomUUID();
    const userId = randomUUID();
    const now = Date.now();

    try {
      return this.transaction(() => {
        this.db
          .prepare('INSERT INTO tenants (id, name, created_at) VALUES (?,?,?)')
          .run(tenantId, tenantName, now);
        this.db
          .prepare(
            `INSERT INTO tenant_users
               (id, tenant_id, email, name, password_hash, password_salt, created_at)
             VALUES (?,?,?,?,?,?,?)`
          )
          .run(userId, tenantId, email, name, passwordHash, salt, now);
        return this.createSession({
          tenantId,
          userId,
          email,
          name,
          tenantName,
          createdAt: now,
        });
      });
    } catch (error) {
      if (isUniqueError(error)) {
        throw new TenantStoreError(409, 'Ese email ya está registrado', 'email_taken');
      }
      throw error;
    }
  }

  login(input: { email: unknown; password: unknown }): TenantSession {
    const email = normalizeEmail(input.email);
    const password = String(input.password ?? '');
    // Un cuerpo enorme no debe llegar a scrypt: el límite del registro también
    // se aplica al login, sin revelar si el email existía.
    const user =
      validEmail(email) && password.length <= MAX_PASSWORD_LENGTH
        ? this.findUserByEmail(email)
        : null;
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      throw new TenantStoreError(401, 'Credenciales inválidas', 'invalid_credentials');
    }
    const tenant = this.db
      .prepare('SELECT name FROM tenants WHERE id = ?')
      .get(user.tenant_id) as unknown as { name: string } | undefined;
    if (!tenant) throw new TenantStoreError(401, 'Credenciales inválidas', 'invalid_credentials');
    return this.createSession({
      tenantId: user.tenant_id,
      userId: user.id,
      email: user.email,
      name: user.name,
      tenantName: tenant.name,
      createdAt: user.created_at,
    });
  }

  authenticate(token: string): TenantAuth | null {
    if (!token || token.length > 512) return null;
    const row = this.db
      .prepare(
        `SELECT s.tenant_id, s.user_id, s.expires_at,
                u.email, u.name, t.name AS tenant_name
         FROM tenant_sessions s
         JOIN tenant_users u ON u.id = s.user_id
         JOIN tenants t ON t.id = s.tenant_id
         WHERE s.token_hash = ?`
      )
      .get(hashToken(token)) as unknown as SessionRow | undefined;
    if (!row) return null;
    if (Number(row.expires_at) <= Date.now()) {
      this.db.prepare('DELETE FROM tenant_sessions WHERE token_hash = ?').run(hashToken(token));
      return null;
    }
    return {
      tenantId: row.tenant_id,
      userId: row.user_id,
      email: row.email,
      name: row.name,
      tenantName: row.tenant_name,
    };
  }

  logout(token: string): void {
    if (!token) return;
    this.db.prepare('DELETE FROM tenant_sessions WHERE token_hash = ?').run(hashToken(token));
  }

  createRecord(
    tenantId: string,
    ownerId: string,
    input: { title: unknown; body?: unknown }
  ): TenantRecord {
    const title = requiredText(input.title, 'title', 200);
    const body = optionalText(input.body, 'body', 100_000);
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO tenant_records
           (id, tenant_id, owner_id, title, body, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(id, tenantId, ownerId, title, body, now, now);
    return {
      id,
      tenantId,
      ownerId,
      title,
      body,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
  }

  listRecords(tenantId: string): TenantRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tenant_records
         WHERE tenant_id = ?
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(tenantId) as unknown as RecordRow[];
    return rows.map(toRecord);
  }

  getRecord(id: string): TenantRecord | null {
    const row = this.db
      .prepare('SELECT * FROM tenant_records WHERE id = ?')
      .get(id) as unknown as RecordRow | undefined;
    return row ? toRecord(row) : null;
  }

  updateRecord(
    id: string,
    tenantId: string,
    input: { title?: unknown; body?: unknown }
  ): TenantRecord {
    const current = this.getRecord(id);
    if (!current) throw new TenantStoreError(404, 'Registro no encontrado');
    if (current.tenantId !== tenantId) throw new TenantStoreError(403, 'No autorizado');
    const title = input.title === undefined ? current.title : requiredText(input.title, 'title', 200);
    const body = input.body === undefined ? current.body : optionalText(input.body, 'body', 100_000);
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE tenant_records
         SET title = ?, body = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .run(title, body, now, id, tenantId);
    return {
      ...current,
      title,
      body,
      updatedAt: new Date(now).toISOString(),
    };
  }

  deleteRecord(id: string, tenantId: string): void {
    const current = this.getRecord(id);
    if (!current) throw new TenantStoreError(404, 'Registro no encontrado');
    if (current.tenantId !== tenantId) throw new TenantStoreError(403, 'No autorizado');
    this.db.prepare('DELETE FROM tenant_records WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  }

  private filePath(tenantId: string, id: string): string {
    const target = path.resolve(this.storageDir, tenantId, id);
    if (!target.startsWith(`${this.storageDir}${path.sep}`)) {
      throw new TenantStoreError(400, 'Ruta de archivo inválida');
    }
    return target;
  }

  saveFile(
    tenantId: string,
    ownerId: string,
    input: { name: unknown; mime: unknown; data: Buffer }
  ): TenantFile {
    if (!Buffer.isBuffer(input.data) || input.data.byteLength === 0) {
      throw new TenantStoreError(400, 'El archivo está vacío');
    }
    if (input.data.byteLength > this.maxFileBytes) {
      throw new TenantStoreError(413, `El archivo supera ${this.maxFileBytes} bytes`);
    }
    const id = randomUUID();
    const name = normalizeFileName(input.name);
    const mime = normalizeMime(input.mime);
    const dir = path.join(this.storageDir, tenantId);
    const target = this.filePath(tenantId, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, input.data, { mode: 0o600 });
    try {
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO tenant_files
             (id, tenant_id, owner_id, name, mime, size, created_at)
           VALUES (?,?,?,?,?,?,?)`
        )
        .run(id, tenantId, ownerId, name, mime, input.data.byteLength, now);
      return {
        id,
        tenantId,
        ownerId,
        name,
        mime,
        size: input.data.byteLength,
        createdAt: new Date(now).toISOString(),
      };
    } catch (error) {
      try {
        fs.rmSync(target, { force: true });
      } catch {
        /* limpieza best-effort */
      }
      throw error;
    }
  }

  listFiles(tenantId: string): TenantFile[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tenant_files
         WHERE tenant_id = ?
         ORDER BY created_at DESC`
      )
      .all(tenantId) as unknown as FileRow[];
    return rows.map(toFile);
  }

  getFile(id: string): TenantFile | null {
    const row = this.db
      .prepare('SELECT * FROM tenant_files WHERE id = ?')
      .get(id) as unknown as FileRow | undefined;
    return row ? toFile(row) : null;
  }

  readFile(file: TenantFile): Buffer | null {
    try {
      return fs.readFileSync(this.filePath(file.tenantId, file.id));
    } catch {
      return null;
    }
  }

  deleteFile(id: string, tenantId: string): void {
    const file = this.getFile(id);
    if (!file) throw new TenantStoreError(404, 'Archivo no encontrado');
    if (file.tenantId !== tenantId) throw new TenantStoreError(403, 'No autorizado');
    try {
      fs.rmSync(this.filePath(file.tenantId, file.id), { force: true });
    } catch {
      throw new TenantStoreError(500, 'No se pudo borrar el archivo');
    }
    this.db.prepare('DELETE FROM tenant_files WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  }

  close(): void {
    this.db.close();
  }
}
