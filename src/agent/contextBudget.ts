/**
 * Presupuesto de contexto del bucle del agente.
 *
 * El bucle reenvía en cada paso los últimos turnos y el resultado de las tools.
 * Sin límites, un `fs.read` de 2 MB o un `shell.run` con miles de líneas deja
 * al modelo sin sitio para razonar, y el recorte que había (`.slice(0, 3000)`)
 * partía el JSON por la mitad y se comía justo el final, donde suele estar el
 * error que importa.
 *
 * Aquí viven las tres decisiones, sin dependencias para poder testearlas:
 *   1. `clipMiddle` — recorta dejando cabeza y cola (los errores van al final).
 *   2. `forContext` / `serializeResults` — cuánto ocupa cada tool.
 *   3. `compactTurns` — cuántos turnos se repiten literalmente y cuáles se
 *      resumen cuando la conversación crece.
 */

export interface ContextTurn {
  role: string;
  text: string;
}

/** Caracteres por turno al guardarlo (antes era `.slice(0, 2000)` en el bucle). */
export const TURN_CHARS = 2000;

/** Presupuesto total de turnos recordados, en caracteres. */
export const TURNS_BUDGET_CHARS = 16_000;

/** Turnos recientes que se repiten literalmente. */
export const RECENT_TURNS = 6;

/** Caracteres que se conservan de un turno ya resumido. */
export const SUMMARY_CHARS = 400;

/** Presupuesto de todos los resultados de tools de un paso, en caracteres. */
export const RESULTS_BUDGET_CHARS = 24_000;

/** Límite por defecto de un resultado de tool. */
export const DEFAULT_TOOL_RESULT_LIMIT = 8_000;

/**
 * Cuánto puede ocupar el resultado de cada tool. Las lecturas y los diffs
 * valen más que una lista de archivos o un mensaje de error.
 */
export const TOOL_RESULT_LIMITS: Record<string, number> = {
  'fs.read': 24_000,
  'git.diff': 18_000,
  'fs.grep': 12_000,
  'shell.run': 12_000,
  'read_diagnostics': 12_000,
  'web.fetch': 12_000,
  'web.search': 8_000,
  'fs.glob': 8_000,
  task: 8_000,
};

/** Marca que queda donde se recortó el texto. */
const ELLIPSIS = (omitted: number) => `\n… [${omitted} caracteres omitidos] …\n`;

/** Estimación de tokens (4 caracteres por token, el orden de magnitud habitual). */
export function estimateTokens(text: string): number {
  return Math.ceil(String(text || '').length / 4);
}

/** Límite de resultado para una tool (o el genérico si no está listada). */
export function limitForTool(toolId: string): number {
  return TOOL_RESULT_LIMITS[toolId] ?? DEFAULT_TOOL_RESULT_LIMIT;
}

/**
 * Recorta conservando cabeza y cola: el arranque explica qué pasó y el final
 * suele llevar el error real. Con `maxChars <= 0` devuelve cadena vacía.
 */
export function clipMiddle(text: string, maxChars: number): string {
  const value = String(text ?? '');
  if (maxChars <= 0) return '';
  if (value.length <= maxChars) return value;
  const markerReserve = 40;
  const room = Math.max(0, maxChars - markerReserve);
  const headChars = Math.ceil(room * 0.6);
  const tailChars = room - headChars;
  const omitted = value.length - headChars - tailChars;
  return `${value.slice(0, headChars)}${ELLIPSIS(omitted)}${tailChars > 0 ? value.slice(-tailChars) : ''}`;
}

export interface ToolResultLike {
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: unknown;
}

/**
 * Prepara un resultado para el contexto: serializa `data` y, si no cabe,
 * lo sustituye por una cadena recortada (el resultado sigue siendo JSON válido).
 */
export function forContext(result: ToolResultLike, maxChars: number = limitForTool(result.tool)) {
  const serialized = JSON.stringify(result.data ?? null);
  const data = serialized.length > maxChars ? clipMiddle(serialized, maxChars) : result.data ?? null;
  const out: Record<string, unknown> = { tool: result.tool, ok: result.ok };
  if (result.error !== undefined && result.error !== null && result.error !== '') {
    out.error = clipMiddle(String(result.error), Math.min(maxChars, 2000));
  }
  out.data = data;
  return out;
}

/**
 * Serializa el lote de resultados de un paso dentro de un presupuesto total.
 * Si un solo resultado se pasa, se recorta; si el lote entero se pasa, se
 * reparte el presupuesto y, como último recurso, se recorta el JSON completo.
 */
export function serializeResults(
  results: ToolResultLike[],
  totalChars: number = RESULTS_BUDGET_CHARS,
): string {
  if (!Array.isArray(results) || results.length === 0) return '[]';

  const natural = results.map((r) => forContext(r));
  let text = JSON.stringify(natural);
  if (text.length <= totalChars) return text;

  // Reparto justo: cada resultado recibe su parte, con un mínimo legible.
  const share = Math.max(500, Math.floor((totalChars - 200) / results.length));
  const reduced = results.map((r) => forContext(r, Math.min(limitForTool(r.tool), share)));
  text = JSON.stringify(reduced);
  if (text.length <= totalChars) return text;

  return clipMiddle(text, totalChars);
}

/** Resume un turno antiguo: principio del texto y marca de compactado. */
function summarize(text: string): string {
  const value = String(text ?? '');
  if (value.length <= SUMMARY_CHARS) return value;
  return `${value.slice(0, SUMMARY_CHARS).trimEnd()} … [compactado]`;
}

const totalChars = (turns: ContextTurn[]) => turns.reduce((n, t) => n + t.text.length, 0);

/**
 * Mantiene los últimos `keepRecent` turnos literales y resume los anteriores.
 * Si con los resúmenes todavía no cabe en `maxChars`, se van tirando los más
 * viejos (nunca los recientes: son los que explican el paso actual).
 */
export function compactTurns(
  turns: ContextTurn[],
  opts: { maxChars?: number; keepRecent?: number } = {},
): ContextTurn[] {
  const maxChars = opts.maxChars ?? TURNS_BUDGET_CHARS;
  const keepRecent = Math.max(0, opts.keepRecent ?? RECENT_TURNS);
  const list = Array.isArray(turns) ? turns : [];
  if (list.length <= keepRecent) return list.slice();

  const recent = list.slice(-keepRecent);
  const compacted = list
    .slice(0, -keepRecent)
    .map((t) => ({ role: t.role, text: summarize(t.text) }));

  const result = [...compacted, ...recent];
  while (result.length > recent.length && totalChars(result) > maxChars) {
    result.shift();
  }
  return result;
}
