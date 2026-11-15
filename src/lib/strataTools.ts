/**
 * Tool calling de Strata local.
 *
 * Strata habla el contrato OpenAI, pero cada modelo declara capacidades
 * distintas y el host puede fragmentar una llamada en varios deltas SSE. Este
 * módulo concentra tres decisiones:
 *  - qué modelos anuncian tools (y tools en paralelo);
 *  - si los argumentos son JSON válido y cumplen el esquema básico de la tool;
 *  - cómo se ensamblan fragmentos sin aceptar una llamada a medias.
 */
import { strataError } from './strataErrors';

export interface StrataToolCapabilities {
  supportsTools?: boolean;
  supportsParallelTools?: boolean;
  /** Campo del catálogo del que salió la capacidad, útil para depurar. */
  source?: string;
}

export interface StrataToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface StrataToolCallFragment {
  id?: string;
  name?: string;
  arguments?: string;
}

const TOOL_FLAGS = [
  'tool_call',
  'tool_calls',
  'tools',
  'supports_tools',
  'supportsTools',
  'function_calling',
  'functionCalling',
  'tool_calling',
  'toolCalling',
] as const;

const PARALLEL_FLAGS = [
  'parallel_tool_calls',
  'parallelToolCalls',
  'parallel_tools',
  'supports_parallel_tools',
  'supportsParallelTools',
] as const;

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'supported', 'auto', 'enabled'].includes(normalized)) return true;
    if (['false', 'no', '0', 'unsupported', 'disabled', 'none'].includes(normalized)) return false;
  }
  if (Array.isArray(value)) {
    // Un array vacío no declara capacidad; un array con tools sí.
    if (value.length === 0) return undefined;
    const names = value.map((item) => String(item).toLowerCase());
    if (names.some((name) => name === 'tools' || name === 'tool_choice' || name === 'function_calling')) {
      return true;
    }
    return true;
  }
  const record = asRecord(value);
  if (record) {
    return readBoolean(record.supported ?? record.enabled ?? record.value);
  }
  return undefined;
}

/**
 * Lee las distintas formas que usan los catálogos locales. Un modelo que no
 * declara nada queda como `undefined`: los hosts antiguos siguen funcionando y
 * no se les quitan las tools por una ausencia de metadatos.
 */
export function parseStrataToolCapabilities(model: unknown): StrataToolCapabilities {
  const record = asRecord(model);
  if (!record) return {};

  const nested = [
    record,
    asRecord(record.capabilities),
    asRecord(record.meta),
    asRecord(record.meta?.capabilities),
    asRecord(record.architecture),
    asRecord(record.architecture?.capabilities),
    asRecord(record.features),
  ].filter((value): value is Record<string, any> => Boolean(value));

  const result: StrataToolCapabilities = {};
  for (const source of nested) {
    for (const flag of TOOL_FLAGS) {
      const value = readBoolean(source[flag]);
      if (value === undefined) continue;
      if (value || result.supportsTools === undefined) {
        result.supportsTools = value;
        result.source = result.source || flag;
      }
    }
    if (Array.isArray(source.supported_parameters)) {
      const values = source.supported_parameters.map((item: unknown) => String(item).toLowerCase());
      if (values.includes('tools') || values.includes('tool_choice') || values.includes('function_calling')) {
        result.supportsTools = true;
        result.source = result.source || 'supported_parameters';
      }
    }
    if (Array.isArray(source.capabilities)) {
      const values = source.capabilities.map((item: unknown) => String(item).toLowerCase());
      if (values.includes('tools') || values.includes('function_calling')) {
        result.supportsTools = true;
        result.source = result.source || 'capabilities';
      }
    }
    for (const flag of PARALLEL_FLAGS) {
      const value = readBoolean(source[flag]);
      if (value !== undefined) result.supportsParallelTools = value;
    }
    if (Number.isFinite(Number(source.max_parallel_tool_calls))) {
      result.supportsParallelTools = Number(source.max_parallel_tool_calls) > 1;
    }
  }
  return result;
}

type ArgumentsResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; reason: string };

function parseArguments(raw: unknown): ArgumentsResult {
  if (raw == null) return { ok: true, args: {} };
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ok: true, args: raw as Record<string, unknown> };
  }
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'arguments debe ser un objeto JSON' };
  }
  if (!raw.trim()) return { ok: true, args: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'arguments no es JSON válido' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'arguments debe ser un objeto JSON' };
  }
  return { ok: true, args: parsed as Record<string, unknown> };
}

function matchesSchemaType(value: unknown, type: unknown): boolean {
  if (Array.isArray(type)) return type.some((item) => matchesSchemaType(value, item));
  switch (String(type || '').toLowerCase()) {
    case '':
    case 'any':
      return true;
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function validateAgainstSchema(args: Record<string, unknown>, schema: unknown): string | null {
  const shape = asRecord(schema);
  if (!shape) return null;
  const properties = asRecord(shape.properties) || {};
  const required = Array.isArray(shape.required)
    ? shape.required.filter((item): item is string => typeof item === 'string')
    : [];
  for (const key of required) {
    if (!(key in args) || args[key] === undefined) return `falta el argumento obligatorio "${key}"`;
  }
  for (const [key, value] of Object.entries(args)) {
    const property = asRecord(properties[key]);
    if (property && !matchesSchemaType(value, property.type)) {
      return `el argumento "${key}" no es de tipo ${String(property.type)}`;
    }
    if (!property && shape.additionalProperties === false) {
      return `el argumento "${key}" no está permitido`;
    }
  }
  return null;
}

export interface StrataToolDefinitions {
  tools?: unknown;
}

interface ToolSchemaEntry {
  name: string;
  parameters?: unknown;
}

function collectToolSchemas(tools: unknown): Map<string, ToolSchemaEntry> {
  const schemas = new Map<string, ToolSchemaEntry>();
  if (!Array.isArray(tools)) return schemas;
  for (const item of tools) {
    const record = asRecord(item);
    const fn = asRecord(record?.function);
    const name = String(fn?.name || record?.name || '').trim();
    if (!name) continue;
    schemas.set(name, {
      name,
      parameters: fn?.parameters ?? record?.parameters ?? record?.input_schema,
    });
  }
  return schemas;
}

function invalidToolCall(message: string, details?: Record<string, unknown>) {
  return strataError('STRATA_TOOL_ARGUMENTS_INVALID', { message, details });
}

/**
 * Convierte tool_calls OpenAI en el formato del agente. A diferencia del
 * normalizador genérico, no convierte un JSON roto en `{}`: una llamada con
 * argumentos inválidos se rechaza entera para no ejecutar una herramienta con
 * parámetros inventados.
 */
export function normalizeStrataToolCalls(
  rawCalls: unknown,
  options: StrataToolDefinitions = {}
): StrataToolCall[] {
  if (rawCalls == null) return [];
  if (!Array.isArray(rawCalls)) {
    throw invalidToolCall('Strata devolvió tool_calls que no son una lista');
  }
  const schemas = collectToolSchemas(options.tools);
  const calls: StrataToolCall[] = [];

  rawCalls.forEach((raw, index) => {
    const call = asRecord(raw);
    const fn = asRecord(call?.function) || call;
    const name = String(fn?.name || '').trim();
    if (!name) {
      throw invalidToolCall('Strata devolvió una tool_call sin nombre', { index });
    }
    if (schemas.size > 0 && !schemas.has(name)) {
      throw invalidToolCall(`El modelo llamó a una herramienta desconocida: ${name}`, {
        index,
        tool: name,
      });
    }
    const parsed = parseArguments(fn?.arguments ?? call?.arguments);
    if (!parsed.ok) {
      throw invalidToolCall(`Argumentos inválidos para ${name}: ${parsed.reason}`, {
        index,
        tool: name,
        reason: parsed.reason,
      });
    }
    const schema = schemas.get(name)?.parameters;
    const schemaError = validateAgainstSchema(parsed.args, schema);
    if (schemaError) {
      throw invalidToolCall(`Argumentos inválidos para ${name}: ${schemaError}`, {
        index,
        tool: name,
        reason: schemaError,
      });
    }
    calls.push({
      id: typeof call?.id === 'string' && call.id ? call.id : `strata-call-${index}`,
      name,
      args: parsed.args,
    });
  });

  return calls;
}

function appendNameFragment(current: string | undefined, fragment: string): string {
  if (!current) return fragment;
  if (current === fragment || current.endsWith(fragment)) return current;
  if (fragment.startsWith(current)) return fragment;
  return `${current}${fragment}`;
}

/**
 * Une un delta de streaming con lo acumulado. El nombre también puede llegar
 * fragmentado; los argumentos siempre se concatenan hasta que el `finish`
 * valida el JSON completo.
 */
export function mergeStrataToolCallFragment(
  current: StrataToolCallFragment | undefined,
  fragment: unknown
): StrataToolCallFragment {
  const call = asRecord(fragment) || {};
  const fn = asRecord(call.function) || call;
  const next: StrataToolCallFragment = { ...(current || {}) };

  if (!next.id && typeof call.id === 'string' && call.id) next.id = call.id;
  const name = typeof fn.name === 'string' ? fn.name : '';
  if (name) next.name = appendNameFragment(next.name, name);

  const args = fn.arguments ?? call.arguments;
  if (typeof args === 'string') {
    next.arguments = `${next.arguments || ''}${args}`;
  } else if (args && typeof args === 'object') {
    next.arguments = next.arguments || JSON.stringify(args);
  }
  return next;
}
