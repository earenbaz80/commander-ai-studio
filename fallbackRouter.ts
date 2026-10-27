/**
 * Fallback Router (P1 #10) - Enrutador inteligente con fallback automático.
 *
 * Características:
 * - Lista de proveedores en orden de prioridad
 * - Health checks periódicos
 * - Fallback automático por error/cuota/latencia
 * - Métricas de uso por proveedor
 * - Circuit breaker para proveedores caídos
 */

import { getServerBaseUrl } from './serverRuntime';
import { GEMINI_MODEL_CHAIN } from './src/config/geminiModels';

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string; // ej: '/api/gemini/generate'
  priority: number; // menor = mayor prioridad
  enabled: boolean;
  models: string[]; // modelos soportados
  supportsTools: boolean;
  supportsStreaming: boolean;
  maxTokens: number;
  rateLimit: { requests: number; windowMs: number };
}

export interface ProviderHealth {
  providerId: string;
  healthy: boolean;
  lastCheck: number;
  latencyMs: number;
  errorCount: number;
  lastError?: string;
  circuitOpen: boolean;
  circuitOpenedAt?: number;
}

export interface FallbackRequest {
  providerId?: string; // si se especifica, intenta ese primero
  model: string;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: any[];
  stream?: boolean;
}

export interface FallbackResponse {
  success: boolean;
  providerId: string;
  text?: string;
  toolCalls?: any[];
  error?: string;
  latencyMs: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

export interface ProviderMetrics {
  providerId: string;
  requests: number;
  successes: number;
  errors: number;
  totalLatencyMs: number;
  lastUsed: number;
}

// Configuración de proveedores (orden = prioridad)
export const PROVIDERS: ProviderConfig[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: '/api/gemini/generate',
    priority: 1,
    enabled: true,
    models: [...GEMINI_MODEL_CHAIN],
    supportsTools: true,
    supportsStreaming: true,
    maxTokens: 8192,
    rateLimit: { requests: 60, windowMs: 60_000 },
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: '/api/openrouter/generate',
    priority: 2,
    enabled: true,
    models: ['openai/gpt-4o', 'openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'],
    supportsTools: true,
    supportsStreaming: true,
    maxTokens: 4096,
    rateLimit: { requests: 100, windowMs: 60_000 },
  },
  {
    id: 'pollinations',
    name: 'Pollinations',
    baseUrl: '/api/pollinations/generate',
    priority: 3,
    enabled: true,
    models: ['openai', 'gpt-4o', 'gpt-3.5-turbo'],
    supportsTools: false,
    supportsStreaming: false,
    maxTokens: 2048,
    rateLimit: { requests: 200, windowMs: 60_000 },
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    baseUrl: '/api/ollama/generate',
    priority: 4,
    enabled: true,
    models: ['llama3.2', 'codellama', 'mistral'],
    supportsTools: true,
    supportsStreaming: true,
    maxTokens: 4096,
    rateLimit: { requests: 1000, windowMs: 60_000 },
  },
];

// Estado en memoria
const health = new Map<string, ProviderHealth>();
const metrics = new Map<string, ProviderMetrics>();
const circuitBreakerThreshold = 5; // errores consecutivos para abrir circuit
const circuitBreakerTimeout = 60_000; // 1 min para reintentar

// Inicializar estado
for (const p of PROVIDERS) {
  health.set(p.id, {
    providerId: p.id,
    healthy: p.enabled,
    lastCheck: 0,
    latencyMs: 0,
    errorCount: 0,
    circuitOpen: false,
  });
  metrics.set(p.id, {
    providerId: p.id,
    requests: 0,
    successes: 0,
    errors: 0,
    totalLatencyMs: 0,
    lastUsed: 0,
  });
}

/**
 * Obtiene lista de proveedores disponibles (ordenados por prioridad).
 */
export function getAvailableProviders(model?: string): ProviderConfig[] {
  return PROVIDERS.filter(p => p.enabled && (!model || p.models.includes(model)))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Health check de un proveedor.
 */
export async function checkProviderHealth(providerId: string): Promise<ProviderHealth> {
  const provider = PROVIDERS.find(p => p.id === providerId);
  if (!provider) throw new Error(`Proveedor ${providerId} no encontrado`);

  const h = health.get(providerId)!;
  const start = Date.now();

  try {
    const res = await fetch(`${getServerBaseUrl()}${provider.baseUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'health check',
        model: provider.models[0],
        maxTokens: 10,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(5000),
    });

    const latency = Date.now() - start;
    const healthy = res.ok;

    h.healthy = healthy;
    h.lastCheck = Date.now();
    h.latencyMs = latency;
    if (healthy) {
      h.errorCount = 0;
      h.circuitOpen = false;
    } else {
      h.errorCount++;
      h.lastError = `HTTP ${res.status}`;
      if (h.errorCount >= circuitBreakerThreshold) {
        h.circuitOpen = true;
        h.circuitOpenedAt = Date.now();
      }
    }
  } catch (error: any) {
    const latency = Date.now() - start;
    h.healthy = false;
    h.lastCheck = Date.now();
    h.latencyMs = latency;
    h.errorCount++;
    h.lastError = error?.message || String(error);
    if (h.errorCount >= circuitBreakerThreshold) {
      h.circuitOpen = true;
      h.circuitOpenedAt = Date.now();
    }
  }

  return h;
}

/**
 * Obtiene el siguiente proveedor saludable para un modelo.
 */
export function getNextHealthyProvider(model?: string, excludeId?: string): ProviderConfig | null {
  const providers = getAvailableProviders(model);
  const now = Date.now();

  for (const p of providers) {
    if (p.id === excludeId) continue;
    const h = health.get(p.id)!;
    if (!h.healthy) continue;
    if (h.circuitOpen && h.circuitOpenedAt && (now - h.circuitOpenedAt) < circuitBreakerTimeout) continue;
    return p;
  }
  return null;
}

/**
 * Ejecuta request con fallback automático.
 */
export async function executeWithFallback(req: FallbackRequest): Promise<FallbackResponse> {
  const startTotal = Date.now();
  let currentProvider = req.providerId ? PROVIDERS.find(p => p.id === req.providerId) : null;
  let fallbackUsed = false;
  let fallbackReason = '';
  let attempts = 0;

  if (!currentProvider) {
    currentProvider = getNextHealthyProvider(req.model);
  }

  while (currentProvider && attempts < PROVIDERS.length) {
    attempts++;
    const start = Date.now();
    const m = metrics.get(currentProvider.id)!;
    const h = health.get(currentProvider.id)!;

    try {
      // Verificar circuit breaker
      if (h.circuitOpen && h.circuitOpenedAt && (Date.now() - h.circuitOpenedAt) < circuitBreakerTimeout) {
        throw new Error('Circuit breaker abierto');
      }

      const body = {
        model: req.model,
        prompt: req.prompt,
        systemInstruction: req.systemInstruction,
        temperature: req.temperature ?? 0.7,
        maxTokens: req.maxTokens ?? currentProvider.maxTokens,
        tools: req.tools,
        stream: req.stream ?? false,
      };

      const res = await fetch(`${getServerBaseUrl()}${currentProvider.baseUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      const latency = Date.now() - start;

      if (res.ok) {
        const data = await res.json();
        // Actualizar métricas
        m.requests++;
        m.successes++;
        m.totalLatencyMs += latency;
        m.lastUsed = Date.now();

        // Health check exitoso
        const h = health.get(currentProvider.id)!;
        h.healthy = true;
        h.errorCount = 0;
        h.circuitOpen = false;
        h.latencyMs = latency;

        return {
          success: true,
          providerId: currentProvider.id,
          text: data.text,
          toolCalls: data.toolCalls,
          latencyMs: Date.now() - startTotal,
          fallbackUsed,
          fallbackReason,
        };
      } else {
        // Error del proveedor - marcar y fallback
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
    } catch (error: any) {
      const latency = Date.now() - start;
      const m = metrics.get(currentProvider.id)!;
      const h = health.get(currentProvider.id)!;

      m.requests++;
      m.errors++;
      m.totalLatencyMs += latency;
      m.lastUsed = Date.now();

      h.errorCount++;
      h.lastError = error?.message || String(error);
      if (h.errorCount >= 3) { // umbral más bajo para fallback rápido
        h.circuitOpen = true;
        h.circuitOpenedAt = Date.now();
      }
      h.healthy = false;
      h.lastCheck = Date.now();

      fallbackUsed = true;
      fallbackReason = error?.message || String(error);

      // Buscar siguiente proveedor
      currentProvider = getNextHealthyProvider(req.model, currentProvider.id);
      if (!currentProvider) break;
    }
  }

  // Todos fallaron
  return {
    success: false,
    providerId: '',
    error: 'Todos los proveedores fallaron',
    latencyMs: Date.now() - startTotal,
    fallbackUsed: true,
    fallbackReason: 'Todos los proveedores fallaron',
  };
}

/**
 * Obtiene métricas de todos los proveedores.
 */
export function getProviderMetrics() {
  const result: Record<string, any> = {};
  for (const [id, m] of metrics) {
    const h = health.get(id)!;
    result[id] = {
      providerId: m.providerId,
      requests: m.requests,
      successes: m.successes,
      errors: m.errors,
      errorRate: m.requests > 0 ? m.errors / m.requests : 0,
      avgLatencyMs: m.successes > 0 ? m.totalLatencyMs / m.successes : 0,
      lastUsed: m.lastUsed,
      healthy: h.healthy ?? false,
      circuitOpen: h.circuitOpen ?? false,
    };
  }
  return result;
}

/**
 * Health check de todos los proveedores (para dashboard).
 */
export async function checkAllProvidersHealth() {
  await Promise.all(PROVIDERS.filter(p => p.enabled).map(p => checkProviderHealth(p.id)));
  return Array.from(health.values());
}

/**
 * Resetea circuit breaker de un proveedor (admin).
 */
export function resetCircuitBreaker(providerId: string) {
  const h = health.get(providerId);
  if (h) {
    h.circuitOpen = false;
    h.circuitOpenedAt = undefined;
    h.errorCount = 0;
    h.healthy = true;
  }
}

/**
 * Habilita/deshabilita proveedor.
 */
export function setProviderEnabled(providerId: string, enabled: boolean) {
  const p = PROVIDERS.find(p => p.id === providerId);
  if (p) p.enabled = enabled;
  const h = health.get(providerId);
  if (h) h.healthy = enabled;
}