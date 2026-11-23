/**
 * Adaptador de backend en memoria.
 *
 * Sólo se usa como test double del contrato de `BackendAdapter`: no se
 * selecciona en producción, no hace red y no guarda valores de credenciales
 * (sólo sus nombres). Reproduce el ciclo que un proveedor real debe cumplir:
 * aprovisionar bindings, migrar de forma idempotente, consultar el estado sin
 * secretos y rotar credenciales entregándolas una vez al sink.
 */
import { randomUUID } from 'node:crypto';
import { backendSecretName, isBackendBindingKind } from './types';
import type {
  BackendAdapter,
  BackendBindingKind,
  BackendBindingRecord,
  BackendMigration,
  BackendMigrateInput,
  BackendMigrationResult,
  BackendProvisionInput,
  BackendRotateInput,
  BackendRotation,
  BackendStatus,
} from './types';

interface ProjectState {
  bindings: Map<BackendBindingKind, BackendBindingRecord>;
  applied: string[];
  /** Migraciones declaradas por el llamador, aplicadas o no. */
  declared: string[];
  secretNames: string[];
}

export interface FakeBackendAdapterOptions {
  now?: () => Date;
  secretFactory?: (name: string) => string;
}

export class FakeBackendAdapter implements BackendAdapter {
  readonly id = 'fake';
  readonly configured = true;

  private readonly projects = new Map<string, ProjectState>();
  private sequence = 0;

  constructor(private readonly options: FakeBackendAdapterOptions = {}) {}

  async provision(input: BackendProvisionInput): Promise<BackendStatus> {
    const projectId = requireProjectId(input.projectId);
    const requested = [...new Set(input.bindings)];
    if (requested.length === 0) throw new Error('Hay que pedir al menos un binding');
    for (const kind of requested) {
      if (!isBackendBindingKind(kind)) throw new Error(`Binding desconocido: ${String(kind)}`);
    }

    const state = this.projectState(projectId);
    for (const kind of requested) {
      // Repetir el aprovisionamiento no duplica recursos ni cambia sus ids.
      if (state.bindings.has(kind)) continue;
      state.bindings.set(kind, {
        kind,
        resourceId: this.nextResourceId(kind),
        state: 'ready',
      });
    }

    return this.status(projectId);
  }

  async migrate(input: BackendMigrateInput): Promise<BackendMigrationResult> {
    const projectId = requireProjectId(input.projectId);
    const state = this.requireProject(projectId);

    // Validar la tanda completa antes de aplicar nada: una tanda ambigua no
    // deja el esquema a medias.
    const seen = new Set<string>();
    const batch: BackendMigration[] = [];
    for (const migration of input.migrations) {
      const id = String(migration?.id ?? '').trim();
      if (!id) throw new Error('Hay una migración sin id');
      if (seen.has(id)) throw new Error(`Migración duplicada en la tanda: ${id}`);
      if (!String(migration?.sql ?? '').trim()) throw new Error(`La migración ${id} no tiene SQL`);
      seen.add(id);
      batch.push({ id, sql: String(migration.sql) });
    }

    const result: BackendMigrationResult = { applied: [], skipped: [], failed: [] };
    for (const migration of batch) {
      if (!state.declared.includes(migration.id)) state.declared.push(migration.id);
      if (state.applied.includes(migration.id)) {
        result.skipped.push(migration.id);
        continue;
      }
      state.applied.push(migration.id);
      result.applied.push(migration.id);
    }
    return result;
  }

  async status(projectIdInput: string): Promise<BackendStatus> {
    const projectId = requireProjectId(projectIdInput);
    const state = this.projects.get(projectId);
    if (!state) {
      return {
        provider: this.id,
        projectId,
        bindings: [],
        migrations: { applied: [], pending: [] },
        secretNames: [],
        ready: false,
      };
    }

    const pending = state.declared.filter((id) => !state.applied.includes(id));
    return {
      provider: this.id,
      projectId,
      bindings: [...state.bindings.values()].map((binding) => ({ ...binding })),
      migrations: { applied: [...state.applied], pending },
      secretNames: [...state.secretNames],
      ready: state.bindings.size > 0 && pending.length === 0,
    };
  }

  async rotateSecrets(input: BackendRotateInput): Promise<BackendRotation> {
    const projectId = requireProjectId(input.projectId);
    const state = this.requireProject(projectId);
    const kinds = input.kinds ? [...new Set(input.kinds)] : [...state.bindings.keys()];
    if (kinds.length === 0) throw new Error('El proyecto no tiene bindings que rotar');
    for (const kind of kinds) {
      if (!isBackendBindingKind(kind)) throw new Error(`Binding desconocido: ${String(kind)}`);
      if (!state.bindings.has(kind)) throw new Error(`El proyecto no tiene el binding ${kind}`);
    }
    if (!input.sink || typeof input.sink.write !== 'function') {
      throw new Error('Falta el sink de secretos');
    }

    const rotated: string[] = [];
    for (const kind of kinds) {
      const name = backendSecretName(kind);
      input.sink.write(name, this.secretValue(name));
      rotated.push(name);
      if (!state.secretNames.includes(name)) state.secretNames.push(name);
    }

    return {
      provider: this.id,
      projectId,
      rotated,
      skipped: [],
      createdAt: this.now().toISOString(),
    };
  }

  private projectState(projectId: string): ProjectState {
    const existing = this.projects.get(projectId);
    if (existing) return existing;
    const created: ProjectState = {
      bindings: new Map(),
      applied: [],
      declared: [],
      secretNames: [],
    };
    this.projects.set(projectId, created);
    return created;
  }

  private requireProject(projectId: string): ProjectState {
    const state = this.projects.get(projectId);
    if (!state) throw new Error('El proyecto no tiene un backend aprovisionado');
    return state;
  }

  private nextResourceId(kind: BackendBindingKind): string {
    this.sequence += 1;
    return `res-${kind}-${this.sequence.toString(36)}`;
  }

  private secretValue(name: string): string {
    const custom = this.options.secretFactory?.(name);
    if (custom) return custom;
    return `fake-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}`;
  }

  private now(): Date {
    const value = this.options.now?.() ?? new Date();
    return new Date(value.getTime());
  }
}

function requireProjectId(value: unknown): string {
  const projectId = typeof value === 'string' ? value.trim() : '';
  if (!projectId) throw new Error('El proyecto no tiene id');
  return projectId;
}
