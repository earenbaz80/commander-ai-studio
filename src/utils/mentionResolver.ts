/**
 * Resolución de menciones `@` al enviar un prompt (P0 #2).
 *
 * Combina:
 *   • Menciones estáticas NO de archivo (@docs:*, @model, @system, @schema, @git:*).
 *   • Archivos reales del proyecto mencionados como @ruta/archivo.ext: se leen
 *     del proyecto activo y se adjuntan como contexto.
 *
 * No toca `resolveContextMentions` (usado por el Composer) para no cambiar su
 * comportamiento.
 */
import { CONTEXT_MENTIONS, MentionItem } from '../data/contextMentions';
import type { ParameterConfig } from '../types/studio';
import { readProjectFile } from './agentToolsApi';

/** Rutas `@ruta/archivo.ext` presentes en el texto (excluye ids estáticos con `:`). */
export function extractFileMentions(text: string): string[] {
  const out = new Set<string>();
  const re = /@([A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}

export interface MentionResolveOptions {
  parameters?: ParameterConfig;
  selectedModel?: string;
  files?: { name: string; content: string }[];
  root?: string;
  /** Máximo de bytes por archivo adjuntado. */
  maxBytes?: number;
}

export interface ResolvedMentions {
  /** Contexto enriquecido listo para añadir al prompt. */
  context: string;
  /** Archivos reales que se adjuntaron. */
  files: string[];
}

/** Resuelve menciones estáticas (no archivo) + archivos reales. */
export async function resolveMentionsForPrompt(
  text: string,
  options: MentionResolveOptions = {}
): Promise<ResolvedMentions> {
  const parts: string[] = [];

  for (const item of CONTEXT_MENTIONS as MentionItem[]) {
    if (item.category === 'file') continue;
    if (text.includes(item.id)) {
      parts.push(`=== CONTEXT: ${item.label} ===\n${item.getContent(options)}`);
    }
  }

  const files = extractFileMentions(text);
  const attached: string[] = [];
  for (const p of files) {
    const res = await readProjectFile(p, options.maxBytes ?? 40_000, options.root);
    if (res.content != null) {
      parts.push(`=== CONTEXT: @${p} ===\n\`\`\`\n${res.content}\n\`\`\``);
      attached.push(p);
    }
  }

  return { context: parts.join('\n\n'), files: attached };
}
