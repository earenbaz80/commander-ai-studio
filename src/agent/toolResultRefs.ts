import type { ToolResultRef } from './sessionTypes';

/**
 * Referencias navegables de un resultado de tool (F4A-3).
 *
 * Las tools ya devuelven archivo y línea en formas distintas (`matches` de
 * `fs.grep`, `declarations`/`references` de `code.analyze`, `diagnostics`, …).
 * El servidor las normaliza aquí, una sola vez, para que cualquier cliente
 * (extensión, escritorio, CLI) pueda abrir el archivo en la línea correcta sin
 * reimplementar el parseo.
 */

const MAX_REFS = 20;
const MAX_TEXT = 160;
const MAX_PATH = 500;

/** Claves donde las tools agrupan entradas navegables. */
const NESTED_KEYS = ['matches', 'declarations', 'references', 'diagnostics', 'results', 'files', 'items', 'entries'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  return clean && clean.length <= MAX_PATH ? clean : null;
}

function asPositiveInt(value: unknown): number | undefined {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_TEXT);
  return clean || undefined;
}

function pathOf(record: Record<string, unknown>): string | null {
  for (const key of ['path', 'file', 'filePath', 'filename', 'fileName']) {
    const path = asPath(record[key]);
    if (path) return path;
  }
  return null;
}

function refOf(value: unknown): ToolResultRef | null {
  const record = asRecord(value);
  if (!record) return null;
  const path = pathOf(record);
  if (!path) return null;
  const line = asPositiveInt(record.line ?? record.startLine ?? record.lineNumber ?? record.start);
  const column = asPositiveInt(record.column ?? record.col ?? record.character ?? record.startColumn);
  const text = asText(record.text ?? record.snippet ?? record.message ?? record.preview);
  return {
    path,
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
    ...(text ? { text } : {}),
  };
}

/**
 * Devuelve hasta 20 referencias únicas. `input` sólo se usa como respaldo para
 * `fs.read`, cuyo resultado trae `startLine` pero no la ruta (viaja en la
 * llamada).
 */
export function toolResultRefs(data: unknown, input?: unknown): ToolResultRef[] {
  const refs: ToolResultRef[] = [];
  const seen = new Set<string>();

  const add = (ref: ToolResultRef | null): void => {
    if (!ref || refs.length >= MAX_REFS) return;
    const key = `${ref.path}:${ref.line ?? ''}:${ref.column ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  const visit = (value: unknown, depth: number): void => {
    if (refs.length >= MAX_REFS || depth > 2) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    add(refOf(record));
    for (const key of NESTED_KEYS) {
      if (Array.isArray(record[key])) visit(record[key], depth + 1);
    }
  };

  visit(data, 0);

  if (refs.length === 0) {
    const path = asPath(asRecord(input)?.path);
    const record = asRecord(data);
    const line = record ? asPositiveInt(record.startLine ?? record.line) : undefined;
    if (path) add({ path, ...(line ? { line } : {}) });
  }

  return refs;
}
