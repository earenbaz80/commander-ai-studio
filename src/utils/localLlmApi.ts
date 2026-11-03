/**
 * Cliente para configurar y probar el LLM local (Ollama / LM Studio / OpenAI-compatible).
 *
 * Reutiliza las rutas del servidor:
 *  • GET /api/ollama/models  → lista los modelos de un servidor Ollama.
 *  • GET /api/custom/models  → lista los modelos de un endpoint
 *    OpenAI-compatible (`${baseURL}/models`: LM Studio, llama.cpp, vLLM…).
 */

export type LocalLlmRuntime = 'ollama' | 'lmstudio' | 'openai';

/** Modelos populares de Ollama con metadatos para UI. */
export interface OllamaModelInfo {
  name: string;
  description: string;
  size?: string;
  tags?: string[];
}

export const POPULAR_OLLAMA_MODELS: OllamaModelInfo[] = [
  { name: 'llama3.2', description: 'Meta Llama 3.2 (3B) — rápido y eficiente', size: '~2 GB', tags: ['chat', 'general'] },
  { name: 'llama3.2:1b', description: 'Meta Llama 3.2 (1B) — ultra ligero', size: '~1.3 GB', tags: ['chat', 'tiny'] },
  { name: 'llama3.1', description: 'Meta Llama 3.1 (8B) — potente y versátil', size: '~4.7 GB', tags: ['chat', 'reasoning'] },
  { name: 'qwen2.5-coder', description: 'Qwen 2.5 Coder (7B) — experto en código', size: '~4.4 GB', tags: ['code', 'programming'] },
  { name: 'qwen2.5-coder:1.5b', description: 'Qwen 2.5 Coder (1.5B) — código ligero', size: '~1.1 GB', tags: ['code', 'tiny'] },
  { name: 'deepseek-r1', description: 'DeepSeek R1 (7B) — razonamiento avanzado', size: '~4.4 GB', tags: ['reasoning', 'math'] },
  { name: 'deepseek-r1:1.5b', description: 'DeepSeek R1 (1.5B) — razonamiento ligero', size: '~1.1 GB', tags: ['reasoning', 'tiny'] },
  { name: 'mistral', description: 'Mistral 7B — equilibrado y rápido', size: '~4.1 GB', tags: ['chat', 'general'] },
  { name: 'mistral-nemo', description: 'Mistral NeMo 12B — mayor contexto', size: '~7.1 GB', tags: ['chat', 'long-context'] },
  { name: 'codellama', description: 'Code Llama 7B — especializado en código', size: '~3.8 GB', tags: ['code'] },
  { name: 'phi3', description: 'Phi-3 Mini (3.8B) — Microsoft, muy rápido', size: '~2.3 GB', tags: ['chat', 'tiny'] },
  { name: 'gemma2', description: 'Gemma 2 (9B) — Google, alta calidad', size: '~5.4 GB', tags: ['chat', 'general'] },
];

export interface LocalLlmTestResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

/**
 * Descarga (pull) un modelo en Ollama vía SSE streaming.
 * Llama a /api/ollama/pull y devuelve progreso via callback.
 */
export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

export async function pullOllamaModel(
  model: string,
  host: string,
  onProgress?: (p: PullProgress) => void
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/ollama/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, host }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.error || `HTTP ${res.status}` };
    }

    if (!res.body) return { ok: false, error: 'No response stream' };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const data = JSON.parse(line.slice(5).trim());
          if (data.done) return { ok: true };
          if (data.error) return { ok: false, error: data.error };
          if (data.progress && onProgress) {
            const p = data.progress;
            onProgress({
              status: p.status || '',
              digest: p.digest,
              total: p.total,
              completed: p.completed,
            });
          }
        } catch {
          // ignore parse errors
        }
      }
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Pull failed' };
  }
}

/** Lista los modelos de un servidor Ollama (por defecto localhost:11434). */
export async function listOllamaModels(host: string): Promise<LocalLlmTestResult> {
  try {
    const res = await fetch(`/api/ollama/models?host=${encodeURIComponent(host)}`);
    const data = await res.json().catch(() => ({}));
    const models = Array.isArray(data.models)
      ? data.models
          .map((m: any) => (typeof m === 'string' ? m : m?.name))
          .filter(Boolean)
      : [];
    const ok = data.success === true || models.length > 0;
    return ok ? { ok: true, models } : { ok: false, error: data.error || 'El servidor no respondió' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error de red' };
  }
}

/**
 * Lista los modelos de LM Studio usando su ruta propia.
 *
 * No usa `/api/custom/models` a propósito: LM Studio y un endpoint genérico
 * OpenAI-compatible son configuraciones distintas, con host y credenciales
 * distintas. El servidor normaliza `http://IP:1234` a `/v1` y consulta también
 * la ruta nativa `/api/v0/models` para servidores remotos antiguos.
 */
export async function listLmStudioModels(host: string): Promise<LocalLlmTestResult> {
  try {
    const res = await fetch('/api/lmstudio/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host }),
    });
    const data = await res.json().catch(() => ({}));
    const models = Array.isArray(data.models) ? data.models.filter(Boolean) : [];
    // `success` significa «el servidor respondió», no «tiene modelos»: LM Studio
    // puede estar abierto sin ningún modelo cargado.
    return data.success === true
      ? { ok: true, models }
      : { ok: false, error: data.error || 'LM Studio no respondió' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error de red' };
  }
}

/** Lista los modelos de un endpoint OpenAI-compatible (`${baseURL}/models`). */
export async function listCustomModels(baseURL: string, apiKey?: string): Promise<LocalLlmTestResult> {
  try {
    const res = await fetch('/api/custom/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseURL, apiKey }),
    });
    const data = await res.json().catch(() => ({}));
    const models = Array.isArray(data.models) ? data.models.filter(Boolean) : [];
    const ok = data.success === true || models.length > 0;
    return ok ? { ok: true, models } : { ok: false, error: data.error || 'El servidor no respondió' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error de red' };
  }
}

/** Prueba la conexión según el runtime elegido. */
export function testLocalLlm(runtime: LocalLlmRuntime, url: string, apiKey?: string): Promise<LocalLlmTestResult> {
  if (runtime === 'ollama') return listOllamaModels(url);
  if (runtime === 'lmstudio') return listLmStudioModels(url);
  return listCustomModels(url, apiKey);
}

export interface OllamaHealthResult {
  ok: boolean;
  models?: string[];
  error?: string;
  host?: string;
}

export async function checkOllamaHealth(host: string): Promise<OllamaHealthResult> {
  try {
    const res = await fetch(`/api/ollama/health?host=${encodeURIComponent(host)}`);
    const data = await res.json().catch(() => ({}));
    const models = Array.isArray(data.models) ? data.models.filter(Boolean) : [];
    const ok = data.ok === true || data.success === true;
    return { ok, models, error: data.error || undefined, host: data.host || undefined };
  } catch (e: any) {
    return { ok: false, models: [], error: e?.message || 'error' };
  }
}