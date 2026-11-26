/**
 * App de ejemplo del backend gestionado (PL3).
 *
 * Es la app que el roadmap pide como referencia: registro/login, una fila
 * propia, un archivo propio y logout, con el aislamiento que debe cumplir
 * cualquier proveedor real. No elige proveedor ni despliega nada: corre local
 * sobre SQLite (`node:sqlite`) porque el adaptador real se decide en G3.
 *
 * Dos niveles de aislamiento, y el servidor decide ambos:
 *
 *  - **Proyecto:** cada `projectId` tiene su propia base, su propio storage y
 *    sus propias sesiones. Un token del proyecto A no autentica en B: la fila
 *    de sesión no existe allí.
 *  - **Cuenta:** toda consulta lleva `user_id` del servidor. Un `userId` en el
 *    cuerpo o en la query se ignora; un recurso de otra cuenta devuelve 403 y
 *    uno inexistente, 404.
 *
 * Los ids de recurso son UUID generados aquí: el nombre del archivo nunca
 * decide la ruta en disco y el cliente nunca aporta un id de usuario.
 */
import express, { type Request, type Response } from 'express';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { loadMigrations, runSqliteMigrations } from '../../deploy/backend/migrations';
import type { BackendMigration } from '../../deploy/backend/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIR = path.join(HERE, 'migrations');

export const PROJECT_HEADER = 'x-project-id';
export const SESSION_COOKIE = 'pl3_session';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_BYTES = 64;
const MAX_PASSWORD_LENGTH = 200;

/** Id de proyecto: lo elige el usuario, así que se valida antes de tocar disco. */
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class ExampleAppError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ExampleAppError';
  }
}

interface SessionUser {
  id: string;
  email: string;
}

interface ProjectContext {
  id: string;
  dir: string;
  db: DatabaseSync;
  uploadsDir: string;
  migrations: { applied: string[]; pending: string[] };
}

export interface ExampleReleaseInfo {
  id: string | null;
  environment: string | null;
  /** Nombres de las credenciales cargadas; nunca sus valores. */
  vars: string[];
}

export interface ExampleAppOptions {
  /** Raíz de datos: una carpeta por proyecto con `app.db` y `uploads/`. */
  dataDir: string;
  migrationsDir?: string;
  sessionTtlMs?: number;
  maxFileBytes?: number;
  /** Entorno de release aplicado al arrancar; se publica por `/api/health`. */
  release?: ExampleReleaseInfo;
}

export interface ExampleApp {
  app: express.Express;
  close: () => void;
  /** Sólo para tests: proyectos abiertos y su resultado de migración. */
  projects: () => { id: string; migrations: { applied: string[]; pending: string[] } }[];
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, Buffer.from(salt, 'base64'), PASSWORD_BYTES).toString('base64');
}

function verifyPassword(password: string, salt: string, expected: string): boolean {
  const expectedBytes = Buffer.from(expected, 'base64');
  if (expectedBytes.byteLength !== PASSWORD_BYTES) return false;
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, 'base64'), PASSWORD_BYTES), expectedBytes);
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(value: unknown): string {
  const password = String(value ?? '');
  if (password.length < 8) throw new ExampleAppError(400, 'La contraseña necesita 8 caracteres');
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new ExampleAppError(400, `La contraseña supera ${MAX_PASSWORD_LENGTH} caracteres`);
  }
  return password;
}

function requiredText(value: unknown, field: string, max: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new ExampleAppError(400, `${field} es obligatorio`);
  if (text.length > max) throw new ExampleAppError(400, `${field} supera ${max} caracteres`);
  return text;
}

/** El nombre se guarda para mostrarlo; nunca se usa como ruta. */
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

function readCookie(header: string | undefined, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.split('=');
    if (key.trim() === name) return rest.join('=').trim();
  }
  return '';
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export function createExampleApp(options: ExampleAppOptions): ExampleApp {
  const dataDir = path.resolve(options.dataDir);
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL_MS;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const release = options.release ?? null;
  const contexts = new Map<string, ProjectContext>();
  let migrationList: BackendMigration[] | null = null;

  const migrations = (): BackendMigration[] => {
    if (!migrationList) migrationList = loadMigrations(migrationsDir);
    return migrationList;
  };

  const openProject = (projectId: string): ProjectContext => {
    const cached = contexts.get(projectId);
    if (cached) return cached;
    const dir = path.join(dataDir, 'projects', projectId);
    const uploadsDir = path.join(dir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, 'app.db'));
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const result = runSqliteMigrations(db, migrations());
    if (result.failed.length > 0) {
      const failure = result.failed[0];
      db.close();
      throw new ExampleAppError(500, `La migración ${failure.id} falló: ${failure.message}`);
    }
    const applied = [...result.applied];
    const declared = migrations().map((migration) => migration.id);
    const context: ProjectContext = {
      id: projectId,
      dir,
      db,
      uploadsDir,
      migrations: {
        applied: declared.filter((id) => applied.includes(id) || result.skipped.includes(id)),
        pending: [],
      },
    };
    contexts.set(projectId, context);
    return context;
  };

  const app = express();
  app.disable('x-powered-by');

  // Cada petición resuelve su proyecto antes de leer nada más. Un id raro no
  // llega al sistema de archivos.
  app.use('/api', (req: Request, res: Response, next) => {
    const raw = String(req.get(PROJECT_HEADER) ?? 'demo').trim().toLowerCase();
    if (!PROJECT_ID_PATTERN.test(raw)) {
      res.status(400).json({ success: false, error: 'projectId inválido' });
      return;
    }
    try {
      res.locals.project = openProject(raw);
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      res.locals.token = token;
      res.locals.session = token ? findSession(res.locals.project, token) : null;
      next();
    } catch (error) {
      next(error);
    }
  });

  app.use(express.json({ limit: '256kb' }));

  const requireSession = (res: Response): SessionUser => {
    const session = res.locals.session as SessionUser | null;
    if (!session) throw new ExampleAppError(401, 'Sesión requerida');
    return session;
  };

  const startSession = (project: ProjectContext, userId: string): string => {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    project.db
      .prepare(
        'INSERT INTO app_sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)'
      )
      .run(hashToken(token), userId, now, now + sessionTtlMs);
    return token;
  };

  app.get('/api/health', (_req, res) => {
    const project = res.locals.project as ProjectContext;
    res.json({
      success: true,
      project: project.id,
      provider: 'sqlite-example',
      migrations: project.migrations,
      // Sólo nombres: el valor vive en `process.env`, no en la respuesta.
      release: release
        ? { id: release.id, environment: release.environment, vars: release.vars }
        : null,
    });
  });

  app.post('/api/auth/register', (req, res) => {
    const project = res.locals.project as ProjectContext;
    const email = normalizeEmail(req.body?.email);
    if (!validEmail(email)) throw new ExampleAppError(400, 'Email inválido');
    const password = validatePassword(req.body?.password);
    const exists = project.db
      .prepare('SELECT id FROM app_users WHERE email = ?')
      .get(email) as unknown as { id: string } | undefined;
    if (exists) throw new ExampleAppError(409, 'Ese email ya está registrado');

    const id = randomUUID();
    const salt = randomBytes(16).toString('base64');
    project.db
      .prepare(
        'INSERT INTO app_users (id, email, password_hash, password_salt, created_at) VALUES (?,?,?,?,?)'
      )
      .run(id, email, hashPassword(password, salt), salt, Date.now());
    const token = startSession(project, id);
    res.setHeader('Set-Cookie', sessionCookie(token, Math.floor(sessionTtlMs / 1000)));
    res.status(201).json({ success: true, user: { id, email } });
  });

  app.post('/api/auth/login', (req, res) => {
    const project = res.locals.project as ProjectContext;
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password ?? '');
    const user =
      validEmail(email) && password.length <= MAX_PASSWORD_LENGTH
        ? (project.db
            .prepare('SELECT id, email, password_hash, password_salt FROM app_users WHERE email = ?')
            .get(email) as unknown as
            | { id: string; email: string; password_hash: string; password_salt: string }
            | undefined)
        : undefined;
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      throw new ExampleAppError(401, 'Credenciales inválidas');
    }
    const token = startSession(project, user.id);
    res.setHeader('Set-Cookie', sessionCookie(token, Math.floor(sessionTtlMs / 1000)));
    res.json({ success: true, user: { id: user.id, email: user.email } });
  });

  app.post('/api/auth/logout', (_req, res) => {
    const project = res.locals.project as ProjectContext;
    const token = String(res.locals.token ?? '');
    if (token) {
      project.db.prepare('DELETE FROM app_sessions WHERE token_hash = ?').run(hashToken(token));
    }
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.json({ success: true });
  });

  app.get('/api/me', (_req, res) => {
    const session = requireSession(res);
    res.json({ success: true, user: session });
  });

  app.post('/api/notes', (req, res) => {
    const project = res.locals.project as ProjectContext;
    const session = requireSession(res);
    const body = requiredText(req.body?.body, 'body', 100_000);
    const note = {
      id: randomUUID(),
      user_id: session.id,
      body,
      created_at: Date.now(),
    };
    project.db
      .prepare('INSERT INTO app_notes (id, user_id, body, created_at) VALUES (?,?,?,?)')
      .run(note.id, note.user_id, note.body, note.created_at);
    res.status(201).json({
      success: true,
      note: { id: note.id, body: note.body, createdAt: new Date(note.created_at).toISOString() },
    });
  });

  app.get('/api/notes', (_req, res) => {
    const project = res.locals.project as ProjectContext;
    const session = requireSession(res);
    // `?userId=` se ignora a propósito: el filtro lo pone el servidor.
    const rows = project.db
      .prepare(
        'SELECT id, body, created_at FROM app_notes WHERE user_id = ? ORDER BY created_at DESC'
      )
      .all(session.id) as unknown as { id: string; body: string; created_at: number }[];
    res.json({
      success: true,
      notes: rows.map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    });
  });

  app.get('/api/notes/:id', (req, res) => {
    const project = res.locals.project as ProjectContext;
    const session = requireSession(res);
    const row = project.db
      .prepare('SELECT id, user_id, body, created_at FROM app_notes WHERE id = ?')
      .get(req.params.id) as unknown as
      | { id: string; user_id: string; body: string; created_at: number }
      | undefined;
    if (!row) throw new ExampleAppError(404, 'Nota no encontrada');
    if (row.user_id !== session.id) throw new ExampleAppError(403, 'No autorizado');
    res.json({
      success: true,
      note: { id: row.id, body: row.body, createdAt: new Date(row.created_at).toISOString() },
    });
  });

  app.post(
    '/api/files',
    express.raw({ type: '*/*', limit: maxFileBytes }),
    (req, res) => {
      const project = res.locals.project as ProjectContext;
      const session = requireSession(res);
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (data.byteLength === 0) throw new ExampleAppError(400, 'El archivo está vacío');
      if (data.byteLength > maxFileBytes) {
        throw new ExampleAppError(413, `El archivo supera ${maxFileBytes} bytes`);
      }
      const id = randomUUID();
      const name = normalizeFileName(req.get('x-file-name') ?? 'archivo.bin');
      const mime = normalizeMime(req.get('content-type'));
      // El id manda: el nombre del cliente no toca la ruta.
      fs.writeFileSync(path.join(project.uploadsDir, id), data, { mode: 0o600 });
      project.db
        .prepare('INSERT INTO app_files (id, user_id, name, mime, size, created_at) VALUES (?,?,?,?,?,?)')
        .run(id, session.id, name, mime, data.byteLength, Date.now());
      res.status(201).json({ success: true, file: { id, name, mime, size: data.byteLength } });
    }
  );

  app.get('/api/files/:id', (req, res) => {
    const project = res.locals.project as ProjectContext;
    const session = requireSession(res);
    const row = project.db
      .prepare('SELECT id, user_id, name, mime, size FROM app_files WHERE id = ?')
      .get(req.params.id) as unknown as
      | { id: string; user_id: string; name: string; mime: string; size: number }
      | undefined;
    if (!row) throw new ExampleAppError(404, 'Archivo no encontrado');
    if (row.user_id !== session.id) throw new ExampleAppError(403, 'No autorizado');
    const target = path.resolve(project.uploadsDir, row.id);
    if (!target.startsWith(`${project.uploadsDir}${path.sep}`)) {
      throw new ExampleAppError(500, 'Ruta de archivo inválida');
    }
    const bytes = fs.readFileSync(target);
    res.setHeader('Content-Type', row.mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${row.name.replace(/[^\x20-\x7e]/g, '_')}"; ` +
        `filename*=UTF-8''${encodeURIComponent(row.name)}`
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'Ruta no encontrada' });
  });

  // body-parser marca 413/400 con `status`; el resto es un 500 sin detalle.
  app.use((error: any, _req: Request, res: Response, _next: unknown) => {
    const status = Number(error?.status) || Number(error?.statusCode) || 500;
    const known = error instanceof ExampleAppError;
    if (status >= 500 && !known && process.env.NODE_ENV !== 'test') {
      console.error('[pl3-example]', error);
    }
    res.status(status).json({
      success: false,
      error: status >= 500 && !known ? 'Error interno' : String(error?.message ?? 'Error'),
    });
  });

  return {
    app,
    close: () => {
      for (const context of contexts.values()) context.db.close();
      contexts.clear();
    },
    projects: () =>
      [...contexts.values()].map((context) => ({
        id: context.id,
        migrations: context.migrations,
      })),
  };
}

/** Búsqueda de sesión; separada para poder usarla antes de los handlers. */
function findSession(project: ProjectContext, token: string): SessionUser | null {
  if (!token || token.length > 512) return null;
  const row = project.db
    .prepare(
      `SELECT s.expires_at, u.id, u.email
       FROM app_sessions s JOIN app_users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(hashToken(token)) as unknown as { expires_at: number; id: string; email: string } | undefined;
  if (!row) return null;
  if (Number(row.expires_at) <= Date.now()) {
    project.db.prepare('DELETE FROM app_sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }
  return { id: row.id, email: row.email };
}
