/**
 * Persistencia de artifacts en IndexedDB.
 *
 * Las grabaciones incluyen frames JPEG en base64 y pueden pesar varios MB, así
 * que localStorage no es una opción. Si IndexedDB no existe (tests, SSR o un
 * navegador que lo bloquea) se usa un Map en memoria para que la vista siga
 * siendo funcional durante la sesión.
 */
import type { Artifact } from './types';

const DB_NAME = 'commander-artifacts';
const STORE = 'artifacts';
const DB_VERSION = 1;

const memory = new Map<string, Artifact>();
const deletedIds = new Set<string>();
let databasePromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE)
        ? request.transaction?.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: 'id' });
      if (store && !store.indexNames.contains('projectPath')) {
        store.createIndex('projectPath', 'projectPath', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return databasePromise;
}

function runRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDatabase().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      let settled = false;
      const finish = (value: T | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const tx = db.transaction(STORE, mode);
        const request = operation(tx.objectStore(STORE));
        request.onsuccess = () => finish(request.result);
        request.onerror = () => finish(null);
        tx.onabort = () => finish(null);
        tx.onerror = () => finish(null);
      } catch {
        finish(null);
      }
    });
  });
}

export async function saveArtifact(artifact: Artifact): Promise<Artifact> {
  memory.set(artifact.id, artifact);
  deletedIds.delete(artifact.id);
  await runRequest('readwrite', (store) => store.put(artifact));
  return artifact;
}

export async function getArtifact(id: string): Promise<Artifact | null> {
  if (!id || deletedIds.has(id)) return null;
  if (memory.has(id)) return memory.get(id) ?? null;
  const stored = await runRequest<Artifact | undefined>('readonly', (store) => store.get(id));
  return stored ?? null;
}

export async function listArtifacts(projectPath = ''): Promise<Artifact[]> {
  const stored = await runRequest<Artifact[]>('readonly', (store) => store.getAll());
  const byId = new Map<string, Artifact>();
  for (const artifact of stored ?? []) {
    if (!deletedIds.has(artifact.id)) byId.set(artifact.id, artifact);
  }
  // La copia en memoria es la más reciente: una edición de comentarios no debe
  // quedar tapada por una lectura que aún vea la versión anterior.
  for (const [id, artifact] of memory) {
    if (!deletedIds.has(id)) byId.set(id, artifact);
  }
  return [...byId.values()]
    .filter((artifact) => !projectPath || artifact.projectPath === projectPath)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateArtifact(
  id: string,
  update: (artifact: Artifact) => Artifact
): Promise<Artifact | null> {
  const current = await getArtifact(id);
  if (!current) return null;
  return saveArtifact(update(current));
}

export async function deleteArtifact(id: string): Promise<void> {
  memory.delete(id);
  deletedIds.add(id);
  await runRequest('readwrite', (store) => store.delete(id));
}

/** Limpieza explícita para tests y para un futuro "borrar todo". */
export async function clearArtifacts(): Promise<void> {
  memory.clear();
  deletedIds.clear();
  await runRequest('readwrite', (store) => store.clear());
}
