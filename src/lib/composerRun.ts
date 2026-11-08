/**
 * Ejecución del Composer: contexto, llamada al modelo y parseo de `FILE:`.
 *
 * Vive fuera del componente a propósito. El componente tenía 1.000 líneas
 * mezclando UI, red y expresiones regulares; separar esto permite probar el
 * parseo y la llamada sin montar React, y deja la pantalla ocupándose de
 * ordenar, no de hablar con el proveedor.
 */
import { ALL_MODELS } from '../data/models';
import { resolveChatRoute } from './aiRouting';
import { resolveContextMentions } from '../data/contextMentions';
import type { ParameterConfig } from '../types/studio';

export interface ComposerFile {
  name: string;
  originalContent: string;
  proposedContent?: string;
  isNew?: boolean;
}

export type ProjectFile = ComposerFile;

/** Fallo del Composer con un código que la UI sabe traducir. */
export class ComposerError extends Error {
  code: 'provider' | 'no-blocks';
  constructor(code: ComposerError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'ComposerError';
  }
}

const SYSTEM_PROMPT = `Eres Commander Composer, un agente de ingeniería de software experto.
El usuario te dará una instrucción para modificar o crear archivos en el proyecto.

REGLAS DE RESPUESTA:
Debes responder ÚNICAMENTE en bloques de código delimitados por archivos, usando el formato exacto:
FILE: ruta/del/archivo.ext
\`\`\`lenguaje
[código completo del archivo con las modificaciones aplicadas]
\`\`\`

Puedes modificar múltiples archivos o agregar nuevos archivos si la tarea lo requiere. No agregues texto conversacional fuera de los bloques de archivos.`;

/**
 * Bloques `FILE: ruta` + valla de código. Si no hay ninguno, cae al primer
 * bloque de código suelto (el modelo a veces olvida la cabecera) y lo asigna al
 * archivo seleccionado.
 */
export function parseFileBlocks(text: string, fallbackFile = ''): Map<string, string> {
  const out = new Map<string, string>();
  const fileRegex = /FILE:\s*([^\r\n]+)\r?\n```[\w-]*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fileRegex.exec(text)) !== null) {
    out.set(match[1].trim(), match[2]);
  }
  if (out.size === 0 && fallbackFile) {
    const single = text.match(/```[\w-]*\r?\n([\s\S]*?)```/);
    if (single) out.set(fallbackFile, single[1]);
  }
  return out;
}

export interface RunComposerInput {
  files: ComposerFile[];
  instruction: string;
  selectedFileName: string;
  selectedModel: string;
  parameters: ParameterConfig;
}

/** Devuelve el contenido propuesto por archivo. Lanza `ComposerError` si falla. */
export async function runComposer(input: RunComposerInput): Promise<Map<string, string>> {
  const { files, instruction, selectedFileName, selectedModel, parameters } = input;
  const model = ALL_MODELS.find((m) => m.id === selectedModel) || ALL_MODELS[0];
  const route = resolveChatRoute({ modelId: selectedModel, provider: model.provider });

  const fileContext = files
    .map((f) => `=== FILE: ${f.name} ===\n${f.proposedContent !== undefined ? f.proposedContent : f.originalContent}`)
    .join('\n\n');

  const { cleanPrompt, enrichedContext } = resolveContextMentions(instruction, {
    parameters,
    selectedModel,
    files: files.map((f) => ({
      name: f.name,
      content: f.proposedContent !== undefined ? f.proposedContent : f.originalContent,
    })),
  });

  const userPrompt = `PROYECTO ACTUAL:
${fileContext}

INSTRUCCIÓN DEL USUARIO:
${cleanPrompt}
${enrichedContext ? `\n[CONTEXTO ADICIONAL POR MENCIONES @]:\n${enrichedContext}` : ''}

Genera los archivos modificados con el código completo para cada uno.`;

  const payload = route.isAnthropic
    ? {
        prompt: userPrompt,
        model: selectedModel,
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 4096,
      }
    : route.isHf
      ? {
          prompt: userPrompt,
          model: selectedModel,
          hfApiToken: parameters.hfApiToken,
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.2,
          maxTokens: 4096,
        }
      : {
          contents: userPrompt,
          systemInstruction: SYSTEM_PROMPT,
          model: selectedModel,
          temperature: 0.2,
          maxTokens: 4096,
        };

  let data: any;
  try {
    const response = await fetch(route.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    data = await response.json();
  } catch (e: any) {
    throw new ComposerError('provider', e?.message || String(e));
  }

  if (!data?.success) throw new ComposerError('provider', data?.error || 'El proveedor no devolvió texto');

  const parsed = parseFileBlocks(String(data.text || ''), selectedFileName);
  if (parsed.size === 0) throw new ComposerError('no-blocks', 'El modelo no retornó bloques de código formateados.');
  return parsed;
}
