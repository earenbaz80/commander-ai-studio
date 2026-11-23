/**
 * Adaptador real del backend gestionado (PL3) sobre Supabase.
 *
 * Enfoque elegido para G3 (2026-11-23): un proyecto de Supabase por app
 * publicada. Se eligió por lo que el contrato ya promete y ningún otro
 * candidato cubría junto: inquilino propio por app, URL de Postgres con
 * credencial propia, storage de objetos por proyecto y una Management API
 * HTTPS que el servidor llama sin SDK, sin build y sin runtime propio. Sigue
 * fuera Vercel (decisión del 2026-11-10). Cloudflare quedó descartado para este
 * backend porque D1 no emite una credencial por base —se usa por binding del
 * Worker o con el token de la cuenta— y el contrato pide una por binding.
 *
 * Estado: **esqueleto**. Los endpoints usados están documentados
 * (`POST /v1/projects`, `PATCH /v1/projects/{ref}/database/password`,
 * `POST /v1/projects/{ref}/database/query` y los buckets de storage), pero
 * ninguna llamada se ha ejercitado contra una cuenta real: esa verificación es
 * lo que cierra G3. Sin `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_ID` y
 * `SUPABASE_REGION` el adaptador queda `configured: false` y no hace red.
 *
 * Reglas que este archivo no rompe:
 *  - No inventa credenciales: no hay ninguna clave escrita aquí. El valor sale
 *    de `randomBytes` en el momento y se entrega una sola vez al `sink`.
 *  - `status` y `rotateSecrets` no transportan valores; sólo nombres.
 *  - `provision` no entrega credenciales porque el contrato no le da `sink`:
 *    crea recursos y la entrega ocurre en la rotación. La contraseña inicial de
 *    Postgres se genera y se descarta; no hay secretos en reposo.
 *  - La rotación hace lo que la API permite (`DATABASE_URL`, `AUTH_SECRET`) y
 *    devuelve el storage en `skipped`, con su motivo, sin emitir valor: las
 *    claves S3 se generan en los ajustes del proyecto, no por la Management
 *    API. Fingir esa credencial dejaría a la app apuntando a algo que no existe.
 */
import { createHash, randomBytes } from 'node:crypto';
import { validateMigrations } from './migrations';
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

const DEFAULT_API_BASE = 'https://api.supabase.com/v1';
const MIGRATIONS_TABLE = 'schema_migrations';

/** Sólo estos bindings se pueden rotar con la Management API. */
const ROTATABLE: ReadonlyArray<BackendBindingKind> = ['database', 'auth'];

const STORAGE_SKIP_REASON =
  'Supabase no emite las claves S3 del storage por la Management API: se generan en los ajustes del proyecto.';

export interface SupabaseAdapterOptions {
  token?: string;
  organizationId?: string;
  region?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Sólo para tests: valor determinista de la contraseña de Postgres. */
  passwordFactory?: () => string;
  /** Sólo para tests: valor determinista de `AUTH_SECRET`. */
  secretFactory?: (name: string) => string;
}

interface ProjectState {
  /** Nombre estable del proyecto en Supabase; es la clave de idempotencia. */
  name: string;
  /** `ref` del proyecto; vacío hasta que el proveedor responde. */
  ref: string;
  bindings: Map<BackendBindingKind, BackendBindingRecord>;
  declared: string[];
  secretNames: string[];
}

export class SupabaseBackendAdapter implements BackendAdapter {
  readonly id = 'supabase';

  private readonly token: string;
  private readonly organizationId: string;
  private readonly region: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly passwordFactory: () => string;
  private readonly secretFactory?: (name: string) => string;
  private readonly projects = new Map<string, ProjectState>();

  constructor(options: SupabaseAdapterOptions = {}) {
    this.token = String(options.token ?? process.env.SUPABASE_ACCESS_TOKEN ?? '').trim();
    this.organizationId = String(
      options.organizationId ?? process.env.SUPABASE_ORG_ID ?? ''
    ).trim();
    this.region = String(options.region ?? process.env.SUPABASE_REGION ?? '').trim();
    this.apiBaseUrl = (options.apiBaseUrl || DEFAULT_API_BASE).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl || fetch;
    this.now = options.now ?? (() => new Date());
    this.passwordFactory = options.passwordFactory ?? (() => randomBytes(24).toString('base64url'));
    this.secretFactory = options.secretFactory;
  }

  /** Sin las tres variables no hay forma de aprovisionar: la UI no lo ofrece. */
  get configured(): boolean {
    return Boolean(this.token && this.organizationId && this.region);
  }

  async provision(input: BackendProvisionInput): Promise<BackendStatus> {
    this.requireConfig();
    const projectId = requireProjectId(input.projectId);
    const requested = [...new Set(input.bindings)];
    if (requested.length === 0) throw new Error('Hay que pedir al menos un binding');
    for (const kind of requested) {
      if (!isBackendBindingKind(kind)) throw new Error(`Binding desconocido: ${String(kind)}`);
    }

    const state = this.projects.get(projectId) ?? {
      name: projectName(projectId),
      ref: '',
      bindings: new Map<BackendBindingKind, BackendBindingRecord>(),
      declared: [],
      secretNames: [],
    };
    this.projects.set(projectId, state);

    // Idempotencia: el proyecto se busca por nombre antes de crearlo. Repetir
    // el aprovisionamiento no duplica recursos ni cambia el `ref`.
    let ref = state.ref || (await this.findProjectRef(state.name));
    if (!ref) {
      const created = await this.request<{ id?: unknown }>('POST', '/projects', {
        name: state.name,
        organization_id: this.organizationId,
        region: this.region,
        // Se descarta: la credencial se entrega al rotar, no aquí.
        db_pass: this.passwordFactory(),
      });
      ref = typeof created?.id === 'string' ? created.id : '';
      if (!ref) throw new Error('Supabase no devolvió el id del proyecto');
    }
    state.ref = ref;

    for (const kind of requested) {
      if (state.bindings.has(kind)) continue;
      state.bindings.set(kind, {
        kind,
        resourceId: kind === 'storage' ? bucketName(state.name) : ref,
        state: 'ready',
      });
    }
    if (requested.includes('storage')) await this.ensureBucket(ref, bucketName(state.name));

    return this.status(projectId);
  }

  async migrate(input: BackendMigrateInput): Promise<BackendMigrationResult> {
    this.requireConfig();
    const projectId = requireProjectId(input.projectId);
    const state = this.requireProject(projectId);
    // La misma validación que el runner de SQLite: ids únicos y SQL no vacío.
    const batch = validateMigrations(input.migrations);
    const applied = new Set(await this.readAppliedMigrations(state.ref));

    const result: BackendMigrationResult = { applied: [], skipped: [], failed: [] };
    for (const migration of batch) {
      if (!state.declared.includes(migration.id)) state.declared.push(migration.id);
      if (applied.has(migration.id)) {
        result.skipped.push(migration.id);
        continue;
      }
      try {
        await this.runQuery(state.ref, migrationSql(migration));
        applied.add(migration.id);
        result.applied.push(migration.id);
      } catch (error: any) {
        // Se corta la tanda: las siguientes pueden depender de la que falló.
        result.failed.push({
          id: migration.id,
          message: String(error?.message ?? error),
        });
        break;
      }
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

    const applied = await this.readAppliedMigrations(state.ref);
    const pending = state.declared.filter((id) => !applied.includes(id));
    return {
      provider: this.id,
      projectId,
      bindings: [...state.bindings.values()].map((binding) => ({ ...binding })),
      migrations: { applied, pending },
      secretNames: [...state.secretNames],
      ready: state.bindings.size > 0 && pending.length === 0,
    };
  }

  async rotateSecrets(input: BackendRotateInput): Promise<BackendRotation> {
    this.requireConfig();
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

    // El storage queda fuera de la tanda pero se informa: el usuario ve que
    // esa credencial sigue sin emitirse, en vez de un fallo que anula las otras.
    const skipped = kinds
      .filter((kind) => !ROTATABLE.includes(kind))
      .map((kind) => ({
        kind,
        name: backendSecretName(kind),
        reason: STORAGE_SKIP_REASON,
      }));

    // Primero se obtienen todos los valores y sólo después se escribe el sink:
    // si el proveedor falla a mitad, no quedan credenciales de edades distintas.
    const issued: { name: string; value: string }[] = [];
    for (const kind of kinds) {
      if (!ROTATABLE.includes(kind)) continue;
      const name = backendSecretName(kind);
      const value =
        kind === 'database'
          ? await this.rotateDatabasePassword(state.ref)
          : this.newAuthSecret();
      issued.push({ name, value });
    }

    const rotated: string[] = [];
    for (const { name, value } of issued) {
      // El valor sale una sola vez, hacia el entorno de la app.
      input.sink.write(name, value);
      rotated.push(name);
      if (!state.secretNames.includes(name)) state.secretNames.push(name);
    }

    return {
      provider: this.id,
      projectId,
      rotated,
      skipped,
      createdAt: this.now().toISOString(),
    };
  }

  /** Cambia la contraseña en el proveedor y devuelve la URL ya completa. */
  private async rotateDatabasePassword(ref: string): Promise<string> {
    const password = this.passwordFactory();
    await this.request('PATCH', `/projects/${ref}/database/password`, { password });
    return databaseUrl(ref, password);
  }

  private newAuthSecret(): string {
    return this.secretFactory?.('AUTH_SECRET') ?? randomBytes(32).toString('base64url');
  }

  private async findProjectRef(name: string): Promise<string> {
    const projects = await this.request<unknown>('GET', '/projects');
    if (!Array.isArray(projects)) return '';
    const match = projects.find(
      (project: any) => project?.name === name && typeof project?.id === 'string'
    );
    return match ? String(match.id) : '';
  }

  private async ensureBucket(ref: string, id: string): Promise<void> {
    const buckets = await this.request<unknown>('GET', `/projects/${ref}/storage/buckets`);
    const exists =
      Array.isArray(buckets) &&
      buckets.some((bucket: any) => bucket?.id === id || bucket?.name === id);
    if (exists) return;
    await this.request('POST', `/projects/${ref}/storage/buckets`, {
      id,
      name: id,
      public: false,
    });
  }

  /**
   * Crea la tabla de control si falta y devuelve lo aplicado. Es idempotente y
   * replica la tabla que ya usa `migrations.ts` en SQLite; así un proyecto no
   * depende del motor para saber qué corrió.
   */
  private async readAppliedMigrations(ref: string): Promise<string[]> {
    this.requireConfig();
    await this.runQuery(
      ref,
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (\n` +
        '  id text PRIMARY KEY,\n' +
        '  applied_at bigint NOT NULL\n' +
        ')'
    );
    const rows = await this.runQuery<unknown>(
      ref,
      `SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY applied_at, id`
    );
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => String((row as any)?.id ?? '')).filter(Boolean);
  }

  private async runQuery<T = unknown>(ref: string, query: string): Promise<T> {
    return this.request<T>('POST', `/projects/${ref}/database/query`, { query });
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const detail = providerMessage(text);
      throw new Error(`Supabase respondió ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    if (!text.trim()) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('Supabase devolvió una respuesta ilegible');
    }
  }

  private requireConfig(): void {
    if (!this.configured) {
      throw new Error(
        'Faltan credenciales de Supabase: SUPABASE_ACCESS_TOKEN, SUPABASE_ORG_ID y SUPABASE_REGION'
      );
    }
  }

  private requireProject(projectId: string): ProjectState {
    const state = this.projects.get(projectId);
    if (!state || !state.ref) {
      throw new Error('El proyecto no tiene un backend aprovisionado');
    }
    return state;
  }
}

/** Nombre estable por proyecto: idempotencia sin guardar un id de proveedor. */
function projectName(projectId: string): string {
  const base =
    projectId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'app';
  const hash = createHash('sha256').update(projectId).digest('hex').slice(0, 8);
  return `cmdr-${base}-${hash}`;
}

function bucketName(projectNameValue: string): string {
  return `${projectNameValue}-files`;
}

/**
 * Host directo documentado por Supabase; el pooler se añadirá cuando G3 lo
 * verifique contra una cuenta real.
 */
function databaseUrl(ref: string, password: string): string {
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

/** Una migración, su registro y el commit en una sola llamada. */
function migrationSql(migration: BackendMigration): string {
  const id = migration.id.replace(/'/g, "''");
  return [
    'BEGIN;',
    migration.sql.trim(),
    `INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES ('${id}', ${Date.now()});`,
    'COMMIT;',
  ].join('\n');
}

/** Mensaje del proveedor, acotado: nunca se registra ni se devuelve el token. */
function providerMessage(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.message ?? parsed?.error ?? '')
      .trim()
      .slice(0, 300);
  } catch {
    return text.trim().slice(0, 300);
  }
}

function requireProjectId(value: unknown): string {
  const projectId = typeof value === 'string' ? value.trim() : '';
  if (!projectId) throw new Error('El proyecto no tiene id');
  return projectId;
}
