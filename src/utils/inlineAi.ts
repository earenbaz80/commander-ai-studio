/**
 * IA del editor (P0 #2): autocompletado tipo ghost-text y edición inline (Cmd+K).
 *
 * Solo texto → texto: reutiliza las MISMAS rutas de proveedor que el agente
 * (`/api/<provider>/generate`), así hereda el enrutado del P0 #1 sin tocar el
 * servidor. Nunca inventa claves: si falta la API key o el proveedor está caído,
 * devuelve `{ ok:false, error }` legible para que la UI lo muestre tal cual.
 */

import { clientCredentialsFor, resolveEndpoint } from '../lib/aiProviders';
import { GEMINI_DEFAULT_MODEL } from '../config/geminiModels';

/** Clave donde la app guarda el modelo activo (la escribe App.tsx). */
export const SELECTED_MODEL_KEY = 'ai_studio_selected_model';
/** Fallback si no hay modelo elegido: el mismo modelo por defecto de la app. */
export const DEFAULT_INLINE_MODEL = GEMINI_DEFAULT_MODEL;

/** Clave de localStorage que habilita el ghost-text del editor (apagado por defecto). */
export const AI_ENABLED_KEY = 'commander_editor_ai_enabled';

/** Prefijo de contexto antes del cursor (caracteres que se envían). */
export const PREFIX_CHARS = 4000;
/** Sufijo de contexto después del cursor. */
export const SUFFIX_CHARS = 800;
/** Pausa mínima entre dos peticiones de autocompletado. */
export const GHOST_DEBOUNCE_MS = 400;

export interface InlinePrompt {
  system: string;
  user: string;
}

export interface InlineResult {
  ok: boolean;
  text: string;
  error?: string;
}

export interface InlineCompletionRequest {
  /** Texto antes del cursor. */
  prefix: string;
  /** Texto después del cursor. */
  suffix?: string;
  filename?: string;
  /** Extensión del archivo (ts, py…). */
  language?: string;
  model?: string;
  signal?: AbortSignal;
}

export interface InlineEditRequest {
  /** Instrucción natural del usuario ("hazlo async", "añade try/catch"…). */
  instruction: string;
  /** Fragmento seleccionado (o líneas) que se va a reemplazar. */
  code: string;
  prefix?: string;
  suffix?: string;
  filename?: string;
  language?: string;
  model?: string;
  signal?: AbortSignal;
}

/** Lee la clave del proveedor del navegador (si no hay almacenamiento, undefined). */
function readSetting(key: string): string | undefined {
  try {
    return localStorage.getItem(key) || undefined;
  } catch {
    return undefined;
  }
}

/** Modelo activo de la app (App.tsx lo sincroniza en localStorage). */
export function getActiveModel(): string {
  try {
    return localStorage.getItem(SELECTED_MODEL_KEY) || DEFAULT_INLINE_MODEL;
  } catch {
    return DEFAULT_INLINE_MODEL;
  }
}

/** Ruta del servidor para un modelo. Delega en la fuente única de verdad. */
export function routeForModel(model: string): string {
  return resolveEndpoint(model);
}

/** Acorta un prefijo largo conservando el FINAL (lo más cercano al cursor). */
function tail(text: string | undefined, max: number): string {
  const s = text ?? '';
  return s.length > max ? s.slice(s.length - max) : s;
}

/** Acorta un sufijo largo conservando el INICIO. */
function head(text: string | undefined, max: number): string {
  const s = text ?? '';
  return s.length > max ? s.slice(0, max) : s;
}

function fileLabel(filename?: string, language?: string): string {
  const parts: string[] = [];
  if (filename) parts.push(`ARCHIVO: ${filename}`);
  if (language) parts.push(`LENGUAJE: ${language}`);
  return parts.length ? `${parts.join(' · ')}\n` : '';
}

/** Prompt de autocompletado: continúa el código en el cursor. */
export function buildCompletePrompt(req: InlineCompletionRequest): InlinePrompt {
  const system =
    'Eres un autocompletador de código incrustado en un editor. Continúa el código justo en la posición del cursor. ' +
    'Responde SOLO con el texto literal a insertar: sin explicaciones, sin markdown, sin bloques de código, ' +
    'sin repetir lo que ya existe y respetando la indentación y el estilo del archivo. ' +
    'Si no hay una continuación útil, responde con una cadena vacía.';

  const user =
    `${fileLabel(req.filename, req.language)}` +
    `El marcador <<CURSOR>> indica la posición exacta del cursor.\n\n` +
    `${tail(req.prefix, PREFIX_CHARS)}\n` +
    `<<CURSOR>>\n` +
    `${head(req.suffix, SUFFIX_CHARS)}`;

  return { system, user };
}

/** Prompt de edición: reemplaza `code` aplicando la instrucción. */
export function buildEditPrompt(req: InlineEditRequest): InlinePrompt {
  const system =
    'Eres un asistente de edición de código dentro de un editor. Aplicas instrucciones sobre el fragmento seleccionado. ' +
    'Responde SOLO con el código resultante del fragmento: sin explicaciones, sin markdown, sin bloques de código ' +
    'envolventes. Conserva la indentación, el estilo y el lenguaje del archivo. ' +
    'Si la instrucción no exige cambios, devuelve el fragmento original tal cual.';

  const user =
    `${fileLabel(req.filename, req.language)}` +
    `INSTRUCCIÓN DEL USUARIO: ${req.instruction.trim()}\n\n` +
    `CONTEXTO ANTES DEL FRAGMENTO:\n${head(req.prefix, 1500) || '(ninguno)'}\n\n` +
    `FRAGMENTO A REEMPLAZAR:\n${req.code}\n\n` +
    `CONTEXTO DESPUÉS DEL FRAGMENTO:\n${head(req.suffix, 300) || '(ninguno)'}`;

  return { system, user };
}

/** Quita un posible bloque ```envolvente sin tocar la indentación interna. */
export function stripCodeFences(raw: string): string {
  const text = raw ?? '';
  const fenced = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);
  if (fenced) return fenced[1];
  return text.replace(/^\s*```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
}

/** Si la sugerencia repite el final del prefijo (el modelo re-ecoó), lo recorta. */
export function stripPrefixOverlap(prefix: string, completion: string): string {
  if (!completion) return '';
  const max = Math.min(prefix.length, completion.length, 240);
  for (let len = max; len > 0; len--) {
    if (prefix.endsWith(completion.slice(0, len))) return completion.slice(len);
  }
  return completion;
}

/**
 * Normaliza la respuesta a una sugerencia inline de UNA sola línea
 * (el ghost-text se renderiza en la misma línea que el cursor).
 */
export function cleanCompletion(prefix: string, raw: string): string {
  let text = stripCodeFences(raw);
  text = text.replace(/\r/g, '');
  text = stripPrefixOverlap(prefix, text);
  // Descartar líneas vacías iniciales; conservar la indentación de la 1ª útil.
  text = text.replace(/^\s*\n+/, '');
  const nl = text.indexOf('\n');
  if (nl >= 0) text = text.slice(0, nl);
  if (!text.trim()) return '';
  return text;
}

/** Normaliza la respuesta de una edición (fragmento completo, sin fences). */
export function cleanEdit(raw: string): string {
  const text = stripCodeFences(raw);
  return text.replace(/^\n+/, '').replace(/\s+$/, '');
}

interface RunOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** Ejecuta un prompt en el proveedor correspondiente y unifica la respuesta. */
async function runInlinePrompt(prompt: InlinePrompt, opts: RunOptions = {}): Promise<InlineResult> {
  const model = opts.model || getActiveModel();
  const route = routeForModel(model);
  const body: Record<string, unknown> = {
    model: model.startsWith('custom/') ? readSetting('CUSTOM_MODEL') || model : model,
    // Gemini usa `contents`; el resto usan `prompt` + `systemInstruction`.
    contents: prompt.user,
    prompt: prompt.user,
    systemInstruction: prompt.system,
    temperature: opts.temperature ?? 0.15,
    maxTokens: opts.maxTokens ?? 256,
    openrouterApiKey: readSetting('OPENROUTER_API_KEY'),
    ollamaHost: readSetting('OLLAMA_HOST'),
    ...clientCredentialsFor(model, readSetting),
  };

  let res: Response;
  try {
    res = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') return { ok: false, text: '', error: 'cancelado' };
    return { ok: false, text: '', error: err?.message || 'Sin conexión con el servidor local' };
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  // Algunos proveedores responden 200 con { ok:false } (sin key, host caído…).
  if (!res.ok || data?.ok === false || data?.success === false) {
    return {
      ok: false,
      text: '',
      error: data?.error || `HTTP ${res.status}`,
    };
  }

  return { ok: true, text: typeof data?.text === 'string' ? data.text : '' };
}

/** Sugiere la continuación en el cursor (ghost-text). */
export async function requestInlineCompletion(req: InlineCompletionRequest): Promise<InlineResult> {
  const result = await runInlinePrompt(buildCompletePrompt(req), {
    model: req.model,
    signal: req.signal,
    maxTokens: 128,
    temperature: 0.15,
  });
  if (!result.ok) return result;
  return { ok: true, text: cleanCompletion(req.prefix || '', result.text) };
}

/** Pide el cambio propuesto por una instrucción (edición inline Cmd+K). */
export async function requestInlineEdit(req: InlineEditRequest): Promise<InlineResult> {
  const result = await runInlinePrompt(buildEditPrompt(req), {
    model: req.model,
    signal: req.signal,
    maxTokens: 1536,
    temperature: 0.3,
  });
  if (!result.ok) return result;
  return { ok: true, text: cleanEdit(result.text) };
}
