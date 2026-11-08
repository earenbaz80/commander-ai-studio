/**
 * Gestor de API keys del cliente: sólo sabe si cada clave está configurada.
 *
 * El valor vive en una cookie httpOnly y el servidor no lo devuelve nunca, así
 * que el navegador no puede leerlo ni cachearlo. Lo que sí se cachea es el
 * booleano de `GET /api/keys` para que la UI pinte el estado sin una petición
 * por render.
 */
import { isApiKeyConfigured, setApiKeyConfigured } from './apiKeyFlags';

export { isApiKeyConfigured };

/**
 * Compatibilidad temporal para llamadas que todavía no se migraron.
 * No lee localStorage ni devuelve valores: el servidor resuelve la cookie.
 * @deprecated Usa `isApiKeyConfigured` o deja que el servidor lea la cookie.
 */
export function getCachedApiKey(_key: string): string | undefined {
  return undefined;
}

const API_KEYS_ENDPOINT = '/api/keys';

/**
 * Allowlist del cliente: las keys que el panel guarda y cuyo estado consulta.
 *
 * Espejo de `VALID_KEYS` en `apiKeys.ts` (servidor). Una lista más corta deja
 * keys del panel sin estado; una más larga manda un POST que el servidor
 * rechaza con 400. `tests/apiKeys.test.ts` comprueba que no divergen.
 */
export const CLIENT_VALID_KEYS: readonly string[] = [
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'XAI_API_KEY',
  'HF_API_TOKEN',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'NVIDIA_API_KEY',
  'OPENCODE_API_KEY',
  'FREEBUFF_API_KEY',
  'FREEBUFF_BASE_URL',
  'CUSTOM_API_KEY',
  'CUSTOM_BASE_URL',
  'CUSTOM_MODEL',
  'OLLAMA_HOST',
  'LMSTUDIO_HOST',
  'GITHUB_TOKEN',
];

/** Refresca el estado de todas las claves con una sola petición. */
export async function loadAllApiKeysIntoCache(): Promise<void> {
  const keys = await listApiKeys();
  for (const key of CLIENT_VALID_KEYS) {
    setApiKeyConfigured(key, keys[key] === true);
  }
}

/** Guarda la clave en la cookie httpOnly del servidor. El valor no se cachea. */
export async function saveApiKey(key: string, value: string): Promise<boolean> {
  try {
    const res = await fetch(API_KEYS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
      credentials: 'include',
    });
    const data = await res.json();
    if (data.success === true) {
      setApiKeyConfigured(key, value.trim().length > 0);
      try { localStorage.removeItem(key); } catch {}
      return true;
    }
    return false;
  } catch (e) {
    console.error('Error guardando API key:', e);
    return false;
  }
}

/**
 * Pregunta al servidor si la clave está configurada. Devuelve sólo el booleano:
 * el endpoint no expone el valor.
 */
export async function checkApiKeyConfigured(key: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_KEYS_ENDPOINT}/${encodeURIComponent(key)}`, {
      credentials: 'include',
    });
    const data = await res.json();
    const configured = data.success === true && data.configured === true;
    setApiKeyConfigured(key, configured);
    return configured;
  } catch (e) {
    console.error('Error leyendo estado de API key:', e);
    return false;
  }
}

export async function deleteApiKey(key: string): Promise<boolean> {
  try {
    const res = await fetch(API_KEYS_ENDPOINT, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      credentials: 'include',
    });
    const data = await res.json();
    if (data.success === true) {
      setApiKeyConfigured(key, false);
      try { localStorage.removeItem(key); } catch {}
      return true;
    }
    return false;
  } catch (e) {
    console.error('Error eliminando API key:', e);
    return false;
  }
}

/** Estado de todas las claves según el servidor (nunca incluye valores). */
export async function listApiKeys(): Promise<Record<string, boolean>> {
  try {
    const res = await fetch(API_KEYS_ENDPOINT, {
      credentials: 'include',
    });
    const data = await res.json();
    if (data.success !== true || !data.keys) return {};
    for (const [key, configured] of Object.entries(data.keys)) {
      setApiKeyConfigured(key, configured === true);
    }
    return data.keys || {};
  } catch (e) {
    console.error('Error listando API keys:', e);
    return {};
  }
}

/**
 * Migra las claves que quedaron en localStorage a cookies httpOnly.
 * Sólo escribe: los valores no vuelven al cliente después.
 */
export async function migrateLegacyKeys(): Promise<void> {
  const legacyKeys = [
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
    'XAI_API_KEY',
    'HF_API_TOKEN',
    'OPENROUTER_API_KEY',
    'OPENCODE_API_KEY',
    'CUSTOM_API_KEY',
    'CUSTOM_BASE_URL',
    'CUSTOM_MODEL',
    'OLLAMA_HOST',
  ];

  for (const key of legacyKeys) {
    try {
      const value = localStorage.getItem(key);
      if (value) {
        const success = await saveApiKey(key, value);
        if (success) {
          console.log(`API key ${key} migrada a cookie httpOnly`);
        }
      }
    } catch (e) {
      console.warn(`No se pudo migrar ${key}:`, e);
    }
  }
}
