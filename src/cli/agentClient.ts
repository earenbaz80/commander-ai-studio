/**
 * Cliente headless del agente para el CLI (`commander agent`).
 *
 * No ejecuta las tools en el proceso del CLI: habla por HTTP con el servidor
 * embebido de Commander AI Studio (`npm run dev` o `commander serve`) y reutiliza
 * los mismos endpoints que la app:
 *
 *   • `GET  /api/health`              → disponibilidad del servidor.
 *   • `POST /api/{provider}/generate` → LLM con function calling nativo.
 *   • `POST /api/agent/run-tool`      → ejecución de tools en sandbox.
 *
 * El bucle es deliberadamente mínimo (scaffold): pensar → ejecutar tools →
 * repetir hasta que el modelo responda sin toolCalls o se alcance `maxSteps`.
 * La UI de terminal (colores, spinner, etc.) es responsabilidad del llamador
 * a través de `onEvent`.
 */
import { AGENT_FUNCTION_DECLARATIONS } from '../agent/fnTools';
import { toOpenAITools, toolDialectForModel } from '../agent/providers';
import { PLAN_TOOL } from '../agent/plan';
import { resolveEndpoint, resolveStreamEndpoint } from '../lib/aiProviders';

export type CliAgentEvent =
  | { type: 'status'; text: string }
  /** Delta de texto del modelo durante el streaming (si está habilitado). */
  | { type: 'chunk'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; ok: boolean; summary: string }
  | { type: 'answer'; text: string }
  | { type: 'error'; text: string };

export interface RunAgentOptions {
  /** URL base del servidor embebido (sin barra final). */
  serverUrl: string;
  /** Objetivo en lenguaje natural. */
  task: string;
  /** Raíz del proyecto sobre la que operan las tools. */
  cwd: string;
  /** Modelo ya prefijado (p. ej. `gemini-2.5-flash`, `ollama/llama3`). */
  model?: string;
  /** Máximo de pasos del bucle. */
  maxSteps?: number;
  /**
   * Emite el texto del modelo en vivo (SSE). Solo aplica a los modelos del
   * dialecto Gemini; el resto cae automáticamente a la llamada sin streaming.
   */
  stream?: boolean;
  /** Callback de progreso para la TUI. */
  onEvent?: (event: CliAgentEvent) => void;
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Quita barras finales para componer URLs de forma segura. */
export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}

/** Comprueba que el servidor responde en `/api/health`. */
export async function checkHealth(
  serverUrl: string
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(`${normalizeServerUrl(serverUrl)}/api/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { status?: string };
    return { ok: true, detail: data.status };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Ejecuta una tool del agente en el servidor. */
export async function runTool(
  serverUrl: string,
  toolId: string,
  input: unknown
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const res = await fetch(`${normalizeServerUrl(serverUrl)}/api/agent/run-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId, input }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(data.error ?? `HTTP ${res.status}`) };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ruta de generación del servidor según el dialecto del modelo. */
function generateRoute(model: string): string {
  return resolveEndpoint(model);
}

/** Ruta SSE de streaming, o `null` si el modelo no la soporta. */
function streamRoute(model: string): string | null {
  return resolveStreamEndpoint(model);
}

/** Cuerpo común de la petición al LLM (compartido por streaming y no-streaming). */
function buildPayload(
  opts: RunAgentOptions,
  history: string[],
  dialect: ReturnType<typeof toolDialectForModel>
): Record<string, unknown> {
  const model = opts.model || 'gemini-2.5-flash';
  const user =
    `OBJETIVO: ${opts.task}\nCWD: ${opts.cwd}\n\n` +
    (history.length
      ? `HISTORIAL:\n${history.join('\n')}`
      : 'Aún no hay pasos. Empieza explorando el proyecto.');

  const systemInstruction =
    'Eres un agente autónomo de código. Razona brevemente y llama herramientas ' +
    `para avanzar hacia: ${opts.task}. Si el objetivo está cumplido, responde ` +
    'SOLO texto final sin llamar herramientas.';

  const payload: Record<string, unknown> = {
    contents: user,
    prompt: user,
    systemInstruction,
    model,
    temperature: 0.2,
    maxTokens: 2048,
  };
  // El CLI no pinta el plan y su bucle manda los nombres tal cual al backend:
  // no le ofrecemos `update_plan`, que aquí no existe como tool.
  const declarations = AGENT_FUNCTION_DECLARATIONS.filter((d) => d.name !== PLAN_TOOL);
  payload.tools =
    dialect === 'gemini'
      ? [{ functionDeclarations: declarations }]
      : toOpenAITools(declarations);
  return payload;
}

/** Resultado de una vuelta del LLM. */
interface ModelTurn {
  thought: string;
  calls: ToolCall[];
  /** ¿La respuesta se recibió por streaming (chunks)? */
  streamed: boolean;
}

/** Una vuelta del LLM consumiendo el endpoint SSE (tokens en vivo). */
async function streamModel(
  opts: RunAgentOptions,
  history: string[],
  route: string,
  onChunk: (text: string) => void
): Promise<ModelTurn> {
  const dialect = toolDialectForModel(opts.model || 'gemini-2.5-flash');
  const res = await fetch(`${normalizeServerUrl(opts.serverUrl)}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(buildPayload(opts, history, dialect)),
  });
  if (!res.ok || !res.body) throw new Error(`LLM HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let calls: ToolCall[] = [];

  const handleEvent = (raw: string) => {
    const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
    if (!dataLine) return;
    const json = dataLine.slice(5).trim();
    if (!json || json === '[DONE]') return;
    let evt: {
      type?: string;
      text?: string;
      fullText?: string;
      functionCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
      error?: string;
      message?: string;
    };
    try {
      evt = JSON.parse(json);
    } catch {
      return;
    }
    if (evt.type === 'error') {
      throw new Error(evt.error || evt.message || 'Error del stream');
    }
    if (evt.type === 'chunk' && evt.text) {
      fullText += evt.text;
      onChunk(evt.text);
    } else if (evt.type === 'done') {
      if (typeof evt.fullText === 'string' && evt.fullText) fullText = evt.fullText;
      calls = (evt.functionCalls || []).map((fc) => ({ name: fc.name, args: fc.args || {} }));
    }
  };

  // SSE separa eventos por doble salto de línea; buffer para chunks partidos.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) handleEvent(part);
  }
  if (buffer.trim()) handleEvent(buffer);

  return { thought: fullText, calls, streamed: true };
}

/** Una vuelta del LLM: pensamiento + posibles toolCalls. */
async function callModel(
  opts: RunAgentOptions,
  history: string[],
  onChunk?: (text: string) => void
): Promise<ModelTurn> {
  const model = opts.model || 'gemini-2.5-flash';
  const dialect = toolDialectForModel(model);
  if (dialect === 'json-text') {
    throw new Error(
      `El modelo "${model}" no soporta function calling nativo. Usa un modelo Gemini u OpenAI-compatible.`
    );
  }

  // Streaming en vivo (solo dialectos con endpoint SSE).
  const route = streamRoute(model);
  if (opts.stream && route && onChunk) {
    return streamModel(opts, history, route, onChunk);
  }

  const res = await fetch(`${normalizeServerUrl(opts.serverUrl)}${generateRoute(model)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPayload(opts, history, dialect)),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);

  const data = (await res.json()) as {
    text?: string;
    functionCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
    toolCalls?: { name: string; args?: Record<string, unknown> }[];
    choices?: { message?: { content?: string } }[];
  };

  const calls =
    dialect === 'gemini'
      ? (data.functionCalls || []).map((fc) => ({ name: fc.name, args: fc.args || {} }))
      : (data.toolCalls || []).map((tc) => ({ name: tc.name, args: tc.args || {} }));
  const thought =
    dialect === 'gemini'
      ? data.text || ''
      : data.text || data.choices?.[0]?.message?.content || '';
  return { thought, calls, streamed: false };
}

/** Recorta la salida de una tool para no inundar la terminal. */
function summarize(data: unknown, max = 500): string {
  if (data == null) return '(sin datos)';
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Ejecuta el bucle del agente hasta terminar o agotar `maxSteps`.
 * Devuelve la respuesta final (si la hubo) y el número de pasos consumidos.
 */
export async function runAgent(
  opts: RunAgentOptions
): Promise<{ answer: string; steps: number }> {
  const emit = opts.onEvent ?? (() => {});
  const maxSteps = Math.max(1, opts.maxSteps ?? 25);
  const history: string[] = [];
  let steps = 0;

  for (let i = 0; i < maxSteps; i++) {
    steps = i + 1;
    emit({ type: 'status', text: `Paso ${steps}/${maxSteps}: pensando…` });

    let thought = '';
    let calls: ToolCall[] = [];
    let streamed = false;
    try {
      ({ thought, calls, streamed } = await callModel(opts, history, (text) =>
        emit({ type: 'chunk', text })
      ));
    } catch (e) {
      emit({ type: 'error', text: e instanceof Error ? e.message : String(e) });
      return { answer: '', steps };
    }

    // Con streaming el texto ya se vio en vivo; no lo repetimos.
    if (thought && !streamed) emit({ type: 'thought', text: thought });

    if (calls.length === 0) {
      emit({ type: 'answer', text: thought || '(el modelo no devolvió respuesta)' });
      return { answer: thought, steps };
    }

    history.push(`ASISTENTE: ${thought}`);
    for (const call of calls) {
      emit({ type: 'tool_call', tool: call.name, input: call.args });
      const result = await runTool(opts.serverUrl, call.name, {
        ...call.args,
        root: opts.cwd,
      });
      const summary = result.ok ? summarize(result.data) : `ERROR: ${result.error}`;
      emit({ type: 'tool_result', tool: call.name, ok: result.ok, summary });
      history.push(`TOOL ${call.name} → ${summary}`);
    }
  }

  const text = `Se alcanzó el límite de ${maxSteps} pasos sin obtener respuesta final.`;
  emit({ type: 'error', text });
  return { answer: '', steps };
}
