import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { createHash } from 'crypto';
import { spawn, execFileSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import JSZip from 'jszip';
import { executeAgentTool, handleAgentRunTool } from './agentTools';
import * as persistence from './persistence';
import * as worktrees from './worktrees';
import { readProjectGitRemote } from './projectRemote';
import { runAutonomousCampaign, planCampaign } from './autonomousRun';
import { setServerBaseUrl } from './serverRuntime';
import { bindExposureWarning, resolveBindHost } from './src/lib/bindHost';
import { addRoot, listRoots, removeRoot, removableRoots, resolveProjectPath } from './projects';
import { enforceTool, getPermissions, setPermissions } from './permissions';
import { mergeRuleSets, normalizeRules } from './src/agent/permissionRules';
// `listSessions` ya lo exporta `sessionWorkspace` (sesiones de UI): se aliasa.
import { createSession, forkSession, getOrLoadSession, listSessions as listAgentSessions, removeSession, stopSession } from './agentSession';
import { isValidSessionId } from './src/agent/sessionStore';
import { decodeSessionState, type ApprovalDecision } from './src/agent/sessionTypes';
import { normalizeOpenAIToolCalls, THINKING_OFF_PARAMS } from './src/agent/providers';
import { truncatedChatCompletions, truncatedOllama } from './src/agent/providerResponses';
import { attachSessionStream, parseStreamCursor } from './src/agent/sessionStream';
import { cancelSubAgents, clearSubAgents, listSubAgents, subscribeSubAgents } from './subAgents';
import { stopJobsForSession } from './shellJobs';
import { closePtysForSession } from './ptySessions';
import {
  handleGeminiGenerate,
  handleGeminiStream,
  handleGeminiInteractions,
  handleResetToolsMemory,
  handleToolsMemoryStatus,
  handleSetToolsMemoryTtl,
  handleFallbackModelsStatus,
  handleSetFallbackModels,
} from './gemini';
import { handleAnthropicGenerate, handleAnthropicStream } from './anthropic';
import { executeLocalHfModel, mapGeminiModel } from './localModels';
import { countProviderTokens, estimateContextTokens } from './src/lib/contextFit';
import { handleApiKeySet, handleApiKeyGet, handleApiKeyDelete, handleApiKeysList, apiKeyMiddleware, getApiKey as getRequestApiKey } from './apiKeys';
import { isAllowedHost, allowedHostsFromEnv } from './hostGuard';
import { CONTENT_SECURITY_POLICY } from './security';
import { clearStrataLocalApiKey, getConfig, getConfigPath, getEnvProviderIds, getGlobalConfigPath, getProviderFileConfig, getProviderSecret, loadConfig, removeOpenAiCompatibleProvider, removeProviderConfig } from './src/config/index';
import { PROVIDER_SPECS, NVIDIA_DEFAULT_MODEL, buildProviderList, customProviderSpecs, describeProvider, getAllProviderCatalog, getProviderCatalog } from './src/providers/registry';
import { parseCompatibleModelId, slugifyProviderId } from './src/lib/openaiCompatibleProviders';
import { filterModelIds } from './src/lib/providerFilters';
import { probeLocalProvider } from './src/providers/localProbe';
import {
  normalizeStrataLocalBaseUrl,
  probeStrataLocal,
  strataLocalEndpointInfo,
  strataLocalModelId,
  strataLocalModelName,
  STRATA_LOCAL_PROVIDER_ID,
  type StrataLocalModelInfo,
} from './src/lib/strataLocal';
import { mergeStrataToolCallFragment, normalizeStrataToolCalls } from './src/lib/strataTools';
import { StrataLifecycleManager } from './src/lib/strataLifecycle';
import { deleteStrataApiKey, getStrataApiKey, normalizeStrataApiKey, saveStrataApiKey } from './src/lib/strataKeyStore';
import { redactStrataSecret } from './src/lib/strataRedaction';
import { redactSecrets } from './secretRedaction';
import {
  classifyStrataFailure,
  fetchStrataWithRetry,
  isStrataIntegrationError,
  parseRetryAfter,
  strataError,
  strataErrorPayload,
  type StrataIntegrationError,
} from './src/lib/strataErrors';
import skillsRouter from './skills/api';
import { forkSessionWorkspace, deleteSessionWorkspace, listSessions, createGitWorktree } from './sessionWorkspace';
import { handleOAuthLogin, handleOAuthCallback, handleLogout, getCurrentUser } from './oauth';
import { executeWithFallback, getProviderMetrics, checkAllProvidersHealth, resetCircuitBreaker, setProviderEnabled } from './fallbackRouter';
import { isDeprecatedGeminiModel } from './src/config/geminiModels';
import {
  INVALID_AUDIO_MESSAGE,
  TRANSCRIPTION_FAILED_MESSAGE,
  TRANSCRIPTION_MODELS,
  isInvalidAudioError,
  isRetryableTranscriptionError,
} from './src/lib/transcription';
import { handleFreebuffGenerate } from './freebuff';
import { listProjectPrompts } from './promptsApi';
import { LMSTUDIO_LOAD_TIMEOUT_MS, lmStudioContextLength, normalizeLmStudioHost, parseLmStudioContextLengths, parseLmStudioModels, toLmStudioContextLength } from './src/lib/lmStudio';
import { cachedLocalModels, rememberLocalModels } from './src/lib/localModelCache';
import {
  createRelease,
  getPublishedRelease,
  getPublishStatus,
  isValidPublishSlug,
  promoteRelease,
  resolvePublishedFile,
  rollbackProduction,
} from './publisher';
import { createConfiguredDeploymentAdapter } from './deploy/configuredAdapter';
import { createDeployRouter } from './deploy/routes';
import { createBrowserRouter } from './browserRoutes';
import { createIntegrationsRouter } from './src/integrations/router';
import { createTenantBackendRouter } from './backend/routes';
import { createBackendRouter } from './deploy/backend/routes';
import { injectBackendEnv } from './deploy/backend/releaseEnv';
import { createConfiguredBackendAdapter } from './deploy/backend/configuredAdapter';
import { safeFetch } from './ssrf';
import {
  LocalModelDownloadManager,
  hubDownloadUrl,
  listLocalModelRecords,
  parseHubGgufFiles,
  parseHubSearchResults,
  removeLocalModel,
  sanitizeGgufFilename,
  splitGgufParts,
} from './src/lib/localModelHub';
import {
  LocalLlamaRuntimeManager,
  findLlamaBinaries,
  localModelPath,
  type LocalRuntimeTuning,
} from './src/lib/localLlamaRuntime';
import { readGgufProfile } from './src/lib/ggufProfile';
import {
  detectLocalHardware,
  mergeProposedTuning,
  proposeLocalRuntimeTuning,
} from './src/lib/localRuntimeProposal';
import { scoreRuntimeAsset, selectCudartAsset } from './src/lib/localRuntimeRelease';
import { fetchChatWithOverflowRetry } from './src/lib/localPromptOverflow';
import { readLocalRuntimeTuning, writeLocalRuntimeTuning } from './src/lib/localRuntimeSettings';

dotenv.config();

const strataLifecycle = new StrataLifecycleManager();

const currentDir = typeof __dirname !== 'undefined' && __dirname
  ? __dirname
  : process.cwd();

const app = express();
app.use(express.json({ limit: '20mb' }));

// Anti DNS rebinding: un dominio ajeno que resuelve a loopback llega con ese
// `Host` y, desde el navegador, hablaría con esta API sin autenticación. Sólo
// pasan loopback, IP literal y lo que liste ALLOWED_HOSTS.
const allowedHosts = allowedHostsFromEnv();
app.use((req, res, next) => {
  if (isAllowedHost(req.headers.host, allowedHosts)) return next();
  return res.status(403).json({ success: false, error: 'Host no permitido' });
});

// Seguridad base sin nuevas deps: headers + CORS allowlist + rate-limit global
app.use((_req, _res, next) => {
  _res.setHeader('X-Content-Type-Options', 'nosniff');
  _res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  _res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
const CORS_ALLOW = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3280,http://localhost:5173,http://localhost:5174,http://localhost:5175').split(',');
app.use((_req, _res, next) => {
  const origin = _req.headers.origin as string | undefined;
  if (origin && CORS_ALLOW.includes(origin)) {
    _res.setHeader('Access-Control-Allow-Origin', origin);
    _res.setHeader('Access-Control-Allow-Credentials', 'true');
    _res.setHeader('Vary', 'Origin');
  }
  if (_req.method === 'OPTIONS') {
    _res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    _res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Commander-File-Name');
    _res.setHeader('Access-Control-Allow-Credentials', 'true');
    return _res.sendStatus(204);
  }
  next();
});
// Límite global por IP. La propia UI sondea claves, hilos y salud todo el
// rato, así que lectura y escritura llevan presupuestos separados y
// /api/health queda exento: un pico de sondeo no puede dejar sin margen a
// una mutación, ni una ráfaga de acciones bloquear el health del agente.
const RATE_WINDOW_MS = 60_000;
/**
 * Presupuesto por IP y minuto. En producción son 300 escrituras; la suite
 * comparte un solo server entre decenas de archivos y ese volumen no es el de
 * una UI, así que el arnés sube el tope por entorno (`COMMANDER_RATE_WRITE_MAX`)
 * en lugar de repartir los tests o desactivar el límite.
 */
function rateLimitFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}
const RATE_READ_MAX = rateLimitFromEnv('COMMANDER_RATE_READ_MAX', 1200);
const RATE_WRITE_MAX = rateLimitFromEnv('COMMANDER_RATE_WRITE_MAX', 300);
const RATE_EXEMPT = new Set(['/api/health']);
const globalRate = new Map<string, { read: number; write: number; reset: number }>();
app.use((_req, _res, next) => {
  if (_req.path.startsWith('/api/') && !RATE_EXEMPT.has(_req.path)) {
    const ip = (_req.ip || _req.socket?.remoteAddress || 'local').toString();
    const now = Date.now();
    const isWrite = _req.method !== 'GET' && _req.method !== 'HEAD' && _req.method !== 'OPTIONS';
    let e = globalRate.get(ip);
    if (!e || now > e.reset) {
      e = { read: 0, write: 0, reset: now + RATE_WINDOW_MS };
      globalRate.set(ip, e);
    }
    const used = isWrite ? ++e.write : ++e.read;
    const max = isWrite ? RATE_WRITE_MAX : RATE_READ_MAX;
    if (used > max) {
      const scopes = isWrite ? 'escrituras' : 'lecturas';
      return _res.status(429).json({
        success: false,
        ok: false,
        error: `Rate limit global (${max}/${scopes} por minuto)`,
      });
    }
    // Purga perezosa: sin esto el mapa crece con cada IP vista.
    if (globalRate.size > 512) {
      for (const [k, v] of globalRate) if (now > v.reset) globalRate.delete(k);
    }
  }
  next();
});

// Cookie parser manual (sin dependencia cookie-parser)
app.use((_req, _res, next) => {
  const header = _req.headers.cookie || '';
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      try { cookies[k] = decodeURIComponent(v); } catch { cookies[k] = v; }
    }
  }
  (_req as any).cookies = cookies;
  next();
});

// Las claves que guarda el panel viven en cookies httpOnly. Este middleware las
// copia a `req.apiKeys` una sola vez para todo /api: los handlers las leen con
// `getApiKey(req, 'NOMBRE')` y no vuelven a mirar cookies por su cuenta. Va
// después del parser (necesita `req.cookies`) y antes de las rutas.
app.use('/api', apiKeyMiddleware);

// API Keys management endpoints (httpOnly cookies)
app.post('/api/keys', handleApiKeySet);
app.get('/api/keys', handleApiKeysList);
app.get('/api/keys/:key', handleApiKeyGet);
app.delete('/api/keys', handleApiKeyDelete);

// Health check endpoint for Electron and orchestration diagnostics
// @ts-ignore
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', server: 'Commander AI Studio', timestamp: Date.now() });
});

// Service worker header configuration
// @ts-ignore
app.get('/sw.js', (req, res, next) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

// Initialize Google GenAI Server Client
const getGenAIClient = (overrideApiKey?: string) => {
  const apiKey = overrideApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY no configurado en entorno ni en solicitud.');
  }
  return new GoogleGenAI({
    apiKey: apiKey || 'dummy-key-for-init',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// Debug endpoint to list available models (solo dev, nunca en prod)
app.get('/api/gemini/debug/listModels', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, error: 'Debug deshabilitado en producción' });
  }
  try {
    const ai = getGenAIClient(req.query.apiKey as string | undefined);
    const result = await ai.models.list();
    const models = (result as any).models || result; 
    console.log('Available models:', JSON.stringify(models, null, 2));
    return res.json({ success: true, models: models });
  } catch (error: any) {
    console.error('Error listing models:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const NVIDIA_MODELS_URL = 'https://integrate.api.nvidia.com/v1/models';

/** Lista los ids de modelo de una API OpenAI-compatible usando una clave. */
async function fetchProviderModelIds(url: string, key: string): Promise<string[]> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'CommanderAIStudio/2.5' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const err: any = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${response.status}`);
  }
  const data: any = await response.json().catch(() => ({}));
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return list
    .map((m: any) => (typeof m === 'string' ? m : m?.id || m?.name))
    .filter((m: unknown): m is string => typeof m === 'string' && m.length > 0);
}

// Endpoint para probar API Key con diagnóstico detallado
app.post('/api/test-key', async (req, res) => {
  const { provider, key } = req.body;
  const cleanKey = typeof key === 'string' ? key.trim() : '';

  if (!cleanKey) {
    return res.status(400).json({
      success: false,
      error: 'La clave ingresada está vacía. Por favor introduce tu API Key.'
    });
  }

  try {
    if (provider === 'google') {
      const ai = new GoogleGenAI({ apiKey: cleanKey });
      try {
        const listResult = await ai.models.list({ config: { pageSize: 5 } });
        const availableModels: string[] = [];
        for await (const m of listResult) {
          if (m.name) availableModels.push(m.name.replace(/^models\//, ''));
        }
        return res.json({
          success: true,
          models: availableModels,
        });
      } catch (listErr: any) {
        const errMsg = listErr.message || '';
        if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('API key not valid') || listErr.status === 400) {
          return res.status(400).json({
            success: false,
            error: 'La API Key de Google no es válida o fue revocada. Consigue una nueva en Google AI Studio (https://aistudio.google.com/app/apikey).',
          });
        }
        if (errMsg.includes('PERMISSION_DENIED') || listErr.status === 403) {
          return res.status(403).json({
            success: false,
            error: 'Permiso denegado para esta clave de Google. Asegúrate de que la API de Gemini esté habilitada en tu consola.',
          });
        }
        throw listErr;
      }
    } else if (provider === 'anthropic') {
      if (!cleanKey.startsWith('sk-ant-') || cleanKey.length < 20) {
        return res.status(400).json({
          success: false,
          error: 'Formato de clave Anthropic inválido. Debe comenzar con "sk-ant-".'
        });
      }
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': cleanKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      if (!response.ok) {
        const errJson: any = await response.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `Anthropic HTTP ${response.status}`);
      }
    } else if (provider === 'xai') {
      if (!cleanKey.startsWith('xai-') || cleanKey.length < 20) {
        return res.status(400).json({
          success: false,
          error: 'Formato de clave xAI inválido. Debe comenzar con "xai-".'
        });
      }
    } else if (provider === 'huggingface') {
      const response = await fetch('https://huggingface.co/api/whoami', {
        headers: { Authorization: `Bearer ${cleanKey}` }
      });
      if (!response.ok) {
        throw new Error('El token de Hugging Face es inválido o no tiene permisos de lectura.');
      }
    } else if (provider === 'openrouter') {
      if (!cleanKey.startsWith('sk-or-') || cleanKey.length < 20) {
        return res.status(400).json({
          success: false,
          error: 'Formato de clave OpenRouter inválido. Debe comenzar con "sk-or-". Consigue una gratis en https://openrouter.ai/keys.'
        });
      }
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${cleanKey}` }
      });
      if (!response.ok) {
        throw new Error('La clave de OpenRouter es inválida o fue revocada.');
      }
    } else if (provider === 'openai') {
      const models = await fetchProviderModelIds(OPENAI_MODELS_URL, cleanKey);
      return res.json({ success: true, models });
    } else if (provider === 'nvidia') {
      const models = await fetchProviderModelIds(NVIDIA_MODELS_URL, cleanKey);
      return res.json({ success: true, models });
    } else if (provider === 'opencode') {
      if (cleanKey.length < 10) {
        return res.status(400).json({ success: false, error: 'API key de OpenCode Zen inválida (muy corta).' });
      }
      const response = await fetch('https://opencode.ai/zen/v1/models', {
        headers: { Authorization: `Bearer ${cleanKey}` }
      });
      if (!response.ok) {
        throw new Error('La API key de OpenCode Zen es inválida o fue revocada.');
      }
    }

    return res.json({ success: true });
  } catch (error: any) {
    console.error(`Error en /api/test-key para ${provider}:`, error);
    let msg = error.message || 'Error al validar la clave.';
    if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
      msg = 'La API Key de Google no es válida o fue revocada. Consigue una nueva en Google AI Studio (https://aistudio.google.com/app/apikey).';
    } else if (msg.includes('PERMISSION_DENIED')) {
      msg = 'Permiso denegado para esta clave de Google. Asegúrate de que la API de Gemini esté habilitada en tu proyecto.';
    } else if (msg.includes('RESOURCE_EXHAUSTED')) {
      msg = 'Límite de cuota excedido (Rate limit) en tu cuenta de Google AI Studio.';
    }
    return res.status(400).json({ success: false, error: msg });
  }
});

// Endpoint de Transcripción de Audio (Speech-to-Text) con Gemini Multimodal
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audioData, mimeType = 'audio/webm', apiKey, lang = 'es' } = req.body;
    if (!audioData) {
      return res.status(400).json({ success: false, error: 'No se recibieron datos de audio para transcribir.' });
    }

    const effectiveKey = apiKey || process.env.GEMINI_API_KEY;
    if (!effectiveKey) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere una API Key de Google Gemini para transcribir el audio.',
      });
    }

    const ai = getGenAIClient(effectiveKey);
    const promptText = lang === 'en'
      ? 'Transcribe exactly what is spoken in this audio. Return ONLY the transcribed text. Do not add quotes, introductory commentary, or extra explanations.'
      : 'Transcribe exactamente lo que se dice en este audio. Devuelve ÚNICAMENTE el texto dictado en español. No agregues comillas, explicaciones ni notas.';

    const contents = [
      {
        role: 'user' as const,
        parts: [
          {
            inlineData: {
              mimeType,
              data: audioData,
            },
          },
          {
            text: promptText,
          },
        ],
      },
    ];

    // Un 503 del flash grande no debe dejar el dictado sin texto: se prueba la
    // cadena de respaldo y sólo se falla cuando ninguno contesta.
    let transcribed = '';
    let usedModel = '';
    let lastError: any = null;
    for (const model of TRANSCRIPTION_MODELS) {
      try {
        const response = await ai.models.generateContent({ model, contents });
        transcribed = response.text || '';
        usedModel = model;
        lastError = null;
        break;
      } catch (modelError: any) {
        lastError = modelError;
        if (!isRetryableTranscriptionError(modelError)) throw modelError;
      }
    }

    if (lastError) {
      return res.status(503).json({ success: false, error: TRANSCRIPTION_FAILED_MESSAGE });
    }

    return res.json({ success: true, text: transcribed.trim(), model: usedModel });
  } catch (error: any) {
    const invalidAudio = isInvalidAudioError(error);
    console.error('[transcribe] fallo', {
      status: invalidAudio ? 400 : 500,
      mimeType: typeof req.body?.mimeType === 'string' ? req.body.mimeType : 'audio/webm',
      audioBytes: typeof req.body?.audioData === 'string' ? Buffer.byteLength(req.body.audioData, 'base64') : 0,
      body: error?.message || error,
    });
    return res.status(invalidAudio ? 400 : 500).json({
      success: false,
      error: invalidAudio ? INVALID_AUDIO_MESSAGE : TRANSCRIPTION_FAILED_MESSAGE,
      ...(invalidAudio ? { retryWithWav: true } : {}),
    });
  }
});

// ==================== RUTAS MODULARIZADAS ====================

// Gemini endpoints
app.post('/api/gemini/generate', handleGeminiGenerate);
app.post('/api/gemini/stream', handleGeminiStream);
app.post('/api/gemini/interactions/create', handleGeminiInteractions);
// Estado y borrado de la marca «esta key no admite herramientas integradas».
app.get('/api/gemini/tools-memory', handleToolsMemoryStatus);
app.post('/api/gemini/tools-memory/reset', handleResetToolsMemory);
// Duración configurable de la marca (se guarda en commander.json).
app.post('/api/gemini/tools-memory/ttl', handleSetToolsMemoryTtl);
// Cadena de respaldo guardada: la UI la elige aquí en vez de mandarla por petición.
app.get('/api/gemini/fallback-models', handleFallbackModelsStatus);
app.post('/api/gemini/fallback-models', handleSetFallbackModels);

// Anthropic endpoints
app.post('/api/anthropic/generate', handleAnthropicGenerate);
app.post('/api/anthropic/stream', handleAnthropicStream);

// Agent tools endpoint
app.post('/api/agent/run-tool', handleAgentRunTool);

// ── Sesiones de agente ──
//
// El registro de `AgentSession` vive en memoria del servidor y hasta ahora nadie
// lo poblaba: `task` y `spawn_agents` buscaban un padre (`getSession`) que no
// existía nunca, así que los subagentes sólo podían fallar con 404. El cliente
// crea aquí una sesión al empezar una tarea.
//
// No se arranca: es un contexto padre (objetivo, cwd, modelo, límites) para que
// los subagentes hereden. Arrancarla pondría a correr el bucle del LLM y
// gastaría tokens por duplicado, que es justo lo que el cliente ya hace.
app.post('/api/agent/sessions', (req, res) => {
  try {
    const b = req.body || {};
    const goal = String(b.goal || '').trim();
    if (!goal) return res.status(400).json({ success: false, error: 'goal requerido' });
    if (goal.length > 2000) return res.status(400).json({ success: false, error: 'goal demasiado largo (>2000)' });
    // El cwd se resuelve contra los roots conocidos: una sesión con un cwd
    // arbitrario sería una puerta a ejecutar tools fuera de todo proyecto.
    const cwd = resolveProjectPath('.', String(b.cwd || b.root || process.cwd())).abs;
    const mode = ['build', 'plan', 'readonly'].includes(String(b.mode)) ? String(b.mode) as any : undefined;
    const allowedTools = Array.isArray(b.allowedTools) ? b.allowedTools.map(String).slice(0, 50) : undefined;
    // Las claves viven sólo en memoria durante la sesión (igual que en el
    // resto de endpoints) y se filtran a las conocidas.
    const rawKeys = b.keys && typeof b.keys === 'object' ? b.keys : {};
    const keys = {
      OPENROUTER_API_KEY: typeof rawKeys.OPENROUTER_API_KEY === 'string' ? rawKeys.OPENROUTER_API_KEY : undefined,
      OLLAMA_HOST: typeof rawKeys.OLLAMA_HOST === 'string' ? rawKeys.OLLAMA_HOST : undefined,
      CUSTOM_BASE_URL: typeof rawKeys.CUSTOM_BASE_URL === 'string' ? rawKeys.CUSTOM_BASE_URL : undefined,
      CUSTOM_API_KEY: typeof rawKeys.CUSTOM_API_KEY === 'string' ? rawKeys.CUSTOM_API_KEY : undefined,
      OPENCODE_API_KEY: typeof rawKeys.OPENCODE_API_KEY === 'string' ? rawKeys.OPENCODE_API_KEY : undefined,
      CUSTOM_MODEL: typeof rawKeys.CUSTOM_MODEL === 'string' ? rawKeys.CUSTOM_MODEL : undefined,
    };
    const hasKeys = Object.values(keys).some((value) => typeof value === 'string' && value.length > 0);
    const run = b.run === true;
    // Tiempo de espera de una aprobación (F1-04). El cliente lo puede bajar
    // para probar el timeout; nunca se permite superar los 5 minutos.
    const approvalTimeoutMs = Number.isFinite(Number(b.approvalTimeoutMs))
      ? Math.min(Math.max(Number(b.approvalTimeoutMs), 50), 300_000)
      : undefined;
    // Timeout por defecto de los hijos de esta sesión (T10 pide 240 s); el
    // valor se acota en `executeTask` antes de armar el reloj del subagente.
    const subagentTimeoutMs = Number.isFinite(Number(b.subagentTimeoutMs))
      ? Number(b.subagentTimeoutMs)
      : undefined;
    const session = createSession({
      goal,
      cwd,
      model: b.model ? String(b.model).slice(0, 200) : undefined,
      maxSteps: Math.min(Math.max(Number(b.maxSteps) || 20, 1), 50),
      mode,
      allowedTools,
      approvalTimeoutMs,
      subagentTimeoutMs,
      keys: hasKeys ? keys : undefined,
      persist: run || b.persist === true,
    });
    // `run: true` crea una sesión ejecutable. `start()` marca `running` de forma
    // síncrona, así que la respuesta ya refleja el estado real.
    if (run) void session.start().catch(() => { /* el error queda en el estado */ });
    res.json({
      success: true,
      session: { id: session.id, goal, cwd, model: session.getModel(), status: session.getStatus() },
      state: session.toState(),
    });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});
app.get('/api/agent/sessions', (_req, res) => {
  try {
    res.json({ success: true, sessions: listAgentSessions() });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});

// Estado completo de una sesión (contrato v2). Carga lazy desde disco: no
// arranca nada solo, sólo reconstruye lo que ya existía.
app.get('/api/agent/sessions/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!isValidSessionId(id)) return res.status(400).json({ success: false, error: 'id inválido' });
    const session = getOrLoadSession(id);
    if (!session) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    // `running` distingue un bucle autoritativo en vuelo de un estado `running`
    // que dejó un CLI interrumpido: el segundo sí se puede reanudar.
    res.json({ success: true, running: session.isRunning(), state: session.toState() });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});

// Aplicar una propuesta guardada. La sesión valida hashes y crea el checkpoint;
// el endpoint no recibe el diff ni el contenido, sólo el id.
app.post('/api/agent/sessions/:id/proposals/:proposalId/apply', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!isValidSessionId(id)) return res.status(400).json({ success: false, error: 'id inválido' });
    const proposalId = String(req.params.proposalId || '').trim();
    if (!proposalId || proposalId.length > 200) {
      return res.status(400).json({ success: false, error: 'proposalId inválido' });
    }
    const session = getOrLoadSession(id);
    if (!session) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    const result = session.applyProposal(proposalId, { dryRun: req.body?.dryRun === true });
    const status = result.ok
      ? 200
      : result.code === 'PROPOSAL_NOT_FOUND'
        ? 404
        : result.code === 'PATH_INVALID'
          ? 403
          : result.code === 'WRITE_FAILED'
            ? 500
            : result.code === 'STALE_BASE' ||
                result.code === 'SESSION_RUNNING' ||
                result.code === 'PROPOSAL_DISCARDED'
              ? 409
              : 422;
    return res.status(status).json({ success: result.ok, ...result, state: session.toState() });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'no se pudo aplicar la propuesta' });
  }
});

// Stream reanudable (F1-03). El cursor sale de `?after=` o de `Last-Event-ID`.
// Los eventos se guardan en el buffer de la sesión, así que una desconexión no
// pierde pasos y el cliente puede reconstruir el estado con `resync`.
app.get('/api/agent/sessions/:id/stream', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!isValidSessionId(id)) return res.status(400).json({ success: false, error: 'id inválido' });
    const session = getOrLoadSession(id);
    if (!session) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    const after = parseStreamCursor(req.query?.after, req.headers['last-event-id']);
    if (after === null) {
      return res.status(400).json({ success: false, error: 'cursor inválido' });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const cleanup = attachSessionStream(session, after, res);
    res.on('close', cleanup);
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ success: false, error: e?.message });
    else res.end();
  }
});

// Añadir un turno y arrancar. Si el bucle sigue vivo se responde 409: dos
// `message` concurrentes no pueden duplicar pasos en la misma sesión.
app.post('/api/agent/sessions/:id/message', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!isValidSessionId(id)) return res.status(400).json({ success: false, error: 'id inválido' });
    const session = getOrLoadSession(id);
    if (!session) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    const text = String(req.body?.text ?? req.body?.message ?? '').trim();
    if (!text) return res.status(400).json({ success: false, error: 'text requerido' });
    if (text.length > 20_000) return res.status(400).json({ success: false, error: 'text demasiado largo (>20000)' });
    if (session.isRunning()) return res.status(409).json({ success: false, error: 'la sesión ya está en ejecución' });
    session.addMessage(text);
    void session.start().catch(() => { /* el error queda en el estado */ });
    res.status(202).json({ success: true, state: session.toState() });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

// Resolver una aprobación (F1-04). La decisión vive en la sesión, no en la
// ruta: repetir la misma petición devuelve 200 y una decisión distinta 409.
app.post('/api/agent/sessions/:id/approvals/:approvalId', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!isValidSessionId(id)) return res.status(400).json({ success: false, error: 'id inválido' });
    const approvalId = String(req.params.approvalId || '').trim();
    if (!approvalId || approvalId.length > 200) {
      return res.status(400).json({ success: false, error: 'approvalId inválido' });
    }
    const session = getOrLoadSession(id);
    if (!session) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    const decision = String(req.body?.decision || '');
    if (decision !== 'allow' && decision !== 'deny' && decision !== 'allow-session') {
      return res.status(400).json({ success: false, error: 'decision inválida' });
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const result = session.resolveApproval(approvalId, decision as ApprovalDecision, reason);
    return res.status(result.status).json(result.body);
  } catch {
    // Sin detalles internos: la ruta no debe filtrar input ni rutas.
    return res.status(500).json({ success: false, error: 'no se pudo resolver la aprobación' });
  }
});

// Bifurca una sesión: copia historial/pasos/plan y devuelve una sesión nueva
// `idle`. La fuente no se muta. Con `text` se añade el primer turno; con
// `run:true` se arranca el bucle autoritativo de la copia.
app.post('/api/agent/sessions/:id/fork', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!isValidSessionId(id)) return res.status(400).json({ success: false, error: 'id inválido' });
    const source = getOrLoadSession(id);
    if (!source) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    if (source.isRunning()) return res.status(409).json({ success: false, error: 'la sesión está en ejecución' });
    const b = req.body || {};
    const text = String(b.text ?? b.message ?? '').trim();
    if (text.length > 20_000) return res.status(400).json({ success: false, error: 'text demasiado largo (>20000)' });
    const session = forkSession(id);
    if (!session) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    if (text) session.addMessage(text);
    if (b.run === true) void session.start().catch(() => { /* el error queda en el estado */ });
    res.status(201).json({
      success: true,
      session: { id: session.id, goal: session.getGoal(), status: session.getStatus() },
      state: session.toState(),
    });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

// Checkpoint del CLI mientras el bucle corre en el proceso del cliente (F1-02).
// El estado sigue viviendo en el servidor; sólo se aceptan turnos/pasos/plan y
// el estado de la corrida, no cambios de objetivo o cwd. Un bucle autoritativo
// en marcha no puede ser pisado por un cliente.
app.put('/api/agent/sessions/:id/state', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!isValidSessionId(id)) return res.status(400).json({ success: false, error: 'id inválido' });
    const session = getOrLoadSession(id);
    if (!session) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    if (session.isRunning()) return res.status(409).json({ success: false, error: 'la sesión está en ejecución' });
    const state = decodeSessionState(req.body?.state ?? req.body);
    if (!state || state.id !== id) {
      return res.status(400).json({ success: false, error: 'estado inválido o de otra sesión' });
    }
    session.replaceState(state);
    res.json({ success: true, state: session.toState() });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

app.delete('/api/agent/sessions/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!isValidSessionId(id)) return res.status(400).json({ success: false, error: 'id inválido' });
    if (!getOrLoadSession(id)) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    removeSession(id);
    // Los subagentes de una sesión borrada ya no se pueden mostrar.
    clearSubAgents(id);
    res.json({ success: true });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

// Cancelar la tanda en curso («parar» de verdad).
//
// Marcar la fila como cancelada sólo cambiaría lo que se ve: cada hijo seguiría
// en su bucle, gastando tokens y escribiendo archivos. Primero se marcan —así el
// cierre de cada hijo, que llega después, no pisa el estado— y luego se paran:
// `stopSession` corta también la petición al proveedor que esté en vuelo.
app.post('/api/agent/sessions/:id/cancel', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!isValidSessionId(id)) return res.status(400).json({ success: false, error: 'id inválido' });
    const session = getOrLoadSession(id);
    if (!session) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    // Cancelar sólo a los hijos dejaría al bucle padre gastando tokens: la
    // sesión autoritativa se para también.
    const parentCancelled = session.getStatus() === 'running' || session.getStatus() === 'idle';
    session.stop();
    const ids = cancelSubAgents(id);
    // Los trabajos en segundo plano de la tanda se paran siempre: un
    // `background: true` sobrevive al hijo que lo lanzó, así que mirar sólo a
    // los que siguen corriendo deja huérfano al que ya respondió. Los trabajos
    // de otras sesiones (y los del padre) no se tocan.
    const cancelados = ids.filter((sid) => stopSession(sid)).length;
    const idsTanda = new Set<string>([...ids, ...listSubAgents(id).map((r) => r.id)]);
    const jobsStopped: string[] = [];
    let ptysClosed = 0;
    for (const sid of idsTanda) {
      jobsStopped.push(...(await stopJobsForSession(sid)));
      ptysClosed += closePtysForSession(sid);
    }
    res.json({ success: true, cancelled: cancelados, ids, jobsStopped, ptysClosed, parentCancelled });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

// Subagentes de una sesión: estado en vivo y resultado final. Es lo que consulta
// el panel mientras corre un `spawn_agents`; no ejecuta nada.
app.get('/api/agent/sessions/:id/subagents', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!getOrLoadSession(id)) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    res.json({ success: true, subagents: listSubAgents(id) });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});

// Stream de subagentes (SSE): manda la lista completa al conectar y otra vez en
// cada cambio (arranca, termina bien, falla). Así el panel no sondea y sigue
// actualizándose aunque su pestaña esté cerrada.
app.get('/api/agent/sessions/:id/events', (req, res) => {
  const id = String(req.params.id || '');
  if (!getOrLoadSession(id)) return res.status(404).json({ success: false, error: 'sesión no encontrada' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  let unsubscribe = () => { /* se reemplaza al suscribirse */ };
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  // Un solo sitio cierra la respuesta: el socket del cliente o el borrado de la
  // sesión padre. Sin esto último, el panel se quedaba «en vivo» para siempre.
  const finish = () => {
    if (closed) return;
    closed = true;
    if (keepAlive) clearInterval(keepAlive);
    unsubscribe();
    try { res.end(); } catch { /* socket cerrado */ }
  };

  const send = (rows: unknown, opts?: { final?: boolean }) => {
    if (closed) return;
    try {
      res.write(`event: subagents\ndata: ${JSON.stringify({ subagents: rows })}\n\n`);
      // La sesión padre desapareció: se avisa con un evento propio (no basta
      // con cerrar, porque `EventSource` reconectaría y el cliente no sabría
      // distinguir un 404 de un reintento inútil) y se cierra la respuesta.
      if (opts?.final) res.write('event: gone\ndata: {}\n\n');
    } catch { /* socket cerrado */ }
    if (opts?.final) finish();
  };
  // Estado inicial: si el cliente llega tarde, ya ve lo que hay.
  send(listSubAgents(id));
  unsubscribe = subscribeSubAgents(id, send);
  // Comentario periódico: mantiene viva la conexión a través de proxies.
  keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* socket cerrado */ }
  }, 15_000);

  req.on('close', finish);
});

// ==================== SKILLS (P1 #9) ====================

// Monta el router de skills bajo /api/skills
app.use('/api/skills', skillsRouter);

// Comandos y agentes del proyecto (`.commander/commands` y `.commander/agents`).
app.get('/api/agent/prompts', (req, res) => {
  try {
    const root = checkpointsRoot(req.query.root);
    // Debe ser un proyecto registrado exacto: estar «dentro» de una raíz
    // registrada dejaba pasar subcarpetas y rutas como `../..`.
    const propio = (value: string) => {
      try {
        return fs.realpathSync.native(value);
      } catch {
        return path.resolve(value);
      }
    };
    if (!listRoots().some((registrado) => propio(registrado) === propio(root))) {
      return res.status(400).json({ success: false, error: 'root fuera de los proyectos del Studio' });
    }
    res.json({ success: true, ...listProjectPrompts(root) });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Error leyendo comandos del proyecto' });
  }
});

// ==================== SESSION WORKSPACES (aislamiento por sesión) ====================
app.get('/api/sessions', (_req, res) => {
  try { res.json({ success: true, sessions: listSessions() }); }
  catch (e: any) { res.status(500).json({ success: false, error: e?.message || 'Error listando sesiones' }); }
});
app.post('/api/sessions/fork', (req, res) => {
  try {
    const source = String(req.body?.projectPath || req.body?.source || '').trim();
    const out = forkSessionWorkspace(source);
    res.json({ success: true, ...out });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'No se pudo crear el workspace de sesión' });
  }
});
app.delete('/api/sessions/:id', (req, res) => {
  try {
    const out = deleteSessionWorkspace(String(req.params.id || ''));
    res.json({ success: true, ...out });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'No se pudo eliminar el workspace de sesión' });
  }
});

// ── Worktree de ejecución (modo worktree) ──
app.post('/api/worktree/create', (req, res) => {
  try {
    const projectPath = String(req.body?.projectPath || '').trim();
    const threadId = String(req.body?.threadId || '').trim();
    if (!projectPath || !threadId) return res.status(400).json({ success: false, error: 'projectPath y threadId requeridos' });
    const out = createGitWorktree(projectPath, threadId);
    res.json({ success: true, ...out });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message || 'No se pudo crear el worktree' }); }
});

// ── Persistencia durable (SQLite) de threads/mensajes ──
app.get('/api/threads', (req, res) => {
  try {
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
    const projectPath = req.query.projectPath ? String(req.query.projectPath) : undefined;
    const threads = persistence.listThreads(projectId, projectPath);
    // El sidebar usa el remoto de Git como identidad estable del proyecto: dos
    // carpetas homónimas de repos distintos no deben compartir el archivado.
    const remotes = new Map<string, string | null>();
    const enriched = threads.map((thread) => {
      const threadPath = thread.project_path || '';
      if (!threadPath) return { ...thread, git_remote: null };
      if (!remotes.has(threadPath)) remotes.set(threadPath, readProjectGitRemote(threadPath));
      return { ...thread, git_remote: remotes.get(threadPath) ?? null };
    });
    res.json({ success: true, threads: enriched });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});
app.post('/api/threads', (req, res) => {
  try {
    const b = req.body || {};
    // `String(undefined)` es la cadena "undefined": sin este control, un cliente
    // que olvidaba el id creaba un hilo con ese nombre literal, invisible para
    // quien lo buscara después. Los llamadores reales siempre mandan id.
    const id = typeof b.id === 'string' ? b.id.trim() : '';
    if (!id) return res.status(400).json({ success: false, error: 'id de hilo requerido' });
    if (b.projectId && b.projectPath) persistence.upsertProject(String(b.projectId), String(b.projectPath), b.defaultBranch);
    const t = persistence.createThread({ id, projectId: b.projectId, projectPath: b.projectPath, title: b.title, model: b.model, agentMode: b.agentMode, executionMode: b.executionMode, stateJson: b.stateJson });
    res.json({ success: true, thread: t });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});
// Renombrar y fijar. Sin este PATCH un hilo sólo podía listarse o borrarse: el
// título lo fijaba el primer mensaje y no había forma de corregirlo.
app.patch('/api/threads/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    if (!persistence.getThread(id)) return res.status(404).json({ success: false, error: 'not found' });
    const b = req.body || {};
    const patch: { title?: string; pinned?: number; project_path?: string } = {};
    if (b.title !== undefined) {
      const title = typeof b.title === 'string' ? b.title.trim() : '';
      if (!title) return res.status(400).json({ success: false, error: 'el título no puede quedar vacío' });
      patch.title = title.slice(0, 200);
    }
    if (b.projectPath !== undefined) {
      // El sidebar agrupa los hilos por ruta: una pestaña que elige proyecto
      // después de crear el hilo debe poder mudarse de grupo.
      patch.project_path = typeof b.projectPath === 'string' ? b.projectPath.trim() : '';
    }
    if (b.pinned !== undefined) {
      if (typeof b.pinned !== 'boolean') return res.status(400).json({ success: false, error: 'pinned debe ser booleano' });
      patch.pinned = b.pinned ? 1 : 0;
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ success: false, error: 'nada que actualizar' });
    persistence.updateThread(id, patch);
    res.json({ success: true, thread: persistence.getThread(id) });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});
app.get('/api/threads/:id', (req, res) => {
  try {
    const t = persistence.getThread(String(req.params.id));
    if (!t) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true, thread: t });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});
app.get('/api/threads/:id/messages', (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    res.json({ success: true, messages: persistence.loadMessages(String(req.params.id), limit) });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});
app.post('/api/threads/:id/messages', (req, res) => {
  try {
    const b = req.body || {};
    const seq = persistence.appendMessage({
      threadId: String(req.params.id),
      requestId: b.requestId, inputId: b.inputId, origin: b.origin,
      steering: !!b.steering, role: String(b.role), parts: b.parts ?? b.content,
      attachments: b.attachments, metrics: b.metrics, ts: b.ts,
    });
    // Sin esto el hilo conservaba la fecha de creación y el sidebar lo hundía.
    if (seq !== null) persistence.touchThread(String(req.params.id));
    res.json({ success: true, seq });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});
app.get('/api/search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ success: true, results: [] });
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    res.json({ success: true, results: persistence.searchConversations(q, limit) });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});
app.delete('/api/threads/:id', (req, res) => {
  try { persistence.deleteThread(String(req.params.id)); res.json({ success: true }); }
  catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

// ── Nono durable memory (cross-session observations) ──
app.get('/api/nono/observations', (req, res) => {
  try {
    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const q = req.query.q ? String(req.query.q) : '';
    const rows = q
      ? persistence.searchNonoObservations(projectId, q, limit)
      : persistence.listNonoObservations(projectId, limit);
    res.json({ success: true, observations: rows });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});
app.post('/api/nono/observations', (req, res) => {
  try {
    const b = req.body || {};
    const id = persistence.saveNonoObservation(b.projectId ?? null, String(b.kind || 'note'), String(b.content || ''), b.ts);
    res.json({ success: true, id });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

// ── Permisos del agente (por proyecto) ──
// `permissions.ts` ya guardaba y aplicaba esta configuración en cada tool; lo
// que faltaba era el camino del panel. El modal leía y guardaba en
// `/api/permissions`, que no existía: el GET se tragaba el 404 en un catch
// «best-effort» y el PUT no guardaba nada, así que la lista blanca, los globs y
// el toggle de modo parecían aplicarse y se perdían al recargar.
/** Root canónico del panel: el que manda el cliente, o el cwd si no lo precisa. */
function permissionsRoot(input: unknown): string {
  const hint = String(input || '').trim();
  if (!hint) return process.cwd();
  return resolveProjectPath('.', hint).abs;
}

/**
 * Root de un panel que acepta una pista del cliente.
 *
 * Sin pista se usa el cwd (el proyecto del servidor). Con pista, se resuelve
 * contra los proyectos permitidos y **se lanza** si no se puede, para que el
 * handler responda 400 igual que `/api/permissions` y `/api/publish/*`.
 *
 * checkpoints y plugins se tragaban ese error y caían a cwd: un root inválido
 * (un path borrado, uno que escapa de los proyectos) operaba en silencio sobre
 * otro proyecto en vez de avisar.
 */
function panelRoot(rootHint?: unknown): string {
  if (typeof rootHint === 'string' && rootHint.trim()) {
    return resolveProjectPath('.', rootHint.slice(0, 1024)).root;
  }
  return process.cwd();
}

app.get('/api/permissions', (req, res) => {
  try {
    const root = permissionsRoot(req.query.root);
    res.json({ success: true, root, permissions: getPermissions(root) });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

app.put('/api/permissions', (req, res) => {
  try {
    const body = req.body || {};
    const root = permissionsRoot(body.root);
    const current = getPermissions(root);
    const patch = (body.permissions || {}) as Record<string, any>;
    // Fusión por campo: el toggle de modo manda sólo `{ mode }` y el modal manda
    // tools y globs. Guardar el patch tal cual borraba lo que el otro no envía.
    const next = {
      mode: patch.mode ?? current.mode,
      allowedTools: 'allowedTools' in patch ? patch.allowedTools : current.allowedTools,
      deniedTools: 'deniedTools' in patch ? patch.deniedTools : current.deniedTools,
      files: {
        read: patch.files?.read ?? current.files.read,
        write: patch.files?.write ?? current.files.write,
      },
      // Las reglas por patrón tienen su propio endpoint; el panel no las pisa.
      rules: current.rules,
      // La política MCP se puede editar por la misma API de permisos y tampoco
      // se pierde cuando el panel guarda sólo el modo o los globs.
      mcpToolRules: "mcpToolRules" in patch ? patch.mcpToolRules : current.mcpToolRules,
      ...(current.rulesImportedAt ? { rulesImportedAt: current.rulesImportedAt } : {}),
    };
    res.json({ success: true, root, permissions: setPermissions(root, next) });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

// Reglas por patrón del proyecto (F1-07): la UI las edita y el CLI las aplica
// desde el mismo archivo. El PUT con `migrate` hace la importación única desde
// localStorage; sin él, reemplaza el conjunto.
app.get('/api/agent/permission-rules', (req, res) => {
  try {
    const root = permissionsRoot(req.query.root);
    const perms = getPermissions(root);
    res.json({ success: true, root, rules: perms.rules, migrated: Boolean(perms.rulesImportedAt) });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

app.put('/api/agent/permission-rules', (req, res) => {
  try {
    const body = req.body || {};
    const root = permissionsRoot(body.root);
    const current = getPermissions(root);
    const incoming = normalizeRules(body.rules);
    const migrate = body.migrate === true && !current.rulesImportedAt;
    const rules = migrate ? mergeRuleSets(current.rules, incoming) : incoming;
    const saved = setPermissions(root, {
      ...current,
      rules,
      ...(migrate ? { rulesImportedAt: Date.now() } : {}),
    });
    res.json({ success: true, root, rules: saved.rules, migrated: Boolean(saved.rulesImportedAt) });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

// ── Worktrees ──
app.get('/api/worktrees', (req, res) => {
  try {
    const projectPath = String(req.query.projectPath || '');
    if (!projectPath) return res.status(400).json({ success: false, error: 'projectPath requerido' });
    res.json({ success: true, worktrees: worktrees.listWorktrees(projectPath) });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});
app.post('/api/worktrees', (req, res) => {
  try {
    const b = req.body || {};
    // Crear un worktree hace `git worktree add`, copia `.env` y corre
    // `npm install`: es una escritura más, así que pasa por los mismos permisos
    // que las tools. Sin este gate, `worktree.create` era la única vía del
    // agente que ignoraba el modo plan y las listas del proyecto. El root se
    // canonicaliza para que no se pueda gobernar un permiso y escribir en otro.
    const projectPath = String(b.projectPath || '').trim();
    // Obligatorio: sin esto, `resolveProjectPath('.', '')` caía al primer root
    // conocido y el worktree se creaba en el proyecto equivocado.
    if (!projectPath) return res.status(400).json({ success: false, error: 'projectPath requerido' });
    const root = resolveProjectPath('.', projectPath).root;
    const denied = enforceTool(getPermissions(root), 'worktree.create');
    if (denied) return res.status(403).json({ success: false, error: denied });
    const r = worktrees.createWorktree(String(b.threadId || b.id), root);
    res.json({ success: true, ...r });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});
app.delete('/api/worktrees', (req, res) => {
  try {
    const b = req.body || {};
    worktrees.removeWorktree(String(b.path), String(b.projectPath), !!b.force);
    res.json({ success: true });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

// ── Queue / autonomous runs ──
app.get('/api/queue/:threadId', (req, res) => {
  try {
    const state = req.query.state ? String(req.query.state) : undefined;
    res.json({ success: true, items: persistence.listQueue(String(req.params.threadId), state) });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});
app.post('/api/queue/:threadId', (req, res) => {
  try {
    const b = req.body || {};
    const threadId = String(req.params.threadId);
    // La cola referencia `threads(id)`: sin hilo, el INSERT moría con
    // «FOREIGN KEY constraint failed» (un 400 con texto de SQLite). No es un
    // cuerpo inválido, es un recurso que no existe: 404. El hilo NO se crea
    // aquí a propósito — una petición de cola suelta no debe inventar hilos.
    if (!persistence.getThread(threadId)) {
      return res.status(404).json({ success: false, error: 'hilo no encontrado' });
    }
    const item = persistence.enqueueItem({ id: String(b.id || `q-${Date.now()}`), threadId, prompt: String(b.prompt || ''), label: b.label, chatText: b.chatText, note: b.note, kind: b.kind, delivery: b.delivery, priority: b.priority, position: b.position, source: b.source, skillName: b.skillName });
    res.json({ success: true, item });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});
app.post('/api/queue/:threadId/dequeue', (req, res) => {
  try {
    const item = persistence.dequeueNext(String(req.params.threadId));
    res.json({ success: true, item });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});
app.patch('/api/queue/item/:id', (req, res) => {
  try {
    persistence.updateQueueItem(String(req.params.id), req.body || {});
    res.json({ success: true });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});
app.get('/api/receipts/:threadId', (req, res) => {
  try { res.json({ success: true, receipts: persistence.listReceipts(String(req.params.threadId)) }); }
  catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});

// ── Autonomous plan (manager-LLM descompone objetivo en tareas) ──
app.post('/api/autonomous/:threadId/plan', async (req, res) => {
  try {
    const b = req.body || {};
    const goal = String(b.goal || '').trim();
    if (!goal) return res.status(400).json({ success: false, error: 'goal requerido' });
    const out = await planCampaign(String(req.params.threadId), goal, {
      parentSessionId: String(b.parentSessionId || ''),
      keys: b.keys,
      cwd: b.cwd,
      model: b.model,
      maxSteps: b.maxSteps,
      allowedTools: b.allowedTools,
      mode: b.mode,
    });
    res.json({ success: true, ...out });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});

// ── Autonomous run (background) ──
app.post('/api/autonomous/:threadId/run', async (req, res) => {
  try {
    const b = req.body || {};
    const parentSessionId = String(b.parentSessionId || '');
    if (!parentSessionId) return res.status(400).json({ success: false, error: 'parentSessionId requerido' });
    // Fire-and-forget: respond immediately, run in background.
    void runAutonomousCampaign(String(req.params.threadId), {
      parentSessionId,
      goal: b.goal ? String(b.goal) : undefined,
      keys: b.keys,
      cwd: b.cwd,
      model: b.model,
      maxSteps: b.maxSteps,
      allowedTools: b.allowedTools,
      mode: b.mode,
    }).catch((e) => console.error('autonomous run failed:', e?.message));
    res.json({ success: true, started: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});

// ==================== PROVIDERS / OBSERVABILIDAD ====================
app.get('/api/providers/health', async (_req, res) => {
  try { const h = await checkAllProvidersHealth(); res.json(h); }
  catch (e: any) { res.status(500).json({ error: e?.message || 'Error de health check' }); }
});
app.get('/api/providers/metrics', (_req, res) => {
  try { res.json(getProviderMetrics()); }
  catch (e: any) { res.status(500).json({ error: e?.message || 'Error de métricas' }); }
});
app.post('/api/providers/:id/reset', (req, res) => {
  try { resetCircuitBreaker(String(req.params.id || '')); res.json({ success: true }); }
  catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});
app.post('/api/providers/:id/enabled', (req, res) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    setProviderEnabled(String(req.params.id || ''), enabled);
    res.json({ success: true });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

app.post('/api/providers', async (req, res) => {
  try {
    const { id, config, target } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'ID de proveedor requerido' });

    // Validar que la configuración tenga los campos requeridos para este proveedor
    const requiredFields: Record<string, string[]> = {
      google: ['apiKey'],
      anthropic: ['apiKey'],
      huggingface: ['apiToken'],
      ollama: ['host'],
      openrouter: ['apiKey'],
      openai: ['apiKey'],
      nvidia: ['apiKey'],
      pollinations: [],
      custom: ['baseUrl'],
      xai: ['apiKey'],
    };

    const spec = requiredFields[id];
    if (spec) {
      const missing = spec.filter(field => !(config && typeof config[field] === 'string'));
      if (missing.length > 0) {
        return res.status(400).json({ success: false, error: 'Configuración incompleta', missing });
      }
    }

    // Merge con configuración existente y guardar.
    // Por defecto, global: `commander.json` está versionado en este repo y una
    // API key guardada ahí acabaría en el próximo commit. `target: 'project'`
    // sigue disponible para quien lo pida explícitamente.
    const providerConfig: Record<string, unknown> = { ...(config || {}) };
    let keyStoredInVault = false;
    if (id === STRATA_LOCAL_PROVIDER_ID) {
      const legacyKey = normalizeStrataApiKey(getProviderFileConfig(id).apiKey);
      if (legacyKey) {
        if (!getStrataApiKey()) saveStrataApiKey(legacyKey);
        clearStrataLocalApiKey();
      }
      const nextKey = normalizeStrataApiKey(providerConfig.apiKey);
      if (nextKey) {
        const targetBase = normalizeStrataLocalBaseUrl(
          (typeof providerConfig.baseUrl === 'string' && providerConfig.baseUrl) ||
            (typeof getProviderFileConfig(id).baseUrl === 'string' && getProviderFileConfig(id).baseUrl) ||
            process.env.STRATA_LOCAL_BASE_URL ||
            ''
        );
        const security = strataLocalKeyTransportError(targetBase, nextKey, providerConfig.allowInsecure);
        if (security) return sendStrataError(res, security);
        saveStrataApiKey(nextKey);
        delete providerConfig.apiKey;
        // `writeConfig` parte del fichero: hay que retirar la copia antigua o
        // volvería a escribirla aunque el patch no la incluya.
        clearStrataLocalApiKey();
        keyStoredInVault = true;
      }
    }
    const { writeConfig } = await import('./src/config/index');
    const writeTarget: 'project' | 'global' = target === 'project' ? 'project' : 'global';
    const configPath = writeConfig({ providers: { [id]: providerConfig } }, writeTarget);

    res.json({
      success: true,
      configPath,
      target: writeTarget,
      ...(keyStoredInVault ? { keyStorage: 'vault' } : {}),
      ...(id === STRATA_LOCAL_PROVIDER_ID ? { allowInsecure: providerConfig.allowInsecure === true } : {}),
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || 'Error creando proveedor' });
  }
});

// Lista real de proveedores: `configured` sale de la config de fichero o del
// entorno, no de que el catálogo tenga entradas. Es lo que pinta el gestor.
app.get('/api/providers', async (req, res) => {
  try {
    const catalog = await getProviderCatalog();
    const envIds = new Set(getEnvProviderIds());
    const config = getConfig().providers as any;
    let providers: any[] = buildProviderList(config, envIds, catalog);

    // Proveedores locales: se dice si su host responde, para que «0 modelos» no
    // signifique lo mismo que «sin configurar». La sonda va cacheada (15 s) y
    // con timeout corto, en paralelo, para no frenar el gestor.
    const localHosts: Record<string, string> = {
      ollama: process.env.OLLAMA_HOST || config?.ollama?.host || 'http://localhost:11434',
      lmstudio: await resolveLmstudioHost(req),
      custom: process.env.CUSTOM_BASE_URL || config?.custom?.baseUrl || '',
      [STRATA_LOCAL_PROVIDER_ID]: resolveStrataLocalBaseUrl(),
    };
    providers = await Promise.all(
      providers.map(async (provider) => {
        const host = localHosts[provider.id];
        if (!host) return provider;
        // Strata Serving puede exigir API key: la sonda genérica no la manda y
        // marcaría como caído un host que sí responde.
        if (provider.id === STRATA_LOCAL_PROVIDER_ID) {
          const endpoint = strataLocalEndpointInfo(host);
          const configuredKey = resolveStrataLocalApiKey();
          const allowInsecure = strataLocalSettings().allowInsecure;
          const apiKey = safeStrataLocalApiKey(host, configuredKey, allowInsecure);
          const probe = await probeStrataLocal(host, apiKey, { timeoutMs: 1_500 });
          // El gestor también enseña los modelos que existen ahora en el host,
          // incluido el cargado que sólo aparezca en `/v1/status`.
          const liveModels = probe.entries.map((entry) => ({
            id: strataLocalModelId(entry.id),
            name: entry.name || entry.id,
            provider: STRATA_LOCAL_PROVIDER_ID,
            ...(entry.contextWindow
              ? { contextWindow: `${Math.round(entry.contextWindow / 1000)}K tokens` }
              : {}),
            ...(entry.supportsTools !== undefined ? { supportsTools: entry.supportsTools } : {}),
            ...(entry.inputModalities?.includes('image') ? { supportsImage: true } : {}),
          }));
          const visibleModels = filterModelIds(liveModels, {
            whitelist: provider.whitelist,
            blacklist: provider.blacklist,
          });
          return {
            ...provider,
            ...(liveModels.length > 0
              ? {
                  models: visibleModels,
                  allModels: liveModels,
                  modelCount: visibleModels.length,
                  totalModels: liveModels.length,
                }
              : {}),
            host,
            allowInsecure: allowInsecure === true,
            ...(endpoint.insecureRemote && !apiKey && configuredKey ? { keyBlocked: true } : {}),
            // El host responde: se ofrece como local aunque no haya fichero de
            // config. Sin respuesta sigue «sin configurar», que era el defecto.
            ...(probe.ok && !provider.configured ? { configured: true, source: 'local' } : {}),
            reachable: probe.ok,
            identity: probe.identity,
            ...(probe.status === 'auth' ? { auth: true } : {}),
            ...(probe.monitor ? { monitor: probe.monitor } : {}),
            ...(typeof probe.loaded === 'boolean' ? { loaded: probe.loaded } : {}),
            ...(probe.model ? { model: probe.model } : {}),
            ...(endpoint.warning ? { warning: endpoint.warning } : {}),
            ...(probe.ok ? {} : { probeError: probe.error || `HTTP ${probe.httpStatus ?? 0}` }),
          };
        }
        const probe = await probeLocalProvider(provider.id, host);
        return {
          ...provider,
          host,
          reachable: probe.reachable,
          ...(probe.error ? { probeError: probe.error } : {}),
        };
      })
    );

    return res.json({ success: true, providers, configPath: getConfigPath(), writePath: getGlobalConfigPath() });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Error listando proveedores' });
  }
});

// Filtros del gestor: apagar un proveedor o recortar su catálogo sin borrar las
// credenciales. Se escribe en la config global, igual que las claves, y no toca
// el resto del fichero.
// Catálogo completo de models.dev para el buscador de «Añadir proveedor».
app.get('/api/providers/available', async (_req, res) => {
  try {
    const catalog = await getAllProviderCatalog();
    const config = getConfig().providers as any;
    const envIds = new Set(getEnvProviderIds());
    const specs = new Map(PROVIDER_SPECS.map((spec) => [spec.id, spec]));
    const added = new Set(Object.keys(config?.openaiCompatible || {}));
    const providers = catalog
      .filter((provider) => !added.has(provider.id))
      .map((provider) => {
        const spec = specs.get(provider.id);
        return {
          id: provider.id,
          name: provider.name,
          env: provider.env,
          doc: provider.doc,
          api: provider.api,
          modelCount: provider.models.length,
          supported: Boolean(spec),
          configured: spec ? describeProvider(spec, config, envIds).configured : false,
        };
      })
      .sort((a, b) => Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name));
    return res.json({ success: true, providers });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Error listando proveedores disponibles' });
  }
});

/**
 * Comprueba si una URL habla el API de OpenAI.
 *
 * Se pide `GET /models` porque es la ruta que usa el resto de la app: si no
 * devuelve `{ data: [...] }` (o `{ models: [...] }`), el endpoint no puede
 * alimentar el selector. Un 401/403 no se trata como incompatible: el host
 * responde, pero la clave no vale, y conviene avisar de eso por separado.
 */
type OpenAiCompatibility = {
  compatible: boolean;
  status: 'compatible' | 'incompatible' | 'auth' | 'unreachable';
  models: string[];
  httpStatus?: number;
  error?: string;
};

async function probeOpenAiCompatibility(baseURL: string, apiKey?: string): Promise<OpenAiCompatibility> {
  const url = String(baseURL || '').trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocolo');
  } catch {
    return { compatible: false, status: 'incompatible', models: [], error: 'URL base inválida (http o https)' };
  }

  try {
    const response = await fetch(`${url}/models`, {
      method: 'GET',
      headers: {
        ...(apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8_000),
    });
    const text = await response.text().catch(() => '');
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        compatible: false,
        status: response.status === 401 || response.status === 403 ? 'auth' : 'incompatible',
        models: [],
        httpStatus: response.status,
        error: `HTTP ${response.status}`,
      };
    }

    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : null;
    if (!list) {
      return {
        compatible: false,
        status: 'incompatible',
        models: [],
        httpStatus: response.status,
        error: text.trim().startsWith('<') ? 'respondió HTML en vez de JSON' : 'respuesta sin lista de modelos',
      };
    }

    const models = list
      .map((model: any) => (typeof model === 'string' ? model : model?.id || model?.name))
      .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0);
    return { compatible: true, status: 'compatible', models, httpStatus: response.status };
  } catch (error: any) {
    return {
      compatible: false,
      status: 'unreachable',
      models: [],
      // `fetch` repite la URL en el error: un `baseUrl` con credenciales
      // (`https://usuario:clave@host`) devolvería la clave al cliente.
      error:
        error?.name === 'TimeoutError'
          ? 'sin respuesta en 8 s'
          : redactSecrets(error?.message || 'no se pudo conectar'),
    };
  }
}

/** Clave del host de Strata: la oficial es `STRATA_API_KEY`; se acepta el alias histórico. */
function strataEnvApiKey(): string | undefined {
  return process.env.STRATA_API_KEY || process.env.STRATA_LOCAL_API_KEY || undefined;
}

/**
 * Migra una clave antigua que quedó en claro en `config.json` al vault cifrado.
 * Si el vault no está disponible se conserva la clave para no perder acceso; el
 * guardado nuevo sí falla en vez de volver a escribirla en claro.
 */
function migrateStrataLocalApiKey(fileKey?: string): void {
  if (!fileKey) return;
  try {
    if (!getStrataApiKey()) saveStrataApiKey(fileKey);
    clearStrataLocalApiKey();
  } catch {
    /* el vault no está disponible: se sigue leyendo la copia antigua */
  }
}

/** Ajustes guardados de Strata local, sin mezclar su id con Strata Cloud. */
function strataLocalSettings(): {
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  allowInsecure: boolean;
} {
  const conf = ((getConfig().providers as any)?.[STRATA_LOCAL_PROVIDER_ID] || {}) as Record<string, unknown>;
  const fileConf = getProviderFileConfig(STRATA_LOCAL_PROVIDER_ID);
  const fileKey = normalizeStrataApiKey(fileConf.apiKey);
  if (fileKey) migrateStrataLocalApiKey(fileKey);
  const envKey = strataEnvApiKey();
  return {
    baseUrl: normalizeStrataLocalBaseUrl(
      (typeof conf.baseUrl === 'string' && conf.baseUrl.trim()) || process.env.STRATA_LOCAL_BASE_URL || ''
    ),
    apiKey: envKey || getStrataApiKey() || fileKey,
    defaultModel:
      typeof conf.defaultModel === 'string' && conf.defaultModel.trim() ? conf.defaultModel.trim() : undefined,
    allowInsecure: conf.allowInsecure === true || fileConf.allowInsecure === true,
  };
}

function resolveStrataLocalBaseUrl(override?: unknown): string {
  return normalizeStrataLocalBaseUrl(
    (typeof override === 'string' && override.trim()) || process.env.STRATA_LOCAL_BASE_URL || strataLocalSettings().baseUrl
  );
}

function resolveStrataLocalApiKey(override?: unknown): string | undefined {
  return (
    normalizeStrataApiKey(override) ||
    strataEnvApiKey() ||
    getStrataApiKey() ||
    normalizeStrataApiKey(getProviderFileConfig(STRATA_LOCAL_PROVIDER_ID).apiKey)
  );
}

/** La confirmación puede venir de la petición o de la config guardada. */
function strataAllowsInsecure(override?: unknown): boolean {
  return override === true || strataLocalSettings().allowInsecure === true;
}

/**
 * Una API key sólo viaja a un host remoto por HTTP con confirmación explícita.
 * Loopback y HTTPS no necesitan permiso adicional.
 */
function strataLocalKeyTransportError(
  baseUrl: string,
  apiKey: string | undefined,
  allowInsecure?: unknown
): StrataIntegrationError | null {
  const key = normalizeStrataApiKey(apiKey);
  if (!key) return null;
  const endpoint = strataLocalEndpointInfo(baseUrl);
  if (!endpoint.insecureRemote || strataAllowsInsecure(allowInsecure)) return null;
  return strataError('STRATA_INSECURE_REMOTE', {
    details: { hostname: endpoint.hostname || undefined, protocol: endpoint.protocol || 'http' },
    secret: key,
  });
}

/** Clave que se puede usar en una sonda interna sin saltarse la política. */
function safeStrataLocalApiKey(
  baseUrl: string,
  apiKey: string | undefined,
  allowInsecure?: unknown
): string | undefined {
  return strataLocalKeyTransportError(baseUrl, apiKey, allowInsecure) ? undefined : normalizeStrataApiKey(apiKey);
}

/**
 * Comprueba credencial, modelo cargado y coincidencia antes de enviar el
 * turno. Devuelve un error tipificado cuando ya se sabe que el host fallará;
 * los hosts antiguos que no publican `/v1/status` siguen pasando.
 */
interface StrataPreflightResult {
  failure: StrataIntegrationError | null;
  info?: StrataLocalModelInfo;
}

async function strataLocalPreflight(
  requested: string,
  baseUrl: string,
  apiKey?: string
): Promise<StrataPreflightResult> {
  try {
    const probe = await probeStrataLocal(baseUrl, apiKey, { timeoutMs: 2_500 });
    if (probe.status === 'auth') {
      return {
        failure: strataError('STRATA_INVALID_API_KEY', {
          message: redactStrataSecret(probe.error || 'Strata rechazó la API key.', apiKey),
          upstreamStatus: probe.httpStatus,
          secret: apiKey,
        }),
      };
    }
    if (probe.status === 'unreachable') {
      return {
        failure: classifyStrataFailure({
          message: probe.error || 'No se pudo conectar con Strata.',
          timedOut: /sin respuesta|timeout|tiempo/i.test(String(probe.error || '')),
          secret: apiKey,
        }),
      };
    }
    if (!probe.ok || !probe.loaded || !probe.model) {
      if (probe.ok && probe.loaded === false) {
        return {
          failure: strataError('STRATA_MODEL_NOT_LOADED', {
            message: 'Strata no tiene un modelo cargado.',
          }),
        };
      }
      return { failure: null };
    }

    const activeModel = probe.model;
    const requestedEntry = probe.entries.find(
      (entry) => entry.id === requested || entry.name === requested || entry.aliases?.includes(requested)
    );
    const activeEntry = probe.entries.find(
      (entry) => entry.id === activeModel || entry.aliases?.includes(activeModel)
    );
    const canonical = requestedEntry?.id || requested;
    if (canonical === activeModel) {
      return { failure: null, info: requestedEntry || activeEntry };
    }
    if (activeEntry?.id === canonical || activeEntry?.aliases?.includes(requested)) {
      return { failure: null, info: activeEntry || requestedEntry };
    }
    return {
      failure: strataError('STRATA_MODEL_MISMATCH', {
        message: `Strata tiene cargado "${activeModel}", no "${requested}". Cambia el modelo desde el panel de Strata antes de enviar.`,
        details: { requestedModel: requested, activeModel },
      }),
    };
  } catch {
    // Si no se puede verificar, se deja que el host responda con su propio error.
    return { failure: null };
  }
}

function sendStrataError(res: any, error: StrataIntegrationError) {
  return res.status(error.httpStatus).json(strataErrorPayload(error));
}

/** Si el modelo declara que no soporta tools, no se le manda el esquema. */
function strataToolsRequestError(
  body: any,
  info?: StrataLocalModelInfo
): StrataIntegrationError | null {
  if (!Array.isArray(body?.tools) || body.tools.length === 0) return null;
  if (info?.supportsTools !== false) return null;
  return strataError('STRATA_TOOLS_UNSUPPORTED', {
    message: `El modelo "${info?.id || 'Strata'}" no declara soporte de tool calling.`,
    details: { model: info?.id, supportsTools: false },
  });
}

function strataLocalLifecyclePayload(baseUrlOverride?: unknown) {
  const availability = strataLifecycle.getAvailability();
  return {
    success: true,
    ...strataLifecycle.getStatus(),
    baseUrl: resolveStrataLocalBaseUrl(baseUrlOverride),
    defaultModel: strataLocalSettings().defaultModel,
    available: availability.available,
  };
}

// Health y catálogo de Strata local. `/v1/status` confirma que el host es
// Strata (no un OpenAI-compatible cualquiera) y dice si hay modelo cargado;
// `/v1/models` aporta contexto, instancia y GPUs. La sonda nunca falla por que
// una versión antigua no tenga `/v1/status`: queda como «compatible».
async function strataLocalHealth(body: any = {}) {
  const baseUrl = resolveStrataLocalBaseUrl(body.baseUrl || body.baseURL);
  const endpoint = strataLocalEndpointInfo(baseUrl);
  const requestedKey = resolveStrataLocalApiKey(body.apiKey);
  const keyError = strataLocalKeyTransportError(baseUrl, requestedKey, body.allowInsecure);
  const probe = await probeStrataLocal(
    baseUrl,
    keyError ? undefined : requestedKey
  );
  return {
    success: probe.ok,
    ok: probe.ok,
    ...(keyError
      ? {
          keyBlocked: true,
          code: keyError.code,
          error: keyError.message,
          hint: keyError.hint,
        }
      : {}),
    status: probe.status,
    baseUrl,
    models: probe.models,
    entries: probe.entries,
    count: probe.models.length,
    identity: probe.identity,
    ...(probe.monitor ? { monitor: probe.monitor } : {}),
    loaded: probe.loaded,
    model: probe.model,
    contextWindow: probe.contextWindow,
    ...(probe.statusInfo ? { statusInfo: probe.statusInfo } : {}),
    remote: endpoint.remote,
    insecureRemote: endpoint.insecureRemote,
    ...(endpoint.warning ? { warning: endpoint.warning } : {}),
    latencyMs: probe.latencyMs,
    ...(probe.httpStatus ? { httpStatus: probe.httpStatus } : {}),
    ...(probe.error && !keyError ? { error: redactStrataSecret(probe.error, requestedKey) } : {}),
  };
}

/** Una sonda con clave bloqueada se rechaza con el mismo contrato tipado. */
function sendStrataHealth(res: any, health: any) {
  if (health?.keyBlocked === true) {
    return res.status(422).json({
      ok: false,
      success: false,
      status: 'insecure',
      code: health.code,
      error: health.error,
      ...(health.hint ? { hint: health.hint } : {}),
      keyBlocked: true,
      baseUrl: health.baseUrl,
      remote: health.remote,
      insecureRemote: health.insecureRemote,
    });
  }
  return res.json(health);
}

app.get('/api/strata-local/health', async (req, res) => {
  try {
    return sendStrataHealth(
      res,
      await strataLocalHealth({
        baseUrl: req.query.baseUrl,
        allowInsecure: req.query.allowInsecure === 'true',
      })
    );
  } catch (e: any) {
    return res.json({ success: false, ok: false, status: 'unreachable', models: [], error: e?.message || 'Strata no responde' });
  }
});

app.post('/api/strata-local/health', async (req, res) => {
  try {
    return sendStrataHealth(res, await strataLocalHealth(req.body || {}));
  } catch (e: any) {
    return res.json({ success: false, ok: false, status: 'unreachable', models: [], error: e?.message || 'Strata no responde' });
  }
});

app.get('/api/strata-local/lifecycle', (req, res) => {
  try {
    return res.json(strataLocalLifecyclePayload(req.query.baseUrl));
  } catch (e: any) {
    return res.json({ success: false, state: 'error', error: e?.message || 'Strata lifecycle no disponible' });
  }
});

// Arranca, reinicia (con el modelo/contexto indicados) o detiene el host.
// El `start` no responde hasta que `/v1/status` confirma el modelo cargado.
app.post('/api/strata-local/lifecycle', async (req, res) => {
  const body = req.body || {};
  const baseUrl = resolveStrataLocalBaseUrl(body.baseURL || body.baseUrl);
  const apiKey = resolveStrataLocalApiKey(body.apiKey);
  const security = strataLocalKeyTransportError(baseUrl, apiKey, body.allowInsecure);
  if (security) return sendStrataError(res, security);
  try {
    if (body.action === 'stop') {
      const result = await strataLifecycle.stop({ baseUrl, apiKey });
      return res.status(result.success ? 200 : 409).json(result);
    }
    if (body.action !== 'start' && body.action !== 'restart') {
      return res.status(400).json({ success: false, error: 'Acción de ciclo de vida inválida' });
    }
    const model = String(
      body.model ||
        strataLocalSettings().defaultModel ||
        (await resolveStrataLocalModel(undefined, baseUrl, apiKey)) ||
        ''
    ).trim();
    if (!model) return res.status(400).json({ success: false, error: 'Modelo de Strata requerido' });
    const context = body.context == null ? 32_768 : Number(body.context);
    const result = await strataLifecycle.start({ model, context, baseUrl, apiKey });
    return res.status(result.success ? 200 : 409).json(result);
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Strata lifecycle falló' });
  }
});

/**
 * Compacta el historial de una conversación local: conserva los últimos
 * turnos y resume los anteriores con el mismo modelo. La UI sólo reemplaza el
 * historial cuando recibe un resumen; si falla, no se pierde nada.
 */
app.post('/api/strata-local/compact', async (req, res) => {
  const body = req.body || {};
  const messages = Array.isArray(body.messages)
    ? body.messages
        .filter((message: any) => message && typeof message.content === 'string' && message.content.trim())
        .slice(-120)
        .map((message: any) => ({
          role: message.role === 'model' ? 'assistant' : String(message.role || 'user'),
          content: String(message.content).slice(0, 20_000),
        }))
    : [];
  const keepRecent = Math.max(2, Math.min(12, Number(body.keepRecent) || 6));
  if (messages.length <= keepRecent) {
    return res.json({ success: true, summary: '', kept: messages.length, removed: 0 });
  }
  const baseUrl = resolveStrataLocalBaseUrl(body.baseURL || body.baseUrl);
  const key = resolveStrataLocalApiKey(body.apiKey);
  const security = strataLocalKeyTransportError(baseUrl, key, body.allowInsecure);
  if (security) return sendStrataError(res, security);
  const abort = requestAbort(req, res, 5 * 60_000);
  try {
    const model = await resolveStrataLocalModel(
      body.model,
      baseUrl,
      key
    );
    if (!model) return res.json({ success: false, error: 'Modelo de Strata requerido' });
    const system = String(body.systemInstruction || '').trim();
    const beforeTokens = estimateContextTokens({ messages, systemInstruction: system });
    const contextWindow = Math.max(0, Number(body.contextWindow) || 0);
    const reservedTokens = Math.max(0, Number(body.reservedTokens) || 0);
    const toolTokens = Math.max(0, Number(body.toolTokens) || 0);
    const draftTokens = Math.max(0, Number(body.draftTokens) || 0);
    // El siguiente turno también tiene que caber: reservamos salida, tools y
    // el borrador antes de decidir cuántos turnos recientes se conservan.
    const targetTokens =
      contextWindow > 0
        ? Math.max(0, contextWindow - reservedTokens - toolTokens - draftTokens)
        : 0;
    let recent = messages.slice(-keepRecent);
    const old = messages.slice(0, -keepRecent);
    let transcript = old
      .map((message: { role: string; content: string }) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');
    if (transcript.length > 24_000) {
      transcript = `${transcript.slice(0, 14_000)}\n\n[…turnos intermedios omitidos…]\n\n${transcript.slice(-8_000)}`;
    }
    const instruction = [
      'Resume la conversación anterior para que otro turno pueda continuar sin leerla completa.',
      'Conserva decisiones, nombres de archivos, rutas, errores, comandos y pendientes; no inventes datos.',
      'Responde sólo el resumen, en el idioma de la conversación.',
      system ? `Instrucciones del sistema que siguen vigentes:\n${system.slice(0, 4_000)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: transcript },
        ],
        temperature: 0.2,
        max_tokens: 800,
        stream: false,
      }),
      signal: abort.signal,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(errorText(error, `Strata HTTP ${response.status}`));
    }
    const data = await response.json();
    const summary = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!summary) throw new Error('El modelo devolvió un resumen vacío');
    const summaryMessage = { role: 'assistant', content: summary };
    const tokensAfter = () =>
      estimateContextTokens({ messages: [summaryMessage, ...recent], systemInstruction: system });
    let afterTokens = tokensAfter();
    // Si el resumen + los turnos recientes todavía no dejan sitio para el
    // siguiente turno, se van soltando los recientes más antiguos. El resumen
    // conserva las decisiones y el último turno sigue siendo el más reciente.
    while (targetTokens > 0 && afterTokens > targetTokens && recent.length > 1) {
      recent = recent.slice(1);
      afterTokens = tokensAfter();
    }
    return res.json({
      success: true,
      summary,
      kept: recent.length,
      removed: Math.max(0, messages.length - recent.length),
      model,
      beforeTokens,
      afterTokens,
      savedTokens: Math.max(0, beforeTokens - afterTokens),
      savedPercent:
        beforeTokens > 0
          ? Math.max(0, Math.round(((beforeTokens - afterTokens) / beforeTokens) * 100))
          : 0,
      ...(targetTokens > 0 ? { budgetTokens: targetTokens } : {}),
    });
  } catch (error: any) {
    if (res.writableEnded) return;
    return res.json({
      success: false,
      error: abort.signal.aborted
        ? 'Resumen cancelado'
        : redactStrataSecret(error?.message || 'No se pudo resumir el historial', key),
    });
  } finally {
    abort.cleanup();
  }
});

/**
 * Modelos de Strata para el selector. Si el host está apagado se conserva la
 * última detección, igual que con Ollama y LM Studio.
 */
async function strataLocalCatalog(): Promise<{
  live: boolean;
  baseUrl: string;
  loaded?: boolean;
  model?: string;
  identity: 'verified' | 'unverified';
  warning?: string;
  entries: Array<{
    id: string;
    name: string;
    provider: string;
    context_window?: number;
    context_length?: number;
    supportsTools?: boolean;
    supportsParallelTools?: boolean;
    tags: string[];
  }>;
}> {
  const baseUrl = resolveStrataLocalBaseUrl();
  const endpoint = strataLocalEndpointInfo(baseUrl);
  let liveModels: string[] = [];
  let liveEntries: StrataLocalModelInfo[] = [];
  let identity: 'verified' | 'unverified' = 'unverified';
  let loaded: boolean | undefined;
  let model: string | undefined;
  try {
    const probe = await probeStrataLocal(
      baseUrl,
      safeStrataLocalApiKey(baseUrl, resolveStrataLocalApiKey(), strataLocalSettings().allowInsecure),
      { timeoutMs: 2_000 }
    );
    liveModels = probe.models;
    liveEntries = probe.entries;
    identity = probe.identity;
    loaded = probe.loaded;
    model = probe.model;
    if (probe.ok) rememberLocalModels(STRATA_LOCAL_PROVIDER_ID, baseUrl, probe.models);
  } catch {
    /* se usa la caché */
  }
  const ids = liveModels.length > 0 ? liveModels : cachedLocalModels(STRATA_LOCAL_PROVIDER_ID, baseUrl).models;
  const metadata = new Map(liveEntries.map((entry) => [entry.id, entry]));
  return {
    live: liveModels.length > 0,
    baseUrl,
    ...(typeof loaded === 'boolean' ? { loaded } : {}),
    ...(model ? { model } : {}),
    identity,
    ...(endpoint.warning ? { warning: endpoint.warning } : {}),
    entries: ids.map((id) => {
      const info = metadata.get(id);
      return {
        id: strataLocalModelId(id),
        name: info?.name || id,
        provider: STRATA_LOCAL_PROVIDER_ID,
        ...(info?.contextWindow
          ? {
              context_window: info.contextWindow,
              context_length: info.contextWindow,
            }
          : {}),
        ...(info?.supportsTools !== undefined ? { supportsTools: info.supportsTools } : {}),
        ...(info?.supportsParallelTools !== undefined
          ? { supportsParallelTools: info.supportsParallelTools }
          : {}),
        tags: liveModels.length > 0 ? ['local'] : ['local', 'guardado'],
      };
    }),
  };
}

app.post('/api/strata-local/models', async (req, res) => {
  try {
    const health = await strataLocalHealth(req.body || {});
    if (health.keyBlocked) return sendStrataHealth(res, health);
    return res.json({
      success: health.ok,
      models: health.models,
      entries: health.entries,
      baseUrl: health.baseUrl,
      status: health.status,
      identity: health.identity,
      loaded: health.loaded,
      model: health.model,
      contextWindow: health.contextWindow,
      ...(health.warning ? { warning: health.warning } : {}),
      ...(health.error ? { error: health.error } : {}),
    });
  } catch (e: any) {
    return res.json({ success: false, models: [], error: e?.message || 'Strata no responde' });
  }
});

/**
 * Telemetría de runtime del host de Strata. El contrato real es `/metrics`
 * (lo que muestra la pestaña Monitor) y `/status` (estado ligero); `/slots`
 * queda como detalle opcional. Se leen en paralelo y cualquier fallo degrada a
 * `null` sin romper el panel.
 */
async function fetchStrataHostJson(root: string, path: string, apiKey?: string): Promise<any | null> {
  try {
    const response = await fetch(`${root}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
      },
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}

async function strataLocalRuntime(body: any = {}) {
  const baseUrl = resolveStrataLocalBaseUrl(body.baseUrl || body.baseURL);
  const apiKey = safeStrataLocalApiKey(
    baseUrl,
    resolveStrataLocalApiKey(body.apiKey),
    body.allowInsecure
  );
  const health = await strataLocalHealth({ ...body, baseUrl });
  const root = baseUrl.replace(/\/v1$/, '');
  const [metrics, state] = await Promise.all([
    fetchStrataHostJson(root, '/metrics', apiKey),
    fetchStrataHostJson(root, '/status', apiKey),
  ]);

  const first = (...values: unknown[]): number | undefined => {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return undefined;
  };
  const round = (value: number | undefined, digits = 1): number | undefined =>
    value === undefined ? undefined : Number(value.toFixed(digits));

  const live = metrics?.live && typeof metrics.live === 'object' ? metrics.live : {};
  const engine = metrics?.engine && typeof metrics.engine === 'object' ? metrics.engine : {};
  const hardware = metrics?.hardware && typeof metrics.hardware === 'object' ? metrics.hardware : {};
  const hardwareStatic =
    metrics?.hardware_static && typeof metrics.hardware_static === 'object' ? metrics.hardware_static : {};
  const statusGpu = health.statusInfo?.machine?.gpu;
  const contextWindow =
    first(health.contextWindow, engine.max_context, health.statusInfo?.contextWindow) || null;
  const usedTokens = first(live.prompt_tokens, state?.prompt_tokens);
  const runState = typeof live.state === 'string' ? live.state : state?.busy ? 'generating' : undefined;
  const running = first(
    live.running,
    runState && runState !== 'idle' && runState !== 'unloaded' ? 1 : 0,
    state?.busy ? 1 : 0
  );
  const waiting = first(live.queued, live.waiting, state?.queued, 0);

  const vramUsedBytes = first(hardware.gpu_mem_used);
  const vramTotalBytes = first(hardware.gpu_mem_total);
  const vramUsedGb =
    vramUsedBytes !== undefined
      ? round(vramUsedBytes / 2 ** 30)
      : round(statusGpu?.usedMib !== undefined ? statusGpu.usedMib / 1024 : undefined);
  const vramTotalGb =
    vramTotalBytes !== undefined
      ? round(vramTotalBytes / 2 ** 30)
      : round(statusGpu?.totalMib !== undefined ? statusGpu.totalMib / 1024 : undefined);
  const ramUsedBytes = first(hardware.ram_used);
  const ramTotalBytes = first(hardware.ram_total);
  const ramUsedGb =
    ramUsedBytes !== undefined
      ? round(ramUsedBytes / 2 ** 30)
      : round(health.statusInfo?.machine?.ram?.usedGib);
  const ramTotalGb =
    ramTotalBytes !== undefined
      ? round(ramTotalBytes / 2 ** 30)
      : round(health.statusInfo?.machine?.ram?.totalGib);

  const slots = Array.isArray(live.slots) ? live.slots : [];
  const instances = (
    slots.length > 0
      ? slots
      : runState || usedTokens !== undefined
        ? [{ slot: 0, state: runState, prompt_tokens: usedTokens, tok_s: live.tok_s }]
        : []
  )
    .slice(0, 8)
    .map((slot: any, index: number) => ({
      id: slot?.slot ?? index,
      model: health.model || engine.model,
      status: slot?.state || runState,
      phase: typeof live.phase === 'string' ? live.phase : undefined,
      context: {
        ...(contextWindow ? { maxTokens: contextWindow } : {}),
        ...(first(slot?.prompt_tokens, slot?.held_tokens, usedTokens) !== undefined
          ? { usedTokens: first(slot?.prompt_tokens, slot?.held_tokens, usedTokens) }
          : {}),
      },
      gpus: statusGpu?.name ? [statusGpu.name] : [],
      outputTps: first(slot?.tok_s),
      promptTps: first(live.prefill_tok_s_mean, hardware.prefill_tok_s_mean),
    }));

  const monitorContext =
    contextWindow !== null || usedTokens !== undefined
      ? {
          usedTokens: usedTokens ?? 0,
          maxTokens: contextWindow,
          ...(contextWindow && usedTokens !== undefined
            ? { pct: Math.round((usedTokens / contextWindow) * 100) }
            : {}),
        }
      : null;

  return {
    success: health.ok,
    ok: health.ok,
    status: health.status,
    baseUrl,
    identity: health.identity,
    loaded: health.loaded,
    model: health.model,
    contextWindow,
    models: health.entries || [],
    ...(health.statusInfo ? { statusInfo: health.statusInfo } : {}),
    runtime:
      metrics || state
        ? {
            mode:
              (first(live.parallel, health.statusInfo?.concurrency?.serving) || 1) > 1
                ? 'parallel'
                : 'single',
            defaultId: engine.model || health.model,
            memory: {
              ...(engine.vram && typeof engine.vram === 'object' ? engine.vram : {}),
              ...(health.statusInfo?.vram || {}),
            },
            instances,
          }
        : null,
    monitor:
      metrics || state
        ? {
            phase: runState,
            // `/status` puede conservar la fase del último request aun estando
            // idle; cuando `/metrics` está disponible, manda su `live.phase`.
            phaseLabel: metrics ? (typeof live.phase === 'string' ? live.phase : undefined) : state?.phase,
            context: monitorContext,
            queue: { running: running ?? 0, waiting: waiting ?? 0 },
            hardware: {
              gpuName: hardwareStatic.gpu_name || statusGpu?.name,
              vramUsedGb,
              vramTotalGb,
              gpuUtilPct: first(hardware.gpu_util, statusGpu?.utilPct),
              gpuTempC: first(hardware.gpu_temp, statusGpu?.tempC),
              powerW: first(hardware.gpu_power, statusGpu?.powerW),
              ramUsedGb,
              ramTotalGb,
            },
            totals: metrics?.totals || null,
            generation: {
              tokS: first(live.tok_s, hardware.tok_s),
              tokSMean: first(live.tok_s_mean, hardware.tok_s_mean),
              promptTps: first(live.prefill_tok_s_mean, hardware.prefill_tok_s_mean),
              generated: first(live.generated),
              maxTokens: first(live.max_tokens),
              elapsedS: first(live.elapsed_s),
            },
          }
        : null,
    remote: health.remote,
    insecureRemote: health.insecureRemote,
    ...(health.warning ? { warning: health.warning } : {}),
    ...(health.error ? { error: health.error } : {}),
    ...(health.keyBlocked
      ? { keyBlocked: true, code: health.code, hint: health.hint }
      : {}),
    latencyMs: health.latencyMs,
  };
}

app.get('/api/strata-local/runtime', async (req, res) => {
  try {
    return res.json(await strataLocalRuntime({ baseUrl: req.query.baseUrl }));
  } catch (e: any) {
    return res.json({ success: false, ok: false, error: e?.message || 'Strata runtime no disponible' });
  }
});

app.post('/api/strata-local/runtime', async (req, res) => {
  try {
    return res.json(await strataLocalRuntime(req.body || {}));
  } catch (e: any) {
    return res.json({ success: false, ok: false, error: e?.message || 'Strata runtime no disponible' });
  }
});

// Comprueba la compatibilidad antes de dar de alta: el formulario puede pedir
// confirmación explícita (`force`) para endpoints que no exponen `/models`.
app.post('/api/providers/detect', async (req, res) => {
  try {
    const body = req.body || {};
    const probe = await probeOpenAiCompatibility(
      String(body.baseURL || body.baseUrl || ''),
      typeof body.apiKey === 'string' ? body.apiKey : undefined
    );
    return res.json({ success: true, ...probe });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Error comprobando el endpoint' });
  }
});

// Añade un proveedor OpenAI-compatible con nombre propio (Groq, DeepSeek, vLLM…).
app.post('/api/providers/custom', async (req, res) => {
  try {
    const body = req.body || {};
    const id = slugifyProviderId(String(body.id || body.name || ''));
    if (!id) return res.status(400).json({ success: false, error: 'Nombre o id inválido' });
    if (PROVIDER_SPECS.some((spec) => spec.id === id)) {
      return res.status(400).json({ success: false, error: 'Ese id ya pertenece a un proveedor integrado' });
    }
    const baseUrl = String(body.baseUrl || '').trim().replace(/\/+$/, '');
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocolo');
    } catch {
      return res.status(400).json({ success: false, error: 'URL base inválida (http o https)' });
    }
    const name = String(body.name || id).trim().slice(0, 80) || id;
    const models = (Array.isArray(body.models) ? body.models : String(body.models || '').split(/[,\n]/))
      .filter((value: unknown): value is string => typeof value === 'string')
      .map((value: string) => value.trim())
      .filter(Boolean)
      .slice(0, 500);
    if (body.force !== true) {
      const probe = await probeOpenAiCompatibility(baseUrl, typeof body.apiKey === 'string' ? body.apiKey : undefined);
      if (!probe.compatible) {
        return res.status(409).json({
          success: false,
          incompatible: true,
          status: probe.status,
          httpStatus: probe.httpStatus,
          models: probe.models,
          error: probe.error || 'No se pudo confirmar la compatibilidad con OpenAI',
        });
      }
    }
    const entry = {
      name,
      baseUrl,
      ...(typeof body.apiKey === 'string' && body.apiKey.trim() ? { apiKey: body.apiKey.trim() } : {}),
      ...(models.length > 0 ? { models } : {}),
    };
    const { writeConfig } = await import('./src/config/index');
    const configPath = writeConfig({ providers: { openaiCompatible: { [id]: entry } } } as any, 'global');
    return res.json({ success: true, id, configPath, target: 'global' });
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e?.message || 'Error añadiendo proveedor' });
  }
});

app.patch('/api/providers/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const isBuiltin = PROVIDER_SPECS.some((spec) => spec.id === id);
    const isAdded = Boolean((getConfig().providers as any)?.openaiCompatible?.[id]);
    if (!isBuiltin && !isAdded) {
      return res.status(404).json({ success: false, error: 'proveedor desconocido' });
    }
    const b = req.body || {};
    const patch: Record<string, unknown> = {};
    if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
    for (const key of ['whitelist', 'blacklist'] as const) {
      if (!Array.isArray(b[key])) continue;
      patch[key] = b[key]
        .filter((v: unknown): v is string => typeof v === 'string')
        .map((v: string) => v.trim())
        .filter(Boolean)
        .slice(0, 500);
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, error: 'nada que actualizar' });
    }
    const { writeConfig } = await import('./src/config/index');
    const configPath = writeConfig(
      isBuiltin
        ? ({ providers: { [id]: patch } } as any)
        : ({ providers: { openaiCompatible: { [id]: patch } } } as any),
      'global'
    );
    return res.json({ success: true, configPath, target: 'global' });
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e?.message || 'Error guardando filtros' });
  }
});

// Elimina un proveedor del fichero de config. Las variables de entorno no se
// pueden borrar desde aquí: se informa de que siguen suministrando la clave.
app.delete('/api/providers/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const vaultKeyRemoved = id === STRATA_LOCAL_PROVIDER_ID ? deleteStrataApiKey() : false;
    if (!PROVIDER_SPECS.some((s) => s.id === id)) {
      if (!(getConfig().providers as any)?.openaiCompatible?.[id]) {
        return res.status(400).json({ success: false, error: 'Proveedor desconocido' });
      }
      const configPath = removeOpenAiCompatibleProvider(id);
      return res.json({ success: true, configPath, stillFromEnv: false });
    }
    const configPath = removeProviderConfig(id);
    return res.json({
      success: true,
      configPath,
      stillFromEnv: getEnvProviderIds().includes(id),
      ...(id === STRATA_LOCAL_PROVIDER_ID ? { vaultKeyRemoved } : {}),
    });
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e?.message || 'Error eliminando proveedor' });
  }
});

// ==================== MCP REGISTRY ====================

// Monta el router de MCP bajo /api/mcp
import { mcpRouter } from './src/mcp/index.js';
import { pluginMarketRouter } from './src/plugins/marketplace.js';
import { pluginLifecycleRouter } from './src/plugins/lifecycleApi.js';
import { listPluginFiles, parsePluginApiVersion, readPluginManifestSummary } from './pluginsRuntime.js';
import { uninstallInstalledPlugin } from './src/plugins/uninstall.js';
app.use('/api/mcp', mcpRouter);
// Catálogo de plugins (marketplace.json) bajo el mismo prefijo: sus rutas
// `/discover` e `/install-from-marketplace` no chocan con las de arriba.
app.use('/api/plugins', pluginMarketRouter);
// Hooks de lifecycle para el bucle del navegador y el del CLI, que no corren
// dentro de `AgentSession`: la ruta reutiliza el mismo runtime de plugins.
app.use('/api/plugins', pluginLifecycleRouter);

// ==================== PLUGINS ECOSISTEMA ====================
// Rutas basicas para discovery, instalacion y listado de plugins.
// Los plugins se almacenan bajo <root>/.commander/plugins/ como zip descomprimidos
// con un manifest.json que define: id, name, version, entrypoint, tools.

const PLUGINS_DIR = '.commander/plugins';

/** Root de `.commander/plugins`; un root inválido lanza (ver `panelRoot`). */
function getPluginsRoot(rootHint?: unknown): string {
  return panelRoot(rootHint);
}

// Asegura que el directorio de plugins exista
const pluginsRoot = getPluginsRoot();
if (!fs.existsSync(path.join(pluginsRoot, PLUGINS_DIR))) {
  fs.mkdirSync(path.join(pluginsRoot, PLUGINS_DIR), { recursive: true });
}

// Listar plugins instalados: manifiestos (marketplace) y zips legados.
// Los plugins del catálogo viven en `<id>.manifest.json`, no en un zip; al
// ignorarlos la lista salía vacía y la UI no ofrecía desinstalarlos.
app.get('/api/plugins', (req, res) => {
  try {
    const root = getPluginsRoot(req.query.root);
    const p = path.join(root, PLUGINS_DIR);
    if (!fs.existsSync(p)) return res.json({ success: true, plugins: [] });

    const files = fs.readdirSync(p);
    // Plugins locales (carpeta con `index.js` y `plugin.json`): el runtime los
    // ejecuta, así que también son instalaciones que la UI debe poder revisar.
    // `listPluginFiles` sólo localiza la entrada; no importa el módulo.
    const local = new Map(listPluginFiles(root).map((plugin) => [plugin.id, plugin.file]));
    const localManifest = (id: string) => {
      const file = local.get(id);
      return file ? readPluginManifestSummary(file) : null;
    };
    const asPermissions = (value: unknown): string[] | null =>
      Array.isArray(value)
        ? value.filter((permission): permission is string => typeof permission === 'string')
        : null;

    const plugins: any[] = [];
    for (const file of files) {
      if (!file.endsWith('.manifest.json')) continue;
      const fallbackId = file.replace(/\.manifest\.json$/, '');
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(p, file), 'utf8'));
        const id = manifest.id || fallbackId;
        const localMeta = localManifest(id);
        plugins.push({
          id,
          name: localMeta?.name || manifest.name || fallbackId,
          version: localMeta?.version ?? manifest.version ?? null,
          apiVersion: localMeta?.apiVersion ?? parsePluginApiVersion(manifest.apiVersion),
          permissions: localMeta?.permissions ?? asPermissions(manifest.permissions),
          checksum: typeof manifest.checksum === 'string' ? manifest.checksum : null,
          source: manifest.source || 'marketplace',
          marketplace: manifest.marketplace || null,
          components: manifest.components || null,
          installedAt: manifest.installedAt || null,
        });
      } catch {
        const localMeta = localManifest(fallbackId);
        plugins.push({
          id: fallbackId,
          name: localMeta?.name || fallbackId,
          version: localMeta?.version ?? null,
          apiVersion: localMeta?.apiVersion ?? null,
          permissions: localMeta?.permissions ?? null,
          checksum: null,
          source: 'manifest',
        });
      }
    }

    const listed = new Set(plugins.map((plugin) => plugin.id));
    for (const file of files) {
      if (!file.endsWith('.zip')) continue;
      const id = file.replace(/\.zip$/, '');
      if (listed.has(id)) continue;
      const localMeta = localManifest(id);
      plugins.push({
        id,
        name: localMeta?.name || id,
        version: localMeta?.version ?? null,
        apiVersion: localMeta?.apiVersion ?? null,
        permissions: localMeta?.permissions ?? null,
        checksum: null,
        source: 'zip',
      });
      listed.add(id);
    }

    // Un plugin local sin manifiesto de instalación (p. ej. el de referencia)
    // también se puede revisar y desinstalar desde Configuración → Extensiones.
    for (const [id] of local) {
      if (listed.has(id)) continue;
      const manifest = localManifest(id);
      plugins.push({
        id,
        name: manifest?.name || id,
        version: manifest?.version ?? null,
        apiVersion: manifest?.apiVersion ?? null,
        permissions: manifest?.permissions ?? null,
        checksum: null,
        source: 'local',
        marketplace: null,
        components: null,
        installedAt: null,
      });
    }

    plugins.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return res.json({ success: true, plugins });
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e?.message || 'Error listando plugins' });
  }
});

/**
 * Id de plugin: un nombre de archivo y nada más.
 *
 * El id se concatena en rutas bajo `.commander/plugins`, así que un valor como
 * `../../x` escribía el manifiesto (y borraba el zip) fuera del directorio. La
 * lista blanca es la primera barrera; `pluginPath` comprueba además que el
 * fichero resuelto siga dentro del directorio de plugins.
 */
const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isSafePluginId(id: unknown): id is string {
  return typeof id === 'string' && PLUGIN_ID_RE.test(id) && !id.includes('..');
}

/** Ruta de un fichero de plugin, garantizada dentro de `<root>/.commander/plugins`. */
function pluginPath(root: string, id: string, ext: '.zip' | '.manifest.json'): string {
  if (!isSafePluginId(id)) throw new Error('Id de plugin inválido');
  const dir = path.resolve(root, PLUGINS_DIR);
  const file = path.resolve(dir, `${id}${ext}`);
  if (path.dirname(file) !== dir) throw new Error('Id de plugin inválido');
  return file;
}

// Esquema inline de validación para plugins (sin nuevas dependencias)
function validarManifestPlugin(body: any): { ok: boolean; error?: string; data?: any } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo de request inválido' };
  const { id, name, version, entrypoint } = body;
  if (!id || typeof id !== 'string') return { ok: false, error: 'id es obligatorio y debe ser string' };
  if (!isSafePluginId(id)) return { ok: false, error: 'id inválido: sólo letras, números, ".", "_" y "-"' };
  if (name !== undefined && typeof name !== 'string') return { ok: false, error: 'name debe ser string si se provee' };
  if (version !== undefined && (typeof version !== 'string' || version.trim() === '')) return { ok: false, error: 'version debe ser string no vacío si se provee' };
  if (entrypoint !== undefined && typeof entrypoint !== 'string') return { ok: false, error: 'entrypoint debe ser string si se provee' };
  return { ok: true, data: { id: String(id), name: name || null, version: version || null, entrypoint: entrypoint || null } };
}

// Instalar plugin (zip con manifest)
app.post('/api/plugins', async (req, res) => {
  try {
    const validation = validarManifestPlugin(req.body);
    if (!validation.ok) return res.status(400).json({ success: false, error: validation.error });
    const { id, name, version, entrypoint } = validation.data;
    const root = getPluginsRoot(req.body?.root);
    const manifestPath = pluginPath(root, id, '.manifest.json');
    const manifest = { id, name, version, entrypoint };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return res.json({ success: true, id, manifest });
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e?.message || 'Error instalando plugin' });
  }
});

// Desinstalar plugin: manifiesto, zip y lo que el plugin copió al proyecto
// (skills, agentes y servidores MCP), según su manifiesto.
app.delete('/api/plugins/:id', (req, res) => {
  try {
    const id = req.params.id;
    if (!isSafePluginId(id)) return res.status(400).json({ success: false, error: 'Id de plugin inválido' });
    const root = getPluginsRoot(req.query.root);
    const result = uninstallInstalledPlugin(id, { root });
    return res.json({ success: true, ...result });
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e?.message || 'Error desinstalando plugin' });
  }
});

// ==================== CHECKPOINTS (rollback/undo) ====================
// Listar / crear / restaurar puntos de control del workspace. Antes de cada
// fs.write/fs.edit el agente ya deja un snapshot por-mutación (agentTools);
// estas rutas exponen además el control a nivel de run (deshacer todo).

import {
  listCheckpoints,
  snapshotProject,
  snapshotPath,
  restoreCheckpoint,
  listWorktreeCheckpoints,
  createWorktreeCheckpoint,
  restoreWorktreeCheckpoint,
  deleteWorktreeCheckpoint,
  isGitRepo,
} from './checkpoints';

/**
 * Root de los checkpoints. Delega en `panelRoot`: un root inválido lanza y el
 * endpoint responde 400, igual que `/api/permissions` y `/api/publish/*`.
 */
function checkpointsRoot(rootHint?: unknown): string {
  return panelRoot(rootHint);
}

app.get('/api/checkpoints', (req, res) => {
  try {
    const root = checkpointsRoot(req.query.root);
    res.json({ success: true, checkpoints: listCheckpoints(root) });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Error listando checkpoints' });
  }
});

app.post('/api/checkpoints', (req, res) => {
  try {
    const root = checkpointsRoot(req.body?.root);
    const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 200) : 'Punto de control';
    // `paths` guarda sólo esas rutas: es lo que necesita rehacer un paso sin
    // copiar el proyecto entero.
    const paths = Array.isArray(req.body?.paths)
      ? (req.body.paths as unknown[]).filter((p): p is string => typeof p === 'string').slice(0, 20)
      : [];
    if (paths.length > 0) {
      const cps = paths.map((p) => snapshotPath(root, p, label));
      return res.json({ success: true, checkpoint: cps[0], checkpoints: cps });
    }
    const cp = snapshotProject(root, label);
    res.json({ success: true, checkpoint: cp });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Error creando checkpoint' });
  }
});

app.post('/api/checkpoints/restore', (req, res) => {
  try {
    const root = checkpointsRoot(req.body?.root);
    const id = String(req.body?.id || '').slice(0, 100);
    if (!id) return res.status(400).json({ success: false, error: 'id requerido' });
    const r = restoreCheckpoint(root, id);
    res.json({ success: true, ...r });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Error restaurando checkpoint' });
  }
});

// ========== GIT WORKTREE CHECKPOINTS (True Time-Travel) ==========

app.get('/api/checkpoints/worktree', (req, res) => {
  try {
    const root = checkpointsRoot(req.query.root);
    const { checkpoints, error } = listWorktreeCheckpoints(root);
    // `isGit` permite a la UI distinguir "no es repo" de "no hay checkpoints".
    res.json({ success: !error, checkpoints, error, isGit: isGitRepo(root) });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Error listando worktree checkpoints' });
  }
});

app.post('/api/checkpoints/worktree', (req, res) => {
  try {
    const root = checkpointsRoot(req.body?.root);
    const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 200) : 'Worktree checkpoint';
    const { checkpoint, error } = createWorktreeCheckpoint(root, label);
    if (error) return res.status(400).json({ success: false, error });
    res.json({ success: true, checkpoint });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Error creando worktree checkpoint' });
  }
});

app.post('/api/checkpoints/worktree/restore', (req, res) => {
  try {
    const root = checkpointsRoot(req.body?.root);
    const id = String(req.body?.id || '').slice(0, 100);
    if (!id) return res.status(400).json({ success: false, error: 'id requerido' });
    const apply = req.body?.apply === true;
    const r = restoreWorktreeCheckpoint(root, id, { apply });
    if (!r.ok) return res.status(400).json({ success: false, error: r.error });
    res.json({ success: true, ...r });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Error restaurando worktree checkpoint' });
  }
});

app.delete('/api/checkpoints/worktree', (req, res) => {
  try {
    const root = checkpointsRoot(req.query.root);
    const id = String(req.query.id || '').slice(0, 100);
    if (!id) return res.status(400).json({ success: false, error: 'id requerido' });
    const r = deleteWorktreeCheckpoint(root, id);
    if (!r.ok) return res.status(400).json({ success: false, error: r.error });
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'Error borrando worktree checkpoint' });
  }
});

// ==================== OAUTH (P1 #10) ====================

// Inicia flujo OAuth
app.get('/auth/:provider', handleOAuthLogin);

// Callback de OAuth
app.get('/auth/:provider/callback', handleOAuthCallback);

// Logout
app.post('/auth/logout', handleLogout);

// Usuario actual
app.get('/api/auth/me', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.json({ success: true, user: null });
  return res.json({ success: true, user });
});

// ==================== FALLBACK ROUTER (P1 #10) ====================

// Ejecuta con fallback automático
app.post('/api/fallback/generate', async (req, res) => {
  try {
    const { providerId, model, prompt, systemInstruction, temperature, maxTokens, tools, stream } = req.body || {};
    if (!prompt || !model) return res.status(400).json({ success: false, error: 'prompt y model requeridos' });
    const result = await executeWithFallback({ providerId, model, prompt, systemInstruction, temperature, maxTokens, tools, stream });
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Métricas de proveedores
app.get('/api/fallback/metrics', (_req, res) => {
  return res.json({ success: true, metrics: getProviderMetrics() });
});

// Health check de todos los proveedores
app.get('/api/fallback/health', async (_req, res) => {
  const health = await checkAllProvidersHealth();
  return res.json({ success: true, health });
});

// Reset circuit breaker (admin)
app.post('/api/fallback/reset-circuit/:providerId', (req, res) => {
  resetCircuitBreaker(req.params.providerId);
  return res.json({ success: true });
});

// Habilita/deshabilita proveedor
app.post('/api/fallback/provider/:providerId/enable', (req, res) => {
  const { enabled } = req.body || {};
  setProviderEnabled(req.params.providerId, enabled === true);
  return res.json({ success: true });
});

// ==================== PROYECTOS (allowlist del agente) ====================

/** Lista los directorios donde el agente puede trabajar. */
// @ts-ignore
app.get('/api/agent/roots', (req, res) => {
  const removable = removableRoots();
  return res.json({
    success: true,
    roots: listRoots().map((dir) => ({
      path: dir,
      name: path.basename(dir) || dir,
      removable: removable.includes(dir),
      cwd: dir === process.cwd(),
    })),
  });
});

/** Registra un directorio como proyecto operable por el agente. */
app.post('/api/agent/roots', (req, res) => {
  try {
    const { path: dir } = req.body || {};
    const { roots, added } = addRoot(dir);
    return res.json({ success: true, added, roots });
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e.message || 'No se pudo añadir el proyecto' });
  }
});

/** Quita un directorio de la allowlist (no se puede quitar el cwd del server). */
app.delete('/api/agent/roots', (req, res) => {
  try {
    const { path: dir } = req.body || {};
    const { roots } = removeRoot(dir);
    return res.json({ success: true, roots });
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e.message || 'No se pudo quitar el proyecto' });
  }
});

/** Crea un proyecto nuevo (carpeta + package.json base) y lo registra. */
app.post('/api/agent/projects', (req, res) => {
  try {
    const { name, parentDir } = req.body || {};
    const cleanName = String(name || '').trim().replace(/[^\w\s.-]/g, '').slice(0, 60);
    if (!cleanName) return res.status(400).json({ success: false, error: 'Nombre de proyecto requerido' });

    // Por defecto, los proyectos nuevos cuelgan del directorio de trabajo del server.
    const parent = String(parentDir || '').trim() || process.cwd();
    const parentRoot = resolveProjectPath('.', parent).abs;
    const target = path.join(parentRoot, cleanName);

    // No puede salirse del root padre aunque el nombre traiga ../
    const rel = path.relative(parentRoot, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(400).json({ success: false, error: 'Nombre de proyecto inválido' });
    }
    if (fs.existsSync(target)) {
      return res.status(409).json({ success: false, error: 'Ya existe un directorio con ese nombre' });
    }

    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({
        name: cleanName.toLowerCase().replace(/\s+/g, '-'),
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build' },
      }, null, 2),
      'utf8'
    );
    fs.writeFileSync(path.join(target, 'README.md'), `# ${cleanName}\n\nProyecto creado desde Commander AI Studio.\n`, 'utf8');

    const { roots } = addRoot(target);
    return res.json({ success: true, path: target, name: cleanName, roots });
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e.message || 'No se pudo crear el proyecto' });
  }
});

// ==================== PUBLICACIÓN (preview / producción) ====================

function publishProjectRoot(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new Error('Proyecto requerido');
  if (raw.length > 2000) throw new Error('Ruta de proyecto demasiado larga');
  return resolveProjectPath('.', raw).abs;
}

/**
 * Errores de publicación. Sólo se devuelve `message` porque sus fuentes no
 * adjuntan contenido: el estado y el entorno usan mensajes fijos ante un JSON
 * inválido, y la build ya no incluye su salida (podría traer código o valores).
 */
function publishError(res: any, error: any) {
  return res.status(400).json({ success: false, error: error?.message || 'Publicación falló' });
}

/** Estado de los punteros, releases y URLs locales del proyecto. */
app.get('/api/publish/status', async (req, res) => {
  try {
    const root = publishProjectRoot(req.query.root);
    const status = await getPublishStatus(root);
    return res.json({ success: true, status });
  } catch (error: any) {
    return publishError(res, error);
  }
});

/** Crea una release inmutable y la apunta a preview. */
app.post('/api/publish/preview', async (req, res) => {
  try {
    const body = req.body || {};
    const root = publishProjectRoot(body.root);
    const outputDir = typeof body.outputDir === 'string' ? body.outputDir.trim().slice(0, 500) : undefined;
    const result = await createRelease(root, {
      outputDir: outputDir || undefined,
      build: body.build === true,
    });
    // Las credenciales rotadas van al entorno de la release, no a la respuesta.
    await injectBackendEnv({ root, releaseId: result.release.id, environment: 'preview' });
    return res.json({ success: true, ...result });
  } catch (error: any) {
    return publishError(res, error);
  }
});

/** Promueve una release concreta a producción (por defecto la preview actual). */
app.post('/api/publish/production', async (req, res) => {
  try {
    const body = req.body || {};
    const root = publishProjectRoot(body.root);
    const current = await getPublishStatus(root);
    const releaseId = typeof body.releaseId === 'string' && body.releaseId.trim()
      ? body.releaseId.trim()
      : current.preview?.id;
    if (!releaseId) throw new Error('No hay una release en preview para promover');
    const status = await promoteRelease(root, releaseId, 'production');
    // Producción recibe su propio entorno: no hereda el archivo de preview.
    await injectBackendEnv({ root, releaseId, environment: 'production' });
    return res.json({ success: true, status });
  } catch (error: any) {
    return publishError(res, error);
  }
});

/** Vuelve a la producción inmediatamente anterior. */
app.post('/api/publish/rollback', async (req, res) => {
  try {
    const root = publishProjectRoot(req.body?.root);
    const status = await rollbackProduction(root);
    // El entorno vuelve con la release restaurada.
    if (status.production) {
      await injectBackendEnv({
        root,
        releaseId: status.production.id,
        environment: 'production',
      });
    }
    return res.json({ success: true, status });
  } catch (error: any) {
    return publishError(res, error);
  }
});

// El adaptador remoto trabaja con releases locales ya creadas: no vuelve a
// compilar ni copia archivos. Sin credenciales queda desactivado; no hay fake.
app.use(
  '/api/deploy',
  createDeployRouter(publishProjectRoot, createConfiguredDeploymentAdapter())
);

// La misma sesión de Playwright que usan las tools del agente, expuesta al panel.
app.use('/api/browser', createBrowserRouter());
app.use('/api/integrations', createIntegrationsRouter());

// Gestión del backend de las apps publicadas (PL3): aprovisionar bindings y
// consultar su estado. Sin proveedor elegido, el único adaptador es el doble en
// memoria y sólo existe con `COMMANDER_BACKEND_FAKE=1`; sin la bandera la ruta
// responde deshabilitada y no finge un backend. Va antes del router
// multiinquilino, que ocupa `/api/backend` completo con su propio catch-all.
app.use('/api/backend/manage', createBackendRouter(createConfiguredBackendAdapter()));

// Backend de datos multiinquilino: auth bearer, registros y archivos aislados
// por inquilino. Se monta antes del estático/Vite para que ninguna ruta SPA
// capture `/api/backend`.
app.use('/api/backend', createTenantBackendRouter());

// Sirve una release bajo `/published/<slug>/<entorno>/`. Va antes de Vite y del
// estático de Commander: si no, el fallback SPA de la app se comería la URL.
app.use('/published/:slug/:env', (req, res) => {
  const slug = String(req.params.slug || '');
  const environment = String(req.params.env || '');
  if (!isValidPublishSlug(slug) || (environment !== 'preview' && environment !== 'production')) {
    return res.status(404).type('text/plain').send('Publicación no encontrada');
  }
  const published = getPublishedRelease(slug, environment);
  if (!published) {
    return res
      .status(404)
      .type('html')
      .send('<!doctype html><meta charset="utf-8"><title>Sin publicación</title><body style="font:14px monospace;background:#000080;color:#00ffff;padding:24px">Este entorno todavía no tiene una release publicada.</body>');
  }
  // El HTML de producción también debe reflejar un rollback de inmediato.
  res.setHeader('Cache-Control', environment === 'preview' ? 'no-store' : 'no-cache');
  const file = resolvePublishedFile(published.dir, req.path);
  // `.commander` es un directorio oculto: sin esta opción `send` devuelve 404
  // aunque el archivo exista. La ruta ya fue resuelta dentro de la release.
  if (file) return res.sendFile(file, { dotfiles: 'allow' });
  if (path.extname(req.path)) return res.status(404).type('text/plain').send('Archivo no encontrado');
  return res.sendFile(path.join(published.dir, 'index.html'), { dotfiles: 'allow' });
});

// ==================== RESTO DE RUTAS ====================

// Conteo de contexto con el tokenizador real del proveedor cuando existe.
// Google, Anthropic, OpenAI y Strata local exponen un contador; el resto cae
// a la estimación local sin bloquear el envío.
app.post('/api/context/count', async (req, res) => {
  try {
    const body = req.body || {};
    const provider = String(body.provider || '').trim().toLowerCase();
    const model = String(body.model || '').trim();
    const messages = Array.isArray(body.messages)
      ? body.messages
          .filter((message: any) => message && typeof message.content === 'string')
          .slice(-200)
          .map((message: any) => ({
            role: String(message.role || 'user'),
            content: String(message.content).slice(0, 200_000),
          }))
      : [];
    const examples = Array.isArray(body.examples)
      ? body.examples
          .filter((example: any) => example && typeof example === 'object')
          .slice(0, 20)
          .map((example: any) => ({ input: String(example.input || ''), output: String(example.output || '') }))
      : [];

    const keyFor = (name: string): string | undefined => {
      const fromBody = typeof body.apiKey === 'string' ? body.apiKey : undefined;
      return (
        fromBody ||
        getRequestApiKey(req, name) ||
        process.env[name] ||
        getProviderSecret(provider, 'apiKey')
      );
    };

    const apiKey =
      provider === 'google'
        ? body.geminiApiKey || keyFor('GEMINI_API_KEY')
        : provider === 'anthropic'
          ? body.anthropicApiKey || keyFor('ANTHROPIC_API_KEY')
          : provider === 'openai'
            ? keyFor('OPENAI_API_KEY')
            : provider === 'strata-local'
              ? body.apiKey || resolveStrataLocalApiKey()
              : undefined;

    const result = await countProviderTokens({
      provider,
      model: provider === 'google' ? mapGeminiModel(model) : model,
      messages,
      systemInstruction: typeof body.systemInstruction === 'string' ? body.systemInstruction : '',
      examples,
      apiKey,
      baseUrl:
        provider === 'google'
          ? (typeof body.baseUrl === 'string' ? body.baseUrl : undefined)
          : provider === 'strata-local'
            ? resolveStrataLocalBaseUrl(body.baseUrl || body.baseURL)
            : undefined,
    });

    return res.json({ success: true, ...result });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'No se pudo medir el contexto' });
  }
});

// Endpoint heredado: conserva la estimación histórica para clientes antiguos.
// El medidor nuevo usa `/api/context/count`, que sí consulta al proveedor.
app.post('/api/gemini/countTokens', async (req, res) => {
  const { contents, systemInstruction } = req.body;
  const contentString = (typeof contents === 'string' ? contents : JSON.stringify(contents)) || '';
  const systemString = systemInstruction || '';
  const totalTokens = Math.ceil((contentString.length + systemString.length) / 4);
  return res.json({ success: true, totalTokens });
});

// Endpoint Hugging Face Generation (Local or API proxy)
app.post('/api/hf/generate', async (req, res) => {
  try {
    const {
      prompt,
      model = 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
      hfApiToken,
      apiKey: userApiKey,
      geminiApiKey,
      systemInstruction = '',
      temperature = 0.7,
      maxTokens = 1024,
    } = req.body;

    const result = await executeLocalHfModel({
      prompt: prompt || 'Hola',
      model,
      hfApiToken: hfApiToken || getProviderSecret('huggingface', 'apiToken'),
      geminiApiKey: userApiKey || geminiApiKey,
      systemInstruction,
      temperature,
      maxTokens,
    });

    return res.json({
      success: true,
      text: result.text,
      metrics: result.metrics,
    });
  } catch (error: any) {
    console.error('Error en /api/hf/generate:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al procesar el modelo de Hugging Face',
    });
  }
});

// In-memory cache for Hugging Face search queries to prevent rate limits
const hfSearchCache = new Map<string, { timestamp: number; models: any[] }>();
const HF_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// Built-in catalog of 30+ top Hugging Face models across all domains for instant offline / rate-limited discovery
const POPULAR_HF_CATALOG = [
  // 1. REASONING & FRONTIER OPEN MODELS
  {
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
    modelId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
    author: 'deepseek-ai',
    downloads: 2450000,
    likes: 48900,
    pipeline_tag: 'text-generation',
    tags: ['deepseek', 'reasoning', 'qwen', 'think', 'quantized'],
    sizeMb: 1200,
  },
  {
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    modelId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    author: 'deepseek-ai',
    downloads: 1680000,
    likes: 38200,
    pipeline_tag: 'text-generation',
    tags: ['deepseek', 'reasoning', '7b', 'math', 'code'],
    sizeMb: 4400,
  },
  {
    id: 'deepseek-ai/DeepSeek-R1-Distill-Llama-8B',
    modelId: 'deepseek-ai/DeepSeek-R1-Distill-Llama-8B',
    author: 'deepseek-ai',
    downloads: 1240000,
    likes: 29800,
    pipeline_tag: 'text-generation',
    tags: ['deepseek', 'reasoning', 'llama', '8b'],
    sizeMb: 5200,
  },
  {
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
    modelId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
    author: 'deepseek-ai',
    downloads: 890000,
    likes: 22100,
    pipeline_tag: 'text-generation',
    tags: ['deepseek', 'reasoning', 'qwen', '32b', 'flagship'],
    sizeMb: 19000,
  },
  // 2. LLAMA FAMILY
  {
    id: 'meta-llama/Llama-3.2-3B-Instruct',
    modelId: 'meta-llama/Llama-3.2-3B-Instruct',
    author: 'meta-llama',
    downloads: 3200000,
    likes: 67200,
    pipeline_tag: 'text-generation',
    tags: ['llama', '3b', 'instruct', 'meta'],
    sizeMb: 2400,
  },
  {
    id: 'meta-llama/Llama-3.2-1B-Instruct',
    modelId: 'meta-llama/Llama-3.2-1B-Instruct',
    author: 'meta-llama',
    downloads: 2100000,
    likes: 45800,
    pipeline_tag: 'text-generation',
    tags: ['llama', '1b', 'instruct', 'meta', 'lightweight'],
    sizeMb: 900,
  },
  {
    id: 'meta-llama/Llama-3.1-8B-Instruct',
    modelId: 'meta-llama/Llama-3.1-8B-Instruct',
    author: 'meta-llama',
    downloads: 4500000,
    likes: 89400,
    pipeline_tag: 'text-generation',
    tags: ['llama', '8b', 'instruct', 'meta'],
    sizeMb: 5600,
  },
  {
    id: 'meta-llama/Llama-3.1-70B-Instruct',
    modelId: 'meta-llama/Llama-3.1-70B-Instruct',
    author: 'meta-llama',
    downloads: 1800000,
    likes: 52300,
    pipeline_tag: 'text-generation',
    tags: ['llama', '70b', 'instruct', 'meta', 'flagship'],
    sizeMb: 42000,
  },
  // 3. QWEN FAMILY
  {
    id: 'Qwen/Qwen2.5-7B-Instruct',
    modelId: 'Qwen/Qwen2.5-7B-Instruct',
    author: 'Qwen',
    downloads: 2800000,
    likes: 58700,
    pipeline_tag: 'text-generation',
    tags: ['qwen', '7b', 'instruct', 'alibaba'],
    sizeMb: 4800,
  },
  {
    id: 'Qwen/Qwen2.5-3B-Instruct',
    modelId: 'Qwen/Qwen2.5-3B-Instruct',
    author: 'Qwen',
    downloads: 1900000,
    likes: 41200,
    pipeline_tag: 'text-generation',
    tags: ['qwen', '3b', 'instruct', 'alibaba'],
    sizeMb: 2200,
  },
  {
    id: 'Qwen/Qwen2.5-72B-Instruct',
    modelId: 'Qwen/Qwen2.5-72B-Instruct',
    author: 'Qwen',
    downloads: 1200000,
    likes: 38900,
    pipeline_tag: 'text-generation',
    tags: ['qwen', '72b', 'instruct', 'alibaba', 'flagship'],
    sizeMb: 45000,
  },
  {
    id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
    modelId: 'Qwen/Qwen2.5-Coder-7B-Instruct',
    author: 'Qwen',
    downloads: 980000,
    likes: 31500,
    pipeline_tag: 'text-generation',
    tags: ['qwen', 'coder', '7b', 'code', 'alibaba'],
    sizeMb: 4800,
  },
  // 4. MISTRAL & SMALL LANGUAGE MODELS
  {
    id: 'mistralai/Mistral-7B-Instruct-v0.3',
    modelId: 'mistralai/Mistral-7B-Instruct-v0.3',
    author: 'mistralai',
    downloads: 3100000,
    likes: 72100,
    pipeline_tag: 'text-generation',
    tags: ['mistral', '7b', 'instruct'],
    sizeMb: 4400,
  },
  {
    id: 'mistralai/Mistral-Nemo-Instruct-2407',
    modelId: 'mistralai/Mistral-Nemo-Instruct-2407',
    author: 'mistralai',
    downloads: 890000,
    likes: 28400,
    pipeline_tag: 'text-generation',
    tags: ['mistral', 'nemo', '12b', 'instruct'],
    sizeMb: 7800,
  },
  {
    id: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
    modelId: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
    author: 'mistralai',
    downloads: 1500000,
    likes: 45600,
    pipeline_tag: 'text-generation',
    tags: ['mistral', 'mixtral', 'moe', '8x7b'],
    sizeMb: 28000,
  },
  // 5. PHI & MICROSOFT MODELS
  {
    id: 'microsoft/Phi-3-mini-4k-instruct',
    modelId: 'microsoft/Phi-3-mini-4k-instruct',
    author: 'microsoft',
    downloads: 2200000,
    likes: 51200,
    pipeline_tag: 'text-generation',
    tags: ['phi', 'mini', '3b', 'microsoft'],
    sizeMb: 2400,
  },
  {
    id: 'microsoft/Phi-3.5-mini-instruct',
    modelId: 'microsoft/Phi-3.5-mini-instruct',
    author: 'microsoft',
    downloads: 1100000,
    likes: 32800,
    pipeline_tag: 'text-generation',
    tags: ['phi', 'mini', '3.5b', 'microsoft'],
    sizeMb: 2600,
  },
  // 6. GEMMA (GOOGLE)
  {
    id: 'google/gemma-2-2b-it',
    modelId: 'google/gemma-2-2b-it',
    author: 'google',
    downloads: 1800000,
    likes: 42300,
    pipeline_tag: 'text-generation',
    tags: ['gemma', '2b', 'google', 'it'],
    sizeMb: 1800,
  },
  {
    id: 'google/gemma-2-9b-it',
    modelId: 'google/gemma-2-9b-it',
    author: 'google',
    downloads: 1400000,
    likes: 38700,
    pipeline_tag: 'text-generation',
    tags: ['gemma', '9b', 'google', 'it'],
    sizeMb: 6200,
  },
  {
    id: 'google/gemma-2-27b-it',
    modelId: 'google/gemma-2-27b-it',
    author: 'google',
    downloads: 780000,
    likes: 24100,
    pipeline_tag: 'text-generation',
    tags: ['gemma', '27b', 'google', 'it'],
    sizeMb: 18000,
  },
  // 7. EMBEDDING MODELS
  {
    id: 'sentence-transformers/all-MiniLM-L6-v2',
    modelId: 'sentence-transformers/all-MiniLM-L6-v2',
    author: 'sentence-transformers',
    downloads: 8900000,
    likes: 156000,
    pipeline_tag: 'feature-extraction',
    tags: ['embeddings', 'minilm', 'sentence-transformers'],
    sizeMb: 90,
  },
  {
    id: 'sentence-transformers/all-mpnet-base-v2',
    modelId: 'sentence-transformers/all-mpnet-base-v2',
    author: 'sentence-transformers',
    downloads: 4500000,
    likes: 98700,
    pipeline_tag: 'feature-extraction',
    tags: ['embeddings', 'mpnet', 'sentence-transformers'],
    sizeMb: 420,
  },
  {
    id: 'BAAI/bge-small-en-v1.5',
    modelId: 'BAAI/bge-small-en-v1.5',
    author: 'BAAI',
    downloads: 3200000,
    likes: 72100,
    pipeline_tag: 'feature-extraction',
    tags: ['embeddings', 'bge', 'small'],
    sizeMb: 130,
  },
  {
    id: 'BAAI/bge-base-en-v1.5',
    modelId: 'BAAI/bge-base-en-v1.5',
    author: 'BAAI',
    downloads: 2100000,
    likes: 54300,
    pipeline_tag: 'feature-extraction',
    tags: ['embeddings', 'bge', 'base'],
    sizeMb: 420,
  },
  {
    id: 'BAAI/bge-large-en-v1.5',
    modelId: 'BAAI/bge-large-en-v1.5',
    author: 'BAAI',
    downloads: 1200000,
    likes: 38900,
    pipeline_tag: 'feature-extraction',
    tags: ['embeddings', 'bge', 'large'],
    sizeMb: 1300,
  },
  // 8. CODE MODELS
  {
    id: 'bigcode/starcoder2-7b',
    modelId: 'bigcode/starcoder2-7b',
    author: 'bigcode',
    downloads: 890000,
    likes: 28400,
    pipeline_tag: 'text-generation',
    tags: ['code', 'starcoder', 'bigcode'],
    sizeMb: 4400,
  },
  {
    id: 'bigcode/starcoder2-15b',
    modelId: 'bigcode/starcoder2-15b',
    author: 'bigcode',
    downloads: 670000,
    likes: 21200,
    pipeline_tag: 'text-generation',
    tags: ['code', 'starcoder', 'bigcode', '15b'],
    sizeMb: 9200,
  },
  {
    id: 'codellama/CodeLlama-7b-Instruct-hf',
    modelId: 'codellama/CodeLlama-7b-Instruct-hf',
    author: 'codellama',
    downloads: 1100000,
    likes: 35600,
    pipeline_tag: 'text-generation',
    tags: ['code', 'codellama', 'llama', 'instruct'],
    sizeMb: 4400,
  },
  {
    id: 'codellama/CodeLlama-34b-Instruct-hf',
    modelId: 'codellama/CodeLlama-34b-Instruct-hf',
    author: 'codellama',
    downloads: 560000,
    likes: 19800,
    pipeline_tag: 'text-generation',
    tags: ['code', 'codellama', 'llama', 'instruct', '34b'],
    sizeMb: 22000,
  },
  // 9. VISION LANGUAGE MODELS
  {
    id: 'llava-hf/llava-1.5-7b-hf',
    modelId: 'llava-hf/llava-1.5-7b-hf',
    author: 'llava-hf',
    downloads: 980000,
    likes: 31200,
    pipeline_tag: 'image-to-text',
    tags: ['vision', 'llava', 'multimodal'],
    sizeMb: 4800,
  },
  {
    id: 'Salesforce/blip-image-captioning-base',
    modelId: 'Salesforce/blip-image-captioning-base',
    author: 'Salesforce',
    downloads: 1200000,
    likes: 38900,
    pipeline_tag: 'image-to-text',
    tags: ['vision', 'blip', 'captioning'],
    sizeMb: 900,
  },
  // 10. WHISPER (AUDIO)
  {
    id: 'openai/whisper-tiny',
    modelId: 'openai/whisper-tiny',
    author: 'openai',
    downloads: 4500000,
    likes: 89200,
    pipeline_tag: 'automatic-speech-recognition',
    tags: ['whisper', 'audio', 'asr', 'tiny'],
    sizeMb: 150,
  },
  {
    id: 'openai/whisper-base',
    modelId: 'openai/whisper-base',
    author: 'openai',
    downloads: 3200000,
    likes: 67800,
    pipeline_tag: 'automatic-speech-recognition',
    tags: ['whisper', 'audio', 'asr', 'base'],
    sizeMb: 280,
  },
  {
    id: 'openai/whisper-small',
    modelId: 'openai/whisper-small',
    author: 'openai',
    downloads: 2100000,
    likes: 54300,
    pipeline_tag: 'automatic-speech-recognition',
    tags: ['whisper', 'audio', 'asr', 'small'],
    sizeMb: 900,
  },
  {
    id: 'openai/whisper-medium',
    modelId: 'openai/whisper-medium',
    author: 'openai',
    downloads: 1400000,
    likes: 41200,
    pipeline_tag: 'automatic-speech-recognition',
    tags: ['whisper', 'audio', 'asr', 'medium'],
    sizeMb: 3000,
  },
  {
    id: 'openai/whisper-large-v3',
    modelId: 'openai/whisper-large-v3',
    author: 'openai',
    downloads: 890000,
    likes: 28700,
    pipeline_tag: 'automatic-speech-recognition',
    tags: ['whisper', 'audio', 'asr', 'large', 'v3'],
    sizeMb: 6000,
  },
];

// Endpoint to search Hugging Face models
app.get('/api/hf/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').slice(0, 200);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    // `pipeline_tag` de Hugging Face. Antes la categoría que elegía el usuario
    // se recibía y se descartaba, así que el desplegable no filtraba nada.
    const pipelineRaw = String(req.query.pipeline || '').slice(0, 64).trim();
    const pipeline = pipelineRaw && pipelineRaw !== 'all' ? pipelineRaw : '';

    // Check cache first
    const cacheKey = `${q}_${pipeline}_${limit}`;
    const cached = hfSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < HF_CACHE_TTL_MS) {
      return res.json({ success: true, models: cached.models, cached: true });
    }

    // Search Hugging Face API
    const params = new URLSearchParams({ limit: String(limit), sort: 'downloads', direction: '-1' });
    if (q) params.set('search', q);
    if (pipeline) params.set('pipeline_tag', pipeline);
    const url = `https://huggingface.co/api/models?${params.toString()}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
    });

    if (!response.ok) {
      // Fallback to built-in catalog
      const needle = q.toLowerCase();
      const filtered = POPULAR_HF_CATALOG.filter(
        (m) =>
          (!pipeline || m.pipeline_tag === pipeline) &&
          (!needle || m.id.toLowerCase().includes(needle) || m.tags.some((t) => t.includes(needle)))
      ).slice(0, limit);
      return res.json({ success: true, models: filtered, fallback: true });
    }

    const data = await response.json();
    const models = data.map((m: any) => ({
      id: m.id,
      modelId: m.id,
      author: m.author,
      downloads: m.downloads || 0,
      likes: m.likes || 0,
      pipeline_tag: m.pipeline_tag || 'text-generation',
      tags: m.tags || [],
      sizeMb: Math.round((m.siblings?.reduce((acc: number, s: any) => acc + (s.size || 0), 0) || 0) / 1024 / 1024),
    }));

    // Cache results
    hfSearchCache.set(cacheKey, { timestamp: Date.now(), models });

    return res.json({ success: true, models });
  } catch (error: any) {
    console.error('Error en /api/hf/search:', error);
    // Fallback to built-in catalog on error
    const filtered = POPULAR_HF_CATALOG.slice(0, 20);
    return res.json({ success: true, models: filtered, fallback: true });
  }
});

// Endpoint to download a model locally (metadata only, actual download happens client-side)
app.post('/api/hf/download-local', async (req, res) => {
  try {
    const { modelId, quantization = 'q4' } = req.body;
    if (!modelId || typeof modelId !== 'string') {
      return res.status(400).json({ success: false, error: 'modelId requerido' });
    }

    // Find in catalog or fetch from API
    let modelInfo = POPULAR_HF_CATALOG.find((m) => m.id === modelId);
    if (!modelInfo) {
      const response = await fetch(`https://huggingface.co/api/models/${modelId}`, {
        headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
      });
      if (!response.ok) {
        return res.status(404).json({ success: false, error: 'Modelo no encontrado' });
      }
      const data = await response.json();
      modelInfo = {
        id: data.id,
        modelId: data.id,
        author: data.author,
        downloads: data.downloads || 0,
        likes: data.likes || 0,
        pipeline_tag: data.pipeline_tag || 'text-generation',
        tags: data.tags || [],
        sizeMb: Math.round((data.siblings?.reduce((acc: number, s: any) => acc + (s.size || 0), 0) || 0) / 1024 / 1024),
      };
    }

    return res.json({
      success: true,
      model: {
        ...modelInfo,
        quantization,
        status: 'ready',
        downloadDate: new Date().toISOString().split('T')[0],
      },
    });
  } catch (error: any) {
    console.error('Error en /api/hf/download-local:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al descargar el modelo',
    });
  }
});

// ==================== WEB SEARCH (para Extensions Manager) ====================
// ── Búsqueda de código del proyecto ──
// Panel Search, Workbench y las menciones `@` del chat. Delegan en `fs.glob` y
// `fs.grep` en vez de repetir un recorrido: así respetan los roots registrados,
// los mismos directorios ignorados y el filtro de ficheros de secretos.
/** Consulta acotada: el recorrido es síncrono y esto lo llaman con cada tecla. */
function searchQuery(value: unknown): string {
  return String(value || '').trim().slice(0, 200);
}

function searchRoot(value: unknown): string | undefined {
  const root = String(value || '').trim();
  return root ? root.slice(0, 1024) : undefined;
}

/** Ranking del picker `@`: el nombre del fichero manda sobre el resto de la ruta. */
function fileMatchScore(relPath: string, query: string): number {
  const rel = relPath.toLowerCase();
  const q = query.toLowerCase();
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  if (base === q) return 3;
  if (base.startsWith(q)) return 2;
  return rel.includes(q) ? 1 : 0;
}

app.get('/api/search/files', async (req, res) => {
  try {
    const q = searchQuery(req.query.q);
    if (!q) return res.json({ success: true, files: [] });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const r = await executeAgentTool('fs.glob', { pattern: q, root: searchRoot(req.query.root) });
    if (!r.ok) return res.status(r.status || 400).json({ success: false, error: r.error, files: [] });
    const files = ((r.data?.files || []) as string[])
      .map((file) => ({ path: file, score: fileMatchScore(file, q) }))
      .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
      .slice(0, limit);
    res.json({ success: true, files });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message, files: [] }); }
});

app.get('/api/search/code', async (req, res) => {
  try {
    const q = searchQuery(req.query.q);
    if (!q) return res.json({ success: true, results: [], semantic: false });
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
    const r = await executeAgentTool('fs.grep', { pattern: q, root: searchRoot(req.query.root) });
    if (!r.ok) return res.status(r.status || 400).json({ success: false, error: r.error, results: [], semantic: false });
    // Agrupado por fichero, que es como lo pinta el panel. `semantic` va en
    // false porque no hay embeddings: el badge de la UI sólo sale con true.
    const byFile = new Map<string, { line: number; text: string }[]>();
    for (const match of ((r.data?.matches || []) as any[])) {
      // `fs.grep` devuelve la ruta con el separador del sistema y `fs.glob` en
      // POSIX; el panel pinta las dos y agrupa por ruta, así que se normaliza
      // aquí para que ambos endpoints hablen igual (también en Windows).
      const file = String(match.file).replace(/\\/g, '/');
      const list = byFile.get(file) || [];
      if (list.length >= 20) continue;
      list.push({ line: Number(match.line) || 0, text: String(match.text || '').slice(0, 200) });
      byFile.set(file, list);
    }
    const results = [...byFile].slice(0, limit).map(([file, matches]) => ({ path: file, score: matches.length, matches }));
    res.json({ success: true, results, semantic: false });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message, results: [], semantic: false }); }
});

app.get('/api/search/web', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 300);
  if (!q) return res.status(400).json({ success: false, error: 'query requerida' });
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'CommanderAIStudio/2.5' } });
    const html = await r.text();
    const results: { title: string; url: string; snippet: string }[] = [];
    const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < 8) {
      results.push({ url: m[1].slice(0, 500), title: m[2].replace(/<[^>]+>/g, '').slice(0, 200), snippet: '' });
    }
    return res.json({ success: true, results });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Error de búsqueda' });
  }
});

app.post('/api/export/native-project', async (req, res) => {
  try {
    const { projectName = 'my-app', files = [], packageJson = {} } = req.body;

    const zip = new JSZip();

    // Add package.json
    const defaultPackageJson = {
      name: projectName.toLowerCase().replace(/\s+/g, '-'),
      version: '1.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
      devDependencies: {
        vite: '^8.0.0',
        '@vitejs/plugin-react': '^6.0.0',
        typescript: '^7.0.0',
      },
      ...packageJson,
    };
    zip.file('package.json', JSON.stringify(defaultPackageJson, null, 2));

    // Add index.html
    zip.file('index.html', `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>`);

    // Add vite.config.ts
    zip.file('vite.config.ts', `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});`);

    // Add tsconfig.json
    zip.file('tsconfig.json', JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        useDefineForClassFields: true,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        isolatedModules: true,
        moduleDetection: 'force',
        noEmit: true,
        jsx: 'react-jsx',
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
        noUncheckedSideEffectImports: true,
      },
      include: ['src'],
    }, null, 2));

    // Add src/main.tsx
    zip.file('src/main.tsx', `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`);

    // Add src/index.css
    zip.file('src/index.css', `@import "tailwindcss";

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
}`);

    // Add user files
    for (const file of files) {
      const path = String(file.path || '').replace(/\.\./g, '').replace(/^\//, '');
      const content = String(file.content || '');
      if (path && content) {
        zip.file(path, content);
      }
    }

    // Generate zip
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${projectName.replace(/[^a-z0-9]/gi, '-')}.zip"`);
    res.send(buffer);
  } catch (error: any) {
    console.error('Error en /api/export/native-project:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al exportar el proyecto',
    });
  }
});

// ==================== LOCAL MODELS (GGUF) ====================

const localModelsDir = (() => {
  const fromEnv = String(process.env.COMMANDER_LOCAL_MODELS_DIR || '').trim();
  if (fromEnv) return fromEnv;
  const fromCwd = path.join(process.cwd(), 'local_models');
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.join(currentDir, '..', 'local_models');
})();
const runtimeDir = path.join(process.cwd(), 'runtime', 'llama');
/**
 * Seam de pruebas: si está seteada, `/generate` y `/stream` hablan con ese
 * llama-server en vez de arrancar binarios. Sin la variable, runtime real.
 */
const localRuntimeUrlOverride = String(process.env.COMMANDER_LOCAL_RUNTIME_URL || '').trim().replace(/\/+$/, '');
try {
  fs.mkdirSync(localModelsDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
} catch (e) {
  console.warn('No se pudo crear local_models/runtime:', e);
}

const localModelDownloads = new LocalModelDownloadManager(localModelsDir);
const localLlamaRuntime = new LocalLlamaRuntimeManager({
  findBinaries: () => findLlamaBinaries(runtimeDir),
});

/**
 * Ajustes del motor nativo que llegan de la UI o del turno del agente.
 * Se recuerdan para que el arranque automático desde el selector conserve la
 * configuración con la que se cargó un modelo grande (expertos MoE en RAM,
 * caché KV cuantizada) y se persisten en .commander/local-runtime.json para que
 * un reinicio de Commander no vuelva en silencio a los valores por defecto.
 */
let lastLocalRuntimeTuning: LocalRuntimeTuning = readLocalRuntimeTuning();

function localRuntimeTuningFrom(body: any): LocalRuntimeTuning {
  const moe = body?.cpuMoeLayers;
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const cacheTypeK = text(body?.cacheTypeK);
  const cacheTypeV = text(body?.cacheTypeV);
  const tensorSplit = text(body?.tensorSplit);
  const cacheReuse =
    body?.cacheReuse === undefined || body?.cacheReuse === null || String(body.cacheReuse).trim() === ''
      ? undefined
      : Number(body.cacheReuse);
  return {
    ...(typeof body?.jinja === 'boolean' ? { jinja: body.jinja } : {}),
    ...(typeof body?.flashAttention === 'boolean' ? { flashAttention: body.flashAttention } : {}),
    ...(moe === undefined || moe === null || String(moe).trim() === ''
      ? {}
      : { cpuMoeLayers: Number(moe) }),
    ...(cacheTypeK ? { cacheTypeK } : {}),
    ...(cacheTypeV ? { cacheTypeV } : {}),
    ...(tensorSplit ? { tensorSplit } : {}),
    ...(cacheReuse === undefined ? {} : { cacheReuse }),
  };
}

function detectLlamaBinary(): string | null {
  const binaries = findLlamaBinaries(runtimeDir);
  return binaries.server || binaries.cli || null;
}

app.get('/api/local-models', (_req, res) => {
  try {
    const library = listLocalModelRecords(localModelsDir);
    const files = library.map((model) => ({
      name: model.filename,
      size: model.sizeBytes,
      sizeMb: model.sizeMb,
      quantization: model.quantization,
      repoId: model.repoId,
      downloadedAt: model.downloadedAt,
    }));
    const runtime = localLlamaRuntime.getStatus();
    res.json({
      success: true,
      models: files,
      library,
      downloads: localModelDownloads.list(),
      runtime,
      runtimeAvailable: localLlamaRuntime.getAvailability(),
      hasLlamaRuntime: !!detectLlamaBinary(),
      dir: localModelsDir,
      runtimeDir,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'scan failed', models: [] });
  }
});

// ==================== HUGGING FACE → GGUF NATIVO ====================

const hfHubBase = () =>
  String(process.env.COMMANDER_HF_HUB_BASE || 'https://huggingface.co').replace(/\/+$/, '');

app.get('/api/local-models/hub/search', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim().slice(0, 200);
    const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 50);
    const params = new URLSearchParams({
      limit: String(limit),
      sort: 'downloads',
      direction: '-1',
      filter: 'gguf',
    });
    if (query) params.set('search', query);
    const response = await safeFetch(`${hfHubBase()}/api/models?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'CommanderAIStudio/2.5' },
    });
    if (!response.ok) throw new Error(`Hugging Face HTTP ${response.status}`);
    const payload = await response.json();
    return res.json({ success: true, models: parseHubSearchResults(payload) });
  } catch (error: any) {
    return res.status(502).json({ success: false, error: error?.message || 'No se pudo consultar Hugging Face' });
  }
});

app.get('/api/local-models/hub/files', async (req, res) => {
  try {
    const repoId = String(req.query.repoId || '').trim();
    if (!repoId || !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repoId) || repoId.includes('..')) {
      return res.status(400).json({ success: false, error: 'repoId inválido' });
    }
    const parts = repoId.split('/').map(encodeURIComponent);
    const response = await safeFetch(`${hfHubBase()}/api/models/${parts.join('/')}?blobs=true`, {
      headers: { Accept: 'application/json', 'User-Agent': 'CommanderAIStudio/2.5' },
    });
    if (!response.ok) throw new Error(`Hugging Face HTTP ${response.status}`);
    const payload = await response.json();
    const files = parseHubGgufFiles(payload, repoId).map((file) => ({
      ...file,
      downloadUrl: file.downloadUrl || hubDownloadUrl(repoId, file.filename),
    }));
    return res.json({ success: true, repoId, files });
  } catch (error: any) {
    return res.status(502).json({ success: false, error: error?.message || 'No se pudieron listar los GGUF' });
  }
});

app.post('/api/local-models/hub/download', async (req, res) => {
  try {
    const { repoId, filename, sizeBytes, quantization } = req.body || {};
    if (!sanitizeGgufFilename(filename)) {
      return res.status(400).json({ success: false, error: 'filename GGUF inválido' });
    }
    const job = localModelDownloads.start({
      repoId: String(repoId || ''),
      filename: String(filename),
      sizeBytes: Number(sizeBytes) || 0,
      quantization: String(quantization || ''),
    });
    return res.status(202).json({ success: true, job });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || 'No se pudo iniciar la descarga' });
  }
});

app.get('/api/local-models/jobs', (_req, res) => {
  res.json({ success: true, jobs: localModelDownloads.list() });
});

app.get('/api/local-models/jobs/:id', (req, res) => {
  const job = localModelDownloads.get(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'Trabajo no encontrado' });
  return res.json({ success: true, job });
});

app.post('/api/local-models/jobs/:id/:action', (req, res) => {
  const action = String(req.params.action || '');
  const id = String(req.params.id || '');
  const job =
    action === 'pause'
      ? localModelDownloads.pause(id)
      : action === 'resume'
        ? localModelDownloads.resume(id)
        : action === 'cancel'
          ? localModelDownloads.cancel(id)
          : action === 'retry'
            ? localModelDownloads.retry(id)
            : null;
  if (!job) return res.status(404).json({ success: false, error: 'Trabajo o acción no válidos' });
  return res.json({ success: true, job });
});

app.delete('/api/local-models/file/:filename', (req, res) => {
  try {
    const requested = String(req.params.filename || '');
    const split = splitGgufParts(requested);
    // Borrar una parte de un GGUF multiparte borra el modelo completo: dejar
    // las otras partes sueltas ocupa disco y no se puede ejecutar.
    const base = split ? requested.replace(/-\d{5}-of-\d{5}\.gguf$/i, '') : requested;
    const names = split
      ? listLocalModelRecords(localModelsDir)
          .filter((record) => record.filename === requested || record.filename.startsWith(`${base}-`))
          .map((record) => record.filename)
      : [requested];
    let removed = false;
    for (const name of names) removed = removeLocalModel(localModelsDir, name) || removed;
    if (!removed) return res.status(404).json({ success: false, error: 'Modelo no encontrado' });
    const activePath = localLlamaRuntime.getStatus().modelPath;
    if (activePath && names.some((name) => activePath === localModelPath(localModelsDir, name))) {
      void localLlamaRuntime.stop();
    }
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'No se pudo borrar el modelo' });
  }
});

app.get('/api/local-models/runtime', (_req, res) => {
  res.json({
    success: true,
    ...localLlamaRuntime.getStatus(),
    availability: localLlamaRuntime.getAvailability(),
  });
});

/**
 * Ajustes propuestos para un GGUF: lee su cabecera (capas, expertos, ventana) y
 * la memoria real de la máquina. El panel los muestra antes de arrancar, así que
 * el usuario no tiene que adivinar el --n-cpu-moe.
 */
app.get('/api/local-models/runtime/proposal', (req, res) => {
  try {
    const modelPath = localModelPath(localModelsDir, req.query.model);
    if (!modelPath || !fs.existsSync(modelPath)) {
      return res.status(404).json({ success: false, error: 'Modelo GGUF no encontrado' });
    }
    const profile = readGgufProfile(modelPath);
    const hardware = detectLocalHardware();
    const proposal = proposeLocalRuntimeTuning({ profile, hardware });
    return res.json({
      success: true,
      model: path.basename(modelPath),
      profile,
      hardware,
      // Ajustes guardados: el panel los prefiere sobre la propuesta derivada.
      saved: lastLocalRuntimeTuning,
      ...proposal,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'No se pudo proponer los ajustes' });
  }
});

app.post('/api/local-models/runtime/start', async (req, res) => {
  try {
    const modelPath = localModelPath(localModelsDir, req.body?.model);
    if (!modelPath || !fs.existsSync(modelPath)) {
      return res.status(404).json({ success: false, error: 'Modelo GGUF no encontrado' });
    }
    const tuning = localRuntimeTuningFrom(req.body);
    // Lo que la petición no manda se completa con los ajustes guardados: un
    // arranque desde el panel no debe perder jinja, flash-attn ni el MoE.
    const effectiveTuning = { ...lastLocalRuntimeTuning, ...tuning };
    // Sin contexto ni capas en la petición se deriva del GGUF y del hardware:
    // forzar 8K y todas las capas a la GPU recortaba la ventana del modelo.
    const needsProposal = !Number(req.body?.context) || req.body?.gpuLayers == null;
    const proposed = needsProposal
      ? proposeLocalRuntimeTuning({
          profile: readGgufProfile(modelPath),
          hardware: detectLocalHardware(),
        }).proposed
      : null;
    const result = await localLlamaRuntime.start({
      modelPath,
      modelName: path.basename(modelPath),
      context: Number(req.body?.context) || proposed?.context,
      gpuLayers: req.body?.gpuLayers == null ? proposed?.gpuLayers : Number(req.body.gpuLayers),
      ...effectiveTuning,
    });
    if (result.success) {
      lastLocalRuntimeTuning = writeLocalRuntimeTuning(effectiveTuning);
    }
    return res.status(result.success ? 200 : 503).json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'No se pudo arrancar el runtime' });
  }
});

app.post('/api/local-models/runtime/stop', async (_req, res) => {
  const result = await localLlamaRuntime.stop();
  return res.status(result.success ? 200 : 500).json(result);
});

app.post('/api/local-models/download', async (req, res) => {
  try {
    const { url, filename } = req.body || {};
    if (!url || !filename) return res.status(400).json({ success: false, error: 'url y filename requeridos' });

    const safeName = path.basename(String(filename));
    if (!safeName || safeName.includes('..')) return res.status(400).json({ success: false, error: 'filename inválido' });
    if (!safeName.toLowerCase().endsWith('.gguf')) return res.status(400).json({ success: false, error: 'solo archivos .gguf' });

    const target = path.join(localModelsDir, safeName);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000);

    const fetchRes = await safeFetch(String(url), { signal: controller.signal });
    if (!fetchRes.ok || !fetchRes.body) throw new Error(`Download HTTP ${fetchRes.status}`);
    const tmp = target + '.part';
    const file = fs.createWriteStream(tmp);
    const reader = fetchRes.body.getReader();
    const hash = createHash('sha256');
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      file.write(value);
      if (value) hash.update(value);
      received += value?.length || 0;
    }
    file.end();
    await new Promise<void>((resolve, reject) => file.on('finish', resolve).on('error', reject));
    if (fs.existsSync(target)) fs.unlinkSync(target);
    fs.renameSync(tmp, target);
    clearTimeout(timeoutId);

    res.json({ success: true, filename: safeName, size: received, sha256: hash.digest('hex') });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'download failed' });
  }
});

/**
 * Deja el runtime sirviendo `modelPath`: reutiliza el proceso si ya tiene ese
 * modelo y, si no, lo arranca con la propuesta del GGUF y el hardware más los
 * ajustes guardados. Lo comparten el generate sin stream y el stream SSE.
 */
async function ensureLocalRuntimeFor(
  modelPath: string,
  options: { context?: unknown; gpuLayers?: unknown } = {}
): Promise<{ success: boolean; error?: string }> {
  const current = localLlamaRuntime.getStatus();
  if (current.state === 'running' && current.modelPath === path.resolve(modelPath)) {
    return { success: true };
  }
  const proposed = proposeLocalRuntimeTuning({
    profile: readGgufProfile(modelPath),
    hardware: detectLocalHardware(),
  }).proposed;
  const result = await localLlamaRuntime.start({
    modelPath,
    modelName: path.basename(modelPath),
    context: Number(options.context) || proposed.context,
    gpuLayers: options.gpuLayers == null ? proposed.gpuLayers : Number(options.gpuLayers),
    ...mergeProposedTuning(lastLocalRuntimeTuning, proposed),
  });
  return { success: result.success, ...(result.error ? { error: result.error } : {}) };
}

app.post('/api/local-models/generate', async (req, res) => {
  // Sin señal, un cliente que abandona deja generando y ocupa el slot único.
  const abort = requestAbort(req, res);
  try {
    const {
      model,
      prompt,
      messages,
      systemInstruction = '',
      temperature = 0.7,
      maxTokens = 2048,
      contextLength,
      gpuLayers,
      tools,
    } = req.body || {};
    if (!model) return res.status(400).json({ success: false, error: 'model required' });

    const modelPath = localModelPath(localModelsDir, model);
    if (!modelPath || !fs.existsSync(modelPath)) {
      return res.status(404).json({ success: false, error: 'model file not found' });
    }

    const binaries = findLlamaBinaries(runtimeDir);
    // El server es el camino normal: mantiene el modelo cargado entre turnos y
    // expone Chat Completions. Sin server, se conserva el CLI de una pasada.
    if (binaries.server || localRuntimeUrlOverride) {
      let baseUrl = localRuntimeUrlOverride;
      if (!baseUrl) {
        const started = await ensureLocalRuntimeFor(modelPath, { context: contextLength, gpuLayers });
        if (!started.success) {
          return res.status(503).json({
            success: false,
            error: started.error || 'No se pudo arrancar el runtime de llama.cpp',
          });
        }
        baseUrl = localLlamaRuntime.getStatus().baseUrl || '';
      }
      if (!baseUrl) {
        return res.status(503).json({ success: false, error: 'El runtime de llama.cpp no tiene endpoint' });
      }
      const history = Array.isArray(messages) && messages.length > 0
        ? messages.map((message: any) => ({ role: String(message?.role || 'user'), content: String(message?.content || '') }))
        : [
            ...(String(systemInstruction || '').trim()
              ? [{ role: 'system', content: String(systemInstruction) }]
              : []),
            { role: 'user', content: String(prompt || '') },
          ];
      const attempt = await fetchChatWithOverflowRetry(`${baseUrl}/chat/completions`, {
        model: path.basename(modelPath),
        messages: history,
        temperature: Number(temperature),
        max_tokens: Number(maxTokens),
        // Reaprovecha el prefijo del turno anterior en vez de
        // recalcularlo: el agente manda casi el mismo historial cada vez.
        cache_prompt: true,
        stream: false,
        ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
      }, { signal: abort.signal });
      if (attempt.trimmed) {
        console.warn(
          `[local-models] prompt recortado por exceso de contexto: ${attempt.droppedMessages} turnos fuera`
        );
      }
      const upstream = attempt.response;
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        throw new Error(`llama-server HTTP ${upstream.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
      }
      const data = await upstream.json();
      const truncated = truncatedChatCompletions(data, Number(maxTokens));
      if (truncated) return res.json({ success: false, ok: false, error: truncated });
      const choice = data?.choices?.[0];
      return res.json({
        success: true,
        text: choice?.message?.content || '',
        toolCalls: normalizeOpenAIToolCalls(choice?.message?.tool_calls || []),
        finishReason: choice?.finish_reason,
        metrics: {
          promptTokens: data?.usage?.prompt_tokens || 0,
          responseTokens: data?.usage?.completion_tokens || 0,
          totalTokens: data?.usage?.total_tokens || 0,
          latencyMs: 0,
        },
      });
    }

    if (!binaries.cli) {
      return res.status(503).json({
        success: false,
        error: 'llama.cpp runtime not found. Descarga el runtime de llama.cpp o instala llama-server/llama-cli en el PATH.',
      });
    }

    // Sin llama-server, el CLI de una pasada también parte de la propuesta.
    const proposed = proposeLocalRuntimeTuning({
      profile: readGgufProfile(modelPath),
      hardware: detectLocalHardware(),
    }).proposed;
    const args = [
      '-m', modelPath,
      '-p', String(prompt || ''),
      '--temp', String(temperature),
      '-n', String(maxTokens),
      '-c', String(Number(contextLength) || proposed.context),
      '-ngl', String(gpuLayers == null ? proposed.gpuLayers : Number(gpuLayers)),
    ];
    const proc = spawn(binaries.cli, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    // Los modelos grandes en CPU pueden tardar; el límite anterior de 2 min
    // cortaba cualquier generación útil. El cliente puede abortar la petición.
    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
    }, 10 * 60_000);

    proc.on('close', () => {
      clearTimeout(timer);
      if (res.headersSent) return;
      let output = stdout;
      try {
        const promptText = String(prompt || '');
        if (output.startsWith(promptText)) output = output.slice(promptText.length);
      } catch {}
      res.json({
        success: true,
        text: output.trim() || (stderr ? `ERROR: ${stderr}` : ''),
        binary: binaries.cli,
        hasErrors: !!stderr,
      });
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timer);
      if (res.headersSent) return;
      res.status(500).json({ success: false, error: err.message });
    });
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err?.message || 'generate failed' });
    }
  } finally {
    abort.cleanup();
  }
});

/**
 * Streaming del runtime nativo: proxy del SSE de llama-server en el mismo sobre
 * que el resto de la app (`chunk`, `done`, `error`), para que el chat pinte la
 * respuesta mientras se genera en vez de esperar el texto completo.
 */
app.post('/api/local-models/stream', async (req, res) => {
  const started = Date.now();
  const abort = requestAbort(req, res);
  try {
    const body = req.body || {};
    const modelPath = localModelPath(localModelsDir, body.model);
    if (!modelPath || !fs.existsSync(modelPath)) {
      return res.status(404).json({ success: false, error: 'model file not found' });
    }
    if (!findLlamaBinaries(runtimeDir).server && !localRuntimeUrlOverride) {
      return res.status(503).json({
        success: false,
        error: 'llama.cpp runtime not found. Descarga el runtime de llama.cpp para usar streaming.',
      });
    }
    let baseUrl = localRuntimeUrlOverride;
    if (!baseUrl) {
      const ready = await ensureLocalRuntimeFor(modelPath, {
        context: body.contextLength,
        gpuLayers: body.gpuLayers,
      });
      if (!ready.success) {
        return res.status(503).json({
          success: false,
          error: ready.error || 'No se pudo arrancar el runtime de llama.cpp',
        });
      }
      baseUrl = localLlamaRuntime.getStatus().baseUrl || '';
    }
    if (!baseUrl) {
      return res.status(503).json({ success: false, error: 'El runtime de llama.cpp no tiene endpoint' });
    }

    const history = Array.isArray(body.messages) && body.messages.length > 0
      ? body.messages.map((message: any) => ({
          role: String(message?.role || 'user'),
          content: String(message?.content || ''),
        }))
      : [
          ...(String(body.systemInstruction || '').trim()
            ? [{ role: 'system', content: String(body.systemInstruction) }]
            : []),
          { role: 'user', content: String(body.prompt || '') },
        ];

    const attempt = await fetchChatWithOverflowRetry(
      `${baseUrl}/chat/completions`,
      {
        model: path.basename(modelPath),
        messages: history,
        temperature: Number(body.temperature ?? 0.7),
        max_tokens: Number(body.maxTokens ?? 2048),
        cache_prompt: true,
        stream: true,
        stream_options: { include_usage: true },
        ...(Array.isArray(body.tools) && body.tools.length > 0 ? { tools: body.tools } : {}),
      },
      { signal: abort.signal, headers: { Accept: 'text/event-stream, application/json' } }
    );
    if (attempt.trimmed) {
      console.warn(
        `[local-models/stream] prompt recortado por exceso de contexto: ${attempt.droppedMessages} turnos fuera`
      );
    }
    const upstream = attempt.response;
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return res.status(502).json({
        success: false,
        error: `llama-server HTTP ${upstream.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (payload: unknown) => {
      if (res.writableEnded) return;
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        /* el cliente cerró el socket */
      }
    };

    const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const toolCalls = new Map<number, { id?: string; name?: string; arguments?: string }>();
    let text = '';
    let finishReason: string | null = null;

    const finish = () => {
      const raw = [...toolCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, call]) => ({
          id: call.id || `local-call-${index}`,
          type: 'function',
          function: { name: call.name || '', arguments: call.arguments || '{}' },
        }));
      send({
        type: 'done',
        fullText: text,
        finishReason,
        ...(raw.length > 0 ? { toolCalls: normalizeOpenAIToolCalls(raw) } : {}),
        metrics: {
          promptTokens: usage.prompt_tokens,
          responseTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          latencyMs: Date.now() - started,
        },
      });
      if (!res.writableEnded) res.end();
    };

    // Un runtime sin stream devuelve el JSON completo: se convierte al mismo
    // sobre para que la UI no se quede en blanco.
    const contentType = String(upstream.headers.get('content-type') || '');
    if (!contentType.includes('text/event-stream')) {
      const data = await upstream.json().catch(() => null);
      const message = data?.choices?.[0]?.message || {};
      text = String(message.content || '');
      finishReason = data?.choices?.[0]?.finish_reason || null;
      if (data?.usage) Object.assign(usage, data.usage);
      if (Array.isArray(message.tool_calls)) {
        message.tool_calls.forEach((call: any, index: number) => {
          toolCalls.set(index, {
            id: call?.id,
            name: call?.function?.name,
            arguments: call?.function?.arguments,
          });
        });
      }
      if (text) send({ type: 'chunk', text });
      finish();
      return;
    }

    const reader = upstream.body?.getReader();
    if (!reader) throw new Error('llama-server no devolvió cuerpo de streaming');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let chunk: any = null;
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }
        if (chunk?.usage) Object.assign(usage, chunk.usage);
        const choice = chunk?.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta || {};
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content;
          send({ type: 'chunk', text: delta.content });
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const call of delta.tool_calls) {
            // llama.cpp manda los argumentos en fragmentos por índice.
            const index = Number.isInteger(call?.index) ? Number(call.index) : 0;
            const previous = toolCalls.get(index) || {};
            toolCalls.set(index, {
              id: call?.id || previous.id,
              name: call?.function?.name
                ? `${previous.name || ''}${call.function.name}`
                : previous.name,
              arguments: `${previous.arguments || ''}${call?.function?.arguments || ''}`,
            });
          }
        }
      }
    }
    finish();
  } catch (error: any) {
    if (res.writableEnded) return;
    const message = abort.signal.aborted
      ? String((abort.signal.reason as any)?.message || abort.signal.reason || 'Generación cancelada')
      : error?.message || 'Streaming del modelo local falló';
    if (!res.headersSent) {
      return res.status(502).json({ success: false, error: message });
    }
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
      res.end();
    } catch {
      /* socket ya cerrado */
    }
  } finally {
    abort.cleanup();
  }
});

// ==================== LLAMA RUNTIME DOWNLOAD (OPT-IN) ====================

app.get('/api/local-models/runtime-release-info', async (_req, res) => {
  try {
    const arch = process.arch.includes('arm') ? 'arm64' : 'x64';
    const osKey = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'macos' : 'linux';
    const primaryAssetPattern = osKey === 'win' ? 'win' : osKey === 'macos' ? 'macos' : 'ubuntu';

    // El release marcado como `latest` puede ser un tag sin binarios (por
    // ejemplo v1.0.0 solo publica nightly-tag.txt). Se recorren los releases
    // recientes y se elige el primero que sí tenga un asset para esta
    // plataforma.
    const relRes = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20', {
      headers: { 'User-Agent': 'CommanderAIStudio/2.5', 'Accept': 'application/vnd.github+json' },
    });
    if (!relRes.ok) {
      return res.status(502).json({ success: false, error: `GitHub HTTP ${relRes.status}` });
    }
    const releaseList = await relRes.json();
    const releases = Array.isArray(releaseList) ? releaseList : [];
    // Con GPU instalada conviene la build CUDA: con la de CPU el runtime
    // arranca sin dispositivos y el `-ngl` de la propuesta no offloadea nada.
    // Sin GPU se evita bajar cientos de MB de CUDA y se usa la de CPU.
    const hardware = (() => {
      try {
        return detectLocalHardware();
      } catch {
        return { gpuCount: 0 } as { gpuCount: number; gpuName?: string };
      }
    })();
    const hasGpu = hardware.gpuCount > 0;
    const assetScore = (asset: any): number =>
      scoreRuntimeAsset(String(asset?.name || ''), { hasGpu });
    let rel: any = null;
    let matched: any[] = [];
    let picked: any = null;
    for (const candidate of releases) {
      const assets = Array.isArray(candidate?.assets) ? candidate.assets : [];
      const candidateMatches = assets.filter((a: any) => {
        const name = String(a?.name || '').toLowerCase();
        if (!name.match(/\.(zip|tar\.gz|tgz)$/)) return false;
        if (!name.includes(primaryAssetPattern)) return false;
        if (!name.includes(arch)) return false;
        return true;
      });
      if (candidateMatches.length === 0) continue;
      rel = candidate;
      matched = candidateMatches;
      picked = [...candidateMatches].sort((a, b) => assetScore(b) - assetScore(a))[0];
      break;
    }
    if (!picked) {
      return res.json({
        success: false,
        platform: osKey,
        arch,
        url: null,
        filename: null,
        releaseTag: null,
        runtimeDir,
        hasLlamaRuntime: !!detectLlamaBinary(),
        allMatches: [],
        error: 'No hay binarios de llama.cpp para esta plataforma en los releases recientes',
      });
    }
    const cudart = selectCudartAsset(matched, picked);
    const variant = /cuda/i.test(picked.name)
      ? 'cuda'
      : /vulkan/i.test(picked.name)
        ? 'vulkan'
        : /cpu/i.test(picked.name)
          ? 'cpu'
          : 'otro';
    res.json({
      success: !!picked,
      platform: osKey,
      arch,
      url: picked?.browser_download_url || null,
      filename: picked?.name || null,
      releaseTag: rel.tag_name || null,
      runtimeDir,
      hasLlamaRuntime: !!detectLlamaBinary(),
      allMatches: matched.map((a: any) => a.name),
      variant,
      gpu: { detected: hasGpu, ...(hardware.gpuName ? { name: hardware.gpuName } : {}) },
      cudartUrl: cudart?.browser_download_url || null,
      cudartFilename: cudart?.name || null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to query GitHub' });
  }
});

app.post('/api/local-models/download-runtime', async (req, res) => {
  try {
    const { confirm, url, filename } = req.body || {};
    if (confirm !== true) return res.status(400).json({ success: false, error: 'confirm=true requerido' });
    if (!url || !filename) return res.status(400).json({ success: false, error: 'url y filename requeridos' });

    fs.mkdirSync(runtimeDir, { recursive: true });
    const safeName = path.basename(String(filename));
    const archivePath = path.join(runtimeDir, safeName);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60 * 60 * 1000);

    const fetchRes = await safeFetch(String(url), { signal: controller.signal });
    if (!fetchRes.ok || !fetchRes.body) throw new Error(`Download HTTP ${fetchRes.status}`);

    const file = fs.createWriteStream(archivePath);
    const reader = fetchRes.body.getReader();
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      file.write(value);
      received += value?.length || 0;
    }
    file.end();
    await new Promise<void>((resolve, reject) => file.on('finish', resolve).on('error', reject));

    // En Windows el `tar` que resuelve Git Bash es GNU tar y no abre ZIP;
    // PowerShell sí. En el resto se mantiene tar (o unzip para ZIP).
    const wantsZip = safeName.toLowerCase().endsWith('.zip') || safeName.toLowerCase().includes('.zip');
    const args = wantsZip ? ['-xf', safeName, '-C', runtimeDir] : ['-xzf', safeName, '-C', runtimeDir];
    const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    try {
      if (wantsZip && process.platform === 'win32') {
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `Expand-Archive -LiteralPath ${psQuote(archivePath)} -DestinationPath ${psQuote(runtimeDir)} -Force`,
          ],
          { stdio: 'ignore', timeout: 120000 }
        );
      } else {
        execFileSync('tar', args, { cwd: runtimeDir, stdio: 'ignore', timeout: 120000 });
      }
      try { fs.unlinkSync(archivePath); } catch {}
    } catch (extractErr: any) {
      return res.json({ success: true, downloaded: true, archive: safeName, extracted: false, hint: 'Archivo descargado; descomprímelo manualmente.', error: extractErr?.message });
    }

    clearTimeout(timeoutId);
    res.json({ success: true, downloaded: true, extracted: true, size: received, runtimePath: runtimeDir, hasLlamaRuntime: !!detectLlamaBinary() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'runtime download failed' });
  }
});

// ==================== LM STUDIO (OpenAI-compatible) ====================
//
// El host puede ser local o de otro equipo de la red: así se usa un modelo
// cargado en tu PC desde la app abierta en otra máquina. Se resuelve en este
// orden: lo que mande el formulario, la query, `LMSTUDIO_HOST`, la config
// guardada en el gestor y, por último, el puerto por defecto de LM Studio.

/**
 * Hosts de LM Studio en orden de preferencia.
 *
 * Hay dos escenarios reales y no excluyentes: el LM Studio de casa (host
 * remoto) y el de este portátil (`localHost`). Devolver todos permite usar el
 * que responda sin editar la configuración al mover el equipo. El modal local
 * sigue mandando por cookie, pero ya no bloquea al otro host si no responde.
 */
function lmstudioHosts(req: any, bodyHost?: unknown): string[] {
  const conf = (getConfig().providers as any)?.lmstudio || {};
  const raw = [
    typeof bodyHost === 'string' && bodyHost.trim() ? bodyHost : '',
    typeof req?.query?.host === 'string' && req.query.host.trim() ? req.query.host : '',
    getRequestApiKey(req, 'LMSTUDIO_HOST') || '',
    process.env.LMSTUDIO_HOST || '',
    conf.localHost || '',
    conf.host || '',
    'http://localhost:1234/v1',
  ];
  const hosts = raw
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => normalizeLmStudioHost(value));
  return [...new Set(hosts)];
}

/**
 * Primer host que responde (sonda cacheada 15 s), o el primero configurado si
 * ninguno contesta. Así, con el portátil fuera de casa, cae solo en el local.
 */
async function resolveLmstudioHost(req: any, bodyHost?: unknown): Promise<string> {
  const hosts = lmstudioHosts(req, bodyHost);
  for (const host of hosts) {
    const probe = await probeLocalProvider('lmstudio', host, { timeoutMs: 1200 });
    if (probe.reachable) return host;
  }
  return hosts[0] || 'http://localhost:1234/v1';
}

/**
 * Consulta el catálogo de LM Studio por las dos rutas que existen en sus
 * versiones: `/v1/models` (OpenAI-compatible) y `/api/v0/models` (nativa).
 * Devuelve también si el servidor respondió, porque «conectado sin modelos»
 * no es un error de conexión: es LM Studio abierto sin modelo cargado.
 */
function lmStudioCatalogContext(id: string, contexts: Record<string, number>): { context_window: number; contextLength: number; contextWindow: string } {
  const tokens = contexts[id] || 32_768;
  return {
    context_window: tokens,
    contextLength: tokens,
    contextWindow: tokens >= 1000 ? `${Math.floor(tokens / 1000)}K tokens` : `${tokens} tokens`,
  };
}

function lmStudioLoadedContext(models: any[], model: string, variantBase: string): number | undefined {
  const entry = models.find((item: any) =>
    (Array.isArray(item?.loaded_instances) ? item.loaded_instances : []).some(
      (instance: any) => instance?.id === model || instance?.id === variantBase
    )
  );
  return lmStudioContextLength(entry);
}

async function fetchLmstudioModels(host: string): Promise<{ models: string[]; host: string; contextLengths: Record<string, number> }> {
  const base = normalizeLmStudioHost(host);
  const root = base.replace(/\/v\d+$/i, '');
  const candidates = [...new Set([`${base}/models`, `${root}/api/v0/models`])];
  const settled = await Promise.allSettled(
    candidates.map(async (url) => {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
      return response.json().catch(() => ({}));
    })
  );

  const models = new Set<string>();
  const contextLengths: Record<string, number> = {};
  const errors: string[] = [];
  let answered = false;
  for (const result of settled) {
    if (result.status === 'rejected') {
      errors.push(result.reason?.message || String(result.reason));
      continue;
    }
    answered = true;
    Object.assign(contextLengths, parseLmStudioContextLengths(result.value));
    for (const id of parseLmStudioModels(result.value)) models.add(id);
  }

  if (!answered) {
    throw new Error(
      `No se pudo conectar a LM Studio en ${base}. Comprueba el puerto 1234, que «Serve on Local Network» esté activo y el firewall. ${errors[0] || ''}`.trim()
    );
  }
  const ids = [...models];
  // Igual que OpenCode: la lista queda guardada por host aunque el servidor se
  // apague después. El LM Studio remoto y el local son claves distintas.
  if (ids.length > 0) rememberLocalModels('lmstudio', base, ids);
  return { models: ids, host: base, contextLengths };
}

/**
 * Estado del modelo elegido en LM Studio.
 *
 * v0 da el id exacto (incluye variantes como `@q8_0`) y su `state`; v1 no
 * siempre distingue variantes, así que se consulta primero v0. v1 queda como
 * respaldo por si una versión futura retira la API antigua. `unknown` no
 * dispara una carga: el chat puede resolverla por JIT y no se rompe un flujo
 * que ya funcionaba.
 */
type LmStudioModelState = 'loaded' | 'not-loaded' | 'unknown';
interface LmStudioModelInfo { state: LmStudioModelState; contextLength?: number; }

/** Cargas explícitas en curso, para que la UI pueda mostrar el aviso. */
const lmStudioLoads = new Map<
  string,
  { model: string; startedAt: number; contextLength?: number }
>();

/**
 * Último fallo de carga por modelo. La generación devuelve el error, pero el
 * aviso global lo consulta después: se recuerda un rato para que la UI no se
 * apague en silencio. Caduca para no resucitar fallos viejos al cambiar de
 * modelo o reintentar más tarde.
 */
const lmStudioLoadErrors = new Map<string, { model: string; error: string; failedAt: number }>();
const LMSTUDIO_LOAD_ERROR_TTL_MS = 2 * 60 * 1000;

function recentLmStudioLoadError(model: string) {
  const entry = lmStudioLoadErrors.get(model);
  if (!entry) return undefined;
  if (Date.now() - entry.failedAt > LMSTUDIO_LOAD_ERROR_TTL_MS) {
    lmStudioLoadErrors.delete(model);
    return undefined;
  }
  return entry;
}

async function getLmStudioModelInfo(host: string, model: string): Promise<LmStudioModelInfo> {
  const base = normalizeLmStudioHost(host);
  const root = base.replace(/\/v\d+$/i, '');

  try {
    const response = await fetch(`${root}/api/v0/models`, {
      headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
      signal: AbortSignal.timeout(7000),
    });
    if (response.ok) {
      const payload: any = await response.json().catch(() => null);
      const entry = Array.isArray(payload?.data)
        ? payload.data.find((item: any) => item?.id === model)
        : undefined;
      if (entry) {
        // «loading» ya está en marcha: no lanzar una segunda carga.
        if (entry.state === 'loaded' || entry.state === 'loading') return { state: 'loaded', contextLength: lmStudioContextLength(entry) };
        if (entry.state === 'not-loaded') return { state: 'not-loaded', contextLength: lmStudioContextLength(entry) };
      }
    }
  } catch {
    // v0 puede no existir en versiones futuras; se prueba v1 abajo.
  }

  try {
    const response = await fetch(`${root}/api/v1/models`, {
      headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
      signal: AbortSignal.timeout(7000),
    });
    if (response.ok) {
      const payload: any = await response.json().catch(() => null);
      const models: any[] = Array.isArray(payload?.models) ? payload.models : [];
      const variantBase = model.replace(/@[^@]+$/, '');
      const exactInstance = models.some((item: any) =>
        (Array.isArray(item?.loaded_instances) ? item.loaded_instances : []).some(
          (instance: any) => instance?.id === model || instance?.id === variantBase
        )
      );
      if (exactInstance) return { state: 'loaded', contextLength: lmStudioLoadedContext(models, model, variantBase) };
      const entry = models.find(
        (item: any) => item?.key === model || item?.id === model || item?.key === variantBase || item?.id === variantBase
      );
      if (entry) {
        return {
          state: Array.isArray(entry.loaded_instances) && entry.loaded_instances.length > 0 ? 'loaded' : 'not-loaded',
          contextLength: lmStudioContextLength(entry),
        };
      }
    }
  } catch {
    // Sin listado no se puede saber el estado: el chat decide (JIT).
  }

  return { state: 'unknown' };
}

/**
 * Carga el modelo antes de generar, como OpenCode. Se hace por HTTP y no con
 * `lms` porque el host puede ser otro equipo de la LAN, donde ese CLI no
 * existe. v0 no tiene endpoint de carga; la carga explícita llegó con v1.
 */
async function ensureLmStudioModelLoaded(host: string, model: string, requestedContextLength?: unknown): Promise<void> {
  // Un intento nuevo invalida el fallo anterior: si el modelo ya está cargado
  // o esta vez funciona, el aviso no debe seguir mostrando el error viejo.
  lmStudioLoadErrors.delete(model);
  const info = await getLmStudioModelInfo(host, model);
  if (info.state !== 'not-loaded') return;
  const contextLength = toLmStudioContextLength(requestedContextLength) ?? info.contextLength;

  const base = normalizeLmStudioHost(host);
  const root = base.replace(/\/v\d+$/i, '');
  const loadKey = `${base}\n${model}`;
  // El contexto forma parte de la petición de carga: la UI lo enseña junto al
  // tiempo para que se sepa qué ventana se está esperando.
  const load = {
    model,
    startedAt: Date.now(),
    ...(contextLength ? { contextLength } : {}),
  };
  lmStudioLoads.set(loadKey, load);

  try {
    let response: Response;
    try {
      response = await fetch(`${root}/api/v1/models/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, ...(contextLength ? { context_length: contextLength } : {}) }),
        // Un modelo grande puede tardar minutos; el chat tampoco tiene timeout.
        signal: AbortSignal.timeout(LMSTUDIO_LOAD_TIMEOUT_MS),
      });
    } catch (error: any) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error(`LM Studio tardó más de ${Math.round(LMSTUDIO_LOAD_TIMEOUT_MS / 60_000)} minutos en cargar el modelo "${model}"`);
      }
      throw new Error(`No se pudo cargar el modelo "${model}" en LM Studio: ${error?.message || 'sin conexión'}`);
    }

    if (response.ok) return;
    // Versión antigua sin endpoint de carga: el chat puede cargarlo por JIT.
    if (response.status === 404) return;

    const payload: any = await response.json().catch(() => ({}));
    const detail = payload?.error?.message || (typeof payload?.error === 'string' ? payload.error : '') || payload?.message || `HTTP ${response.status}`;
    if (response.status === 409 || /already loaded|already in memory/i.test(String(detail))) return;
    throw new Error(`No se pudo cargar el modelo "${model}" en LM Studio: ${detail}`);
  } finally {
    if (lmStudioLoads.get(loadKey) === load) lmStudioLoads.delete(loadKey);
  }
}

app.get('/api/lmstudio/models', async (req, res) => {
  try {
    const probe = await fetchLmstudioModels(await resolveLmstudioHost(req));
    return res.json({
      success: true,
      models: probe.models,
      host: probe.host,
      warning: probe.models.length === 0 ? 'LM Studio responde, pero no tiene modelos cargados.' : undefined,
    });
  } catch (e: any) {
    // Sin conexión se devuelve lo último detectado, marcado como caché: el
    // servidor puede estar apagado y los modelos siguen siendo los suyos.
    const saved = cachedLocalModels('lmstudio');
    return res.json({
      success: false,
      models: saved.models,
      cached: saved.models.length > 0,
      updatedAt: saved.updatedAt,
      error: redactSecrets(e?.message || 'LM Studio no responde'),
    });
  }
});

// POST para poder probar un host que aún no está guardado (botón «Probar»).
app.post('/api/lmstudio/models', async (req, res) => {
  try {
    const probe = await fetchLmstudioModels(await resolveLmstudioHost(req, req.body?.host));
    return res.json({
      success: true,
      models: probe.models,
      host: probe.host,
      warning: probe.models.length === 0 ? 'LM Studio responde, pero no tiene modelos cargados.' : undefined,
    });
  } catch (e: any) {
    // Sin conexión se devuelve lo último detectado, marcado como caché: el
    // servidor puede estar apagado y los modelos siguen siendo los suyos.
    const saved = cachedLocalModels('lmstudio');
    return res.json({
      success: false,
      models: saved.models,
      cached: saved.models.length > 0,
      updatedAt: saved.updatedAt,
      error: redactSecrets(e?.message || 'LM Studio no responde'),
    });
  }
});

app.get('/api/lmstudio/loading', (req, res) => {
  // Sondeo de la UI: no cachear, o el aviso se quedaría encendido.
  res.setHeader('Cache-Control', 'no-store');
  const requested = typeof req.query.model === 'string'
    ? req.query.model.trim().replace(/^lmstudio\//, '')
    : '';
  const load = [...lmStudioLoads.values()].find((item) => !requested || item.model === requested);
  // Sin carga en curso, un fallo reciente explica por qué el aviso se apaga.
  const failed = load ? undefined : recentLmStudioLoadError(requested);
  return res.json({
    success: true,
    loading: Boolean(load),
    ...(load
      ? {
          model: load.model,
          startedAt: load.startedAt,
          ...(load.contextLength ? { contextLength: load.contextLength } : {}),
        }
      : {}),
    ...(!load && failed ? { model: failed.model, error: failed.error, failedAt: failed.failedAt } : {}),
  });
});

app.post('/api/lmstudio/generate', async (req, res) => {
  try {
    const { prompt, model, systemInstruction = '', temperature = 0.7, maxTokens = 2048, host: bodyHost, tools, toolChoice, contextLength } = req.body || {};
    const host = await resolveLmstudioHost(req, bodyHost);
    const target = model
      ? String(model).replace(/^lmstudio\//, '')
      : getProviderSecret('lmstudio', 'defaultModel') || '';
    if (!target) return res.json({ ok: false, error: 'Modelo requerido' });

    // OpenCode carga el modelo elegido si aún no está en memoria. Hacerlo aquí
    // cubre también el host remoto y cualquier caller del endpoint (agente,
    // Nono, generación directa).
    try {
      await ensureLmStudioModelLoaded(host, target, contextLength);
    } catch (error: any) {
      // El aviso de la UI sondea este estado cuando la generación termina; sin
      // esto solo vería `loading: false` y no podría explicar el fallo.
      lmStudioLoadErrors.set(target, {
        model: target,
        error: redactSecrets(error instanceof Error ? error.message : String(error || 'Error desconocido')),
        failedAt: Date.now(),
      });
      throw error;
    }

    const response = await fetch(`${host}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: target,
        // Tool-calling: LM Studio habla Chat Completions, pero si no se reenvían
        // las `tools` el agente recibe texto sin toolCalls y se para en el
        // primer paso. El bucle del agente manda aquí el esquema completo.
        ...(Array.isArray(tools) && tools.length > 0 ? { tools, tool_choice: toolChoice || 'auto' } : {}),
        messages: [
          ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
          { role: 'user', content: prompt || '' },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `LM Studio HTTP ${response.status}`);
    }

    const data = await response.json();
    // Mismo corte que en las demás rutas: `finish_reason: "length"` sin nada es
    // error, no un éxito con texto vacío (`G1-EMPTY-TURN`).
    const truncado = truncatedChatCompletions(data, maxTokens);
    if (truncado) return res.json({ success: false, ok: false, error: truncado });
    const message = data.choices?.[0]?.message || {};
    // Mismo formato que los handlers de OpenAI/NVIDIA: `src/agent/llm.ts` lee
    // `toolCalls` con { name, args }, y LM Studio las devuelve como
    // `tool_calls[].function.arguments` en texto JSON.
    const calls = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
      .map((tc: any) => {
        const fn = tc?.function || {};
        let args: Record<string, unknown> = {};
        try {
          args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments || {};
        } catch {
          args = {};
        }
        return { id: tc?.id, name: fn.name, args };
      })
      .filter((tc: any) => typeof tc.name === 'string' && tc.name.length > 0);
    return res.json({
      success: true,
      text: message.content || '',
      finishReason: data.choices?.[0]?.finish_reason,
      ...(calls.length > 0 ? { toolCalls: calls } : {}),
      metrics: {
        promptTokens: data.usage?.prompt_tokens || 0,
        responseTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        latencyMs: 0,
      },
    });
  } catch (e: any) {
    return res.json({ ok: false, error: redactSecrets(e?.message || 'LM Studio generate falló') });
  }
});

// ==================== OLLAMA HEALTH ====================
// ==================== OLLAMA HEALTH ====================
// ==================== OLLAMA HEALTH ====================
// Catálogo de modelos de Ollama para el modal Local LLM. `/api/ollama/health`
// dice si el servidor responde; esto devuelve lo que ese modal pinta.
app.get('/api/ollama/models', async (req, res) => {
  const host = String(
    req.query.host || getRequestApiKey(req, 'OLLAMA_HOST') || process.env.OLLAMA_HOST || 'http://localhost:11434'
  );
  // `OLLAMA_HOST` admite credenciales en la URL (`https://usuario:clave@host`).
  // El modal sólo pinta el host y no lo reescribe, y `fetch` rechaza esas URLs
  // repitiéndolas en el error: el host y el mensaje salen redactados, con el
  // host y el puerto a la vista para diagnosticar.
  const hostVisible = redactSecrets(host);
  try {
    const response = await fetch(`${host}/api/tags`, {
      method: 'GET',
      headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
      signal: AbortSignal.timeout(4000),
    });
    const data = response.ok ? await response.json().catch(() => ({})) : {};
    const models = Array.isArray(data?.models)
      ? data.models.map((m: any) => (typeof m === 'string' ? m : (m?.name || m?.model))).filter(Boolean)
      : [];
    res.json({
      success: response.ok,
      models,
      host: hostVisible,
      error: response.ok ? undefined : ('HTTP ' + response.status),
    });
  } catch (error: any) {
    res.json({ success: false, models: [], host: hostVisible, error: redactSecrets(error?.message || 'unreachable') });
  }
});

app.get('/api/ollama/health', async (req, res) => {
  const host = String(
    req.query.host || getRequestApiKey(req, 'OLLAMA_HOST') || process.env.OLLAMA_HOST || 'http://localhost:11434'
  );
  // Misma regla que `/api/ollama/models`: el host va redactado porque el
  // cliente no lo reutiliza, y el mensaje de `fetch` también lo repite.
  const hostVisible = redactSecrets(host);
  try {
    const response = await fetch(`${host}/api/tags`, {
      method: 'GET',
      headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
      signal: AbortSignal.timeout(4000),
    });
    const data = response.ok ? await response.json().catch(() => ({})) : {};
    const models = Array.isArray(data?.models)
      ? data.models.map((m: any) => (typeof m === 'string' ? m : (m?.name || m?.model))).filter(Boolean)
      : [];
    res.json({
      success: response.ok,
      ok: response.ok,
      models,
      host: hostVisible,
      error: response.ok ? undefined : ('HTTP ' + response.status),
    });
  } catch (error: any) {
    res.json({
      success: false,
      ok: false,
      models: [],
      host: hostVisible,
      error: redactSecrets(error?.message || 'unreachable'),
    });
  }
});

// ==================== OLLAMA PULL ====================




// Ollama pull endpoint
app.post('/api/ollama/pull', async (req, res) => {
  try {
    const { model, host } = req.body;
    if (!model) return res.status(400).json({ ok: false, error: 'Model name required' });
    const ollamaHost = host || req.query.host || process.env.OLLAMA_HOST || 'http://localhost:11434';

    const response = await fetch(`${ollamaHost}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'CommanderAIStudio/2.5' },
      body: JSON.stringify({ name: model, stream: true }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`Ollama HTTP ${response.status}: ${err}`);
    }

    // Stream progress to client via SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          // Forward progress to client
          res.write(`data: ${JSON.stringify({ ok: true, progress: data })}\n\n`);
        } catch {
          // Ignore non-JSON lines
        }
      }
    }
    res.write(`data: ${JSON.stringify({ ok: true, done: true })}\n\n`);
    res.end();
  } catch (error: any) {
    if (!res.headersSent) {
      return res.json({ ok: false, error: redactSecrets(error.message || 'Pull failed') });
    } else {
      res.write(`data: ${JSON.stringify({ ok: false, error: redactSecrets(error.message) })}\n\n`);
      res.end();
    }
  }
});

// Ollama delete model endpoint
app.post('/api/ollama/delete', async (req, res) => {
  try {
    const { model, host } = req.body;
    if (!model) return res.status(400).json({ ok: false, error: 'Model name required' });
    const ollamaHost = host || req.query.host || process.env.OLLAMA_HOST || 'http://localhost:11434';

    const response = await fetch(`${ollamaHost}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'CommanderAIStudio/2.5' },
      body: JSON.stringify({ name: model }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`Ollama HTTP ${response.status}: ${err}`);
    }

    return res.json({ ok: true, success: true });
  } catch (error: any) {
    return res.json({ ok: false, error: redactSecrets(error.message || 'Delete failed') });
  }
});

// ==================== MODELS.DEV LIVE CATALOG ====================
// Fetches the comprehensive models catalog from models.dev (75+ providers)

interface ModelsDevModel {
  id: string;
  name: string;
  provider: string;
  attachment?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  tool_call?: boolean;
  input_modalities?: string[];
  output_modalities?: string[];
  context_window?: number;
  knowledge_cutoff?: string;
  release_date?: string;
  license?: string;
  architecture?: string;
  quantization?: string[];
  pricing?: { input: number; output: number };
  tags?: string[];
  deprecated?: boolean;
}

async function fetchNvidiaLiveModels() {
  const key = process.env.NVIDIA_API_KEY || getProviderSecret('nvidia', 'apiKey');
  if (!key) return [];
  try {
    const ids = await fetchProviderModelIds(NVIDIA_MODELS_URL, key);
    return ids.map((id) => ({
      id: `nvidia/${id}`,
      name: id,
      provider: 'nvidia',
      context_window: 128_000,
      tags: ['nvidia', 'nim'],
    }));
  } catch {
    return [];
  }
}

async function fetchModelsDevCatalog(): Promise<ModelsDevModel[]> {
  // models.dev devuelve un mapa `proveedor → { env, models }`, no una lista
  // plana. El registro lo normaliza y aquí sólo se aplana a este formato.
  const providers = await getProviderCatalog();
  return providers.flatMap((p) =>
    p.models.map((m) => ({
      id: m.id,
      name: m.name,
      provider: p.id,
      context_window: m.contextWindow ? Number(String(m.contextWindow).replace(/[^0-9]/g, '')) * 1000 : undefined,
      tool_call: m.supportsTools,
      reasoning: m.supportsReasoning,
      input_modalities: m.supportsImage ? ['text', 'image'] : ['text'],
    }))
  );
}

app.get('/api/models/live', async (req, res) => {
  try {
    const [modelsDevModels, ollamaModels, lmstudioResult, nvidiaModels, strataLocalResult] = await Promise.all([
      fetchModelsDevCatalog(),
      (async () => {
        try {
          const host = req.query.host || process.env.OLLAMA_HOST || getProviderSecret('ollama', 'host') || 'http://localhost:11434';
          const response = await fetch(`${host}/api/tags`, {
            headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
          });
          if (!response.ok) return [];
          const data = await response.json();
          const names: string[] = (data.models || [])
            .map((m: any) => (typeof m === 'string' ? m : m?.name))
            .filter(Boolean);
          // Se guarda por host: si Ollama se apaga, sus modelos siguen listados.
          rememberLocalModels('ollama', String(host), names);
          return names.map((name) => ({
            id: `ollama/${name}`,
            name,
            provider: 'ollama',
            context_window: 128_000,
            tags: ['local', 'detectado'],
          }));
        } catch {
          return [];
        }
      })(),
      (async () => {
        let liveIds: string[] = [];
        let liveContexts: Record<string, number> = {};
        try {
          const probe = await fetchLmstudioModels(await resolveLmstudioHost(req));
          liveIds = probe.models;
          liveContexts = probe.contextLengths;
        } catch {
          // LM Studio puede estar apagado: el catálogo guardado en la última
          // detección sigue siendo suyo y no debe desaparecer del selector.
        }
        // Puede responder uno de los dos hosts y el otro estar apagado: se
        // suman los modelos guardados de ambos (remoto/local) sin duplicar.
        const ids = [...new Set([...liveIds, ...cachedLocalModels('lmstudio').models])];
        return {
          live: liveIds.length > 0,
          entries: ids.map((id) => ({
            id: `lmstudio/${id}`,
            name: id,
            provider: 'lmstudio' as const,
            ...lmStudioCatalogContext(id, liveContexts),
            tags: liveIds.length > 0 ? ['local'] : ['local', 'guardado'],
          })),
        };
      })(),
      fetchNvidiaLiveModels(),
      strataLocalCatalog(),
    ]);

    // Proveedores añadidos por el usuario: sus modelos no están en models.dev,
    // así que se listan desde su endpoint (o desde los guardados al añadirlo).
    const addedProviders = customProviderSpecs(getConfig().providers as any);
    const addedConfig = (((getConfig().providers as any)?.openaiCompatible) || {}) as Record<string, any>;
    const compatibleEntries = (
      await Promise.all(
        addedProviders.map(async (spec) => {
          const entry = addedConfig[spec.id] || {};
          const base = String(entry.baseUrl || '').replace(/\/+$/, '');
          let ids: string[] = Array.isArray(entry.models)
            ? entry.models.filter((value: unknown): value is string => typeof value === 'string')
            : [];
          if (ids.length === 0 && base) {
            try {
              const response = await fetch(`${base}/models`, {
                headers: { ...(entry.apiKey ? { Authorization: `Bearer ${entry.apiKey}` } : {}) },
                signal: AbortSignal.timeout(8_000),
              });
              if (response.ok) {
                const data = await response.json().catch(() => ({}));
                const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
                ids = list.map((model: any) => (typeof model === 'string' ? model : model?.id || model?.name)).filter(Boolean);
              }
            } catch {
              /* se queda con los modelos guardados */
            }
          }
          return ids.map((id) => ({
            id: `openai-compatible/${spec.id}/${id}`,
            name: id,
            provider: spec.id as any,
            context_window: 32_768,
            tags: ['openai-compatible'],
          }));
        })
      )
    ).flat();

    // GGUF nativos descargados por Commander: no dependen de ningún daemon
    // externo, así que se listan siempre que el archivo exista en disco.
    const nativeLocalEntries = listLocalModelRecords(localModelsDir)
      .filter((record) => {
        const split = splitGgufParts(record.filename);
        return !split || split.index === 1;
      })
      .map((record) => {
        // Ventana y tamaño reales salen de la cabecera del GGUF: publicar 8K
        // fijos recortaba el contexto de modelos que declaran 32K o más.
        const recordPath = localModelPath(localModelsDir, record.filename);
        const profile = recordPath ? readGgufProfile(recordPath) : null;
        const contextLength = profile?.contextLength || 8_192;
        const sizeBytes = record.sizeBytes || profile?.tensorBytes || 0;
        const sizeMb = record.sizeMb || Math.round(sizeBytes / (1024 * 1024));
        return {
          id: `local/${record.filename}`,
          name: record.filename,
          provider: 'local' as const,
          contextLength,
          context_window: contextLength,
          contextWindow:
            contextLength >= 1000
              ? `${Math.floor(contextLength / 1000)}K tokens`
              : `${contextLength} tokens`,
          description: `GGUF local · ${record.quantization}${sizeMb ? ` · ${sizeMb} MB` : ''}`,
          // llama.cpp sólo llama tools si el GGUF trae plantilla de chat y el
          // motor arranca con `--jinja`.
          supportsTools: Boolean(profile?.hasChatTemplate && lastLocalRuntimeTuning.jinja !== false),
          sizeBytes,
          sizeMb,
          tags: ['local', 'gguf'],
        };
      });

    // Un servidor local apagado no vacía el selector: se listan los modelos de
    // la última detección guardada. Ollama tiene un solo host; LM Studio une
    // arriba los modelos del remoto y del local.
    const ollamaList = ollamaModels.length > 0
      ? ollamaModels
      : cachedLocalModels('ollama').models.map((name) => ({
          id: `ollama/${name}`,
          name,
          provider: 'ollama' as const,
          context_window: 128_000,
          tags: ['local', 'guardado'],
        }));
    const ollamaLive = ollamaModels.length > 0;
    const lmstudioLive = lmstudioResult.live;

    // Merge and normalize to CatalogEntry format
    const allEntries = [
      // NVIDIA se sirve desde `fetchNvidiaLiveModels()` con ids prefijados;
      // las entradas crudas de models.dev (`meta/...`) se clasificarían como
      // HuggingFace por llevar `/`.
      ...modelsDevModels.filter((m) => m.provider !== 'nvidia').map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider as any,
        contextWindow: m.context_window ? `${Math.round(m.context_window / 1000)}K tokens` : undefined,
        contextLength: m.context_window,
        description: m.tags?.join(', '),
        supportsThinking: m.reasoning === true,
        supportsImage: m.input_modalities?.includes('image') === true,
        supportsAudio: m.input_modalities?.includes('audio') === true,
        supportsVideo: m.input_modalities?.includes('video') === true,
        supportsTools: m.tool_call === true,
        pricing: m.pricing,
        license: m.license,
        architecture: m.architecture,
        quantization: m.quantization,
        knowledgeCutoff: m.knowledge_cutoff,
        releaseDate: m.release_date,
        tags: m.tags,
        // models.dev no marca los Gemini retirados: se completa aquí para que
        // el selector los etiquete en vez de ofrecerlos como actuales.
        deprecated: m.deprecated === true || (m.provider === 'google' && isDeprecatedGeminiModel(m.id)),
      })),
      ...ollamaList,
      ...lmstudioResult.entries,
      ...strataLocalResult.entries.map((entry) => ({
        ...entry,
        name: entry.name || entry.id,
        contextLength: entry.context_length,
        ...(entry.context_window
          ? { contextWindow: `${Math.round(entry.context_window / 1000)}K tokens` }
          : {}),
      })),
      ...nvidiaModels,
      ...nativeLocalEntries,
      ...compatibleEntries,
    ];

    // Estado por proveedor: `available` dice si tiene modelos listados y
    // `configured` si hay credenciales. Antes ambos eran lo mismo (count > 0),
    // así que todo aparecía «disponible» aunque no hubiera ni una clave.
    const providerStatus: Record<string, { available: boolean; count: number; configured: boolean; source: string; error?: string; cached?: boolean; name?: string; loaded?: boolean; model?: string; identity?: string; warning?: string }> = {};
    const envIds = new Set(getEnvProviderIds());
    const specs = new Map([...PROVIDER_SPECS, ...addedProviders].map((s) => [s.id, s]));
    for (const p of new Set(allEntries.map((m) => m.provider))) {
      const count = allEntries.filter((m) => m.provider === p).length;
      const spec = specs.get(p);
      const st = spec ? describeProvider(spec, getConfig().providers as any, envIds) : { configured: true, source: 'none' };
      providerStatus[p] = {
        available: count > 0,
        count,
        configured: st.configured,
        source: st.source,
        name: spec?.name || p,
        ...(p === STRATA_LOCAL_PROVIDER_ID
          ? {
              ...(typeof strataLocalResult.loaded === 'boolean' ? { loaded: strataLocalResult.loaded } : {}),
              ...(strataLocalResult.model ? { model: strataLocalResult.model } : {}),
              identity: strataLocalResult.identity,
              cached: !strataLocalResult.live,
              ...(strataLocalResult.warning ? { warning: strataLocalResult.warning } : {}),
            }
          : {}),
      };
    }
    // Los proveedores sin entradas en el catálogo (HF, custom, freebuff) deben
    // salir igualmente: su disponibilidad es tener credenciales, no modelos.
    for (const spec of PROVIDER_SPECS) {
      if (providerStatus[spec.id]) continue;
      const st = describeProvider(spec, getConfig().providers as any, envIds);
      providerStatus[spec.id] = { available: st.configured, count: 0, configured: st.configured, source: st.source };
    }
    providerStatus.ollama = { available: ollamaList.length > 0, count: ollamaList.length, configured: true, source: 'local', ...(ollamaLive ? {} : { cached: true }) };
    providerStatus.lmstudio = { available: lmstudioResult.entries.length > 0, count: lmstudioResult.entries.length, configured: true, source: 'local', name: 'LM Studio', ...(lmstudioLive ? {} : { cached: true }) };
    providerStatus.local = { available: nativeLocalEntries.length > 0, count: nativeLocalEntries.length, configured: true, source: 'local', name: 'Commander (GGUF)' };
    providerStatus[STRATA_LOCAL_PROVIDER_ID] = {
      ...(providerStatus[STRATA_LOCAL_PROVIDER_ID] || {}),
      available: strataLocalResult.entries.length > 0,
      count: strataLocalResult.entries.length,
      configured: true,
      source: 'local',
      name: 'Strata (local)',
      identity: strataLocalResult.identity,
      ...(typeof strataLocalResult.loaded === 'boolean' ? { loaded: strataLocalResult.loaded } : {}),
      ...(strataLocalResult.model ? { model: strataLocalResult.model } : {}),
      ...(strataLocalResult.entries.length > 0 && !strataLocalResult.live ? { cached: true } : {}),
      ...(strataLocalResult.warning ? { warning: strataLocalResult.warning } : {}),
    };
    // Los añadidos están configurados por definición: existen porque se guardó
    // su URL base, aunque ahora no respondan.
    for (const spec of addedProviders) {
      const count = compatibleEntries.filter((entry) => entry.provider === spec.id).length;
      providerStatus[spec.id] = { available: count > 0, count, configured: true, source: 'file', name: spec.name };
    }

    return res.json({
      success: true,
      models: allEntries,
      providers: providerStatus,
    });
  } catch (error: any) {
    return res.json({ ok: false, error: error.message || 'Failed to fetch live catalog' });
  }
});

// Ollama list available models from library (search)
app.get('/api/ollama/library', async (req, res) => {
  try {
    const host = req.query.host || process.env.OLLAMA_HOST || getProviderSecret('ollama', 'host') || 'http://localhost:11434';
    const response = await fetch(`${host}/api/tags`, {
      headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const data = await response.json();
    // Also try to get library models (Ollama doesn't have a public library API, so we return local)
    return res.json({ success: true, models: data.models || [] });
  } catch (error: any) {
    return res.json({ ok: false, error: redactSecrets(error.message || 'Ollama no disponible') });
  }
});

// Ollama generate endpoint
app.post('/api/ollama/generate', async (req, res) => {
  try {
    const { prompt, model = 'llama3.2', systemInstruction = '', temperature = 0.7, maxTokens = 2048 } = req.body;
    const host =
      req.query.host ||
      getRequestApiKey(req, 'OLLAMA_HOST') ||
      process.env.OLLAMA_HOST ||
      getProviderSecret('ollama', 'host') ||
      'http://localhost:11434';

    const response = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt,
        stream: false,
        options: { temperature, num_predict: maxTokens },
      }),
    });

    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const data = await response.json();
    // Ollama corta por `num_predict` con `done_reason: "length"`.
    const truncado = truncatedOllama(data, maxTokens);
    if (truncado) return res.json({ success: false, ok: false, error: truncado });
    return res.json({
      success: true,
      text: data.response || '',
      metrics: {
        promptTokens: data.prompt_eval_count || 0,
        responseTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        latencyMs: data.total_duration ? Math.round(data.total_duration / 1e6) : 0,
      },
    });
  } catch (error: any) {
    return res.json({ ok: false, error: redactSecrets(error.message || 'Ollama generate falló') });
  }
});

// OpenRouter generate endpoint
// xAI Grok. `aiProviders` declara este endpoint para los ids `grok*`, pero no
// había handler: el modelo elegido recibía el `index.html` de la SPA en vez de
// una respuesta. Mismo contrato que OpenRouter; la clave sale del cuerpo o de
// `XAI_API_KEY` (el cliente no la manda: `clientCredentialsFor` sólo viaja con
// ids `custom/`).
app.post('/api/xai/generate', async (req, res) => {
  try {
    const { prompt, model = 'grok-beta', systemInstruction = '', temperature = 0.7, maxTokens = 2048, apiKey } = req.body || {};
    const key = apiKey || process.env.XAI_API_KEY || getProviderSecret('xai', 'apiKey');
    if (!key) return res.json({ ok: false, error: 'XAI_API_KEY requerida' });

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
          { role: 'user', content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `xAI HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return res.json({
      success: true,
      text,
      metrics: {
        promptTokens: data.usage?.prompt_tokens || 0,
        responseTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        latencyMs: 0,
      },
    });
  } catch (error: any) {
    return res.json({ ok: false, error: error.message || 'xAI generate falló' });
  }
});

app.post('/api/openrouter/generate', async (req, res) => {
  try {
    const { prompt, model = 'openai/gpt-4o-mini', systemInstruction = '', temperature = 0.7, maxTokens = 2048, apiKey, baseURL } = req.body;
    const key = apiKey || process.env.OPENROUTER_API_KEY || getProviderSecret('openrouter', 'apiKey');
    if (!key) return res.json({ ok: false, error: 'OPENROUTER_API_KEY requerida' });

    // `baseURL` en el cuerpo permite apuntar a un proxy OpenRouter-compatible
    // (y a un upstream falso en los tests), igual que en `/api/custom/generate`.
    const base = String(baseURL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
          { role: 'user', content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenRouter HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    // Un turno cortado por presupuesto no es una respuesta (`G1-EMPTY-TURN`).
    const truncado = truncatedChatCompletions(data, maxTokens);
    if (truncado) return res.json({ success: false, ok: false, error: truncado });
    return res.json({
      success: true,
      text,
      finishReason: data.choices?.[0]?.finish_reason,
      metrics: {
        promptTokens: data.usage?.prompt_tokens || 0,
        responseTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        latencyMs: 0,
      },
    });
  } catch (error: any) {
    return res.json({ ok: false, error: error.message || 'OpenRouter generate falló' });
  }
});

// Pollinations generate endpoint (free, no API key)
app.post('/api/pollinations/generate', async (req, res) => {
  try {
    const { prompt, model = 'openai', systemInstruction = '', temperature = 0.7 } = req.body;

    const fullPrompt = systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt;
    const url = `https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}?model=${encodeURIComponent(model)}&temperature=${temperature}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
    });

    if (!response.ok) throw new Error(`Pollinations HTTP ${response.status}`);
    const text = await response.text();
    return res.json({
      success: true,
      text,
      metrics: { promptTokens: 0, responseTokens: 0, totalTokens: 0, latencyMs: 0 },
    });
  } catch (error: any) {
    return res.json({ ok: false, error: error.message || 'Pollinations generate falló' });
  }
});

// Custom endpoint (OpenAI-compatible)
// Catálogo de un endpoint OpenAI-compatible (`${baseURL}/models`): lo usan el
// botón de probar del proveedor Custom y el modal Local LLM. Las claves se
// resuelven como en `/api/custom/generate`: la del cuerpo manda, si no la del
// entorno.
app.post('/api/custom/models', async (req, res) => {
  const { baseURL, apiKey } = req.body || {};
  const url = String(baseURL || process.env.CUSTOM_BASE_URL || '').replace(/\/+$/, '');
  const key = apiKey || process.env.CUSTOM_API_KEY || process.env.OPENCODE_API_KEY;
  if (!url) return res.json({ success: false, models: [], error: 'CUSTOM_BASE_URL requerido' });
  try {
    const response = await fetch(`${url}/models`, {
      method: 'GET',
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return res.json({ success: false, models: [], error: `HTTP ${response.status}` });
    const data = await response.json().catch(() => ({}));
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    const models = list.map((m: any) => (typeof m === 'string' ? m : (m?.id || m?.name))).filter(Boolean);
    res.json({ success: true, models });
  } catch (error: any) {
    res.json({ success: false, models: [], error: error?.message || 'unreachable' });
  }
});

/**
 * Historial que entiende Chat Completions. La app manda `messages` (incluido el
 * turno nuevo) y `prompt`; el prompt queda como respaldo para clientes viejos y
 * para el agente. Antes se ignoraba `messages`, así que una conversación local
 * sólo veía el último mensaje.
 */
type OpenAiHistoryMessage = Record<string, unknown>;

/**
 * Normaliza los `tool_calls` de un turno assistant para reenviarlos como
 * historial. Strata usa el contrato OpenAI: `arguments` debe ser un string
 * JSON, aunque algunos clientes lo manden ya parseado.
 */
function openAiHistoryToolCalls(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const calls: Array<Record<string, unknown>> = [];
  for (const call of raw) {
    const fn = call?.function;
    if (!fn || typeof fn.name !== 'string' || !fn.name) continue;
    const args = fn.arguments == null
      ? '{}'
      : typeof fn.arguments === 'string'
        ? fn.arguments
        : JSON.stringify(fn.arguments);
    calls.push({
      ...(typeof call?.id === 'string' && call.id ? { id: call.id } : {}),
      type: 'function',
      function: { name: fn.name, arguments: args },
    });
  }
  return calls;
}

function openAiChatMessages(body: any): OpenAiHistoryMessage[] {
  const source = Array.isArray(body?.messages) ? body.messages : [];
  const messages: OpenAiHistoryMessage[] = [];
  for (const item of source.slice(-200)) {
    if (!item || typeof item !== 'object') continue;
    const role = item.role === 'model' ? 'assistant' : String(item.role || 'user');

    // El resultado de una tool viaja con su `tool_call_id`; sin conservarlo el
    // modelo no puede relacionarlo con la llamada anterior.
    if (role === 'tool') {
      if (typeof item.tool_call_id !== 'string' || !item.tool_call_id) continue;
      messages.push({
        role: 'tool',
        tool_call_id: item.tool_call_id,
        content: typeof item.content === 'string' ? item.content : String(item.content ?? ''),
        ...(typeof item.name === 'string' && item.name ? { name: item.name } : {}),
      });
      continue;
    }

    if (!['system', 'user', 'assistant'].includes(role)) continue;
    const content = typeof item.content === 'string' ? item.content : '';
    const toolCalls = role === 'assistant' ? openAiHistoryToolCalls(item.tool_calls) : [];
    // Un assistant que sólo pide tools no tiene texto: es un turno válido y hay
    // que conservarlo para que el `tool` posterior tenga contexto.
    if (!content.trim() && toolCalls.length === 0) continue;
    messages.push({
      role,
      content: role === 'assistant' && !content.trim() ? null : content,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }
  if (messages.length === 0) {
    messages.push({ role: 'user', content: String(body?.prompt || '') });
  }
  const system = String(body?.systemInstruction || '').trim();
  if (system && !messages.some((message) => message.role === 'system' && String(message.content || '').trim())) {
    messages.unshift({ role: 'system', content: system });
  }
  return messages;
}

function openAiTools(body: any): { tools?: unknown[]; toolChoice?: unknown } {
  return Array.isArray(body?.tools) && body.tools.length > 0
    ? { tools: body.tools, toolChoice: body.toolChoice || 'auto' }
    : {};
}

/** Cancela el `fetch` si el cliente se va o si el modelo se queda colgado. */
function requestAbort(_req: any, res: any, timeoutMs = 15 * 60_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('El modelo local no respondió a tiempo')), timeoutMs);
  timeout.unref?.();
  const close = () => {
    if (!res.writableEnded) controller.abort(new Error('Generación cancelada'));
  };
  res.on?.('close', close);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      res.off?.('close', close);
    },
  };
}

function errorText(payload: any, fallback: string): string {
  return String(payload?.error?.message || payload?.error || fallback).slice(0, 500);
}

async function generateCustom(
  req: any,
  res: any,
  overrides?: {
    baseURL?: string;
    apiKey?: string;
    model?: string;
    label?: string;
    /** Activa los códigos y el reintento seguro propios de Strata. */
    strata?: boolean;
    /** Permite inyectar el fetch con reintento sin duplicar la ruta. */
    fetcher?: typeof fetch;
    /** Capacidades del modelo Strata para no mandar tools que no soporta. */
    strataTools?: { supportsParallelTools?: boolean };
  }
) {
  const started = Date.now();
  const abort = requestAbort(req, res);
  let requestKey: string | undefined;
  try {
    const {
      model: requestedModel,
      temperature = 0.7,
      maxTokens = 2048,
      baseURL: requestedBaseURL,
      apiKey: requestedApiKey,
    } = req.body;
    const model = overrides?.model || requestedModel;

    // Los proveedores añadidos comparten esta ruta: el prefijo del id dice
    // cuál es y aquí se resuelven URL y clave guardadas en el servidor.
    const added = parseCompatibleModelId(String(model || ''));
    const addedEntry = added ? (getConfig().providers as any)?.openaiCompatible?.[added.providerId] : undefined;
    if (added && !addedEntry?.baseUrl) {
      return res.json({ ok: false, error: `Proveedor ${added?.providerId} sin configurar` });
    }

    const key = added
      ? addedEntry?.apiKey
      : overrides?.apiKey || requestedApiKey || process.env.CUSTOM_API_KEY || process.env.OPENCODE_API_KEY || getProviderSecret('custom', 'apiKey');
    requestKey = key;
    const url = added
      ? String(addedEntry.baseUrl).replace(/\/+$/, '')
      : overrides?.baseURL || requestedBaseURL || process.env.CUSTOM_BASE_URL || getProviderSecret('custom', 'baseUrl');
    const targetModel = added ? added.modelId : model;
    const errorPrefix = overrides?.label || 'Custom';

    if (!url) return res.json({ ok: false, error: overrides?.baseURL ? 'URL base requerida' : 'CUSTOM_BASE_URL requerido' });
    if (!key && !added && !overrides?.baseURL) return res.json({ ok: false, error: 'CUSTOM_API_KEY requerida' });

    const toolPayload = openAiTools(req.body);
    const payload: Record<string, unknown> = {
      model: targetModel || 'gpt-4o-mini',
      messages: openAiChatMessages(req.body),
      temperature,
      max_tokens: maxTokens,
      ...(toolPayload.tools
        ? {
            tools: toolPayload.tools,
            tool_choice: toolPayload.toolChoice,
            ...(overrides?.strataTools?.supportsParallelTools !== undefined
              ? { parallel_tool_calls: overrides.strataTools.supportsParallelTools }
              : {}),
          }
        : {}),
    };

    const doFetch = overrides?.fetcher ?? fetch;
    const response = await doFetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        ...(key ? { 'Authorization': `Bearer ${key}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (overrides?.strata) {
        throw classifyStrataFailure({
          status: response.status,
          payload: err,
          message: errorText(err, `${errorPrefix} HTTP ${response.status}`),
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
          secret: key,
        });
      }
      throw new Error(errorText(err, `${errorPrefix} HTTP ${response.status}`));
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message || {};
    const text = message.content || '';
    const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls = overrides?.strata
      ? normalizeStrataToolCalls(rawToolCalls, { tools: req.body?.tools })
      : normalizeOpenAIToolCalls(rawToolCalls);
    const finishReason = data.choices?.[0]?.finish_reason;
    // Un turno cortado por `max_tokens` y sin contenido ni tool calls no es una
    // respuesta: devolverlo como éxito hacía que el agente cerrara en vacío
    // (G1-EMPTY-TURN).
    const truncado = truncatedChatCompletions(data, maxTokens);
    if (truncado) {
      return res.json({ success: false, ok: false, error: truncado });
    }
    return res.json({
      success: true,
      text,
      finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      metrics: {
        promptTokens: data.usage?.prompt_tokens || 0,
        responseTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        latencyMs: Date.now() - started,
      },
    });
  } catch (error: any) {
    if (res.writableEnded) return;
    if (overrides?.strata) {
      const reason = abort.signal.reason;
      const message = abort.signal.aborted
        ? String((reason as any)?.message || reason || 'Generación cancelada')
        : error?.message || `${overrides.label || 'Strata'} generate falló`;
      return sendStrataError(
        res,
        isStrataIntegrationError(error)
          ? error
          : classifyStrataFailure({
              message,
              aborted: abort.signal.aborted,
              timedOut: /tiempo|timeout|timed?\s*out/i.test(message),
              secret: requestKey,
            })
      );
    }
    const message = abort.signal.aborted
      ? 'Generación cancelada'
      : error?.message || `${overrides?.label || 'Custom'} generate falló`;
    return res.json({ ok: false, error: message });
  } finally {
    abort.cleanup();
  }
}

app.post('/api/custom/generate', (req, res) => generateCustom(req, res));

/**
 * Modelo efectivo de Strata. Si la petición no trae uno y no hay
 * `defaultModel`, se usa el que el host declara cargado o el primero del
 * catálogo. Strata sólo resuelve solo cuando hay un modelo; aquí se evita el
 * error innecesario «Modelo de Strata requerido» tras cargar el primero.
 */
async function resolveStrataLocalModel(
  requested?: unknown,
  baseUrlOverride?: unknown,
  apiKey?: string
): Promise<string | null> {
  const direct = strataLocalModelName(String(requested || '')).trim();
  if (direct) return direct;
  const configured = strataLocalModelName(String(strataLocalSettings().defaultModel || '')).trim();
  if (configured) return configured;
  try {
    const health = await strataLocalHealth({
      baseUrl: baseUrlOverride || undefined,
      apiKey,
    });
    return health.model || strataLocalModelName(health.entries?.[0]?.id || '') || null;
  } catch {
    return null;
  }
}

// Strata local reutiliza el mismo contrato: sólo cambia de dónde salen la URL,
// la clave y el modelo por defecto, y quita el prefijo del selector.
app.post('/api/strata-local/generate', async (req, res) => {
  const body = req.body || {};
  const baseUrl = resolveStrataLocalBaseUrl(body.baseURL || body.baseUrl);
  const apiKey = resolveStrataLocalApiKey(body.apiKey);
  const security = strataLocalKeyTransportError(baseUrl, apiKey, body.allowInsecure);
  if (security) return sendStrataError(res, security);
  const model = await resolveStrataLocalModel(body.model, baseUrl, apiKey);
  if (!model) {
    return sendStrataError(
      res,
      strataError('STRATA_MODEL_NOT_LOADED', {
        message: 'Strata no tiene un modelo cargado o no se pudo resolver el modelo solicitado.',
      })
    );
  }
  const preflight = await strataLocalPreflight(model, baseUrl, apiKey);
  if (preflight.failure) return sendStrataError(res, preflight.failure);
  const toolsError = strataToolsRequestError(body, preflight.info);
  if (toolsError) return sendStrataError(res, toolsError);
  return generateCustom(req, res, {
    baseURL: baseUrl,
    apiKey,
    model,
    label: 'Strata local',
    strata: true,
    strataTools: { supportsParallelTools: preflight.info?.supportsParallelTools },
    fetcher: (input, init) => fetchStrataWithRetry(fetch, input, init ?? {}, { secret: apiKey }),
  });
});

/**
 * Streaming de Strata con el mismo sobre SSE que Gemini/Anthropic: `chunk`,
 * `done` y `error`. El `fetch` se cancela al cerrar la pestaña, y el parseo
 * tolera un host que conteste JSON en vez de SSE (modelo sin stream).
 */
app.post('/api/strata-local/stream', async (req, res) => {
  const started = Date.now();
  const abort = requestAbort(req, res);
  let key: string | undefined;
  try {
    const body = req.body || {};
    const baseUrl = resolveStrataLocalBaseUrl(body.baseURL || body.baseUrl);
    key = resolveStrataLocalApiKey(body.apiKey);
    const security = strataLocalKeyTransportError(baseUrl, key, body.allowInsecure);
    if (security) return sendStrataError(res, security);
    const model = await resolveStrataLocalModel(body.model, baseUrl, key);
    if (!model) {
      return sendStrataError(
        res,
        strataError('STRATA_MODEL_NOT_LOADED', {
          message: 'Strata no tiene un modelo cargado o no se pudo resolver el modelo solicitado.',
        })
      );
    }
    const preflight = await strataLocalPreflight(model, baseUrl, key);
    if (preflight.failure) return sendStrataError(res, preflight.failure);
    const toolsError = strataToolsRequestError(body, preflight.info);
    if (toolsError) return sendStrataError(res, toolsError);
    const toolPayload = openAiTools(body);
    const upstream = await fetchStrataWithRetry(fetch, `${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
      },
      body: JSON.stringify({
        model,
        messages: openAiChatMessages(body),
        temperature: body.temperature ?? 0.7,
        max_tokens: body.maxTokens ?? 2048,
        stream: true,
        stream_options: { include_usage: true },
        ...(toolPayload.tools
          ? {
              tools: toolPayload.tools,
              tool_choice: toolPayload.toolChoice,
              ...(preflight.info?.supportsParallelTools !== undefined
                ? { parallel_tool_calls: preflight.info.supportsParallelTools }
                : {}),
            }
          : {}),
      }),
      signal: abort.signal,
    }, { secret: key });
    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return sendStrataError(
        res,
        classifyStrataFailure({
          status: upstream.status,
          payload: err,
          message: errorText(err, `Strata HTTP ${upstream.status}`),
          retryAfterMs: parseRetryAfter(upstream.headers.get('retry-after')),
          secret: key,
        })
      );
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const send = (payload: unknown) => {
      if (res.writableEnded) return;
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        /* el cliente cerró el socket */
      }
    };

    const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const toolCalls = new Map<number, { id?: string; name?: string; arguments?: string }>();
    let text = '';
    let finishReason: string | null = null;

    const finish = () => {
      try {
        const raw = [...toolCalls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([index, call]) => ({
            id: call.id || `strata-call-${index}`,
            type: 'function',
            function: { name: call.name || '', arguments: call.arguments || '{}' },
          }));
        const normalized = normalizeStrataToolCalls(raw, { tools: body.tools });
        send({
          type: 'done',
          fullText: text,
          finishReason,
          ...(normalized.length > 0 ? { toolCalls: normalized } : {}),
          metrics: {
            promptTokens: usage.prompt_tokens,
            responseTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            latencyMs: Date.now() - started,
          },
        });
      } catch (error: any) {
        const typed = isStrataIntegrationError(error)
          ? error
          : strataError('STRATA_TOOL_ARGUMENTS_INVALID', { message: error?.message });
        send({ type: 'error', ...strataErrorPayload(typed) });
      }
      if (!res.writableEnded) res.end();
    };

    // Un host sin stream puede devolver el JSON completo; se convierte al mismo
    // sobre SSE para que la UI no se quede en blanco.
    const contentType = String(upstream.headers.get('content-type') || '');
    if (!contentType.includes('text/event-stream')) {
      const data = await upstream.json().catch(() => null);
      const message = data?.choices?.[0]?.message || {};
      text = String(message.content || '');
      finishReason = data?.choices?.[0]?.finish_reason || null;
      if (data?.usage) Object.assign(usage, data.usage);
      // Un host sin stream también puede devolver tool_calls; se conservan en
      // el `done` con el mismo formato que el camino SSE.
      if (Array.isArray(message.tool_calls)) {
        message.tool_calls.forEach((call: any, index: number) => {
          toolCalls.set(index, mergeStrataToolCallFragment(undefined, call));
        });
      }
      if (text) send({ type: 'chunk', text });
      finish();
      return;
    }

    const reader = upstream.body?.getReader();
    if (!reader) throw new Error('Strata no devolvió cuerpo de streaming');
    const decoder = new TextDecoder();
    let buffer = '';
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let chunk: any = null;
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }
        if (chunk?.usage) Object.assign(usage, chunk.usage);
        const choice = chunk?.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta || {};
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content;
          send({ type: 'chunk', text: delta.content });
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const call of delta.tool_calls) {
            const rawIndex = Number(call?.index);
            const hasIndex = call?.index != null && Number.isInteger(rawIndex);
            const index = hasIndex
              ? rawIndex
              : typeof call?.id === 'string' && call.id
                ? toolCalls.size
                : Math.max(0, toolCalls.size - 1);
            toolCalls.set(index, mergeStrataToolCallFragment(toolCalls.get(index), call));
          }
        }
      }
    }
    finish();
  } catch (error: any) {
    if (res.writableEnded) return;
    const reason = abort.signal.reason;
    const message = abort.signal.aborted
      ? String((reason as any)?.message || reason || 'Generación cancelada')
      : error?.message || 'Strata stream falló';
    const typed = isStrataIntegrationError(error)
      ? error
      : classifyStrataFailure({
          message,
          aborted: abort.signal.aborted,
          timedOut: /tiempo|timeout|timed?\s*out/i.test(message),
          secret: key,
        });
    if (!res.headersSent) return sendStrataError(res, typed);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', ...strataErrorPayload(typed) })}\n\n`);
      res.end();
    } catch {
      /* socket cerrado */
    }
  } finally {
    abort.cleanup();
  }
});

// OpenAI y NVIDIA NIM comparten el contrato Chat Completions. Se normalizan
// aquí las tool_calls al formato que consume `src/agent/llm.ts`.
async function generateOpenAiCompatible(req: any, res: any, provider: 'openai' | 'nvidia') {
  try {
    const body = req.body || {};
    const isOpenAI = provider === 'openai';
    const key =
      (typeof body.apiKey === 'string' && body.apiKey.trim()) ||
      (isOpenAI ? process.env.OPENAI_API_KEY : process.env.NVIDIA_API_KEY) ||
      getProviderSecret(provider, 'apiKey');
    if (!key) return res.json({ ok: false, error: `${isOpenAI ? 'OPENAI_API_KEY' : 'NVIDIA_API_KEY'} requerida` });

    // `baseURL` en el cuerpo permite apuntar a un proxy OpenAI-compatible (y a un
    // upstream falso en los tests), igual que en custom y OpenRouter.
    const base = typeof body.baseURL === 'string' && body.baseURL.trim()
      ? body.baseURL.trim().replace(/\/+$/, '')
      : isOpenAI ? 'https://api.openai.com/v1' : 'https://integrate.api.nvidia.com/v1';
    const fallbackModel = isOpenAI ? 'gpt-4.1-mini' : NVIDIA_DEFAULT_MODEL;
    const model = String(body.model || getProviderSecret(provider, 'defaultModel') || fallbackModel).replace(
      new RegExp(`^${provider}/`),
      ''
    );
    const messages = [
      ...(body.systemInstruction ? [{ role: 'system', content: body.systemInstruction }] : []),
      { role: 'user', content: body.prompt || '' },
    ];
    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: body.temperature ?? 0.7,
      max_tokens: body.maxTokens ?? 2048,
    };
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      payload.tools = body.tools;
      payload.tool_choice = body.toolChoice || 'auto';
    }
    // NIM cuenta el razonamiento contra `max_tokens` aunque lo separe en
    // `reasoning_content`. En el turno de cierre (formato puro) se apaga la
    // plantilla de razonamiento para no gastar el presupuesto antes de escribir.
    if (!isOpenAI && body.disableThinking === true) {
      payload.chat_template_kwargs = THINKING_OFF_PARAMS.chat_template_kwargs;
    }

    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'User-Agent': 'CommanderAIStudio/2.5',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) {
      const err: any = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `${isOpenAI ? 'OpenAI' : 'NVIDIA'} HTTP ${response.status}`);
    }

    const data: any = await response.json();
    const message = data.choices?.[0]?.message || {};
    const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
      .map((tc: any) => {
        const fn = tc?.function || {};
        let args: Record<string, unknown> = {};
        try {
          args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments || {};
        } catch {
          args = {};
        }
        return { id: tc?.id, name: fn.name, args };
      })
      .filter((tc: any) => typeof tc.name === 'string' && tc.name.length > 0);

    const text = message.content || '';
    const finishReason = data.choices?.[0]?.finish_reason;
    // Misma regla que en `/api/custom/generate`: truncado y vacío es error.
    const truncado = truncatedChatCompletions(data, Number(payload.max_tokens));
    if (truncado) {
      return res.json({ success: false, ok: false, error: truncado });
    }
    return res.json({
      success: true,
      text,
      finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      metrics: {
        promptTokens: data.usage?.prompt_tokens || 0,
        responseTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        latencyMs: 0,
      },
    });
  } catch (error: any) {
    return res.json({ ok: false, error: error.message || `${provider} generate falló` });
  }
}

app.post('/api/openai/generate', (req, res) => generateOpenAiCompatible(req, res, 'openai'));
app.post('/api/nvidia/generate', (req, res) => generateOpenAiCompatible(req, res, 'nvidia'));

// ==================== FREEBUFF ====================

// Proxy a su endpoint OpenAI-compatible; el handler vive en `freebuff.ts`.
app.post('/api/freebuff/generate', handleFreebuffGenerate);

// ==================== VITE & STATIC ====================

// Bootstrap asíncrono (sin top-level await) para que server.ts siga siendo
// empaquetable a CJS con esbuild (electron/server.cjs, el que carga main.cjs).
async function bootstrap() {
  // Si una instalación antigua dejó la clave de Strata en config.json, se
  // mueve al vault antes de aceptar peticiones. Si el vault no está disponible
  // se conserva para no perder acceso; el siguiente guardado sí exigirá vault.
  try {
    migrateStrataLocalApiKey(
      normalizeStrataApiKey(getProviderFileConfig(STRATA_LOCAL_PROVIDER_ID).apiKey)
    );
  } catch {
    /* se reintenta al leer los ajustes de Strata */
  }
  const PORT = Number(process.env.PORT || loadConfig().server?.port || 3280);
  // `HOST` (serve --host) manda sobre `server.host`; el bind es real y sólo
  // se normalizan los alias.
  const HOST = resolveBindHost(process.env.HOST || loadConfig().server?.host);
  // Fuera de loopback, quien arranca tiene que saber que la API queda abierta.
  const bindWarning = bindExposureWarning(HOST);
  if (bindWarning) console.warn(bindWarning);
  // Servidor HTTP explícito (no `app.listen`) para compartirlo con Vite: el
  // WebSocket de HMR viaja por el mismo puerto de la app. Antes Vite abría el
  // suyo en el 24678 y chocaba con cualquier otro vite corriendo en la máquina.
  const server = createHttpServer(app);

  // Vite middleware for dev mode
  if (process.env.NODE_ENV === 'production') {
    // Serve static files in production only
    // En el paquete, server.cjs vive en resources/ y el dist se copia ahí
    // (extraResources); en el repo está en ../dist. Se prueban las dos rutas
    // en vez de asumir una: asumirla dejaba la UI empaquetada en 404.
    const distPath =
      [process.env.COMMANDER_DIST, path.join(currentDir, 'dist'), path.join(currentDir, '..', 'dist')]
        .filter((p): p is string => Boolean(p))
        .find((p) => fs.existsSync(path.join(p, 'index.html'))) || path.join(currentDir, '..', 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      console.warn(`[server] no se encontró dist/index.html (probado en ${distPath})`);
    }
    // Sólo el HTML/estático de Commander: `/published` se sirve antes y no
    // debe heredar esta política, que es del Studio y no del proyecto del
    // usuario. En dev no se aplica porque Vite necesita inline + HMR.
    app.use((_req, res, next) => {
      res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
      next();
    });
    app.use(express.static(distPath));
    // @ts-ignore
    app.get(/.*/, (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Desarrollo: montar Vite como middleware (HMR + API en mismo puerto)
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      // `hmr.server` comparte el WebSocket de HMR con este servidor HTTP: el
      // cliente se conecta al mismo puerto de la app en vez de al 24678, que
      // Vite abre por su cuenta y choca con otro vite corriendo en la máquina.
      // (La forma nueva sería `server.ws`, pero esta versión de Vite aún no la
      // aplica en middlewareMode: abre el 24678 igualmente.)
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

app.get('/api/system/info', (_req, res) => {
  try {
    const cpus = os.cpus() || [];
    res.json({
      success: true,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      hostname: os.hostname(),
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMb: Math.round(os.freemem() / 1024 / 1024),
      cpuModel: (cpus[0] && cpus[0].model) ? cpus[0].model : null,
      cpuCores: cpus.length,
      uptimeMin: Math.round(os.uptime() / 60),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'system info failed' });
  }
});

server.listen(PORT, HOST, () => {
    // Con PORT=0 el SO elige el puerto: el propio server tiene que anunciar y
    // usar el real, no el 0 pedido. Las llamadas internas del agente
    // (llm/fallback/autonomous) se resuelven contra esta base URL.
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : PORT;
    setServerBaseUrl(`http://${HOST}:${port}`);
    console.log(`🚀 Commander AI Studio server running on port ${port}`);
    console.log(`   Health: http://${HOST}:${port}/api/health`);
    console.log(`   API Proxy: http://${HOST}:${port}/api/providers -> registered routes`);
  });

  server.on('error', (err) => {
    console.error('Server error:', err);
  });

  server.on('listening', () => {
    console.log('Server listening event fired');
  });

  server.on('close', () => {
    console.log('Server closed');
  });

  // Terminal persistente con PTY en /ws/terminal. El proceso ve un terminal de
  // verdad (vim, top, REPLs): el frontend ya habla este protocolo con xterm.js.
  const { attachTerminalWs } = await import('./src/terminal/wsServer.js');
  attachTerminalWs(server, { projectPath: process.cwd() });

  // Mantener proceso vivo en desarrollo
  if (process.env.NODE_ENV !== 'production') {
    console.log('Server ready - keeping process alive');
    const keepAlive = setInterval(() => {}, 1000);
    process.on('SIGINT', () => {
      clearInterval(keepAlive);
      server.close(() => process.exit(0));
    });
  }

  return app;
}

bootstrap().catch((err) => {
  console.error('Fallo al arrancar el servidor:', err);
  process.exit(1);
});

// Debug: mantener proceso vivo
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

export { bootstrap as startServer };
export default app;
