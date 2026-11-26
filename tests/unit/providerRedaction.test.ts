/**
 * Detalles de proveedor que salen por `/api/deploy/*` y
 * `/api/backend/manage/*`: se prueban los routers en proceso para inyectar
 * respuestas de Vercel y del backend gestionado con secretos sin depender de
 * una cuenta real.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDeployRouter } from '../../deploy/routes';
import { createBackendRouter } from '../../deploy/backend/routes';
import type {
  DeploymentAdapter,
  DeploymentRecord,
  DeploymentStatus,
  ProjectDescriptor,
} from '../../deploy/types';
import type { BackendAdapter, BackendStatus } from '../../deploy/backend/types';

const VERCEL_TOKEN = 'vercel-token-de-prueba-123456';
const BACKEND_TOKEN = 'backend-token-de-prueba-123456';

let previousVercelToken: string | undefined;
let previousBackendToken: string | undefined;

beforeEach(() => {
  previousVercelToken = process.env.VERCEL_TOKEN;
  previousBackendToken = process.env.COMMANDER_BACKEND_TOKEN;
  process.env.VERCEL_TOKEN = VERCEL_TOKEN;
  process.env.COMMANDER_BACKEND_TOKEN = BACKEND_TOKEN;
});

afterEach(() => {
  if (previousVercelToken === undefined) delete process.env.VERCEL_TOKEN;
  else process.env.VERCEL_TOKEN = previousVercelToken;
  if (previousBackendToken === undefined) delete process.env.COMMANDER_BACKEND_TOKEN;
  else process.env.COMMANDER_BACKEND_TOKEN = previousBackendToken;
});

interface RouteResult {
  status: number;
  body: any;
  raw: string;
}

/** Invoca el router como lo haría Express tras `express.json()`. */
function callRoute(
  router: unknown,
  method: string,
  url: string,
  body?: unknown
): Promise<RouteResult> {
  return new Promise((resolve, reject) => {
    const [path, search] = url.split('?');
    const req: any = {
      method: method.toUpperCase(),
      url: path,
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

const deployment: DeploymentRecord = {
  id: 'dpl_1',
  releaseId: 'release-1',
  environment: 'preview',
  url: 'https://demo.vercel.app',
  createdAt: new Date().toISOString(),
  status: 'ready',
  provider: 'vercel',
};

function vercelStatus(): DeploymentStatus {
  return {
    provider: 'vercel',
    projectId: 'proj-1',
    preview: deployment,
    production: null,
    canRollback: false,
    deployments: [deployment],
  };
}

function vercelAdapter(overrides: Partial<DeploymentAdapter> = {}): DeploymentAdapter {
  const project: ProjectDescriptor = {
    id: 'proj-1',
    root: 'proj',
    name: 'demo',
    kind: 'static',
    buildScript: false,
    outputDir: 'dist',
    manifest: null,
  };
  return {
    id: 'vercel',
    configured: true,
    detectProject: async () => project,
    preflight: async () => ({ ok: true, fileCount: 1, bytes: 1, issues: [] }),
    deploy: async () => deployment,
    promote: async () => deployment,
    rollback: async () => deployment,
    status: async () => vercelStatus(),
    logs: async () => '',
    ...overrides,
  };
}

function backendStatus(): BackendStatus {
  return {
    provider: 'fake',
    projectId: 'proj-1',
    bindings: [],
    migrations: { applied: [], pending: [] },
    secretNames: [],
    ready: false,
  };
}

function backendAdapter(overrides: Partial<BackendAdapter> = {}): BackendAdapter {
  return {
    id: 'fake',
    configured: true,
    provision: async () => backendStatus(),
    migrate: async () => ({ applied: [], skipped: [], failed: [] }),
    status: async () => backendStatus(),
    rotateSecrets: async () => ({
      provider: 'fake',
      projectId: 'proj-1',
      rotated: [],
      skipped: [],
      createdAt: new Date().toISOString(),
    }),
    ...overrides,
  };
}

describe('redacción de detalles de proveedor', () => {
  it('sanea el error de Vercel en /api/deploy/*', async () => {
    const adapter = vercelAdapter({
      status: async () => {
        throw new Error(
          `Vercel 500: {"error":{"message":"token ${VERCEL_TOKEN} sbp_ABCDEFGH12345678"}}`
        );
      },
    });

    const res = await callRoute(
      createDeployRouter((value) => String(value ?? ''), adapter),
      'GET',
      '/status?root=proj'
    );

    expect(res.status).toBe(400);
    expect(res.raw).toContain('Vercel 500');
    expect(res.raw).toContain('[redactado]');
    expect(res.raw).not.toContain(VERCEL_TOKEN);
    expect(res.raw).not.toContain('sbp_ABCDEFGH12345678');
  });

  it('sanea el log de Vercel antes de devolverlo', async () => {
    const adapter = vercelAdapter({
      logs: async () =>
        `build ok\n${VERCEL_TOKEN}\npostgresql://postgres:clave@db.ref.example:5432/postgres\nBearer abcdef1234567890`,
    });

    const res = await callRoute(
      createDeployRouter((value) => String(value ?? ''), adapter),
      'GET',
      '/logs?root=proj&deploymentId=dpl_1'
    );

    expect(res.status).toBe(200);
    expect(String(res.body.log)).toContain('build ok');
    expect(String(res.body.log)).toContain('[redactado]');
    expect(String(res.body.log)).not.toContain(VERCEL_TOKEN);
    expect(String(res.body.log)).not.toContain('clave@db.ref.example');
    expect(String(res.body.log)).not.toContain('abcdef1234567890');
  });

  it('sanea el error del backend en /api/backend/manage/*', async () => {
    const adapter = backendAdapter({
      status: async () => {
        throw new Error(`El backend respondió 403: {"message":"token ${BACKEND_TOKEN}"}`);
      },
    });

    const res = await callRoute(
      createBackendRouter(adapter),
      'GET',
      '/status?projectId=proj-1'
    );

    expect(res.status).toBe(400);
    expect(res.raw).toContain('El backend respondió 403');
    expect(res.raw).toContain('[redactado]');
    expect(res.raw).not.toContain(BACKEND_TOKEN);
  });

  it('sanea el mensaje de una migración fallida', async () => {
    const adapter = backendAdapter({
      migrate: async () => ({
        applied: [],
        skipped: [],
        failed: [
          {
            id: '001_init',
            message: `El backend respondió 400: password=${BACKEND_TOKEN} postgresql://postgres:clave@db.ref.example:5432/postgres`,
          },
        ],
      }),
    });

    const res = await callRoute(
      createBackendRouter(adapter),
      'POST',
      '/migrate',
      {
        projectId: 'proj-1',
        migrations: [{ id: '001_init', sql: 'select 1;' }],
      }
    );

    expect(res.status).toBe(200);
    expect(res.body.result.failed[0].id).toBe('001_init');
    expect(res.body.result.failed[0].message).toContain('[redactado]');
    expect(res.raw).not.toContain(BACKEND_TOKEN);
    expect(res.raw).not.toContain('clave@db.ref.example');
  });
});
