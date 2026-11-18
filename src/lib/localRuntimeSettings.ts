/**
 * Persistencia de los ajustes del runtime nativo de llama.cpp.
 *
 * Vive en `.commander/local-runtime.json` (ignorado por git), igual que
 * `permissions.json`. Los valores se sanean al leer: una entrada vieja o
 * corrupta no debe impedir arrancar el modelo, sólo perder el ajuste inválido.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  KV_CACHE_TYPES,
  QUANTIZED_KV_TYPES,
  normalizeLocalRuntimeTuning,
  type LocalRuntimeTuning,
} from './localLlamaRuntime';

/** Permite aislar tests y despliegues del `.commander` del proyecto. */
export const LOCAL_RUNTIME_SETTINGS_ENV = 'COMMANDER_LOCAL_RUNTIME_SETTINGS';

const SETTINGS_DIR = '.commander';
const SETTINGS_FILE = 'local-runtime.json';

export function localRuntimeSettingsPath(root = process.cwd()): string {
  const override = process.env[LOCAL_RUNTIME_SETTINGS_ENV]?.trim();
  if (override) return path.resolve(override);
  return path.join(root, SETTINGS_DIR, SETTINGS_FILE);
}

const TENSOR_SPLIT_RE = /^\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?){0,15}$/;

/**
 * Deja sólo los ajustes conocidos y válidos. Los que fallan se descartan en
 * silencio: es preferible arrancar con los valores por defecto de ese campo que
 * rechazar todo el archivo.
 */
export function sanitizeLocalRuntimeTuning(raw: unknown): LocalRuntimeTuning {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const tuning: LocalRuntimeTuning = {};
  if (typeof record.jinja === 'boolean') tuning.jinja = record.jinja;
  const reuse = record.cacheReuse;
  if (typeof reuse === 'number' && Number.isFinite(reuse) && reuse >= 0 && reuse <= 8192) {
    tuning.cacheReuse = Math.round(reuse);
  }
  if (typeof record.flashAttention === 'boolean') tuning.flashAttention = record.flashAttention;

  const moe = Number(record.cpuMoeLayers);
  if (Number.isFinite(moe) && moe > 0 && moe <= 999) tuning.cpuMoeLayers = Math.round(moe);

  const cacheType = (value: unknown): string | undefined => {
    const type = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return (KV_CACHE_TYPES as readonly string[]).includes(type) ? type : undefined;
  };
  const cacheTypeK = cacheType(record.cacheTypeK);
  const cacheTypeV = cacheType(record.cacheTypeV);
  const tensorSplit = typeof record.tensorSplit === 'string' ? record.tensorSplit.trim() : '';
  if (tensorSplit && TENSOR_SPLIT_RE.test(tensorSplit)) tuning.tensorSplit = tensorSplit;

  // llama.cpp rechaza la caché KV cuantizada sin flash-attn: si el archivo trae
  // esa combinación, se conserva el ajuste de atención y se sueltan los tipos.
  const quantized = [cacheTypeK, cacheTypeV].some(
    (type) => !!type && QUANTIZED_KV_TYPES.has(type)
  );
  if (!quantized || tuning.flashAttention !== false) {
    if (cacheTypeK) tuning.cacheTypeK = cacheTypeK;
    if (cacheTypeV) tuning.cacheTypeV = cacheTypeV;
  }
  return tuning;
}

export function readLocalRuntimeTuning(root = process.cwd()): LocalRuntimeTuning {
  try {
    const raw = fs.readFileSync(localRuntimeSettingsPath(root), 'utf8');
    return sanitizeLocalRuntimeTuning(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * Guarda los ajustes normalizados y devuelve lo que quedó persistido. Un fallo
 * de escritura no rompe el arranque: el ajuste sigue vivo en memoria.
 */
export function writeLocalRuntimeTuning(
  tuning: LocalRuntimeTuning,
  root = process.cwd()
): LocalRuntimeTuning {
  const persisted: LocalRuntimeTuning = normalizeLocalRuntimeTuning(
    sanitizeLocalRuntimeTuning(tuning)
  );
  try {
    const file = localRuntimeSettingsPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    /* sin permisos de escritura: el ajuste vive hasta que se cierre el proceso */
  }
  return persisted;
}
