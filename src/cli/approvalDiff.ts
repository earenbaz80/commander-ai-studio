/**
 * Diff unificado del cambio que pide una tool que escribe, para el prompt de
 * aprobación del CLI.
 *
 * El menú sólo pinta el hunk si el pedido trae `diff` (`tui.ts`); sin él,
 * `approval.render.diffShown` sale siempre `false` y la decisión no queda
 * acreditada como tomada sobre el cambio (protocolo CAL2, I2). Se reconstruye
 * leyendo el archivo actual y aplicando el cambio en memoria, con el mismo motor
 * que las tools `fs.propose.*`, para que CLI y escritorio enseñen lo mismo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { applyExactEdit } from '../utils/patch.js';
import { buildUnifiedDiff } from './diff.js';

/** Por encima de esto no se lee: el turno espera y el menú corta a 400 líneas. */
const MAX_BYTES = 512 * 1024;

/** Contenido resultante de aplicar el `fs.edit` (simple o `replacements`), o `undefined` si no aplica. */
function editedContent(input: Record<string, unknown>, before: string): string | undefined {
  const entries = Array.isArray(input.replacements) ? input.replacements : [input];
  let current = before;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') return undefined;
    const { oldString, newString, replaceAll } = entry as Record<string, unknown>;
    if (typeof oldString !== 'string' || typeof newString !== 'string') return undefined;
    const applied = applyExactEdit(current, oldString, newString, replaceAll === true);
    if (!applied) return undefined;
    current = applied.content;
  }
  return current;
}

/** Diff del cambio, o `undefined` si no hay nada que enseñar: el pedido queda sin `diff`. */
export function approvalDiffFor(
  tool: string,
  input: Record<string, unknown>,
  cwd: string
): string | undefined {
  if (tool !== 'fs.edit' && tool !== 'fs.write') return undefined;
  const rawPath = typeof input.path === 'string' ? input.path.trim() : '';
  if (rawPath === '') return undefined;

  // `resolve` acepta las rutas absolutas que a veces manda el modelo.
  const absPath = path.resolve(cwd, rawPath);
  const relative = path.relative(cwd, absPath);
  // Fuera del workspace no hay ruta relativa que enseñar: se pinta la tal cual.
  const displayPath = (relative.startsWith('..') ? rawPath : relative).split(path.sep).join('/');

  let before = '';
  let exists = false;
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size > MAX_BYTES) return undefined;
    before = fs.readFileSync(absPath, 'utf8');
    exists = true;
  } catch {
    // No existe: un `fs.write` lo crea y el diff se pinta desde vacío.
  }

  const after =
    tool === 'fs.write'
      ? typeof input.content === 'string'
        ? input.content
        : undefined
      : editedContent(input, before);
  if (after === undefined) return undefined;

  const diff = buildUnifiedDiff(displayPath, before, after, { exists });
  // Sin hunk no hay cambio: las cabeceras solas no son un diff.
  return diff.includes('@@ ') ? diff : undefined;
}
