/**
 * Adaptador real de PL3 sobre Supabase, contra una Management API simulada.
 *
 * No hay cuenta ni token reales: `fetch` es un stub local y las credenciales
 * de configuración son de prueba. Lo que se cubre es el contrato, que es lo
 * que no puede esperar a G3: sin variables no se hace red, aprovisionar es
 * idempotente, las migraciones no se repiten, la rotación entrega el valor una
 * sola vez al sink y ni el estado ni la respuesta llevan secretos.
 */
import { describe, expect, test } from 'vitest';
import { SupabaseBackendAdapter } from '../../deploy/backend/supabase';
import type { BackendSecretSink } from '../../deploy/backend/types';

const TOKEN = 'token-de-prueba-no-real';
const ORG = 'org-de-prueba';
const REGION = 'us-east-1';
const REF = 'abcdefghijklmnop';
const API = 'https://api.test/v1';
const PROJECT_ID = 'app-pl3';

interface Call {
  method: string;
  path: string;
  body: any;
}

/** API mínima de Supabase: proyectos, buckets, contraseña y SQL. */
function stubApi() {
  const calls: Call[] = [];
  const state = {
    projects: [] as { id: string; name: string }[],
    buckets: [] as { id: string }[],
    applied: [] as string[],
    password: '',
  };

  const respond = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = String(url).startsWith(API) ? String(url).slice(API.length) : String(url);
    const method = String(init?.method ?? 'GET');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });

    if (method === 'GET' && path === '/projects') return respond(200, state.projects);
    if (method === 'POST' && path === '/projects') {
      const project = { id: REF, name: String(body?.name ?? '') };
      state.projects.push(project);
      return respond(201, project);
    }
    if (method === 'GET' && path === `/projects/${REF}/storage/buckets`) {
      return respond(200, state.buckets);
    }
    if (method === 'POST' && path === `/projects/${REF}/storage/buckets`) {
      state.buckets.push({ id: String(body?.id ?? '') });
      return respond(201, { name: body?.name });
    }
    if (method === 'PATCH' && path === `/projects/${REF}/database/password`) {
      state.password = String(body?.password ?? '');
      return respond(200, { message: 'ok' });
    }
    if (method === 'POST' && path === `/projects/${REF}/database/query`) {
      const query = String(body?.query ?? '');
      if (/select id from schema_migrations/i.test(query)) {
        return respond(201, state.applied.map((id) => ({ id })));
      }
      if (/boom/i.test(query)) return respond(400, { message: 'syntax error at or near "boom"' });
      const inserted = /insert into schema_migrations .*values \('([^']+)'/i.exec(query);
      if (inserted) state.applied.push(inserted[1]);
      return respond(201, []);
    }
    return respond(404, { message: `sin ruta ${method} ${path}` });
  }) as unknown as typeof fetch;

  return { calls, state, fetchImpl };
}

function adapter(api = stubApi(), options: { secretFactory?: () => string } = {}) {
  return {
    api,
    backend: new SupabaseBackendAdapter({
      token: TOKEN,
      organizationId: ORG,
      region: REGION,
      apiBaseUrl: API,
      fetchImpl: api.fetchImpl,
      passwordFactory: () => 'password-rotada-1',
      ...(options.secretFactory ? { secretFactory: options.secretFactory } : {}),
    }),
  };
}

function collectSink(): { sink: BackendSecretSink; values: Record<string, string> } {
  const values: Record<string, string> = {};
  return {
    values,
    sink: {
      write(name, value) {
        values[name] = value;
      },
    },
  };
}

describe('SupabaseBackendAdapter', () => {
  test('sin credenciales queda desactivado y no hace red', async () => {
    const backend = new SupabaseBackendAdapter({
      token: '',
      organizationId: '',
      region: '',
      fetchImpl: (() => {
        throw new Error('no debería llamar a la red');
      }) as unknown as typeof fetch,
    });

    expect(backend.configured).toBe(false);
    await expect(
      backend.provision({ projectId: PROJECT_ID, bindings: ['database'] })
    ).rejects.toThrow(/Faltan credenciales/);
  });

  test('aprovisiona proyecto y bucket una sola vez y sin secretos en el estado', async () => {
    const { api, backend } = adapter();

    const first = await backend.provision({
      projectId: PROJECT_ID,
      bindings: ['database', 'storage', 'auth'],
    });

    expect(first.ready).toBe(true);
    expect(first.provider).toBe('supabase');
    expect(first.bindings.map((binding) => binding.kind)).toEqual([
      'database',
      'storage',
      'auth',
    ]);
    expect(first.bindings.find((binding) => binding.kind === 'database')?.resourceId).toBe(REF);
    expect(first.secretNames).toEqual([]);
    // La contraseña inicial se generó y se descartó: no quedó en el estado.
    expect(JSON.stringify(first)).not.toContain('db_pass');
    expect(api.state.password).toBe('');

    const second = await backend.provision({ projectId: PROJECT_ID, bindings: ['database'] });

    expect(second.bindings).toHaveLength(3);
    expect(api.calls.filter((call) => call.method === 'POST' && call.path === '/projects')).toHaveLength(
      1
    );
    expect(
      api.calls.filter((call) => call.path === `/projects/${REF}/storage/buckets`)
    ).toHaveLength(2); // GET + POST del primer aprovisionamiento; el segundo no pide storage.
  });

  test('la rotación entrega la URL con la contraseña nueva al sink y responde sólo nombres', async () => {
    const { api, backend } = adapter();
    await backend.provision({ projectId: PROJECT_ID, bindings: ['database'] });
    const { sink, values } = collectSink();

    const rotation = await backend.rotateSecrets({ projectId: PROJECT_ID, kinds: ['database'], sink });

    expect(rotation.rotated).toEqual(['DATABASE_URL']);
    expect(api.state.password).toBe('password-rotada-1');
    expect(values.DATABASE_URL).toBe(
      `postgresql://postgres:password-rotada-1@db.${REF}.supabase.co:5432/postgres`
    );

    // Ni la respuesta ni el estado publicado transportan el valor.
    expect(JSON.stringify(rotation)).not.toContain('password-rotada-1');
    const status = await backend.status(PROJECT_ID);
    expect(status.secretNames).toEqual(['DATABASE_URL']);
    expect(JSON.stringify(status)).not.toContain('password-rotada-1');
  });

  test('rotar todo se rechaza antes de emitir nada: el storage no se rota por API', async () => {
    const { backend } = adapter();
    await backend.provision({
      projectId: PROJECT_ID,
      bindings: ['database', 'storage', 'auth'],
    });
    const { sink, values } = collectSink();

    await expect(backend.rotateSecrets({ projectId: PROJECT_ID, sink })).rejects.toThrow(
      /storage/
    );
    expect(values).toEqual({});
  });

  test('las migraciones se aplican una vez y se saltan al repetir', async () => {
    const { backend } = adapter();
    await backend.provision({ projectId: PROJECT_ID, bindings: ['database'] });
    const migrations = [
      { id: '001_init', sql: 'create table notes (id text primary key);' },
      { id: '002_indexes', sql: 'create index notes_id on notes (id);' },
    ];

    const first = await backend.migrate({ projectId: PROJECT_ID, migrations });
    const second = await backend.migrate({ projectId: PROJECT_ID, migrations });

    expect(first).toEqual({ applied: ['001_init', '002_indexes'], skipped: [], failed: [] });
    expect(second).toEqual({ applied: [], skipped: ['001_init', '002_indexes'], failed: [] });
    const status = await backend.status(PROJECT_ID);
    expect(status.migrations).toEqual({ applied: ['001_init', '002_indexes'], pending: [] });
    expect(status.ready).toBe(true);
  });

  test('un fallo de SQL se informa, corta la tanda y no filtra el token', async () => {
    const { backend } = adapter();
    await backend.provision({ projectId: PROJECT_ID, bindings: ['database'] });

    const result = await backend.migrate({
      projectId: PROJECT_ID,
      migrations: [
        { id: '001_ok', sql: 'create table notes (id text primary key);' },
        { id: '002_boom', sql: 'boom;' },
        { id: '003_later', sql: 'create table later (id text primary key);' },
      ],
    });

    expect(result.applied).toEqual(['001_ok']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('002_boom');
    expect(result.failed[0].message).toMatch(/syntax error/);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
