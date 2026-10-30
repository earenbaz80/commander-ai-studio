import { AGENT_FUNCTION_DECLARATIONS } from './fnTools';
import { FREEBUFF_TOOL_MODELS } from '../config/freebuffModels';

/**
 * Normalización de tool-calling entre proveedores.
 *
 * Cada proveedor habla un dialecto distinto para llamar herramientas:
 *  - 'gemini'   → REST de Gemini: { tools: [{ functionDeclarations }] } con tipos en MAYÚSCULAS.
 *  - 'openai'   → Chat Completions / Ollama / OpenAI-compat: { tools: [{ type: 'function', function }] } con JSON Schema en minúsculas.
 *  - 'json-text'→ Sin tool-calling nativo: el agente le pide JSON en texto plano y lo parsea.
 */
export type ToolDialect = 'gemini' | 'openai' | 'anthropic' | 'json-text';

/**
 * Detecta el dialecto de tool-calling según el id del modelo (ya prefijado).
 *
 * Los ids de Freebuff con tool-calling viven en `src/config/freebuffModels.ts`
 * (datos en `freebuff-models.json`, compartidos con el script de sync).
 */
export function toolDialectForModel(model?: string): ToolDialect {
  if (!model) return 'gemini';
  if (/^ollama\//.test(model)) return 'openai';
  if (/^openrouter\//.test(model)) return 'openai';
  if (/^custom\//.test(model)) return 'openai';
  // Freebuff es OpenAI-compatible; sólo los que declaran toolCalls lo usan.
  if (model.startsWith('freebuff/')) {
    return FREEBUFF_TOOL_MODELS.has(model.slice('freebuff/'.length)) ? 'openai' : 'json-text';
  }
  if (/^pollinations\//.test(model)) return 'json-text';
  // Claude (Anthropic) — tool-calling nativo con su propio formato.
  if (/^claude/i.test(model) || model.includes('claude')) return 'anthropic';
  // Los ids de HuggingFace contienen '/' y se ejecutan en local/API sin tool-calling nativo.
  if (model.includes('/')) return 'json-text';
  return 'gemini'; // ids planos de Gemini
}

/** ¿Este modelo puede usar tool-calling nativo del agente? */
export function modelSupportsTools(model?: string): boolean {
  return toolDialectForModel(model) !== 'json-text';
}

/** Ventana de contexto estimada (tokens) por modelo. Default 128k. */
export function getContextWindow(model?: string): number {
  if (!model) return 128000;
  const m = model.toLowerCase();
  if (m.includes('1m') || m.includes('1048576')) return 1048576;
  if (m.includes('2m')) return 2097152;
  if (m.includes('512k')) return 524288;
  if (m.includes('256k')) return 262144;
  if (m.includes('128k')) return 128000;
  if (m.includes('64k')) return 65536;
  if (m.includes('32k')) return 32768;
  if (m.includes('16k')) return 16384;
  if (m.includes('8k')) return 8192;
  // Gemma/Gemini Flash defaults
  if (m.includes('flash')) return 1048576;
  if (m.includes('gemini')) return 1048576;
  if (m.includes('gpt-4o')) return 128000;
  if (m.includes('claude')) return 200000;
  return 128000;
}

type GeminiParams = { type?: string; description?: string };
type GeminiDeclaration = {
  name: string;
  description: string;
  parameters?: {
    type?: string;
    properties?: Record<string, GeminiParams | undefined>;
    required?: string[];
  };
};

function toLowerCaseJsonType(t?: string): string {
  switch ((t || '').toUpperCase()) {
    case 'OBJECT': return 'object';
    case 'STRING': return 'string';
    case 'NUMBER': return 'number';
    case 'INTEGER': return 'integer';
    case 'BOOLEAN': return 'boolean';
    case 'ARRAY': return 'array';
    default: return 'string';
  }
}

/**
 * Convierte declaraciones de función estilo Gemini (tipos en MAYÚSCULAS)
 * al formato `tools` de OpenAI / OpenAI-compatible (JSON Schema en minúsculas).
 */
export function toOpenAITools(decls: GeminiDeclaration[] = AGENT_FUNCTION_DECLARATIONS) {
  return decls.map((d) => ({
    type: 'function' as const,
    function: {
      name: d.name,
      description: d.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(d.parameters?.properties || {}).map(([key, p]) => [
            key,
            p
              ? { type: toLowerCaseJsonType(p.type), ...(p.description ? { description: p.description } : {}) }
              : { type: 'string' },
          ])
        ),
        required: d.parameters?.required || [],
      },
    },
  }));
}

/**
 * Convierte declaraciones de función estilo Gemini al formato `tools` de
 * Anthropic (tool-use): { name, description, input_schema }.
 */
export function toAnthropicTools(decls: GeminiDeclaration[] = AGENT_FUNCTION_DECLARATIONS) {
  return decls.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(d.parameters?.properties || {}).map(([key, p]) => [
          key,
          p
            ? { type: toLowerCaseJsonType(p.type), ...(p.description ? { description: p.description } : {}) }
            : { type: 'string' },
        ])
      ),
      required: d.parameters?.required || [],
    },
  }));
}

export interface NormalizedToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Normaliza las tool_calls de una respuesta OpenAI / Ollama / OpenAI-compat
 * a un formato único { id, name, args }.
 * - OpenAI: choices[0].message.tool_calls[], con arguments como string JSON.
 * - Ollama:  message.tool_calls[], con arguments ya como objeto.
 */
export function normalizeOpenAIToolCalls(toolCalls: any[] = []): NormalizedToolCall[] {
  const out: NormalizedToolCall[] = [];
  for (const tc of toolCalls || []) {
    const fn = tc?.function;
    if (!fn || typeof fn.name !== 'string' || !fn.name) continue;
    let args: Record<string, unknown> = {};
    const raw = fn.arguments;
    if (raw == null) args = {};
    else if (typeof raw === 'string') {
      try { args = JSON.parse(raw); } catch { args = {}; }
    } else if (typeof raw === 'object') {
      args = raw as Record<string, unknown>;
    }
    out.push({ id: tc.id || fn.name, name: fn.name, args });
  }
  return out;
}