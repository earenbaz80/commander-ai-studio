import type { Request, Response } from 'express';
import crypto from 'crypto';

const COOKIE_PREFIX = 'ai_studio_';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 días

/**
 * Allowlist del servidor: lo único que `/api/keys` acepta guardar, leer o borrar.
 * Tiene que ser la misma que `CLIENT_VALID_KEYS` en `src/lib/apiKeys.ts`: si una
 * key sólo existe aquí, el panel no la pide; si sólo existe allí, se guarda una
 * cookie que ningún handler lee. `tests/apiKeys.test.ts` las cruza.
 */
export const VALID_KEYS: ReadonlySet<string> = new Set([
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
]);

function sanitizeValue(value: string): string {
  return value.slice(0, 4096).replace(/[\r\n]/g, '');
}

export function handleApiKeySet(req: Request, res: Response) {
  try {
    const { key, value } = req.body || {};
    if (!key || typeof key !== 'string' || !VALID_KEYS.has(key)) {
      return res.status(400).json({ success: false, error: 'Key inválida' });
    }
    if (value === undefined || value === null) {
      return res.status(400).json({ success: false, error: 'Valor requerido' });
    }
    const cleanValue = sanitizeValue(String(value));

    // Generar token CSRF simple basado en la sesión
    const token = crypto.randomBytes(16).toString('hex');

    res.cookie(`${COOKIE_PREFIX}${key}`, cleanValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });
    res.cookie(`${COOKIE_PREFIX}token`, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });

    return res.json({ success: true, message: 'API key guardada de forma segura' });
  } catch (error: any) {
    console.error('Error guardando API key:', error);
    return res.status(500).json({ success: false, error: 'Error guardando API key' });
  }
}

export function handleApiKeyGet(req: Request, res: Response) {
  try {
    // La ruta es `GET /api/keys/:key` (param), pero el cliente puede mandarla
    // también como `?key=`: aceptar ambas evita el 400 que dejaba la key vacía.
    const key = String(req.params?.key ?? req.query?.key ?? '');
    if (!key || !VALID_KEYS.has(key)) {
      return res.status(400).json({ success: false, error: 'Key inválida' });
    }
    // Sólo se informa de la presencia: el valor vive en la cookie httpOnly y
    // no sale nunca del servidor. Cualquier JS del origen que llamara a este
    // endpoint se llevaba todas las claves en claro.
    const cookies = (req as any).cookies || {};
    const configured = !!cookies[`${COOKIE_PREFIX}${key}`];
    return res.json({ success: true, key, configured });
  } catch (error: any) {
    console.error('Error leyendo estado de API key:', error);
    return res.status(500).json({ success: false, error: 'Error leyendo estado de API key' });
  }
}

export function handleApiKeyDelete(req: Request, res: Response) {
  try {
    const { key } = req.body || {};
    if (!key || typeof key !== 'string' || !VALID_KEYS.has(key)) {
      return res.status(400).json({ success: false, error: 'Key inválida' });
    }
    res.clearCookie(`${COOKIE_PREFIX}${key}`, { path: '/' });
    return res.json({ success: true, message: 'API key eliminada' });
  } catch (error: any) {
    console.error('Error eliminando API key:', error);
    return res.status(500).json({ success: false, error: 'Error eliminando API key' });
  }
}

export function handleApiKeysList(req: Request, res: Response) {
  try {
    const cookies = (req as any).cookies || {};
    const keys: Record<string, boolean> = {};
    for (const key of VALID_KEYS) {
      keys[key] = !!cookies[`${COOKIE_PREFIX}${key}`];
    }
    return res.json({ success: true, keys });
  } catch (error: any) {
    console.error('Error listando API keys:', error);
    return res.status(500).json({ success: false, error: 'Error listando API keys' });
  }
}

// Middleware para inyectar API keys en las requests
export function apiKeyMiddleware(req: Request, _res: Response, next: Function) {
  const cookies = (req as any).cookies || {};
  (req as any).apiKeys = {};
  for (const key of VALID_KEYS) {
    const value = cookies[`${COOKIE_PREFIX}${key}`];
    if (value) {
      (req as any).apiKeys[key] = value;
    }
  }
  next();
}

// Helper para obtener API key de la request
export function getApiKey(req: Request, key: string): string | undefined {
  return (req as any).apiKeys?.[key];
}
