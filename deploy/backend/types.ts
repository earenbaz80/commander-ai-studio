/**
 * Contrato del backend gestionado de Commander (PL3).
 *
 * Un proyecto publicado puede pedir base de datos, storage y auth sin montar
 * nada a mano. Este contrato describe el ciclo completo —aprovisionar, migrar,
 * consultar y rotar credenciales— y no conoce proveedores: eso vive en cada
 * adaptador, igual que en `deploy/types.ts`.
 *
 * Regla de secretos: el valor de una credencial sale **una sola vez**, por el
 * `sink` que pasa el llamador, para inyectarlo en el entorno de despliegue.
 * Ningún resultado del adaptador (`status`, `rotateSecrets`) transporta valores:
 * sólo nombres. El cliente nunca recibe un secreto.
 */

export const BACKEND_BINDING_KINDS = ['database', 'storage', 'auth'] as const;

export type BackendBindingKind = (typeof BACKEND_BINDING_KINDS)[number];

export function isBackendBindingKind(value: unknown): value is BackendBindingKind {
  return (
    typeof value === 'string' && (BACKEND_BINDING_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Nombres convencionales de las credenciales. Son parte del contrato para que
 * `status().secretNames` y la rotación se puedan comparar entre adaptadores; un
 * adaptador real los escribe tal cual en el entorno de la app publicada.
 */
const SECRET_NAMES: Record<BackendBindingKind, string> = {
  database: 'DATABASE_URL',
  storage: 'STORAGE_SECRET',
  auth: 'AUTH_SECRET',
};

export function backendSecretName(kind: BackendBindingKind): string {
  return SECRET_NAMES[kind];
}

export type BackendBindingState = 'ready' | 'pending' | 'failed';

/** Binding aprovisionado. `resourceId` identifica el recurso, nunca es un secreto. */
export interface BackendBindingRecord {
  kind: BackendBindingKind;
  resourceId: string;
  state: BackendBindingState;
}

/** Migración declarativa; `id` es estable y ordena la aplicación. */
export interface BackendMigration {
  id: string;
  sql: string;
}

export interface BackendProvisionInput {
  projectId: string;
  bindings: ReadonlyArray<BackendBindingKind>;
}

export interface BackendMigrateInput {
  projectId: string;
  migrations: ReadonlyArray<BackendMigration>;
}

export interface BackendMigrationFailure {
  id: string;
  message: string;
}

export interface BackendMigrationResult {
  /** Aplicadas en esta llamada, en el orden recibido. */
  applied: string[];
  /** Ya estaban aplicadas: repetir una migración no la duplica. */
  skipped: string[];
  /** Fallos por migración; un adaptador real puede aplicar el resto. */
  failed: BackendMigrationFailure[];
}

/** Destino de un secreto recién rotado: el entorno de la app, no un log. */
export interface BackendSecretSink {
  write(name: string, value: string): void;
}

export interface BackendRotateInput {
  projectId: string;
  /** Sin `kinds`, rota todos los bindings aprovisionados. */
  kinds?: ReadonlyArray<BackendBindingKind>;
  sink: BackendSecretSink;
}

export interface BackendRotation {
  provider: string;
  projectId: string;
  /** Nombres rotados; el valor ya se entregó al sink. */
  rotated: string[];
  createdAt: string;
}

export interface BackendStatus {
  provider: string;
  projectId: string;
  bindings: BackendBindingRecord[];
  migrations: { applied: string[]; pending: string[] };
  /** Sólo nombres de credenciales emitidas; nunca sus valores. */
  secretNames: string[];
  ready: boolean;
}

export interface BackendAdapter {
  readonly id: string;
  /** false cuando faltan credenciales; la UI no debe ofrecer aprovisionar. */
  readonly configured: boolean;
  provision(input: BackendProvisionInput): Promise<BackendStatus>;
  migrate(input: BackendMigrateInput): Promise<BackendMigrationResult>;
  status(projectId: string): Promise<BackendStatus>;
  rotateSecrets(input: BackendRotateInput): Promise<BackendRotation>;
}
