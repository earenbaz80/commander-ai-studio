/**
 * Adaptador de despliegue en memoria.
 *
 * Sólo se usa como test double del contrato: no se selecciona en producción.
 * No hace red, no guarda credenciales y sus URLs usan el dominio reservado
 * `.invalid`. Reproduce el mismo ciclo que el publicador local.
 */
import { describeProject, isDeployEnvironment } from './adapter';
import { preflightRelease } from './preflight';
import type {
  DeployEnvironment,
  DeployInput,
  DeploymentAdapter,
  DeploymentRecord,
  DeploymentStatus,
  PreflightInput,
  PreflightResult,
  ProjectDescriptor,
  PromoteInput,
} from './types';

const MAX_HISTORY = 20;

interface ProjectState {
  deployments: DeploymentRecord[];
  preview: string | null;
  production: string | null;
  productionHistory: string[];
}

export interface FakeDeploymentAdapterOptions {
  now?: () => Date;
  idFactory?: () => string;
  baseUrl?: string;
}

export class FakeDeploymentAdapter implements DeploymentAdapter {
  readonly id = 'fake';
  readonly configured = true;

  private readonly projects = new Map<string, ProjectState>();
  private sequence = 0;

  constructor(private readonly options: FakeDeploymentAdapterOptions = {}) {}

  async detectProject(root: string): Promise<ProjectDescriptor> {
    return describeProject(root);
  }

  async preflight(input: PreflightInput): Promise<PreflightResult> {
    return preflightRelease(input.release.dir);
  }

  async deploy(input: DeployInput): Promise<DeploymentRecord> {
    if (!isDeployEnvironment(input.environment)) {
      throw new Error('Entorno de despliegue inválido');
    }
    if (!input.release?.id) throw new Error('La release no tiene id');
    if (!input.release.dir) throw new Error('La release no tiene carpeta');
    const preflight = await this.preflight(input);
    if (!preflight.ok) {
      throw new Error(preflight.issues[0]?.message || 'La release no pasó el preflight');
    }

    const state = this.projectState(input.project);
    const now = this.now();
    const deploymentId = this.nextId(now);
    const record: DeploymentRecord = {
      id: deploymentId,
      releaseId: input.release.id,
      environment: input.environment,
      url: this.urlFor(input.project, deploymentId, input.environment),
      createdAt: now.toISOString(),
      status: 'ready',
      provider: this.id,
    };

    state.deployments.unshift(record);
    if (input.environment === 'preview') state.preview = record.id;
    else this.setProduction(state, record.id);

    return { ...record };
  }

  async promote(input: PromoteInput): Promise<DeploymentRecord> {
    if (!isDeployEnvironment(input.environment)) {
      throw new Error('Entorno de despliegue inválido');
    }
    const state = this.projects.get(input.project.id);
    const record = state?.deployments.find((item) => item.id === input.deploymentId);
    if (!state || !record) throw new Error('El deployment indicado no existe');

    if (input.environment === 'preview') state.preview = record.id;
    else this.setProduction(state, record.id);

    return this.withEnvironment(input.project, record, input.environment);
  }

  async rollback(project: ProjectDescriptor): Promise<DeploymentRecord> {
    const state = this.requireProject(project);
    if (state.productionHistory.length < 2) {
      throw new Error('No hay una producción anterior a la que volver');
    }
    const previousId = state.productionHistory[1];
    const record = state.deployments.find((item) => item.id === previousId);
    if (!record) throw new Error('La release anterior ya no existe');

    state.production = previousId;
    state.productionHistory = state.productionHistory.slice(1);
    return this.withEnvironment(project, record, 'production');
  }

  async status(project: ProjectDescriptor): Promise<DeploymentStatus> {
    const state = this.projects.get(project.id);
    if (!state) {
      return {
        provider: this.id,
        projectId: project.id,
        preview: null,
        production: null,
        canRollback: false,
        deployments: [],
      };
    }

    const find = (
      id: string | null,
      environment: DeployEnvironment
    ): DeploymentRecord | null => {
      if (!id) return null;
      const record = state.deployments.find((item) => item.id === id);
      return record ? this.withEnvironment(project, record, environment) : null;
    };

    return {
      provider: this.id,
      projectId: project.id,
      preview: find(state.preview, 'preview'),
      production: find(state.production, 'production'),
      canRollback: state.productionHistory.length > 1,
      deployments: state.deployments.map((record) => ({ ...record })),
    };
  }

  async logs(deploymentId: string): Promise<string> {
    for (const state of this.projects.values()) {
      const record = state.deployments.find((item) => item.id === deploymentId);
      if (record) {
        return `fake ${record.id} ${record.status} ${record.url}`;
      }
    }
    throw new Error('Deployment no encontrado');
  }

  private projectState(project: ProjectDescriptor): ProjectState {
    const existing = this.projects.get(project.id);
    if (existing) return existing;
    const created: ProjectState = {
      deployments: [],
      preview: null,
      production: null,
      productionHistory: [],
    };
    this.projects.set(project.id, created);
    return created;
  }

  private requireProject(project: ProjectDescriptor): ProjectState {
    const state = this.projects.get(project.id);
    if (!state) throw new Error('El proyecto no tiene deployments');
    return state;
  }

  private setProduction(state: ProjectState, deploymentId: string): void {
    if (state.production === deploymentId) return;
    state.production = deploymentId;
    state.productionHistory = [
      deploymentId,
      ...state.productionHistory.filter((id) => id !== deploymentId),
    ].slice(0, MAX_HISTORY);
  }

  private withEnvironment(
    project: ProjectDescriptor,
    record: DeploymentRecord,
    environment: DeployEnvironment
  ): DeploymentRecord {
    return {
      ...record,
      environment,
      url: this.urlFor(project, record.id, environment),
    };
  }

  private now(): Date {
    const value = this.options.now?.() ?? new Date();
    return new Date(value.getTime());
  }

  private nextId(now: Date): string {
    this.sequence += 1;
    const custom = this.options.idFactory?.();
    if (custom) return custom;
    return `dep-${now.toISOString().replace(/\D/g, '').slice(0, 14)}-${this.sequence.toString(36)}`;
  }

  private urlFor(
    project: ProjectDescriptor,
    deploymentId: string,
    environment: DeployEnvironment
  ): string {
    const base = (this.options.baseUrl || 'https://deploy.invalid').replace(/\/+$/, '');
    return `${base}/${encodeURIComponent(project.id)}/${encodeURIComponent(deploymentId)}/${environment}/`;
  }
}
