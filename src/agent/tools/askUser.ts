import type { ToolDefinition } from '../types';

/**
 * `ask_user`: el agente pregunta y el bucle espera la respuesta.
 *
 * Viaja por el canal de aprobación (`ctx.approve`) porque es el único punto
 * donde el bucle puede pararse a esperar algo del usuario sin inventar otro
 * transporte. No es una aprobación: el modal distingue la pregunta por
 * `meta.kind === 'question'` y devuelve el texto en `answer`.
 */
export interface AskUserInput {
  question: string;
  header?: string;
  options?: string[];
  allowFreeText?: boolean;
}

export interface AskUserOutput {
  answer: string;
}

/** Más de seis opciones deja de ser una pregunta y pasa a ser un menú. */
const MAX_OPTIONS = 6;

export const askUserTool: ToolDefinition<AskUserInput, AskUserOutput> = {
  id: 'ask_user',
  description:
    'Preguntar al usuario y esperar su respuesta. Úsalo cuando falte un dato que no puedes deducir del repo ni del objetivo (enfoque, alcance, un valor concreto). Con options ofrece alternativas clicables; allowFreeText deja además escribir. No ejecuta nada en el workspace.',
  danger: false,
  requiresApproval: () => true,
  approvalMeta: (input) => ({
    kind: 'question',
    question: String(input?.question ?? ''),
    options: Array.isArray(input?.options)
      ? input.options.map((o) => String(o).trim()).filter(Boolean).slice(0, MAX_OPTIONS)
      : [],
    allowFreeText: input?.allowFreeText !== false,
  }),
  run: async (input, ctx) => {
    const question = String(input?.question ?? '').trim();
    if (!question) return { ok: false, error: 'question es obligatorio' };

    const res = await ctx.approve({
      id: `ask-${Date.now()}`,
      toolId: 'ask_user',
      title: String(input?.header ?? '').trim() || 'Pregunta del agente',
      description: question,
      danger: false,
      meta: { kind: 'question' },
    });

    const answer = String((res as { answer?: string })?.answer ?? '').trim();
    if (!res.approved) return { ok: false, error: 'el usuario canceló la pregunta' };
    if (!answer) return { ok: false, error: 'respuesta vacía: pregunta de nuevo con opciones' };
    return { ok: true, data: { answer } };
  },
};
