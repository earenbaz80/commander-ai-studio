/**
 * Gestor de API keys seguras vía cookies httpOnly.
 * Las keys nunca se almacenan en localStorage ni en el código del cliente.
 */
const API_KEYS_ENDPOINT = '/api/keys';

const KEY_CACHE: Record<string, string> = {};

/**
 * Allowlist del cliente: las keys que el panel carga y guarda por cookie.
 *
 * Espejo de `VALID_KEYS` en `apiKeys.ts` (servidor). Una lista más corta deja
 * keys del panel sin precargar; una más larga manda un POST que el servidor
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
];

export function getCachedApiKey(key: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(KEY_CACHE, key)) {
    return KEY_CACHE[key] || undefined;
  }
  try {
    const v = localStorage.getItem(key);
    if (v) {
      KEY_CACHE[key] = v;
      return v;
    }
  } catch {}
  return undefined;
}

export async function loadAllApiKeysIntoCache(): Promise<void> {
  for (const k of CLIENT_VALID_KEYS) {
    try {
      const v = await getApiKey(k);
      if (v) KEY_CACHE[k] = v;
      else if (!(k in KEY_CACHE)) KEY_CACHE[k] = '';
    } catch {
      // keep cache state
    }
  }
}

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
      KEY_CACHE[key] = value;
      try { localStorage.removeItem(key); } catch {}
      return true;
    }
    return false;
  } catch (e) {
    console.error('Error guardando API key:', e);
    return false;
  }
}

export async function getApiKey(key: string): Promise<string> {
  try {
    const res = await fetch(`${API_KEYS_ENDPOINT}/${encodeURIComponent(key)}`, {
      credentials: 'include',
    });
    const data = await res.json();
    return data.success === true ? data.value || '' : '';
  } catch (e) {
    console.error('Error leyendo API key:', e);
    return '';
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
      delete KEY_CACHE[key];
      try { localStorage.removeItem(key); } catch {}
      return true;
    }
    return false;
  } catch (e) {
    console.error('Error eliminando API key:', e);
    return false;
  }
}

export async function listApiKeys(): Promise<Record<string, boolean>> {
  try {
    const res = await fetch(API_KEYS_ENDPOINT, {
      credentials: 'include',
    });
    const data = await res.json();
    return data.success === true ? data.keys || {} : {};
  } catch (e) {
    console.error('Error listando API keys:', e);
    return {};
  }
}

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
