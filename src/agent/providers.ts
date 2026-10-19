import { AGENT_FUNCTION_DECLARATIONS } from './fnTools';

/**
 * Normalización de tool-calling entre proveedores.
 *
 * Cada proveedor habla un dialecto distinto para llamar herramientas:
 *  - 'gemini'   → REST de Gemini: { tools: [{ functionDeclarations }] } con tipos en MAYÚSCULAS.
 *  - 'openai'   → Chat Completions / Ollama / OpenAI-compat: { tools: [{ type: 'function', function }] } con JSON Schema en minúsculas.
 *  - 'json-text'→ Sin tool-calling nativo: el agente le pide JSON en texto plano y lo parsea.
 */
export type ToolDialect = 'gemini' | 'openai' | 'json-text';

/** Detecta el dialecto de tool-calling según el id del modelo (ya prefijado). */
export function toolDialectForModel(model?: string): ToolDialect {
  if (!model) return 'gemini';
  if (/^ollama\//.test(model)) return 'openai';
  if (/^openrouter\//.test(model)) return 'openai';
  if (/^custom\//.test(model)) return 'openai';
  if (/^pollinations\//.test(model)) return 'json-text';
  // Los ids de HuggingFace contienen '/' y se ejecutan en local/API sin tool-calling nativo.
  if (model.includes('/')) return 'json-text';
  return 'gemini'; // ids planos de Gemini
}

/** ¿Este modelo puede usar tool-calling nativo del agente? */
export function modelSupportsTools(model?: string): boolean {
  return toolDialectForModel(model) !== 'json-text';
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