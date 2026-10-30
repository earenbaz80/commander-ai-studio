import type { Request, Response } from 'express';
import { FREEBUFF_DEFAULT_MODEL } from './src/config/freebuffModels';
import { getApiKey } from './apiKeys';

/**
 * Proxy de Freebuff: `/api/freebuff/generate`.
 *
 * Freebuff expone un endpoint OpenAI-compatible con su propio catálogo de
 * modelos (`GET /api/v1/paid/models`, 280 ids). Su clave es la del panel de
 * cuenta (Account → Developer API), no la de Gemini ni la de OpenAI, así que
 * tiene variable propia: compartir CUSTOM_API_KEY haría que apuntar «custom» a
 * otro sitio rompiera Freebuff en silencio.
 *
 * Vive aquí y no en `server.ts` siguiendo el mismo molde que `gemini.ts`: el
 * handler se prueba sin levantar el server, con `req`/`res` falsos y `fetch`
 * stubbeado (ver `tests/freebuff.test.ts`). Los fallos que importan —una clave
 * ausente, un tool_call mal formado, un error del proveedor— no necesitan la
 * red para reproducirse.
 */

export const FREEBUFF_DEFAULT_BASE = 'https://freebuff.com/api/v1/paid';

/** Mensaje único para cuando falta la clave del proveedor. */
export const FREEBUFF_KEY_REQUIRED =
  'FREEBUFF_API_KEY requerida: se obtiene en Freebuff → Account → Developer API';

/**
 * Clave efectiva: cuerpo → panel (cookie) → `FREEBUFF_API_KEY` → `OPENAI_API_KEY`.
 *
 * El panel es el que guarda la clave con `POST /api/keys`; sin este escalón la
 * clave quedaba en la cookie y el proxy sólo la veía si el cliente además la
 * repetía en el cuerpo. El último escalón existe porque Freebuff es
 * OpenAI-compatible y una cuenta que ya tenía su clave de OpenAI a mano puede
 * reutilizarla. No es al revés a propósito: si sobra la de OpenAI, Freebuff
 * tiene que seguir usando la suya.
 */
export function resolveFreebuffKey(fromRequest: unknown, fromPanel?: unknown): string {
  if (fromRequest) return String(fromRequest);
  if (fromPanel) return String(fromPanel);
  return process.env.FREEBUFF_API_KEY || process.env.OPENAI_API_KEY || '';
}

/** `arguments` llega como string JSON; un modelo descuidado lo manda ya objeto. */
function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleFreebuffGenerate(req: Request, res: Response) {
  try {
    const {
      prompt,
      contents,
      model,
      systemInstruction = '',
      temperature = 0.7,
      maxTokens = 2048,
      tools,
      apiKey,
      baseURL,
    } = req.body || {};

    const key = resolveFreebuffKey(apiKey, getApiKey(req, 'FREEBUFF_API_KEY'));
    if (!key) {
      return res.json({ success: false, error: FREEBUFF_KEY_REQUIRED });
    }

    // La base sigue el mismo orden que la clave: cuerpo → panel → entorno → default.
    const base = String(
      baseURL || getApiKey(req, 'FREEBUFF_BASE_URL') || process.env.FREEBUFF_BASE_URL || FREEBUFF_DEFAULT_BASE
    ).replace(/\/+$/, '');
    const wanted = String(model || FREEBUFF_DEFAULT_MODEL).replace(/^freebuff\//, '');
    const userText = String(prompt ?? contents ?? '');

    const body: Record<string, unknown> = {
      model: wanted,
      messages: [
        ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
        { role: 'user', content: userText },
      ],
      temperature,
      max_tokens: maxTokens,
    };
    if (Array.isArray(tools) && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => ({} as any));
      const message = detail?.error?.message || detail?.error || `Freebuff HTTP ${response.status}`;
      return res.json({ success: false, error: String(message), status: response.status });
    }

    const data: any = await response.json();
    const message = data?.choices?.[0]?.message || {};
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls
          .map((tc: any) => ({
            id: tc?.id,
            name: tc?.function?.name,
            args: parseToolArgs(tc?.function?.arguments),
          }))
          .filter((tc: any) => typeof tc.name === 'string' && tc.name)
      : [];

    return res.json({
      success: true,
      text: typeof message.content === 'string' ? message.content : '',
      toolCalls,
      // Quién contestó de verdad, como en Gemini: el agente lo deja como paso.
      model: data?.model || wanted,
      metrics: {
        promptTokens: data?.usage?.prompt_tokens || 0,
        responseTokens: data?.usage?.completion_tokens || 0,
        totalTokens: data?.usage?.total_tokens || 0,
        latencyMs: 0,
      },
    });
  } catch (error: any) {
    return res.json({ success: false, error: error?.message || 'Freebuff generate falló' });
  }
}
