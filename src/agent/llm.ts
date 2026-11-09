import type { ChatMessage } from '../types/studio';
import { AGENT_FUNCTION_DECLARATIONS } from './fnTools';
import { toolDialectForModel, toOpenAITools, toAnthropicTools } from './providers';
import { clientCredentialsFor, resolveEndpoint } from '../lib/aiProviders';
import { GEMINI_DEFAULT_MODEL } from '../config/geminiModels';
import { RESULT_TURN_CHARS, clipMiddle, formatStepDigest } from './contextBudget';

/**
 * System prompt estructurado por secciones. Es la única fuente de la verdad
 * sobre cómo se comporta el agente: identidad, contrato de tools, guía de
 * workspace, higiene git y reglas del repo. Antes eran ~10 líneas sueltas.
 */
export function buildSystemPrompt(ctx: LLMContext): string {
  const isPlan = ctx.mode === 'plan';
  const sections: string[] = [];
  sections.push(
    `Eres un agente autónomo de ingeniería de código (Commander). Razona brevemente en texto y llama herramientas para avanzar hacia el objetivo. Si el objetivo ya está cumplido, responde SOLO texto final sin llamar herramientas.`
  );
  sections.push(
    `PLAN: mantén el plan al día con \`update_plan\` (status: pending/in_progress/done/blocked; envía {id,status} para cambios parciales).`
  );
  sections.push(
    `PROTOCOLO DE EDICIÓN:
- Antes de editar, localiza el código con fs.glob/fs.grep y léelo con fs.read para tener el texto exacto.
- Cambios pequeños: fs.edit con oldString idéntico al archivo. Crear archivos: fs.write.
- En cuanto tengas el texto delante, haz la edición en el paso siguiente: no vuelvas a buscar ni a releer lo ya leído.
- Para un cambio que quieras revisar antes de aplicar, usa fs.propose.write / fs.propose.edit: devuelven un diff unificado sin tocar disco (funcionan incluso en modo plan).
- Tras editar código, usa read_diagnostics (o code.analyze si quieres el detalle del archivo) para verificar que no introdujiste errores de tipos o compilación (TypeScript, Python, Go o Rust según el proyecto).`
  );
  sections.push(
    `ANÁLISIS NATIVO (sin modelo, sin cuota, sin red):
- code.analyze {path}: diagnósticos de TypeScript, imports sin usar y reglas del repo (colores, i18n); con symbol añade sus referencias en todo el proyecto. Úsalo antes de editar a ciegas y para comprobar tu propio trabajo.
- code.refactor {path, symbol, newName}: renombra un símbolo en TODOS los archivos con el language service y devuelve un diff por archivo, sin escribir. Prefierelo a encadenar fs.edit cuando el símbolo aparece en varios sitios; aplica cada diff con fs.write.
- code.fix {paths}: eslint --fix y prettier con los binarios del proyecto. Sirve para dejar como pide el repo un archivo que ya tocaste, no para cambiar lógica.
- Si fs.propose devuelve diagnostics con errores o rules con violaciones, corrigelo antes de dar el cambio por bueno.`
  );
  sections.push(
    `CONTRATO DE TOOLS:
- Las tools de filesystem nunca leen ni buscan archivos sensibles (.env y familia, id_rsa, .pem/.key, .p12, credenciales). Si necesitas un valor de .env, pídele al usuario que lo copie o lee una plantilla .env.example.
- Los comandos de shell pasan por una allowlist; no hay sustitución de variables ni encadenamiento fuera de \`|\` entre etapas permitidas.
- Puedes lanzar subagentes con la tool 'task' (goal, instructions, model, allowedTools, mode, maxSteps, parentSessionId).
- Puedes proponer VARIAS toolCalls independientes a la vez (se ejecutan en paralelo).
- Si te falta un dato que no puedes deducir del repo ni del objetivo (enfoque, alcance, un valor), usa 'ask_user' en vez de suponerlo: la corrida espera la respuesta.`
  );
  sections.push(
    `GUÍA DE WORKSPACE (checkout local compartido):
- Compartes el checkout con el usuario y posibles otros agentes. Antes de editar, inspecciona git status y la rama.
- No descartes, sobrescribas, stashees, stagees ni commitees cambios que no hiciste tú. Evita \`git add -A\`; stagea archivos concretos.
- Otro thread puede tener un dev server en el 3280: inspecciona los listeners antes de elegir puerto.`
  );
  sections.push(
    `HIGIENE GIT: no hagas commit, push ni PR salvo que el usuario lo pida explícitamente.`
  );
  if (isPlan) {
    sections.push(
      `MODO PLAN: estás diseñando un plan, no construyéndolo. Explora con las tools de solo lectura. No llames fs.write/fs.edit ni comandos que muten. Aprobar el plan es lo que arranca la construcción. Usa 'ask_user' para resolver dudas antes de entregarlo.`
    );
  }
  if (ctx.skills && ctx.skills.length > 0) {
    sections.push(
      `SKILLS DISPONIBLES: ${ctx.skills.join(', ')}.\nTutorial: lee el SKILL.md relevante antes de usar un skill; resuelve recursos relativos a su directorio. Usa la tool 'skill' con el nombre.`
    );
  }
  if (ctx.agentsMd) {
    sections.push(`REGLAS DEL REPO (AGENTS.md):\n${ctx.agentsMd.slice(0, 4000)}`);
  }
  return sections.join('\n\n');
}
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
  mode?: 'build' | 'plan' | 'readonly';
  skills?: string[];
}

export async function callAgentLLM(
  ctx: LLMContext,
  opts: {
    apiBase?: string;
    apiKey?: string;
    model?: string;
  } = {}
): Promise<LLMResponse> {
  const model = opts.model || GEMINI_DEFAULT_MODEL;

  const system = `${buildSystemPrompt(ctx)}

FORMATO JSON (responde ÚNICAMENTE con JSON válido, sin markdown, sin texto fuera):
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

PASOS RECIENTES:
${formatStepDigest(ctx.recentSteps)}

${ctx.history.length > 0 ? `HISTORIAL:\n${JSON.stringify(
  ctx.history.slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 400) })),
  null,
  2
)}\n\n` : ''}TOOLS:
${ctx.toolSchema}`;

  try {
    const route = opts.apiBase || resolveEndpoint(model);
    const res = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        contents: `${system}\n\n${user}`,
        prompt: `${system}\n\n${user}`,
        temperature: 0.2,
        maxTokens: 2048,
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
          model,
          contents: `Tu respuesta anterior no fue JSON válido. Reemite EXACTAMENTE este JSON corregido, sin markdown ni texto extra:\n${cleaned.slice(0, 4000)}`,
          prompt: `Reemite solo JSON válido: ${cleaned.slice(0, 4000)}`,
          temperature: 0,
          maxTokens: 2048,
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
  /** Modelo que respondió de verdad, cuando el proveedor lo declara. */
  model?: string;
  /**
   * El modelo pedido no respondió y contestó otro. `null` = respondió el pedido;
   * ausente = el proveedor no lo declara (OpenAI/Ollama, servidores antiguos).
   */
  fallback?: { from: string; to: string } | null;
}

/** Lee una credencial del panel desde el almacenamiento del cliente. */
function readClientKey(name: string): string | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage.getItem(name) || undefined;
  } catch {
    return undefined;
  }
}

// Tool-use nativo (function calling) por dialecto:
//  - Gemini → REST /api/gemini/generate con { tools: [{ functionDeclarations }] }.
//  - OpenAI-compatible (OpenRouter / custom / Ollama) → tools estilo Chat Completions.
//  - json-text (Pollinations/HF) → el loop usa el camino JSON en texto plano.
export async function callAgentLLMTools(
  ctx: LLMContext & { systemExtra?: string; turns?: { role: string; text: string }[] },
  opts: { model?: string } = {}
): Promise<LLMNativeResult> {
  const model = opts.model || GEMINI_DEFAULT_MODEL;
  const dialect = toolDialectForModel(model);
  const turns = ctx.turns || [];
  const user = `OBJETIVO: ${ctx.goal}\nCWD: ${ctx.cwd}\n\nPLAN ACTUAL:\n${JSON.stringify(ctx.plan, null, 2)}\n\nPASOS RECIENTES:\n${formatStepDigest(ctx.recentSteps)}\n\nHISTORIAL:\n${turns.slice(-8).map((t) => `${t.role.toUpperCase()}: ${clipMiddle(t.text, t.role === 'user' ? RESULT_TURN_CHARS : 1200)}`).join('\n\n')}\n\nTOOLS:\n${ctx.toolSchema}${ctx.systemExtra ? `\n${ctx.systemExtra}` : ''}`;
  const systemInstruction = buildSystemPrompt(ctx);

  if (dialect === 'json-text') {
    // Sin tool-calling nativo: el llamador debe usar callAgentLLM (JSON en texto).
    return { thought: '', calls: [] };
  }

  // `dialect !== 'gemini'` solo llega aquí para custom/ (openrouter/ y ollama/
  // también son openai pero se resuelven igual), así que resolveEndpoint es
  // equivalente al fallback anterior.
  const route =
    dialect === 'gemini' ? '/api/gemini/generate' :
    dialect === 'anthropic' ? '/api/anthropic/generate' :
    resolveEndpoint(model);

  const payload: Record<string, unknown> = {
    contents: user,
    prompt: user,
    systemInstruction,
    model,
    temperature: 0.2,
    maxTokens: 2048,
    ...clientCredentialsFor(model, readClientKey),
  };

  if (dialect === 'gemini') {
    payload.tools = [{ functionDeclarations: AGENT_FUNCTION_DECLARATIONS }];
  } else if (dialect === 'anthropic') {
    payload.tools = toAnthropicTools();
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
    return {
      thought: data.text || '',
      calls,
      ...(typeof data.model === 'string' ? { model: data.model } : {}),
      ...(data.fallback ? { fallback: data.fallback } : {}),
    };
  }

  if (dialect === 'anthropic') {
    const calls = (data.toolCalls || []).map((tc: any) => ({ name: tc.name, args: tc.args || {} }));
    // Fallback: parse tool_use blocks directly from Anthropic's content array
    // if the handler did not normalize them.
    if (calls.length === 0 && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block?.type === 'tool_use' && block.name) {
          calls.push({ name: block.name, args: block.input || {} });
        }
      }
    }
    const text = data.text || (Array.isArray(data.content) ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('') : '');
    return { thought: text, calls };
  }

  // OpenAI-compatible: el servidor normaliza toolCalls → [{ id, name, args }].
  const calls = (data.toolCalls || []).map((tc: any) => ({ name: tc.name, args: tc.args || {} }));
  return { thought: data.text || data.choices?.[0]?.message?.content || '', calls };
}