/**
 * Nombres de archivos GGUF: funciones puras compartidas por el servidor y la UI.
 *
 * No importa `node:*` a propósito: el selector del chat y el panel de descargas
 * corren en el navegador, y necesitan la misma noción de cuantización y de
 * partes que el gestor de descargas.
 */

/** `Qwen2.5-7B-Instruct-Q4_K_M.gguf` → `Q4_K_M`. */
export function quantizationFromFilename(filename: string): string {
  const match = String(filename).match(/(?<![A-Za-z0-9])((?:I?Q)\d(?:_[A-Z0-9]+)*|F16|BF16|FP16)(?![A-Za-z0-9])/i);
  if (match) return match[1].toUpperCase();
  if (/\bf16\b/i.test(filename)) return 'F16';
  if (/\bbf16\b/i.test(filename)) return 'BF16';
  return 'GGUF';
}

/** Separa `modelo-00001-of-00003.gguf` en índice y total. */
export function splitGgufParts(filename: string): { index: number; total: number } | null {
  const match = String(filename).match(/-(\d{5})-of-(\d{5})\.gguf$/i);
  if (!match) return null;
  const index = Number(match[1]);
  const total = Number(match[2]);
  return Number.isInteger(index) && Number.isInteger(total) && index > 0 && total > 0
    ? { index, total }
    : null;
}
