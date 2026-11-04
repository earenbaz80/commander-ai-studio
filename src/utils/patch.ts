/**
 * Motor de diff/revisión de parches (estilo «aplicar/rechazar hunks»).
 *
 * Compara el contenido actual de un archivo con la propuesta de la IA y
 * permite reconstruir el archivo aplicando sólo los hunks que el usuario
 * acepte antes de escribir en disco.
 *
 * Es 100 % determinista y sin dependencias: útil también en tests de Node.
 */

export interface DiffLine {
  type: 'context' | 'add' | 'del';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffHunk {
  id: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** Líneas originales incluidas en el hunk (contexto + eliminadas). */
  oldLines: string[];
  /** Líneas propuestas que reemplazan al bloque (contexto + añadidas). */
  newLines: string[];
  /** Líneas para pintar el hunk en la interfaz. */
  lines: DiffLine[];
}

export interface DiffResult {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

type Op =
  | { type: 'equal'; a: number; b: number }
  | { type: 'del'; a: number }
  | { type: 'add'; b: number };

/** Evita tablas LCS gigantes: por encima de esto se degrada a «todo reemplazado». */
const MAX_LCS_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  return text.split('\n');
}

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0 || n * m > MAX_LCS_CELLS) {
    const ops: Op[] = [];
    for (let i = 0; i < n; i++) ops.push({ type: 'del', a: i });
    for (let j = 0; j < m; j++) ops.push({ type: 'add', b: j });
    return ops;
  }

  // Tabla LCS calculada desde el final para reconstruir el camino óptimo.
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', a: i, b: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', a: i });
      i++;
    } else {
      ops.push({ type: 'add', b: j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', a: i });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'add', b: j });
    j++;
  }
  return ops;
}

/**
 * Diff por líneas agrupado en hunks con `context` líneas de contexto.
 * Si no hay cambios devuelve `hunks: []`.
 */
export function diffLines(oldText: string, newText: string, context = 3): DiffResult {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = lcsOps(a, b);

  const additions = ops.filter((o) => o.type === 'add').length;
  const deletions = ops.filter((o) => o.type === 'del').length;
  if (additions === 0 && deletions === 0) {
    return { hunks: [], additions: 0, deletions: 0 };
  }

  // Agrupa los cambios contiguos; fusiona los separados por <= 2*context líneas iguales.
  const groups: { start: number; end: number }[] = [];
  let idx = 0;
  while (idx < ops.length) {
    if (ops[idx].type === 'equal') {
      idx++;
      continue;
    }
    const start = idx;
    let end = idx;
    while (end < ops.length) {
      if (ops[end].type !== 'equal') {
        end++;
        continue;
      }
      let k = end;
      while (k < ops.length && ops[k].type === 'equal') k++;
      if (k < ops.length && k - end <= context * 2) {
        end = k;
        continue;
      }
      break;
    }
    groups.push({ start, end });
    idx = Math.max(end, start + 1);
  }

  const hunks: DiffHunk[] = groups.map((g, hunkIdx) => {
    const start = Math.max(0, g.start - context);
    const end = Math.min(ops.length, g.end + context);
    const slice = ops.slice(start, end);
    const lines: DiffLine[] = [];
    const oldLines: string[] = [];
    const newLines: string[] = [];
    let oldStart = 1;
    let newStart = 1;
    let oldSeen = false;
    let newSeen = false;

    for (const op of slice) {
      if (op.type === 'equal') {
        const oldNo = op.a + 1;
        const newNo = op.b + 1;
        if (!oldSeen) { oldStart = oldNo; oldSeen = true; }
        if (!newSeen) { newStart = newNo; newSeen = true; }
        lines.push({ type: 'context', text: a[op.a], oldNo, newNo });
        oldLines.push(a[op.a]);
        newLines.push(a[op.a]);
      } else if (op.type === 'del') {
        const oldNo = op.a + 1;
        if (!oldSeen) { oldStart = oldNo; oldSeen = true; }
        lines.push({ type: 'del', text: a[op.a], oldNo, newNo: null });
        oldLines.push(a[op.a]);
      } else {
        const newNo = op.b + 1;
        if (!newSeen) { newStart = newNo; newSeen = true; }
        lines.push({ type: 'add', text: b[op.b], oldNo: null, newNo });
        newLines.push(b[op.b]);
      }
    }

    const firstOld = lines.find((l) => l.type !== 'add');
    const firstNew = lines.find((l) => l.type !== 'del');
    return {
      id: `h${hunkIdx}-${firstOld?.oldNo ?? firstNew?.newNo ?? hunkIdx}`,
      oldStart,
      oldCount: oldLines.length,
      newStart,
      newCount: newLines.length,
      oldLines,
      newLines,
      lines,
    };
  });

  return { hunks, additions, deletions };
}

/**
 * Renderiza un `DiffResult` como diff unificado (`--- a/x` / `+++ b/x` / `@@`).
 *
 * Es el formato que espera un modelo para razonar sobre un cambio sin aplicarlo:
 * lo usan las tools `fs.propose.*` (dry-run) y es lo mismo que mostraría
 * `git diff`, pero calculado en memoria sobre contenido propuesto.
 */
export function toUnifiedDiff(
  relPath: string,
  result: DiffResult,
  opts: { exists?: boolean } = {}
): string {
  const exists = opts.exists !== false;
  const out: string[] = [
    `--- ${exists ? `a/${relPath}` : '/dev/null'}`,
    `+++ b/${relPath}`,
  ];
  for (const h of result.hunks) {
    out.push(`@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`);
    for (const l of h.lines) {
      out.push((l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ') + l.text);
    }
  }
  return out.join('\n');
}

function isAccepted(accepted: Set<string> | string[], id: string): boolean {
  return accepted instanceof Set ? accepted.has(id) : accepted.includes(id);
}

/**
 * Reconstruye el archivo aplicando sólo los hunks aceptados.
 * Los hunks rechazados conservan el contenido original.
 */
export function mergeHunks(
  oldText: string,
  hunks: DiffHunk[],
  accepted: Set<string> | string[]
): string {
  if (hunks.length === 0) return oldText;

  const a = splitLines(oldText);
  const out: string[] = [];
  let cursor = 0;

  for (const h of hunks) {
    // Localiza el bloque original del hunk a partir del cursor (los hunks van en orden).
    let pos = -1;
    if (h.oldLines.length === 0) {
      pos = cursor;
    } else {
      for (let i = cursor; i + h.oldLines.length <= a.length; i++) {
        let match = true;
        for (let k = 0; k < h.oldLines.length; k++) {
          if (a[i + k] !== h.oldLines[k]) { match = false; break; }
        }
        if (match) { pos = i; break; }
      }
    }
    if (pos < 0) pos = cursor;

    for (let i = cursor; i < pos; i++) out.push(a[i]);
    if (isAccepted(accepted, h.id)) out.push(...h.newLines);
    else out.push(...h.oldLines);
    cursor = pos + h.oldLines.length;
  }

  for (let i = cursor; i < a.length; i++) out.push(a[i]);
  return out.join('\n');
}

/**
 * Aplica un reemplazo exacto en el cliente (equivalente a `fs.edit`).
 * Devuelve `null` si `oldString` no aparece en el texto.
 */
export function applyExactEdit(
  oldText: string,
  oldString: string,
  newString: string,
  replaceAll = false
): { content: string; replaced: number } | null {
  if (oldString === '') return null;
  if (oldText.indexOf(oldString) < 0) return null;

  if (!replaceAll) {
    return { content: oldText.replace(oldString, newString), replaced: 1 };
  }

  let count = 0;
  let i = 0;
  let content = '';
  for (;;) {
    const at = oldText.indexOf(oldString, i);
    if (at < 0) {
      content += oldText.slice(i);
      break;
    }
    content += oldText.slice(i, at) + newString;
    i = at + oldString.length;
    count++;
  }
  return { content, replaced: count };
}
