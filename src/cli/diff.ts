/**
 * Diff unificado para la terminal (F1-05).
 *
 * El servidor ya manda el cambio propuesto de `fs.write`/`fs.edit` como diff
 * unificado; aquí se parsea y se pinta por hunk con números de línea, sin
 * dependencias y sin volver a leer el archivo. El tope de líneas es explícito:
 * si el diff no cabe, se dice cuántas líneas quedaron fuera en vez de fingir
 * que lo mostrado es todo.
 *
 * `buildUnifiedDiff` comparte el motor de `src/utils/patch.ts` (contexto 3 por
 * defecto), así que el CLI y el escritorio enseñan el mismo cambio.
 */
import { diffLines, toUnifiedDiff } from '../utils/patch.js';

/** Tope de líneas que se pintan de un diff antes de avisar del truncado. */
export const DIFF_MAX_LINES = 400;

export interface RenderDiffOptions {
  /** Tope de líneas; por defecto `DIFF_MAX_LINES`. */
  maxLines?: number;
  /** ANSI en verde/rojo/cyan; el llamador decide según TTY y `NO_COLOR`. */
  color?: boolean;
}

export interface DiffHunkSummary {
  index: number;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  additions: number;
  deletions: number;
}

export interface RenderedDiff {
  lines: string[];
  truncated: boolean;
  /** Líneas que quedaron fuera por el tope (0 si se mostró todo). */
  omitted: number;
  /** Líneas totales del diff antes del tope. */
  total: number;
  hunks: DiffHunkSummary[];
}

interface BodyLine {
  kind: 'context' | 'add' | 'del';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

interface ParsedHunk extends DiffHunkSummary {
  lines: BodyLine[];
}

interface ParsedDiff {
  headers: string[];
  hunks: ParsedHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const RESET = '\x1b[0m';

function paint(code: string, text: string, color: boolean): string {
  return color ? `\x1b[${code}m${text}${RESET}` : text;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Genera el diff unificado de `before` → `after` para una ruta relativa.
 *
 * `exists: false` pinta `--- /dev/null` (archivo nuevo). Con el mismo contenido
 * devuelve sólo las cabeceras, sin hunks.
 */
export function buildUnifiedDiff(
  relPath: string,
  before: string,
  after: string,
  opts: { context?: number; exists?: boolean } = {}
): string {
  const result = diffLines(
    normalizeNewlines(before),
    normalizeNewlines(after),
    opts.context ?? 3
  );
  return toUnifiedDiff(relPath, result, { exists: opts.exists ?? before !== '' });
}

/** Parsea un diff unificado; tolera CRLF y líneas `\ No newline at end of file`. */
function parseUnifiedDiff(diff: string): ParsedDiff {
  const rows = normalizeNewlines(diff).split('\n');
  const headers: string[] = [];
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;

  for (const row of rows) {
    if (row.startsWith('--- ') || row.startsWith('+++ ')) {
      headers.push(row);
      continue;
    }
    const header = HUNK_RE.exec(row);
    if (header) {
      current = {
        index: hunks.length,
        header: row,
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        additions: 0,
        deletions: 0,
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current || row.startsWith('\\')) continue;

    const sign = row[0];
    const text = row.slice(1);
    if (sign === '+') {
      current.lines.push({ kind: 'add', text, oldNo: null, newNo: null });
      current.additions += 1;
    } else if (sign === '-') {
      current.lines.push({ kind: 'del', text, oldNo: null, newNo: null });
      current.deletions += 1;
    } else if (sign === ' ' || row === '') {
      if (row === '') continue;
      current.lines.push({ kind: 'context', text, oldNo: null, newNo: null });
    }
  }

  // Los números salen del encabezado del hunk, no de contar el archivo entero.
  for (const hunk of hunks) {
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.kind === 'context') {
        line.oldNo = oldNo++;
        line.newNo = newNo++;
      } else if (line.kind === 'del') {
        line.oldNo = oldNo++;
        line.newNo = null;
      } else {
        line.oldNo = null;
        line.newNo = newNo++;
      }
    }
  }

  return { headers, hunks };
}

function toSummary(hunk: ParsedHunk): DiffHunkSummary {
  const { lines: _lines, ...summary } = hunk;
  return summary;
}

function widestLineNumber(parsed: ParsedDiff): number {
  let max = 1;
  for (const hunk of parsed.hunks) {
    max = Math.max(max, hunk.oldStart + hunk.oldCount, hunk.newStart + hunk.newCount);
  }
  return Math.max(2, String(max).length);
}

function renderBodyLine(line: BodyLine, width: number, color: boolean): string {
  const oldNo = (line.oldNo === null ? '' : String(line.oldNo)).padStart(width);
  const newNo = (line.newNo === null ? '' : String(line.newNo)).padStart(width);
  const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
  const code = line.kind === 'add' ? '32' : line.kind === 'del' ? '31' : '0';
  const body = `${paint('90', `${oldNo} ${newNo}`, color)} ${paint(code, `${sign}${line.text}`, color)}`;
  return body;
}

/**
 * Pinta un diff unificado con números de línea y signos `+`/`-`.
 *
 * Si supera `maxLines`, corta y añade una línea que dice cuántas quedaron
 * fuera: lo mostrado nunca se presenta como el diff completo.
 */
export function renderDiff(diff: string, opts: RenderDiffOptions = {}): RenderedDiff {
  const maxLines = Math.max(1, opts.maxLines ?? DIFF_MAX_LINES);
  const color = opts.color === true;
  const parsed = parseUnifiedDiff(diff);
  const width = widestLineNumber(parsed);

  const all: string[] = [
    ...parsed.headers.map((header) => paint('2', header, color)),
  ];
  for (const hunk of parsed.hunks) {
    all.push(paint('36', hunk.header, color));
    for (const line of hunk.lines) all.push(renderBodyLine(line, width, color));
  }

  const total = all.length;
  const truncated = total > maxLines;
  if (!truncated) {
    return {
      lines: all,
      truncated: false,
      omitted: 0,
      total,
      hunks: parsed.hunks.map(toSummary),
    };
  }

  const kept = all.slice(0, maxLines);
  const omitted = total - maxLines;
  kept.push(
    paint('33', `… ${omitted} línea(s) omitidas: diff truncado en ${maxLines}, no está completo`, color)
  );
  return {
    lines: kept,
    truncated: true,
    omitted,
    total,
    hunks: parsed.hunks.map((hunk) => ({ ...hunk, lines: undefined as never })),
  };
}

/** Resúmenes de hunk, para la tecla `?` del prompt de aprobación. */
export function diffHunks(diff: string): DiffHunkSummary[] {
  return parseUnifiedDiff(diff).hunks.map(toSummary);
}

/**
 * Pinta un solo hunk (`?` en el prompt), con el mismo formato que `renderDiff`.
 * Devuelve `null` si el índice no existe.
 */
export function renderHunk(
  diff: string,
  index: number,
  opts: { color?: boolean } = {}
): string[] | null {
  const parsed = parseUnifiedDiff(diff);
  const hunk = parsed.hunks[index];
  if (!hunk) return null;
  const color = opts.color === true;
  const width = widestLineNumber(parsed);
  return [
    paint('36', hunk.header, color),
    ...hunk.lines.map((line) => renderBodyLine(line, width, color)),
  ];
}
