/**
 * Parseo de pipelines para `shell.run`.
 *
 * El servidor no ejecuta comandos a través de un shell: valida cada etapa por
 * separado y las encadena con los `stdio` de Node. Este módulo es el único
 * sitio que decide qué es una etapa, y lo comparten cliente (para pedir
 * aprobación) y servidor (para ejecutar), de modo que nunca ven cosas
 * distintas.
 *
 * Solo se admite `|`. Cualquier otro metacaracter (`;`, `&&`, `||`, `>`, `<`,
 * `&`, backticks, `$()`, `${}`, `%`, `^`, saltos de línea) se rechaza antes de
 * partir el comando, aunque el segmento parezca inofensivo.
 */

export type PipelineParse =
  | { ok: true; segments: string[] }
  | { ok: false; error: string };

/** Tope de etapas: más que esto ya no es un pipeline legible, es una cadena. */
export const MAX_PIPELINE_SEGMENTS = 10;

/** Longitud máxima del comando completo. */
export const MAX_COMMAND_CHARS = 2000;

const FORBIDDEN: Array<{ re: RegExp; error: string }> = [
  { re: /\|\|/, error: 'Operador || no permitido (encadena comandos)' },
  { re: /&&/, error: 'Operador && no permitido (encadena comandos)' },
  { re: /[;&]/, error: 'Separador de comandos no permitido (; o &)' },
  { re: /`/, error: 'Sustitución con backticks no permitida' },
  { re: /\$\(|\$\{/, error: 'Sustitución de comandos no permitida ($() o ${})' },
  { re: /[<>]/, error: 'Redirección no permitida (< o >)' },
  { re: /[%^]/, error: 'Expansión de cmd.exe no permitida (% o ^)' },
  { re: /[\0\r\n]/, error: 'Salto de línea o NUL no permitido' },
];

/**
 * Parte un comando en etapas separadas por `|`.
 * Devuelve error si hay metacaracteres prohibidos, etapas vacías o demasiadas.
 */
export function splitPipeline(command: unknown): PipelineParse {
  const cmd = String(command ?? '').trim();
  if (!cmd) return { ok: false, error: 'command requerido' };
  if (cmd.length > MAX_COMMAND_CHARS) {
    return { ok: false, error: `command demasiado largo (máx ${MAX_COMMAND_CHARS})` };
  }
  for (const rule of FORBIDDEN) {
    if (rule.re.test(cmd)) return { ok: false, error: rule.error };
  }
  const segments = cmd.split('|').map((s) => s.trim());
  if (segments.some((s) => s.length === 0)) {
    return { ok: false, error: 'Pipeline con una etapa vacía' };
  }
  if (segments.length > MAX_PIPELINE_SEGMENTS) {
    return { ok: false, error: `Máximo ${MAX_PIPELINE_SEGMENTS} etapas por pipeline` };
  }
  return { ok: true, segments };
}

/** Primer token de una etapa (el ejecutable). */
export function segmentBinary(segment: string): string {
  return String(segment || '').trim().split(/\s+/)[0] || '';
}
