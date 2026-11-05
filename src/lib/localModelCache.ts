/**
 * Caché en disco de los modelos detectados en servidores locales.
 *
 * LM Studio y Ollama sólo listan modelos mientras están arrancados. Eso hacía
 * que, al apagar el equipo de casa o cerrar LM Studio, el selector del chat
 * perdiera los modelos ya detectados. OpenCode conserva esa lista: aquí se
 * guarda por proveedor y por host (el LM Studio remoto y el local son claves
 * distintas) y se usa cuando la sonda en vivo no responde.
 *
 * Sólo se guardan ids de modelo, nunca claves ni configuración.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export type LocalModelsProvider = 'lmstudio' | 'ollama';

export interface LocalModelsEntry {
  models: string[];
  /** ISO de la última detección que trajo modelos. */
  updatedAt: string;
}

export interface CachedLocalModels {
  models: string[];
  /** Host del que salieron, si se pidió uno concreto. */
  host?: string;
  updatedAt?: string;
  /** Hosts con lista guardada, del más reciente al más antiguo. */
  hosts: string[];
}

type CacheFile = Partial<Record<LocalModelsProvider, Record<string, LocalModelsEntry>>>;

/**
 * Archivo de la caché. `COMMANDER_LOCAL_MODELS_CACHE` permite aislarla en
 * tests; por defecto vive junto a la config global del usuario, fuera del
 * proyecto, para no ensuciar el repositorio.
 */
export function localModelsCachePath(): string {
  const override = process.env.COMMANDER_LOCAL_MODELS_CACHE;
  if (override && override.trim()) return path.resolve(override.trim());
  // `os.homedir()` resuelve bien en Windows aunque el proceso venga de Git
  // Bash (donde `HOME` es `/c/Users/...` y no una ruta de unidad válida).
  const home = os.homedir() || process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.config', 'commander', 'local-models.json');
}

/** Clave estable del host: sin barras finales, que no cambian de servidor. */
export function localModelsHostKey(host: string): string {
  return String(host || '').trim().replace(/\/+$/, '');
}

function readCacheFile(): CacheFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(localModelsCachePath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as CacheFile) : {};
  } catch {
    // Sin archivo (lo normal la primera vez) o corrupto: se empieza vacío.
    return {};
  }
}

function writeCacheFile(data: CacheFile): void {
  try {
    const file = localModelsCachePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch {
    // La caché es una comodidad: si el disco no deja escribir, la app sigue.
  }
}

function cleanModels(models: string[]): string[] {
  return [...new Set(models.map((id) => String(id || '').trim()).filter(Boolean))];
}

/**
 * Guarda la lista detectada de un host. Una respuesta vacía no borra lo
 * anterior: significa «no hay nada cargado ahora», no que se hayan desinstalado
 * los modelos. Devuelve `false` si no había nada que guardar.
 */
export function rememberLocalModels(
  provider: LocalModelsProvider,
  host: string,
  models: string[]
): boolean {
  const key = localModelsHostKey(host);
  const ids = cleanModels(models);
  if (!key || ids.length === 0) return false;

  const data = readCacheFile();
  data[provider] = {
    ...(data[provider] || {}),
    [key]: { models: ids, updatedAt: new Date().toISOString() },
  };
  writeCacheFile(data);
  return true;
}

/**
 * Modelos guardados. Con `host` devuelve sólo los de ese servidor; sin él,
 * une los de todos los hosts conocidos (remoto y local) empezando por el más
 * reciente, que es lo que necesita `/api/models/live` cuando nada responde.
 */
export function cachedLocalModels(provider: LocalModelsProvider, host?: string): CachedLocalModels {
  const entries = readCacheFile()[provider] || {};
  const hosts = Object.keys(entries).sort((a, b) =>
    String(entries[b]?.updatedAt || '').localeCompare(String(entries[a]?.updatedAt || ''))
  );

  if (host !== undefined) {
    const key = localModelsHostKey(host);
    const entry = entries[key];
    return {
      models: cleanModels(Array.isArray(entry?.models) ? entry.models : []),
      host: key || undefined,
      updatedAt: entry?.updatedAt,
      hosts: entry ? [key] : [],
    };
  }

  const models: string[] = [];
  let updatedAt: string | undefined;
  for (const key of hosts) {
    const entry = entries[key];
    if (!updatedAt && entry?.updatedAt) updatedAt = entry.updatedAt;
    if (Array.isArray(entry?.models)) models.push(...entry.models);
  }

  return { models: cleanModels(models), updatedAt, hosts };
}

/** Borra la caché. Sólo para tests y diagnósticos. */
export function resetLocalModelsCache(): void {
  try {
    fs.rmSync(localModelsCachePath(), { force: true });
  } catch {
    /* sin archivo */
  }
}
