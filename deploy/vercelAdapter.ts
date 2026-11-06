/**
 * Adaptador real para hosting estático en Vercel.
 *
 * Sube la release local ya construida (nunca ejecuta build), crea deployments
 * con archivos referenciados por SHA y usa la API de promoción/rollback de
 * Vercel. El token vive sólo en el proceso del servidor y nunca se incluye en
 * mensajes de error.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describeProject } from './adapter';
import type {
  DeployEnvironment,
  DeployInput,
  DeploymentAdapter,
  DeploymentRecord,
  DeploymentState,
  DeploymentStatus,
  ProjectDescriptor,
  PreflightInput,
  PreflightResult,
  PromoteInput,
  RemoteDeploymentState,
} from './types';
import { MemoryRemoteStateStore, type RemoteStateStore } from './stateStore';
import {
  PREFLIGHT_MAX_BYTES,
  PREFLIGHT_MAX_FILES,
  preflightFiles,
  preflightRelease,
} from './preflight';

const API_BASE = 'https://api.vercel.com';
const MAX_HISTORY = 20;
const UPLOAD_CONCURRENCY = 4;

interface VercelDeployment {
  id: string;
  url?: string;
  alias?: string[];
  readyState?: string;
  createdAt?: number;
  target?: string | null;
}

interface CollectedFile {
  file: string;
  data: Buffer;
  sha: string;
  size: number;
}

export interface VercelAdapterOptions {
  token?: string;
  projectId?: string;
  teamId?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  store?: RemoteStateStore;
}

export class VercelDeploymentAdapter implements DeploymentAdapter {
  readonly id = 'vercel';

  private readonly token: string;
  private readonly projectId: string;
  private readonly teamId: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly store: RemoteStateStore;

  constructor(options: VercelAdapterOptions = {}) {
    this.token = String(options.token ?? process.env.VERCEL_TOKEN ?? '').trim();
    this.projectId = String(options.projectId ?? process.env.VERCEL_PROJECT_ID ?? '').trim();
    this.teamId = String(options.teamId ?? process.env.VERCEL_TEAM_ID ?? '').trim();
    this.apiBaseUrl = (options.apiBaseUrl || API_BASE).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl || fetch;
    this.store = options.store || new MemoryRemoteStateStore();
  }

  get configured(): boolean {
    return Boolean(this.token && this.projectId);
  }

  async detectProject(root: string): Promise<ProjectDescriptor> {
    const project = await describeProject(root);
    if (project.kind !== 'static' && project.kind !== 'spa') {
      throw new Error(
        'Vercel en esta fase sólo publica builds estáticas o SPA; este proyecto es ' +
          project.kind
      );
    }
    return project;
  }

  async preflight(input: PreflightInput): Promise<PreflightResult> {
    return preflightRelease(input.release.dir);
  }

  async deploy(input: DeployInput): Promise<DeploymentRecord> {
    this.requireConfig();
    const files = await this.collectFiles(input.release.dir);
    if (files.length === 0) throw new Error('La release no contiene archivos');
    const preflight = preflightFiles(files);
    if (!preflight.ok) {
      throw new Error(preflight.issues[0]?.message || 'La release no pasó el preflight');
    }

    await this.uploadFiles(files);

    const body: Record<string, unknown> = {
      name: input.project.name,
      project: this.projectId,
      files: files.map((file) => ({ file: file.file, sha: file.sha, size: file.size })),
      projectSettings: { framework: null },
      meta: {
        commanderReleaseId: input.release.id,
        commanderProjectId: input.project.id,
      },
    };
    if (input.environment === 'production') body.target = 'production';

    const deployment = await this.request<VercelDeployment>(
      `/v13/deployments${this.query({ forceNew: '1', skipAutoDetectionConfirmation: '1' })}`,
      { method: 'POST', body: JSON.stringify(body) }
    );
    if (!deployment?.id) throw new Error('Vercel no devolvió el id del deployment');

    const record = this.toRecord(deployment, input.release.id, input.environment);
    const state = await this.readState(input.project);
    state.deployments = [record, ...state.deployments].slice(0, MAX_HISTORY);
    if (input.environment === 'preview') state.preview = record.id;
    else this.setProduction(state, record.id);
    await this.store.write(input.project, state);
    return { ...record };
  }

  async promote(input: PromoteInput): Promise<DeploymentRecord> {
    this.requireConfig();
    const state = await this.readState(input.project);
    const record = state.deployments.find((item) => item.id === input.deploymentId);
    if (!record) throw new Error('El deployment indicado no existe');
    if (record.status !== 'ready') {
      throw new Error('El deployment todavía no está listo; actualiza el estado antes de promover');
    }

    if (input.environment === 'preview') {
      state.preview = record.id;
      await this.store.write(input.project, state);
      return { ...record, environment: 'preview' };
    }

    await this.request(
      `/v10/projects/${encodeURIComponent(this.projectId)}/promote/${encodeURIComponent(record.id)}${this.query()}`,
      { method: 'POST' }
    );

    const live = await this.getDeployment(record.id).catch(() => null);
    const promoted: DeploymentRecord = {
      ...record,
      environment: 'production',
      status: live ? this.mapState(live.readyState) : record.status,
      url: live ? this.productionUrl(live, record.url) : record.url,
    };
    state.deployments = state.deployments.map((item) =>
      item.id === promoted.id ? promoted : item
    );
    this.setProduction(state, promoted.id);
    await this.store.write(input.project, state);
    return { ...promoted };
  }

  async rollback(project: ProjectDescriptor): Promise<DeploymentRecord> {
    this.requireConfig();
    const state = await this.readState(project);
    if (state.productionHistory.length < 2) {
      throw new Error('No hay una producción anterior a la que volver');
    }
    const previousId = state.productionHistory[1];
    const record = state.deployments.find((item) => item.id === previousId);
    if (!record) throw new Error('La release anterior ya no existe');
    if (record.status !== 'ready') {
      throw new Error('La producción anterior no está lista; actualiza el estado');
    }

    await this.request(
      `/v1/projects/${encodeURIComponent(this.projectId)}/rollback/${encodeURIComponent(previousId)}${this.query({ description: 'Commander rollback' })}`,
      { method: 'POST' }
    );

    const live = await this.getDeployment(previousId).catch(() => null);
    const rolledBack: DeploymentRecord = {
      ...record,
      environment: 'production',
      status: live ? this.mapState(live.readyState) : record.status,
      url: live ? this.productionUrl(live, record.url) : record.url,
    };
    state.deployments = state.deployments.map((item) =>
      item.id === rolledBack.id ? rolledBack : item
    );
    state.production = previousId;
    state.productionHistory = state.productionHistory.slice(1);
    await this.store.write(project, state);
    return { ...rolledBack };
  }

  async status(project: ProjectDescriptor): Promise<DeploymentStatus> {
    this.requireConfig();
    const state = await this.readState(project);
    const pointerIds = new Set([state.preview, state.production].filter(Boolean));
    const pending = state.deployments.filter(
      (deployment) =>
        pointerIds.has(deployment.id) ||
        deployment.status === 'queued' ||
        deployment.status === 'building'
    );

    let changed = false;
    await mapLimit(pending, UPLOAD_CONCURRENCY, async (deployment) => {
      try {
        const live = await this.getDeployment(deployment.id);
        const nextStatus = this.mapState(live.readyState);
        const nextUrl =
          deployment.environment === 'production'
            ? this.productionUrl(live, deployment.url)
            : this.deploymentUrl(live, deployment.url);
        if (nextStatus !== deployment.status || nextUrl !== deployment.url) changed = true;
        deployment.status = nextStatus;
        deployment.url = nextUrl;
      } catch {
        // Un fallo puntual de red no borra el último estado conocido.
      }
    });
    if (changed) await this.store.write(project, state);

    const byId = new Map(state.deployments.map((deployment) => [deployment.id, deployment]));
    return {
      provider: this.id,
      projectId: project.id,
      preview: state.preview ? byId.get(state.preview) || null : null,
      production: state.production ? byId.get(state.production) || null : null,
      canRollback: state.productionHistory.length > 1,
      deployments: state.deployments.map((deployment) => ({ ...deployment })),
    };
  }

  async logs(deploymentId: string): Promise<string> {
    this.requireConfig();
    try {
      const events = await this.request<any>(
        `/v3/deployments/${encodeURIComponent(deploymentId)}/events${this.query({ limit: '100' })}`
      );
      const list = Array.isArray(events) ? events : Array.isArray(events?.events) ? events.events : [];
      const text = list
        .map((event: any) => {
          const at = event?.created ? new Date(event.created).toISOString() : '';
          const body = event?.text || event?.payload?.text || event?.type || '';
          return [at, body].filter(Boolean).join(' ');
        })
        .filter(Boolean)
        .join('\n');
      if (text) return text.slice(-6000);
      return JSON.stringify(events).slice(0, 6000);
    } catch {
      const deployment = await this.getDeployment(deploymentId);
      return `Vercel ${deployment.id} ${deployment.readyState || 'unknown'} ${this.deploymentUrl(deployment, '')}`;
    }
  }

  private async readState(project: ProjectDescriptor): Promise<RemoteDeploymentState> {
    const state = await this.store.read(project);
    if (state?.provider === this.id) return state;
    return {
      provider: this.id,
      preview: null,
      production: null,
      productionHistory: [],
      deployments: [],
    };
  }

  private setProduction(state: RemoteDeploymentState, deploymentId: string): void {
    if (state.production === deploymentId) return;
    state.production = deploymentId;
    state.productionHistory = [
      deploymentId,
      ...state.productionHistory.filter((id) => id !== deploymentId),
    ].slice(0, MAX_HISTORY);
  }

  private requireConfig(): void {
    if (!this.token) {
      throw new Error('Falta VERCEL_TOKEN; configúralo en .env o en el almacén de secretos');
    }
    if (!this.projectId) {
      throw new Error('Falta VERCEL_PROJECT_ID; configúralo en .env o en el almacén de secretos');
    }
  }

  private query(extra: Record<string, string> = {}): string {
    const params = new URLSearchParams(extra);
    if (this.teamId) params.set('teamId', this.teamId);
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  private async request<T>(route: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${route}`, { ...init, headers });
    } catch {
      throw new Error('No se pudo conectar con Vercel; revisa la red del servidor');
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500);
      throw new Error(`Vercel ${response.status}: ${detail || response.statusText}`.trim());
    }
    const raw = await response.text();
    if (!raw) return undefined as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error('Vercel devolvió una respuesta ilegible');
    }
  }

  private async getDeployment(id: string): Promise<VercelDeployment> {
    return this.request<VercelDeployment>(
      `/v13/deployments/${encodeURIComponent(id)}${this.query()}`
    );
  }

  private async uploadFiles(files: CollectedFile[]): Promise<void> {
    let index = 0;
    const workers = Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, files.length) },
      async () => {
        while (index < files.length) {
          const current = files[index++];
          const headers = new Headers({
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(current.size),
            'x-vercel-digest': current.sha,
            Authorization: `Bearer ${this.token}`,
          });
          let response: Response;
          try {
            response = await this.fetchImpl(`${this.apiBaseUrl}/v2/files${this.query()}`, {
              method: 'POST',
              headers,
              body: current.data,
            });
          } catch {
            throw new Error(`No se pudo subir ${current.file} a Vercel`);
          }
          if (!response.ok) {
            const detail = (await response.text().catch(() => ''))
              .replace(/\s+/g, ' ')
              .slice(0, 300);
            throw new Error(`Vercel rechazó ${current.file} (${response.status}): ${detail}`);
          }
        }
      }
    );
    await Promise.all(workers);
  }

  private async collectFiles(root: string): Promise<CollectedFile[]> {
    const files: CollectedFile[] = [];
    let bytes = 0;
    const visit = async (dir: string): Promise<void> => {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          throw new Error(`La release contiene un symlink no permitido: ${entry.name}`);
        }
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await visit(abs);
          continue;
        }
        if (!entry.isFile()) continue;
        const data = await fsp.readFile(abs);
        bytes += data.byteLength;
        if (files.length + 1 > PREFLIGHT_MAX_FILES) {
          throw new Error('La release supera el límite de archivos');
        }
        if (bytes > PREFLIGHT_MAX_BYTES) throw new Error('La release supera el límite de 300 MB');
        files.push({
          file: path.relative(root, abs).replace(/\\/g, '/'),
          data,
          sha: createHash('sha1').update(data).digest('hex'),
          size: data.byteLength,
        });
      }
    };
    await visit(root);
    return files;
  }

  private toRecord(
    deployment: VercelDeployment,
    releaseId: string,
    environment: DeployEnvironment
  ): DeploymentRecord {
    return {
      id: deployment.id,
      releaseId,
      environment,
      url:
        environment === 'production'
          ? this.productionUrl(deployment, this.deploymentUrl(deployment, ''))
          : this.deploymentUrl(deployment, ''),
      createdAt: new Date(deployment.createdAt || Date.now()).toISOString(),
      status: this.mapState(deployment.readyState),
      provider: this.id,
    };
  }

  private deploymentUrl(deployment: VercelDeployment, fallback: string): string {
    const url = String(deployment.url || '').trim();
    if (!url) return fallback;
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }

  private productionUrl(deployment: VercelDeployment, fallback: string): string {
    const alias = deployment.alias?.find((value) => typeof value === 'string' && value.trim());
    return alias ? `https://${alias.replace(/^https?:\/\//i, '')}` : this.deploymentUrl(deployment, fallback);
  }

  private mapState(value: string | undefined): DeploymentState {
    switch (String(value || '').toUpperCase()) {
      case 'QUEUED':
      case 'INITIALIZING':
        return 'queued';
      case 'BUILDING':
        return 'building';
      case 'READY':
        return 'ready';
      case 'ERROR':
      case 'CANCELED':
      case 'BLOCKED':
        return 'failed';
      default:
        return 'unknown';
    }
  }
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(workers);
}
