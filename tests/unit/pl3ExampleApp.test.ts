import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createExampleApp, SESSION_COOKIE, type ExampleApp } from '../../examples/pl3-backend-app/app';
import {
  appliedMigrationIds,
  runSqliteMigrations,
  validateMigrations,
} from '../../deploy/backend/migrations';

/**
 * App de referencia de PL3 contra su base real.
 *
 * No usa `startServer()`: eso levanta Commander, y aquí lo que se prueba es el
 * ejemplo publicado, no la app. Se sirve con `http.createServer(app)` en un
 * puerto efímero del propio proceso (`listen(0)`), sin `spawn` ni puerto fijo,
 * y se cierra al terminar: no compite con el server compartido de la suite.
 */

let example: ExampleApp;
let server: http.Server;
let baseUrl = '';
let dataDir = '';

const tokens = new Map<string, string>();

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-pl3-example-'));
  example = createExampleApp({ dataDir });
  server = http.createServer(example.app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('sin puerto efímero');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  example.close();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* WAL aún abierto */
  }
});

interface CallOptions {
  project?: string;
  token?: string;
  json?: unknown;
  raw?: Buffer;
  headers?: Record<string, string>;
}

async function call(method: string, route: string, options: CallOptions = {}) {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.project) headers['x-project-id'] = options.project;
  if (options.token) headers.cookie = `${SESSION_COOKIE}=${options.token}`;
  let body: Buffer | undefined;
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = Buffer.from(JSON.stringify(options.json));
  } else if (options.raw) {
    body = options.raw;
  }
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  let json: any = null;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    json = null;
  }
  return {
    status: response.status,
    body: json,
    text: bytes.toString('utf8'),
    bytes,
    headers: response.headers,
    setCookie: response.headers.get('set-cookie') ?? '',
  };
}

function tokenFrom(setCookie: string): string {
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) throw new Error(`sin cookie de sesión: ${setCookie}`);
  return match[1];
}

async function register(project: string, email: string): Promise<string> {
  const res = await call('POST', '/api/auth/register', {
    project,
    json: { email, password: 'secreto123' },
  });
  expect(res.status, res.text).toBe(201);
  return tokenFrom(res.setCookie);
}

describe('migraciones reales sobre SQLite', () => {
  it('aplica en orden, registra y no repite la tanda', () => {
    const db = new DatabaseSync(':memory:');
    const migrations = [
      { id: '0001', sql: 'CREATE TABLE demo (id TEXT PRIMARY KEY)' },
      { id: '0002', sql: 'CREATE INDEX ix_demo ON demo (id)' },
    ];

    const first = runSqliteMigrations(db, migrations);
    expect(first).toEqual({ applied: ['0001', '0002'], skipped: [], failed: [] });
    expect(appliedMigrationIds(db)).toEqual(['0001', '0002']);

    const second = runSqliteMigrations(db, migrations);
    expect(second).toEqual({ applied: [], skipped: ['0001', '0002'], failed: [] });
    db.close();
  });

  it('un SQL inválido revierte su migración, se reporta y no aplica el resto', () => {
    const db = new DatabaseSync(':memory:');
    const result = runSqliteMigrations(db, [
      { id: '0001', sql: 'CREATE TABLE buena (id TEXT)' },
      { id: '0002', sql: 'CREATE TABLE rota (' },
      { id: '0003', sql: 'CREATE TABLE nunca (id TEXT)' },
    ]);

    expect(result.applied).toEqual(['0001']);
    expect(result.failed.map((failure) => failure.id)).toEqual(['0002']);
    expect(result.failed[0].message.length).toBeGreaterThan(0);
    expect(appliedMigrationIds(db)).toEqual(['0001']);
    // La tabla de la migración fallida no quedó a medias.
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as unknown as { name: string }[];
    expect(tables.map((table) => table.name)).not.toContain('nunca');
    db.close();
  });

  it('rechaza ids duplicados y SQL vacío antes de tocar la base', () => {
    expect(() =>
      validateMigrations([
        { id: '0001', sql: 'SELECT 1' },
        { id: '0001', sql: 'SELECT 2' },
      ])
    ).toThrow(/duplicada/);
    expect(() => validateMigrations([{ id: '0001', sql: '   ' }])).toThrow(/no tiene SQL/);
  });
});

describe('app de ejemplo PL3', () => {
  it('salud: las migraciones del ejemplo quedaron aplicadas', async () => {
    const res = await call('GET', '/api/health', { project: 'app-a' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.provider).toBe('sqlite-example');
    expect(res.body.migrations).toEqual({
      applied: ['001_init', '002_indexes'],
      pending: [],
    });
    expect(fs.existsSync(path.join(dataDir, 'projects', 'app-a', 'app.db'))).toBe(true);
  });

  it('registro, login, sesión y logout', async () => {
    const email = 'ana@example.test';
    const created = await call('POST', '/api/auth/register', {
      project: 'app-a',
      json: { email, password: 'secreto123' },
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body.user.email).toBe(email);
    expect(created.setCookie).toMatch(/HttpOnly/);
    expect(created.setCookie).toMatch(/SameSite=Lax/);
    const token = tokenFrom(created.setCookie);
    tokens.set('ana', token);

    const me = await call('GET', '/api/me', { project: 'app-a', token });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);

    const duplicate = await call('POST', '/api/auth/register', {
      project: 'app-a',
      json: { email, password: 'secreto123' },
    });
    expect(duplicate.status).toBe(409);

    const wrong = await call('POST', '/api/auth/login', {
      project: 'app-a',
      json: { email, password: 'incorrecta' },
    });
    expect(wrong.status).toBe(401);

    const login = await call('POST', '/api/auth/login', {
      project: 'app-a',
      json: { email, password: 'secreto123' },
    });
    expect(login.status).toBe(200);
    const second = tokenFrom(login.setCookie);
    expect(second).not.toBe(token);

    const out = await call('POST', '/api/auth/logout', { project: 'app-a', token: second });
    expect(out.status).toBe(200);
    const after = await call('GET', '/api/me', { project: 'app-a', token: second });
    expect(after.status).toBe(401);
  });

  it('sin sesión: 401 en todo lo privado', async () => {
    const me = await call('GET', '/api/me', { project: 'app-a' });
    expect(me.status).toBe(401);
    expect(me.body.error).toMatch(/Sesión requerida/);

    const notes = await call('GET', '/api/notes', { project: 'app-a' });
    expect(notes.status).toBe(401);

    const create = await call('POST', '/api/notes', {
      project: 'app-a',
      json: { body: 'sin sesión' },
    });
    expect(create.status).toBe(401);

    const file = await call('GET', '/api/files/cualquiera', { project: 'app-a' });
    expect(file.status).toBe(401);

    const upload = await call('POST', '/api/files', {
      project: 'app-a',
      raw: Buffer.from('x'),
      headers: { 'x-file-name': 'x.txt', 'content-type': 'text/plain' },
    });
    expect(upload.status).toBe(401);
  });

  it('dos cuentas no ven las notas de la otra: 403 al pedir un id ajeno', async () => {
    const tokenAna = tokens.get('ana') as string;
    const tokenBeto = await register('app-a', 'beto@example.test');
    tokens.set('beto', tokenBeto);

    const created = await call('POST', '/api/notes', {
      project: 'app-a',
      token: tokenAna,
      json: { body: 'nota privada de ana' },
    });
    expect(created.status, created.text).toBe(201);
    const noteId = created.body.note.id as string;

    const mine = await call('GET', '/api/notes', { project: 'app-a', token: tokenAna });
    expect(mine.body.notes).toHaveLength(1);

    const theirs = await call('GET', '/api/notes', { project: 'app-a', token: tokenBeto });
    expect(theirs.status).toBe(200);
    expect(theirs.body.notes).toEqual([]);

    const foreign = await call('GET', `/api/notes/${noteId}`, {
      project: 'app-a',
      token: tokenBeto,
    });
    expect(foreign.status).toBe(403);

    const own = await call('GET', `/api/notes/${noteId}`, { project: 'app-a', token: tokenAna });
    expect(own.status).toBe(200);
    expect(own.body.note.body).toBe('nota privada de ana');

    // Un `userId` en la query no cambia el filtro del servidor.
    const spoofed = await call('GET', '/api/notes?userId=beto', {
      project: 'app-a',
      token: tokenAna,
    });
    expect(spoofed.body.notes).toHaveLength(1);
    expect(spoofed.body.notes[0].body).toBe('nota privada de ana');

    const missing = await call('GET', '/api/notes/no-existe', {
      project: 'app-a',
      token: tokenAna,
    });
    expect(missing.status).toBe(404);
  });

  it('archivos: el dueño los lee, la otra cuenta recibe 403 y el nombre no elige la ruta', async () => {
    const tokenAna = tokens.get('ana') as string;
    const tokenBeto = tokens.get('beto') as string;

    const upload = await call('POST', '/api/files', {
      project: 'app-a',
      token: tokenAna,
      raw: Buffer.from('contenido de ana'),
      headers: { 'x-file-name': '../../evil.txt', 'content-type': 'text/plain' },
    });
    expect(upload.status, upload.text).toBe(201);
    expect(upload.body.file.name).toBe('evil.txt');
    expect(upload.body.file.size).toBe(16);
    const fileId = upload.body.file.id as string;

    // El id es un UUID nuestro: el archivo vive bajo uploads/, no fuera.
    expect(
      fs.existsSync(path.join(dataDir, 'projects', 'app-a', 'uploads', fileId))
    ).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'projects', 'app-a', 'evil.txt'))).toBe(false);

    const download = await call('GET', `/api/files/${fileId}`, {
      project: 'app-a',
      token: tokenAna,
    });
    expect(download.status).toBe(200);
    expect(download.text).toBe('contenido de ana');
    expect(download.headers.get('content-type')).toBe('text/plain');

    const foreign = await call('GET', `/api/files/${fileId}`, {
      project: 'app-a',
      token: tokenBeto,
    });
    expect(foreign.status).toBe(403);
    expect(foreign.text).not.toContain('contenido de ana');

    const anonymous = await call('GET', `/api/files/${fileId}`, { project: 'app-a' });
    expect(anonymous.status).toBe(401);

    const unknown = await call('GET', '/api/files/no-existe', {
      project: 'app-a',
      token: tokenAna,
    });
    expect(unknown.status).toBe(404);

    const empty = await call('POST', '/api/files', {
      project: 'app-a',
      token: tokenAna,
      raw: Buffer.alloc(0),
      headers: { 'x-file-name': 'vacio.txt' },
    });
    expect(empty.status).toBe(400);
  });

  it('aísla proyectos: una sesión de A no autentica en B y los datos no cruzan', async () => {
    const tokenAna = tokens.get('ana') as string;
    const tokenB = await register('app-b', 'ana@example.test');

    // La misma cuenta puede existir en otro proyecto, pero es otra identidad.
    const meA = await call('GET', '/api/me', { project: 'app-a', token: tokenAna });
    const meB = await call('GET', '/api/me', { project: 'app-b', token: tokenB });
    expect(meA.status).toBe(200);
    expect(meB.status).toBe(200);
    expect(meA.body.user.id).not.toBe(meB.body.user.id);

    const crossed = await call('GET', '/api/me', { project: 'app-b', token: tokenAna });
    expect(crossed.status).toBe(401);

    const notesB = await call('GET', '/api/notes', { project: 'app-b', token: tokenB });
    expect(notesB.body.notes).toEqual([]);

    const noteFromA = await call('GET', '/api/notes', { project: 'app-a', token: tokenAna });
    const noteId = noteFromA.body.notes[0].id as string;
    // En B esa nota no existe: no se filtra ni siquiera su existencia.
    const leaked = await call('GET', `/api/notes/${noteId}`, { project: 'app-b', token: tokenB });
    expect(leaked.status).toBe(404);

    // Cada proyecto tiene su base y su carpeta de archivos.
    expect(fs.existsSync(path.join(dataDir, 'projects', 'app-a', 'app.db'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'projects', 'app-b', 'app.db'))).toBe(true);
  });

  it('rechaza un projectId que intenta salir de su carpeta', async () => {
    const res = await call('GET', '/api/health', { project: '../fuera' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId inválido/);
  });

  it('reabrir la app no reaplica migraciones', async () => {
    const reopened = createExampleApp({ dataDir });
    const second = http.createServer(reopened.app);
    try {
      await new Promise<void>((resolve) => second.listen(0, '127.0.0.1', () => resolve()));
      const address = second.address();
      if (!address || typeof address === 'string') throw new Error('sin puerto efímero');
      const res = await fetch(`http://127.0.0.1:${address.port}/api/health`, {
        headers: { 'x-project-id': 'app-a' },
      });
      expect(res.status).toBe(200);
      const health = await res.json();
      expect(health.migrations).toEqual({ applied: ['001_init', '002_indexes'], pending: [] });
      expect(reopened.projects()).toEqual([
        { id: 'app-a', migrations: { applied: ['001_init', '002_indexes'], pending: [] } },
      ]);

      // Una sola fila por migración: la segunda apertura no duplicó nada.
      const db = new DatabaseSync(path.join(dataDir, 'projects', 'app-a', 'app.db'));
      const rows = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as unknown as {
        id: string;
      }[];
      db.close();
      expect(rows.map((row) => row.id)).toEqual(['001_init', '002_indexes']);
    } finally {
      await new Promise<void>((resolve) => second.close(() => resolve()));
      reopened.close();
    }
  });
});
