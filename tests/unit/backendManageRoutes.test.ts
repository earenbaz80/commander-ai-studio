/**
 * Router de gestión del backend gestionado (PL3), sin levantar un servidor.
 *
 * El router de Express es una función: se le pasa un `req`/`res` mínimos y
 * responde en el proceso. Así se prueba lo que el arnés HTTP no puede observar
 * —el sink de la rotación— y la propiedad central del contrato: el valor de la
 * credencial sale una vez hacia el sink y **nunca** aparece en el cuerpo que se
 * serializaría al cliente.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { FakeBackendAdapter } from '../../deploy/backend/fakeAdapter';
import { createBackendRouter } from '../../deploy/backend/routes';
import {
  clearPendingDeploymentSecrets,
  readPendingDeploymentSecret,
} from '../../deploy/backend/secretSink';
import type { BackendSecretSink } from '../../deploy/backend/types';

const projectId = 'proj-rutas-pl3';
const migrations = [
  { id: '001_init', sql: 'create table if not exists notes (id text primary key);' },
  { id: '002_indexes', sql: 'create index if not exists notes_id on notes (id);' },
];

interface RouteResult {
  status: number;
  body: any;
  raw: string;
}

/**
 * Invoca el router como lo haría Express después de `express.json()`: el body
 * ya parseado y la query resuelta. El `res` guarda lo que se habría enviado.
 */
function callRoute(
  router: unknown,
  method: string,
  url: string,
  body?: unknown
): Promise<RouteResult> {
  return new Promise((resolve, reject) => {
    const [path, search] = url.split('?');
    const req: any = {
      method,
      url: path,
      originalUrl: `/api/backend/manage${url}`,
      baseUrl: '/api/backend/manage',
      headers: {},
      body,
      query: Object.fromEntries(new URLSearchParams(search ?? '')),
      get(header: string) {
        return this.headers[String(header).toLowerCase()];
      },
    };
    const headers: Record<string, string> = {};
    const res: any = {
      statusCode: 200,
      payload: undefined,
      headersSent: false,
      setHeader(name: string, value: unknown) {
        headers[String(name).toLowerCase()] = String(value);
        return this;
      },
      getHeader(name: string) {
        return headers[String(name).toLowerCase()];
      },
      removeHeader(name: string) {
        delete headers[String(name).toLowerCase()];
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.payload = payload;
        resolve({ status: this.statusCode, body: payload, raw: JSON.stringify(payload) });
        return this;
      },
      send(payload: unknown) {
        this.payload = payload;
        resolve({
          status: this.statusCode,
          body: payload,
          raw: typeof payload === 'string' ? payload : JSON.stringify(payload),
        });
        return this;
      },
      end(payload?: unknown) {
        if (this.payload === undefined) {
          resolve({ status: this.statusCode, body: payload, raw: String(payload ?? '') });
        }
        return this;
      },
      type() {
        return this;
      },
    };
    (router as (req: unknown, res: unknown, next: (error?: unknown) => void) => void)(
      req,
      res,
      (error?: unknown) => {
        if (error) reject(error);
        else resolve({ status: 404, body: null, raw: '' });
      }
    );
  });
}

function valueFor(name: string): string {
  return `valor-${name}`;
}

beforeEach(() => {
  clearPendingDeploymentSecrets();
});

describe('createBackendRouter', () => {
  test('la rotación entrega el valor al sink y la respuesta sólo lleva nombres', async () => {
    const adapter = new FakeBackendAdapter({ secretFactory: valueFor });
    const router = createBackendRouter(adapter);

    const provisioned = await callRoute(router, 'POST', '/provision', {
      projectId,
      bindings: ['database', 'storage', 'auth'],
    });
    expect(provisioned.status).toBe(200);

    const rotated = await callRoute(router, 'POST', '/rotate', { projectId });

    expect(rotated.status).toBe(200);
    expect(rotated.body.rotation.rotated).toEqual([
      'DATABASE_URL',
      'STORAGE_SECRET',
      'AUTH_SECRET',
    ]);
    // El valor salió del adaptador y llegó al sink…
    expect(readPendingDeploymentSecret(projectId, 'DATABASE_URL')).toBe(
      valueFor('DATABASE_URL')
    );
    expect(readPendingDeploymentSecret(projectId, 'STORAGE_SECRET')).toBe(
      valueFor('STORAGE_SECRET')
    );
    // …y no viaja en lo que se serializa al cliente.
    expect(rotated.raw).not.toContain('valor-');
    expect(rotated.raw).not.toContain('DATABASE_URL=');
  });

  test('rota sólo los kinds pedidos y respeta el sink inyectado', async () => {
    const adapter = new FakeBackendAdapter({ secretFactory: valueFor });
    const written: { name: string; value: string }[] = [];
    const sink: BackendSecretSink = {
      write(name, value) {
        written.push({ name, value });
      },
    };
    const router = createBackendRouter(adapter, { createSink: () => sink });

    await callRoute(router, 'POST', '/provision', {
      projectId,
      bindings: ['database', 'auth'],
    });
    const rotated = await callRoute(router, 'POST', '/rotate', {
      projectId,
      kinds: ['database'],
    });

    expect(rotated.status).toBe(200);
    expect(rotated.body.rotation.rotated).toEqual(['DATABASE_URL']);
    expect(written).toEqual([{ name: 'DATABASE_URL', value: valueFor('DATABASE_URL') }]);
    // Con sink propio, el destino por defecto no se toca.
    expect(readPendingDeploymentSecret(projectId, 'DATABASE_URL')).toBeUndefined();
  });

  test('migrate aplica, no reaplica y responde sólo con ids', async () => {
    const adapter = new FakeBackendAdapter();
    const router = createBackendRouter(adapter);

    await callRoute(router, 'POST', '/provision', { projectId, bindings: ['database'] });

    const first = await callRoute(router, 'POST', '/migrate', { projectId, migrations });
    expect(first.status).toBe(200);
    expect(first.body.result).toEqual({
      applied: ['001_init', '002_indexes'],
      skipped: [],
      failed: [],
    });
    // Ni el SQL ni nada del esquema se devuelve al cliente.
    expect(first.raw).not.toContain('create table');

    const second = await callRoute(router, 'POST', '/migrate', { projectId, migrations });
    expect(second.status).toBe(200);
    expect(second.body.result).toEqual({
      applied: [],
      skipped: ['001_init', '002_indexes'],
      failed: [],
    });

    const status = await callRoute(
      router,
      'GET',
      `/status?projectId=${encodeURIComponent(projectId)}`
    );
    expect(status.body.status.migrations).toEqual({
      applied: ['001_init', '002_indexes'],
      pending: [],
    });
  });

  test('rechaza migraciones inválidas y kinds desconocidos sin tocar el sink', async () => {
    const adapter = new FakeBackendAdapter();
    let sinkCalls = 0;
    const router = createBackendRouter(adapter, {
      createSink: () => ({
        write() {
          sinkCalls += 1;
        },
      }),
    });
    await callRoute(router, 'POST', '/provision', { projectId, bindings: ['database'] });

    const noList = await callRoute(router, 'POST', '/migrate', { projectId, migrations: [] });
    expect(noList.status).toBe(400);
    expect(noList.body.error).toMatch(/al menos una migración/);

    const noId = await callRoute(router, 'POST', '/migrate', {
      projectId,
      migrations: [{ sql: 'select 1;' }],
    });
    expect(noId.status).toBe(400);
    expect(noId.body.error).toMatch(/no tiene id/);

    const noSql = await callRoute(router, 'POST', '/migrate', {
      projectId,
      migrations: [{ id: '003', sql: '  ' }],
    });
    expect(noSql.status).toBe(400);
    expect(noSql.body.error).toMatch(/no tiene SQL/);

    const unknownKind = await callRoute(router, 'POST', '/rotate', {
      projectId,
      kinds: ['realtime'],
    });
    expect(unknownKind.status).toBe(400);
    expect(unknownKind.body.error).toMatch(/Binding desconocido/);
    expect(sinkCalls).toBe(0);
  });

  test('sin adaptador migrate y rotate responden deshabilitado sin llamar al sink', async () => {
    let sinkCalls = 0;
    const router = createBackendRouter(null, {
      createSink: () => ({
        write() {
          sinkCalls += 1;
        },
      }),
    });

    const status = await callRoute(
      router,
      'GET',
      `/status?projectId=${encodeURIComponent(projectId)}`
    );
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ provider: 'none', configured: false, enabled: false });

    for (const route of ['/migrate', '/rotate']) {
      const res = await callRoute(router, 'POST', route, { projectId, migrations });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/no está habilitado/);
    }
    expect(sinkCalls).toBe(0);
  });
});
