/**
 * Búsqueda difusa de la paleta de comandos.
 *
 * La paleta reúne comandos, archivos, sesiones, herramientas y agentes; un
 * `includes()` por subcadena dejaba fuera atajos como «cmpsr» o «fggl». Aquí
 * cada token de la consulta debe aparecer (subcadena o subsecuencia) en algún
 * campo del comando, y se puntúa para que las coincidencias de etiqueta queden
 * por encima de las de palabras clave.
 */
import type { CommandItem } from './CommandPalette';

/** Minúsculas y sin diacríticos, para que «sesion» encuentre «sesión». */
export function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Puntúa un token dentro de un texto.
 * - `-1`: no aparece.
 * - Subcadena al principio > subcadena en límite de palabra > subcadena suelta.
 * - Si no hay subcadena, se acepta como subsecuencia (con penalización por
 *   separación), pero sólo para tokens de dos letras o más.
 */
function scoreToken(token: string, rawText: string, weight: number): number {
  if (!rawText) return -1;
  const text = normalizeForSearch(rawText);
  const at = text.indexOf(token);
  if (at === 0) return weight + 40;
  if (at > 0) {
    const boundary = /[\s._/-]/.test(text[at - 1] || '');
    return weight + (boundary ? 25 : 10) - Math.min(at, 20);
  }
  if (token.length < 2) return -1;

  let cursor = 0;
  let gaps = 0;
  let previous = -1;
  for (let i = 0; i < text.length && cursor < token.length; i++) {
    if (text[i] !== token[cursor]) continue;
    if (previous >= 0) gaps += i - previous - 1;
    previous = i;
    cursor++;
  }
  if (cursor !== token.length) return -1;
  return weight / 3 - Math.min(gaps, 60) / 12;
}

function scoreCommand(command: CommandItem, tokens: string[]): number {
  let total = 0;
  for (const token of tokens) {
    const best = Math.max(
      scoreToken(token, command.label, 100),
      scoreToken(token, command.keywords || '', 60),
      scoreToken(token, command.group, 40),
      scoreToken(token, command.hint || '', 30)
    );
    if (best < 0) return -1;
    total += best;
  }
  return total;
}

/**
 * Filtra y ordena por relevancia. Sin consulta devuelve el orden original
 * (que agrupa primero los comandos y luego las fuentes).
 */
export function rankCommands(commands: CommandItem[], query: string): CommandItem[] {
  const clean = normalizeForSearch(query.trim());
  if (!clean) return commands;
  const tokens = clean.split(/\s+/).filter(Boolean);
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, tokens) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}
