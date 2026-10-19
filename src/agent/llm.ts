import { getCachedApiKey } from '../lib/apiKeys';
import type { ChatMessage } from '../types/studio';
import { AGENT_FUNCTION_DECLARATIONS } from './fnTools';
import { toolDialectForModel, toOpenAITools } from './providers';

export interface LLMToolCall {
  id: string;
  tool: string;
  input: unknown;
  reason?: string;
}

export interface LLMResponse {
  thought?: string;
  plan?: { id: string; text: string; done: boolean }[];
  toolCalls?: LLMToolCall[];
  answer?: string;
  finish?: boolean;
}

export interface LLMContext {
  goal: string;
  cwd: string;
  history: ChatMessage[];
  toolSchema: string;
  recentSteps: any[];
  plan: any[];
  agentsMd?: string;
}

export async function callAgentLLM(
  ctx: LLMContext,
  opts: {
    apiBase?: string;
    apiKey?: string;
    model?: string;
  } = {}
): Promise<LLMResponse> {
  const apiBase = opts.apiBase || '/api/gemini/generate';
  const model = opts.model || 'gemini-2.5-flash';

  const system = `Eres un agente autónomo pragmático para ingeniería de código.

REGLAS:
- Responde ÚNICAMENTE con JSON válido. Sin markdown. Sin texto fuera.
- Objetivo: cumplir ${ctx.goal} en ${ctx.cwd}.
- Puedes usar herramientas: fs.read, fs.write, fs.edit, fs.glob, fs.grep, shell.run, read_diagnostics, task, git.status, git.diff, git.log, git.commit, web.fetch, web.search, code.run, mcp.call.
- Si necesitas leer archivos, usar fs.glob/fs.grep primero. Para docs web usa web.search/web.fetch.
- Tras editar código, usa read_diagnostics para verificar que no introdujiste errores de TypeScript.
- Puedes lanzar subagentes con la tool 'task' (goal, instructions, model, allowedTools, mode, maxSteps, parentSessionId).
- Puedes proponer VARIAS toolCalls independientes a la vez (se ejecutan en paralelo).
- Si vas a editar, lee el archivo completo para obtener contexto exacto.
- Para cambios pequeños usa fs.edit con oldString EXACTO. Para crear archivos usa fs.write.
- Si el comando shell es potencialmente destructivo, lo marcarás pero ejecutará solo con aprobación.
- Sé minimalista. Un tool_call a la vez si es incierto.
- Si ya cumpliste el objetivo, responde con {"finish": true, "answer": "..."}.
${ctx.agentsMd ? `\nREGLAS DEL REPO (AGENTS.md):\n${ctx.agentsMd.slice(0, 4000)}\n` : ''}

FORMATO JSON:
{
  "thought": "razonamiento breve",
  "plan": [{"id":"p1","text":"...","done":false}],
  "toolCalls": [{"id":"t1","tool":"fs.read","input":{"path":"..."}}],
  "answer": "respuesta final si terminas",
  "finish": false
}`;

  const user = `OBJETIVO: ${ctx.goal}
CWD: ${ctx.cwd}

PLAN ACTUAL:
${JSON.stringify(ctx.plan, null, 2)}

ULTIMOS PASOS:
${JSON.stringify(ctx.recentSteps.slice(-10), null, 2)}

HISTORIAL BREVE:
${JSON.stringify(
  ctx.history.slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 400) })),
  null,
  2
)}

TOOLS:
${ctx.toolSchema}`;

  try {
    const route = model.startsWith('custom/') ? '/api/custom/generate'
      : model.startsWith('openrouter/') ? '/api/openrouter/generate'
      : model.startsWith('pollinations/') ? '/api/pollinations/generate'
      : model.startsWith('ollama/') ? '/api/ollama/generate'
      : apiBase;
    const res = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.startsWith('custom/') ? (getCachedApiKey('CUSTOM_MODEL') || model) : model,
        contents: `${system}\n\n${user}`,
        prompt: `${system}\n\n${user}`,
        temperature: 0.2,
        maxTokens: 2048,
        openrouterApiKey: getCachedApiKey('OPENROUTER_API_KEY') || undefined,
        ollamaHost: getCachedApiKey('OLLAMA_HOST') || undefined,
        baseURL: getCachedApiKey('CUSTOM_BASE_URL') || undefined,
        apiKey: getCachedApiKey('CUSTOM_API_KEY') || getCachedApiKey('OPENCODE_API_KEY') || undefined,
      }),
    });

    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    const text = data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleaned = text.replace(/```json|```/g, '').trim();
    try {
      return JSON.parse(cleaned) as LLMResponse;
    } catch {
      // Reparo: un reintento pidiendo solo JSON antes de rendirse
      const retry = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.startsWith('custom/') ? (getCachedApiKey('CUSTOM_MODEL') || model) : model,
          contents: `Tu respuesta anterior no fue JSON válido. Reemite EXACTAMENTE este JSON corregido, sin markdown ni texto extra:\n${cleaned.slice(0, 4000)}`,
          prompt: `Reemite solo JSON válido: ${cleaned.slice(0, 4000)}`,
          temperature: 0,
          maxTokens: 2048,
          openrouterApiKey: getCachedApiKey('OPENROUTER_API_KEY') || undefined,
          ollamaHost: getCachedApiKey('OLLAMA_HOST') || undefined,
          baseURL: getCachedApiKey('CUSTOM_BASE_URL') || undefined,
          apiKey: getCachedApiKey('CUSTOM_API_KEY') || getCachedApiKey('OPENCODE_API_KEY') || undefined,
        }),
      });
      if (!retry.ok) throw new Error(`LLM HTTP ${retry.status}`);
      const rdata = await retry.json();
      const rtext = (rdata.text || '{}').replace(/```json|```/g, '').trim();
      return JSON.parse(rtext) as LLMResponse;
    }
  } catch (e: any) {
    return {
      thought: `Error llamando LLM: ${e?.message || String(e)}`,
      finish: true,
      answer: 'No pude generar siguiente paso. Revisa objetivo o modelo.',
    };
  }
}

export interface LLMNativeResult {
  thought: string;
  calls: { name: string; args: any }[];
}

// Tool-use nativo (function calling) por dialecto:
//  - Gemini → REST /api/gemini/generate con { tools: [{ functionDeclarations }] }.
//  - OpenAI-compatible (OpenRouter / custom / Ollama) → tools estilo Chat Completions.
//  - json-text (Pollinations/HF) → el loop usa el camino JSON en texto plano.
export async function callAgentLLMTools(
  ctx: LLMContext & { systemExtra?: string; turns?: { role: string; text: string }[] },
  opts: { model?: string } = {}
): Promise<LLMNativeResult> {
  const model = opts.model || 'gemini-2.5-flash';
  const dialect = toolDialectForModel(model);
  const turns = ctx.turns || [];
  const user = `OBJETIVO: ${ctx.goal}\nCWD: ${ctx.cwd}\n\nPLAN ACTUAL:\n${JSON.stringify(ctx.plan, null, 2)}\n\nULTIMOS PASOS:\n${JSON.stringify(ctx.recentSteps.slice(-10), null, 2)}\n\nHISTORIAL:\n${turns.slice(-8).map((t) => `${t.role.toUpperCase()}: ${t.text.slice(0, 1200)}`).join('\n\n')}\n\nTOOLS:\n${ctx.toolSchema}${ctx.systemExtra ? `\n${ctx.systemExtra}` : ''}`;
  const systemInstruction = `Eres un agente autónomo de código. Razona brevemente en texto y llama herramientas para avanzar hacia: ${ctx.goal}. Si el objetivo está cumplido, responde SOLO texto final sin llamar herramientas.${ctx.agentsMd ? `\nREGLAS DEL REPO:\n${ctx.agentsMd.slice(0, 4000)}` : ''}`;

  if (dialect === 'json-text') {
    // Sin tool-calling nativo: el llamador debe usar callAgentLLM (JSON en texto).
    return { thought: '', calls: [] };
  }

  const route =
    dialect === 'gemini' ? '/api/gemini/generate'
    : model.startsWith('openrouter/') ? '/api/openrouter/generate'
    : model.startsWith('ollama/') ? '/api/ollama/generate'
    : '/api/custom/generate';

  const payload: Record<string, unknown> = {
    contents: user,
    prompt: user,
    systemInstruction,
    model: model.startsWith('custom/') ? (getCachedApiKey('CUSTOM_MODEL') || model) : model,
    temperature: 0.2,
    maxTokens: 2048,
    openrouterApiKey: getCachedApiKey('OPENROUTER_API_KEY') || undefined,
    ollamaHost: getCachedApiKey('OLLAMA_HOST') || undefined,
    baseURL: getCachedApiKey('CUSTOM_BASE_URL') || undefined,
    apiKey: getCachedApiKey('CUSTOM_API_KEY') || getCachedApiKey('OPENCODE_API_KEY') || undefined,
  };

  if (dialect === 'gemini') {
    payload.tools = [{ functionDeclarations: AGENT_FUNCTION_DECLARATIONS }];
  } else {
    payload.tools = toOpenAITools();
  }

  const res = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = await res.json();

  if (dialect === 'gemini') {
    const calls = (data.functionCalls || []).map((fc: any) => ({ name: fc.name, args: fc.args || {} }));
    return { thought: data.text || '', calls };
  }

  // OpenAI-compatible: el servidor normaliza toolCalls → [{ id, name, args }].
  const calls = (data.toolCalls || []).map((tc: any) => ({ name: tc.name, args: tc.args || {} }));
  return { thought: data.text || data.choices?.[0]?.message?.content || '', calls };
}