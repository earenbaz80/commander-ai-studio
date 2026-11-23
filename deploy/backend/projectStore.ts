/**
 * Persistencia del estado de un proyecto gestionado (PL3).
 *
 * Sin esto el `ref` del proyecto de Supabase vivía sólo en memoria: tras
 * reiniciar Commander, `status` y `rotateSecrets` respondían «sin
 * aprovisionar» aunque el proyecto y el bucket siguieran existiendo. Aquí se
 * guardan el nombre estable, el `ref`, los bindings aprovisionados, las
 * migraciones declaradas y los **nombres** de credenciales emitidas. Ningún
 * valor de credencial llega a este archivo.
 *
 * Un archivo por proyecto —el id puede ser una ruta, así que se usa su hash— y
 * escritura atómica. La ruta base se puede aislar con
 * `COMMANDER_BACKEND_STATE_DIR`; por defecto `.commander/backend`, como el
 * resto del estado local.
 */
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isBackendBindingKind } from './types';
import type { BackendBindingRecord, BackendBindingState } from './types';

const VERSION = 1;

/** Forma persistida; sólo nombres e identificadores, nunca secretos. */
export interface BackendProjectStateRecord {
  projectId: string;
  /** Nombre estable del proyecto en el proveedor. */
  name: string;
  /** `ref` del proyecto; vacío sólo si el proveedor aún no respondió. */
  ref: string;
  bindings: BackendBindingRecord[];
  /** Migraciones declaradas por el llamador, aplicadas o no. */
  declared: string[];
  secretNames: string[];
}

export interface BackendProjectStore {
  read(projectId: string): Promise<BackendProjectStateRecord | null>;
  write(projectId: string, state: BackendProjectStateRecord): Promise<void>;
}

export function backendStateDir(): string {
  return path.resolve(
    process.env.COMMANDER_BACKEND_STATE_DIR || path.join(process.cwd(), '.commander', 'backend')
  );
}

export class FileBackendProjectStore implements BackendProjectStore {
  constructor(private readonly dir?: string) {}

  async read(projectId: string): Promise<BackendProjectStateRecord | null> {
    const file = this.fileFor(projectId);
    let raw: string;
    try {
      raw = await fsp.readFile(file, 'utf8');
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('El estado del backend gestionado está corrupto');
    }
    const record = normalizeRecord(parsed, projectId);
    if (!record) throw new Error('El estado del backend gestionado está corrupto');
    return record;
  }

  async write(projectId: string, state: BackendProjectStateRecord): Promise<void> {
    const file = this.fileFor(projectId);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    // Sólo se escribe la forma conocida: nada de campos que un día lleven un valor.
    const payload = {
      version: VERSION,
      projectId,
      name: state.name,
      ref: state.ref,
      bindings: state.bindings.map((binding) => ({
        kind: binding.kind,
        resourceId: binding.resourceId,
        state: binding.state,
      })),
      declared: [...state.declared],
      secretNames: [...state.secretNames],
    };
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, file);
  }

  private fileFor(projectId: string): string {
    const dir = this.dir ?? backendStateDir();
    const hash = createHash('sha256').update(projectId).digest('hex').slice(0, 32);
    return path.join(dir, 'projects', `${hash}.json`);
  }
}

function normalizeRecord(value: unknown, projectId: string): BackendProjectStateRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as any;
  if (raw.version !== VERSION) return null;
  // El hash no es una clave criptográfica de seguridad: se comprueba el id para
  // no atribuir a un proyecto el estado de otro por una colisión o un archivo
  // copiado a mano.
  if (raw.projectId !== projectId) return null;
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  if (typeof raw.ref !== 'string') return null;
  if (!Array.isArray(raw.bindings) || !Array.isArray(raw.declared) || !Array.isArray(raw.secretNames)) {
    return null;
  }
  if (!isStringArray(raw.declared) || !isStringArray(raw.secretNames)) return null;

  const bindings: BackendBindingRecord[] = [];
  const seen = new Set<string>();
  for (const entry of raw.bindings) {
    if (!entry || typeof entry !== 'object') return null;
    if (!isBackendBindingKind(entry.kind)) return null;
    if (typeof entry.resourceId !== 'string' || !entry.resourceId) return null;
    if (!isBindingState(entry.state)) return null;
    if (seen.has(entry.kind)) return null;
    seen.add(entry.kind);
    bindings.push({ kind: entry.kind, resourceId: entry.resourceId, state: entry.state });
  }

  return {
    projectId,
    name: raw.name,
    ref: raw.ref,
    bindings,
    declared: [...raw.declared],
    secretNames: [...raw.secretNames],
  };
}

function isStringArray(value: unknown[]): value is string[] {
  return value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function isBindingState(value: unknown): value is BackendBindingState {
  return value === 'ready' || value === 'pending' || value === 'failed';
}
