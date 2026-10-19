/**
 * Diff de líneas sencillo (LCS) para previsualizar la edición inline (Cmd+K).
 *
 * Puro y sin dependencias: se usa tanto en la UI como en los tests. Para
 * bloques enormes evita la matriz O(n·m) y cae a "todo reemplazado", que
 * sigue siendo un previsualización honesta.
 */

export type DiffOpType = 'equal' | 'add' | 'del';

export interface DiffOp {
  type: DiffOpType;
  text: string;
}

/** Límite de celdas (líneasA × líneasB) antes de degradar a reemplazo total. */
export const DIFF_CELL_LIMIT = 250_000;

/** Divide en líneas conservando las líneas vacías intermedias y finales. */
function splitLines(text: string): string[] {
  return (text ?? '').split('\n');
}

/** Diff por líneas entre dos textos. */
export function lineDiff(before: string, after: string): DiffOp[] {
  const a = splitLines(before);
  const b = splitLines(after);

  // Fallback defensivo para selecciones gigantes.
  if (a.length * b.length > DIFF_CELL_LIMIT) {
    const ops: DiffOp[] = [];
    for (const t of a) ops.push({ type: 'del', text: t });
    for (const t of b) ops.push({ type: 'add', text: t });
    return ops;
  }

  const n = a.length;
  const m = b.length;
  // dp[i][j] = longitud del LCS de A[i..] y B[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i] });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'del', text: a[i++] });
  while (j < m) ops.push({ type: 'add', text: b[j++] });
  return ops;
}

/** Cuenta líneas añadidas/quitadas para el resumen "+N −M". */
export function summarizeDiff(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'add') added += 1;
    else if (op.type === 'del') removed += 1;
  }
  return { added, removed };
}

/** ¿El diff cambia algo? */
export function hasChanges(ops: DiffOp[]): boolean {
  return ops.some((op) => op.type !== 'equal');
}
