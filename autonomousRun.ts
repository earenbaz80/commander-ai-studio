import { executeTask } from './agentSession';
import { dequeueNext, updateQueueItem, recordReceipt, enqueueItem, listQueue, createThread, getThread } from './persistence';
import { uid } from './src/agent/id';
import { resolveEndpoint } from './src/lib/aiProviders';
import { getServerBaseUrl } from './serverRuntime';
import { GEMINI_DEFAULT_MODEL } from './src/config/geminiModels';

export interface AutoRunOptions {
  parentSessionId: string;
  goal?: string;
  keys?: any;
  cwd?: string;
  model?: string;
  maxSteps?: number;
  allowedTools?: string[] | null;
  mode?: 'build' | 'plan' | 'readonly';
}

/**
 * Presupuesto de una llamada al planificador. Sin esto, la cadena de respaldo
 * del server puede tardar minutos y `POST /api/autonomous/:id/plan` se queda
 * colgado: una descomposición que tarda más de un minuto ya no sirve.
 */
export const PLAN_TIMEOUT_MS = 60_000;

/** `AbortSignal.timeout` aborta con `TimeoutError`; un abort manual, con `AbortError`. */
function isTimeout(e: unknown): boolean {
  const name = (e as any)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * La cola tiene `FOREIGN KEY (thread_id) REFERENCES threads(id)`.
 *
 * Planificar para un hilo que aún no está en la base reventaba al encolar con
 * `FOREIGN KEY constraint failed` —después de gastar la llamada al LLM—, así
 * que el plan salía `ok: false` sin una sola tarea. El hilo se crea aquí, en el
 * momento de encolar: si el plan falla antes, no queda un hilo vacío de basura.
 */
function ensureThread(threadId: string, goal: string, model: string): void {
  if (getThread(threadId)) return;
  createThread({ id: threadId, title: goal.slice(0, 120), model });
}

export async function planCampaign(threadId: string, goal: string, opts: AutoRunOptions): Promise<{ ok: boolean; enqueued: number; tasks: { prompt: string; label: string }[]; error?: string }> {
  // El default sale del módulo compartido. El id que estaba escrito aquí a mano
  // ya está retirado (404), así que el planner gastaba su primer intento en un
  // modelo muerto; ahora hereda el mismo default que el resto de la app.
  const model = opts.model || GEMINI_DEFAULT_MODEL;
  const buildPrompt = (retry: boolean) => `Eres un manager de tareas para un agente de código. Descompone el objetivo en 3-8 tareas concretas, atómicas y ejecutables (cada una editable por un agente). Devuelve ÚNICAMENTE JSON válido con este esquema exacto:
{"tasks":[{"prompt":"instrucción completa y autocontenida para el agente","label":"título corto","priority":0,"recovery_prompt":"qué hacer si falla (opcional)"}]}
Reglas: prompt debe ser autocontenido (incluir rutas/archivos relevantes); no dupliques tareas; ordena por dependencia; máximo 8 tareas.${retry ? '\nIMPORTANTE: responde SOLO con el JSON, sin markdown ni texto adicional.' : ''}
Objetivo: ${goal}`;

  const call = async (retry: boolean) => {
    // `resolveEndpoint` devuelve una ruta (`/api/gemini/generate`): en Node un
    // fetch relativo lanza «Failed to parse URL». Las llamadas internas del
    // server van contra su propia base (fijada al escuchar).
    const route = `${getServerBaseUrl()}${resolveEndpoint(model)}`;
    const res = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        contents: buildPrompt(retry),
        prompt: buildPrompt(retry),
        temperature: retry ? 0 : 0.2,
        maxTokens: 2048,
        openrouterApiKey: opts.keys?.OPENROUTER_API_KEY || undefined,
        ollamaHost: opts.keys?.OLLAMA_HOST || undefined,
        baseURL: opts.keys?.CUSTOM_BASE_URL || undefined,
        apiKey: opts.keys?.CUSTOM_API_KEY || opts.keys?.OPENCODE_API_KEY || undefined,
      }),
      signal: AbortSignal.timeout(PLAN_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = (data as any).text || (data as any).content || (data as any).candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = String(text).match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { tasks: [] };
  };

  try {
    let parsed: any;
    try { parsed = await call(false); }
    catch (e) {
      // Un timeout no es una respuesta mal formada: reintentar duplicaría la
      // espera (dos veces el presupuesto) sin cambiar el resultado.
      if (isTimeout(e)) throw e;
      parsed = await call(true);
    }
    const raw = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    // Validación + dedupe + cap
    const seen = new Set<string>();
    const tasks: any[] = [];
    for (const t of raw) {
      if (!t || !t.prompt) continue;
      const prompt = String(t.prompt).trim().slice(0, 4000);
      if (!prompt || seen.has(prompt)) continue;
      seen.add(prompt);
      tasks.push({
        prompt,
        label: String(t.label || t.prompt).trim().slice(0, 120),
        priority: Number.isFinite(t.priority) ? t.priority : 0,
        recovery_prompt: t.recovery_prompt ? String(t.recovery_prompt).slice(0, 4000) : undefined,
      });
      if (tasks.length >= 8) break;
    }
    if (tasks.length > 0) ensureThread(threadId, goal, model);
    let enqueued = 0;
    for (const t of tasks) {
      const id = uid('q');
      enqueueItem({
        id,
        threadId,
        prompt: t.prompt,
        label: t.label,
        note: 'manager-llm',
        source: 'manager-llm',
        priority: t.priority,
      });
      if (t.recovery_prompt) {
        try { const { updateQueueItem } = await import('./persistence'); updateQueueItem(id, { recovery_prompt: t.recovery_prompt }); } catch { /* ignore */ }
      }
      enqueued++;
    }
    return { ok: true, enqueued, tasks: tasks.map((t) => ({ prompt: t.prompt, label: t.label })) };
  } catch (e: any) {
    const error = isTimeout(e)
      ? `el modelo no respondió en ${Math.round(PLAN_TIMEOUT_MS / 1000)}s`
      : e?.message || 'error';
    return { ok: false, enqueued: 0, tasks: [], error };
  }
}

export async function runAutonomousCampaign(threadId: string, opts: AutoRunOptions): Promise<{ ok: boolean; processed: number; error?: string }> {
  const campaignStartedAt = Date.now();
  let ordinal = 0;
  let processed = 0;
  try {
    // Manager-LLM autónomo: si hay objetivo y la cola está vacía, descomponer
    // automáticamente antes de empezar a consumir.
    if (opts.goal) {
      // Los ítems nacen en `pending` (enqueueItem) y pasan a `claimed` al
      // desencolarse: mirar `queued` daba siempre vacío y re-planificaba en
      // cada campaña, duplicando tareas.
      const pending = listQueue(threadId, 'pending');
      if (pending.length === 0) {
        await planCampaign(threadId, opts.goal, opts);
      }
    }
    while (true) {
      const item = dequeueNext(threadId);
      if (!item) break;
      ordinal++;
      processed++;
      const result = await executeTask(opts.parentSessionId, {
        goal: item.prompt,
        instructions: item.note || undefined,
        model: opts.model,
        allowedTools: opts.allowedTools,
        mode: opts.mode,
        maxSteps: opts.maxSteps ?? 20,
      }, opts.keys, opts.cwd);
      const status = result.ok ? 'done' : 'failed';
      updateQueueItem(item.id, { state: status, note: result.error || item.note || undefined });
      recordReceipt({
        id: uid('rcpt'),
        threadId,
        campaignStartedAt,
        ordinal,
        effort: 'standard',
        status,
        queueItemId: item.id,
        outcomeJson: result,
      });
      if (!result.ok && item.recovery_prompt) {
        try {
          enqueueItem({
            id: uid('q'),
            threadId,
            prompt: item.recovery_prompt,
            label: `recovery for ${item.id}`,
            note: 'auto-recovery',
            source: 'auto-run',
          });
        } catch { /* ignore */ }
      }
    }
    return { ok: true, processed };
  } catch (e: any) {
    return { ok: false, processed, error: e?.message || 'error' };
  }
}
