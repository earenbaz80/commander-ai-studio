/**
 * Contrato de despliegue de Commander.
 *
 * Una release local es inmutable; este contrato describe cómo un adaptador
 * remoto la publica, la promueve y la vuelve a un deployment anterior. No
 * conoce proveedores ni credenciales: eso vive en cada adaptador.
 */

export type DeployEnvironment = 'preview' | 'production';

export type ProjectKind = 'static' | 'spa' | 'worker' | 'ssr' | 'unknown';

export type DeploymentState = 'queued' | 'building' | 'ready' | 'failed' | 'unknown';

export type DeployBinding = 'database' | 'storage' | 'auth' | 'realtime';

/** Manifiesto opcional que un proyecto puede dejar en `commander.app.json`. */
export interface CommanderAppManifest {
  version?: 1;
  kind?: ProjectKind;
  build?: {
    command?: string;
    outputDir?: string;
  };
  publicEnv?: string[];
  bindings?: Partial<Record<DeployBinding, boolean>>;
}

export interface ProjectDescriptor {
  /** Identificador estable del proyecto para el adaptador. */
  id: string;
  root: string;
  name: string;
  kind: ProjectKind;
  buildScript: boolean;
  outputDir: string | null;
  manifest: CommanderAppManifest | null;
}

/** Referencia a una release ya creada por `publisher.ts`. */
export interface ReleaseDescriptor {
  id: string;
  dir: string;
  fileCount: number;
  bytes: number;
}

export interface DeployInput {
  project: ProjectDescriptor;
  release: ReleaseDescriptor;
  environment: DeployEnvironment;
}

export interface PreflightInput {
  project: ProjectDescriptor;
  release: ReleaseDescriptor;
}

export type PreflightIssueCode =
  | 'symlink'
  | 'limit'
  | 'forbidden'
  | 'source-map'
  | 'secret'
  | 'unreadable';

export interface PreflightIssue {
  file: string;
  code: PreflightIssueCode;
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  fileCount: number;
  bytes: number;
  issues: PreflightIssue[];
}

export interface PromoteInput {
  project: ProjectDescriptor;
  deploymentId: string;
  environment: DeployEnvironment;
}

export interface DeploymentRecord {
  id: string;
  releaseId: string;
  /** Entorno en el que se creó el deployment; el puntero actual manda. */
  environment: DeployEnvironment;
  url: string;
  createdAt: string;
  status: DeploymentState;
  provider: string;
}

export interface DeploymentStatus {
  provider: string;
  projectId: string;
  preview: DeploymentRecord | null;
  production: DeploymentRecord | null;
  canRollback: boolean;
  deployments: DeploymentRecord[];
}

/** Bloque remoto que `publisher.ts` conserva junto al estado local. */
export interface RemoteDeploymentState {
  provider: string;
  preview: string | null;
  production: string | null;
  productionHistory: string[];
  deployments: DeploymentRecord[];
}

export interface DeploymentAdapter {
  readonly id: string;
  /** false cuando faltan credenciales; la UI no debe ofrecer un deploy. */
  readonly configured: boolean;
  detectProject(root: string): Promise<ProjectDescriptor>;
  preflight(input: PreflightInput): Promise<PreflightResult>;
  deploy(input: DeployInput): Promise<DeploymentRecord>;
  promote(input: PromoteInput): Promise<DeploymentRecord>;
  rollback(project: ProjectDescriptor): Promise<DeploymentRecord>;
  status(project: ProjectDescriptor): Promise<DeploymentStatus>;
  logs(deploymentId: string): Promise<string>;
}
