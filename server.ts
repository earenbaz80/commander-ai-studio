import express from 'express';
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
import { runAutonomousCampaign, planCampaign } from './autonomousRun';
import { setServerBaseUrl } from './serverRuntime';
import { addRoot, listRoots, removeRoot, removableRoots, resolveProjectPath } from './projects';
import { enforceTool, getPermissions, setPermissions } from './permissions';
// `listSessions` ya lo exporta `sessionWorkspace` (sesiones de UI): se aliasa.
import { createSession, getSession, listSessions as listAgentSessions, removeSession, stopSession } from './agentSession';
import { cancelSubAgents, clearSubAgents, listSubAgents, subscribeSubAgents } from './subAgents';
import { stopJobsForSession } from './shellJobs';
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
import { executeLocalHfModel } from './localModels';
import { handleApiKeySet, handleApiKeyGet, handleApiKeyDelete, handleApiKeysList, apiKeyMiddleware, getApiKey as getRequestApiKey } from './apiKeys';
import { isAllowedHost, allowedHostsFromEnv } from './hostGuard';
import { getConfig, getConfigPath, getEnvProviderIds, getGlobalConfigPath, getProviderSecret, loadConfig, removeProviderConfig } from './src/config/index';
import { PROVIDER_SPECS, buildProviderList, describeProvider, getProviderCatalog } from './src/providers/registry';
import skillsRouter from './skills/api';
import { forkSessionWorkspace, deleteSessionWorkspace, listSessions, createGitWorktree } from './sessionWorkspace';
import { handleOAuthLogin, handleOAuthCallback, handleLogout, getCurrentUser } from './oauth';
import { executeWithFallback, getProviderMetrics, checkAllProvidersHealth, resetCircuitBreaker, setProviderEnabled } from './fallbackRouter';
import { GEMINI_DEFAULT_MODEL } from './src/config/geminiModels';
import { handleFreebuffGenerate } from './freebuff';
import { normalizeLmStudioHost, parseLmStudioModels } from './src/lib/lmStudio';

dotenv.config();

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
    _res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    _res.setHeader('Access-Control-Allow-Credentials', 'true');
    return _res.sendStatus(204);
  }
  next();
});
const globalRate = new Map<string, { count: number; reset: number }>();
app.use((_req, _res, next) => {
  if (_req.path.startsWith('/api/')) {
    const ip = (_req.ip || _req.socket?.remoteAddress || 'local').toString();
    const now = Date.now();
    const e = globalRate.get(ip);
    if (!e || now > e.reset) globalRate.set(ip, { count: 1, reset: now + 60_000 });
    else {
      e.count++;
      if (e.count > 300) return _res.status(429).json({ success: false, ok: false, error: 'Rate limit global (300/min)' });
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

    const response = await ai.models.generateContent({
      model: GEMINI_DEFAULT_MODEL,
      contents: [
        {
          role: 'user',
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
      ],
    });

    const transcribed = response.text || '';
    return res.json({ success: true, text: transcribed.trim() });
  } catch (error: any) {
    console.error('Error en /api/transcribe:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al transcribir el audio.',
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
    const session = createSession({
      goal,
      cwd,
      model: b.model ? String(b.model).slice(0, 200) : undefined,
      maxSteps: Math.min(Math.max(Number(b.maxSteps) || 20, 1), 50),
      mode,
      allowedTools,
    });
    res.json({ success: true, session: { id: session.id, goal, cwd, model: session.getModel(), status: session.getStatus() } });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});
app.get('/api/agent/sessions', (_req, res) => {
  try {
    res.json({ success: true, sessions: listAgentSessions() });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});
app.delete('/api/agent/sessions/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!getSession(id)) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
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
    if (!getSession(id)) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    const ids = cancelSubAgents(id);
    // Los trabajos en segundo plano de la tanda se paran siempre: un
    // `background: true` sobrevive al hijo que lo lanzó, así que mirar sólo a
    // los que siguen corriendo deja huérfano al que ya respondió. Los trabajos
    // de otras sesiones (y los del padre) no se tocan.
    const cancelados = ids.filter((sid) => stopSession(sid)).length;
    const idsTanda = new Set<string>([...ids, ...listSubAgents(id).map((r) => r.id)]);
    const jobsStopped: string[] = [];
    for (const sid of idsTanda) jobsStopped.push(...(await stopJobsForSession(sid)));
    res.json({ success: true, cancelled: cancelados, ids, jobsStopped });
  } catch (e: any) { res.status(400).json({ success: false, error: e?.message }); }
});

// Subagentes de una sesión: estado en vivo y resultado final. Es lo que consulta
// el panel mientras corre un `spawn_agents`; no ejecuta nada.
app.get('/api/agent/sessions/:id/subagents', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!getSession(id)) return res.status(404).json({ success: false, error: 'sesión no encontrada' });
    res.json({ success: true, subagents: listSubAgents(id) });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message }); }
});

// Stream de subagentes (SSE): manda la lista completa al conectar y otra vez en
// cada cambio (arranca, termina bien, falla). Así el panel no sondea y sigue
// actualizándose aunque su pestaña esté cerrada.
app.get('/api/agent/sessions/:id/events', (req, res) => {
  const id = String(req.params.id || '');
  if (!getSession(id)) return res.status(404).json({ success: false, error: 'sesión no encontrada' });

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
    res.json({ success: true, threads: persistence.listThreads(projectId, projectPath) });
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
    };
    res.json({ success: true, root, permissions: setPermissions(root, next) });
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
    const { writeConfig } = await import('./src/config/index');
    const writeTarget: 'project' | 'global' = target === 'project' ? 'project' : 'global';
    const configPath = writeConfig({ providers: { [id]: config } }, writeTarget);

    res.json({ success: true, configPath, target: writeTarget });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || 'Error creando proveedor' });
  }
});

// Lista real de proveedores: `configured` sale de la config de fichero o del
// entorno, no de que el catálogo tenga entradas. Es lo que pinta el gestor.
app.get('/api/providers', async (_req, res) => {
  try {
    const catalog = await getProviderCatalog();
    const envIds = new Set(getEnvProviderIds());
    const providers = buildProviderList(getConfig().providers as any, envIds, catalog);
    return res.json({ success: true, providers, configPath: getConfigPath(), writePath: getGlobalConfigPath() });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'Error listando proveedores' });
  }
});

// Filtros del gestor: apagar un proveedor o recortar su catálogo sin borrar las
// credenciales. Se escribe en la config global, igual que las claves, y no toca
// el resto del fichero.
app.patch('/api/providers/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!PROVIDER_SPECS.some((spec) => spec.id === id)) {
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
    const configPath = writeConfig({ providers: { [id]: patch } } as any, 'global');
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
    if (!PROVIDER_SPECS.some((s) => s.id === id)) {
      return res.status(400).json({ success: false, error: 'Proveedor desconocido' });
    }
    const configPath = removeProviderConfig(id);
    return res.json({ success: true, configPath, stillFromEnv: getEnvProviderIds().includes(id) });
  } catch (e: any) {
    return res.status(400).json({ success: false, error: e?.message || 'Error eliminando proveedor' });
  }
});

// ==================== MCP REGISTRY ====================

// Monta el router de MCP bajo /api/mcp
import { mcpRouter } from './src/mcp/index.js';
app.use('/api/mcp', mcpRouter);

// ==================== PLUGINS ECOSISTEMA ====================
// Rutas basicas para discovery, instalacion y listado de plugins.
// Los plugins se almacenan bajo <root>/.commander/plugins/ como zip descomprimidos
// con un manifest.json que define: id, name, version, entrypoint, tools.

const PLUGINS_DIR = '.commander/plugins';

function getPluginsRoot(rootHint?: unknown): string {
  if (typeof rootHint === 'string' && rootHint.trim()) {
    try { return resolveProjectPath('.', rootHint.slice(0, 1024)).root; } catch { /* cae a cwd */ }
  }
  return process.cwd();
}

// Asegura que el directorio de plugins exista
const pluginsRoot = getPluginsRoot();
if (!fs.existsSync(path.join(pluginsRoot, PLUGINS_DIR))) {
  fs.mkdirSync(path.join(pluginsRoot, PLUGINS_DIR), { recursive: true });
}

// Listar plugins instalados
app.get('/api/plugins', (req, res) => {
  try {
    const root = getPluginsRoot(req.query.root);
    const p = path.join(root, PLUGINS_DIR);
    if (!fs.existsSync(p)) return res.json({ success: true, plugins: [] });
    const entries = fs.readdirSync(p).filter(f => f.endsWith('.zip'));
    const plugins = entries.map(f => {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8'));
        return { id: manifest.id, name: manifest.name, version: manifest.version, entr: manifest.entrypoint };
      } catch { return { id: f.replace('.zip', ''), name: f, version: 'unknown' }; }
    });
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

// Desinstalar plugin
app.delete('/api/plugins/:id', (req, res) => {
  try {
    const id = req.params.id;
    if (!isSafePluginId(id)) return res.status(400).json({ success: false, error: 'Id de plugin inválido' });
    const root = getPluginsRoot(req.query.root);
    const zipPath = pluginPath(root, id, '.zip');
    const manifestPath = pluginPath(root, id, '.manifest.json');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    return res.json({ success: true, id });
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
  restoreCheckpoint,
  listWorktreeCheckpoints,
  createWorktreeCheckpoint,
  restoreWorktreeCheckpoint,
  deleteWorktreeCheckpoint,
  isGitRepo,
} from './checkpoints';

/** Resuelve el root canónico de forma segura (mismo patrón que agentTools). */
function checkpointsRoot(rootHint?: unknown): string {
  if (typeof rootHint === 'string' && rootHint.trim()) {
    try {
      return resolveProjectPath('.', rootHint.slice(0, 1024)).root;
    } catch {
      /* cae a cwd */
    }
  }
  return process.cwd();
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

// ==================== RESTO DE RUTAS ====================

// Endpoint to estimate token count
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

    // Check cache first
    const cacheKey = `${q}_${limit}`;
    const cached = hfSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < HF_CACHE_TTL_MS) {
      return res.json({ success: true, models: cached.models, cached: true });
    }

    // Search Hugging Face API
    const url = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&limit=${limit}&sort=downloads&direction=-1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
    });

    if (!response.ok) {
      // Fallback to built-in catalog
      const filtered = POPULAR_HF_CATALOG.filter((m) =>
        m.id.toLowerCase().includes(q.toLowerCase()) ||
        m.tags.some((t) => t.includes(q.toLowerCase()))
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
  const fromCwd = path.join(process.cwd(), 'local_models');
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.join(currentDir, '..', 'local_models');
})();
const runtimeDir = path.join(process.cwd(), 'runtime', 'llama');
try {
  fs.mkdirSync(localModelsDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
} catch (e) {
  console.warn('No se pudo crear local_models/runtime:', e);
}

function detectLlamaBinary(): string | null {
  if (fs.existsSync(runtimeDir)) {
    for (const name of ['llama-cli', 'llama-cli.exe', 'llama-server', 'llama-server.exe']) {
      const full = path.join(runtimeDir, name);
      if (fs.existsSync(full)) return full;
    }
  }
  const candidates = ['llama-cli', 'llama.cpp', 'llama-server'];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 2000 });
      return bin;
    } catch (e) {
      // try
    }
  }
  return null;
}

app.get('/api/local-models', (_req, res) => {
  try {
    const files = fs.existsSync(localModelsDir)
      ? fs.readdirSync(localModelsDir).filter((f) => f.toLowerCase().endsWith('.gguf')).map((f) => {
          const p = path.join(localModelsDir, f);
          const st = fs.statSync(p);
          return { name: f, size: st.size, sizeMb: Math.round(st.size / 1024 / 1024) };
        })
      : [];
    res.json({ success: true, models: files, hasLlamaRuntime: !!detectLlamaBinary(), dir: localModelsDir, runtimeDir });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'scan failed', models: [] });
  }
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

    const fetchRes = await fetch(url, { signal: controller.signal });
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

app.post('/api/local-models/generate', async (req, res) => {
  try {
    const { model, prompt, temperature = 0.7, maxTokens = 1024 } = req.body || {};
    if (!model) return res.status(400).json({ success: false, error: 'model required' });

    const bin = detectLlamaBinary();
    if (!bin) return res.status(503).json({ success: false, error: 'llama.cpp runtime not found in PATH or runtime/llama' });

    const modelPath = path.join(localModelsDir, model);
    if (!fs.existsSync(modelPath)) return res.status(404).json({ success: false, error: 'model file not found' });

    const args = [
      '-m', modelPath,
      '-p', String(prompt || ''),
      '--temp', String(temperature),
      '-n', String(maxTokens),
      '-ngl', '0',
    ];

    const proc = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const chunks: Buffer[] = [];

    proc.stdout.on('data', (d: Buffer) => {
      chunks.push(d);
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    const timeoutMs = 120000;
    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
    }, timeoutMs);

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
        binary: bin,
        hasErrors: !!stderr,
      });
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timer);
      if (res.headersSent) return;
      res.status(500).json({ success: false, error: err.message });
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'generate failed' });
  }
});

// ==================== LLAMA RUNTIME DOWNLOAD (OPT-IN) ====================

app.get('/api/local-models/runtime-release-info', async (_req, res) => {
  try {
    const arch = process.arch.includes('arm') ? 'arm64' : 'x64';
    const osKey = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'macos' : 'linux';
    const primaryAssetPattern = osKey === 'win' ? 'win' : osKey === 'macos' ? 'macos' : 'ubuntu';

    const relRes = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest', {
      headers: { 'User-Agent': 'CommanderAIStudio/2.5', 'Accept': 'application/vnd.github+json' },
    });
    if (!relRes.ok) {
      return res.status(502).json({ success: false, error: `GitHub HTTP ${relRes.status}` });
    }
    const rel = await relRes.json();
    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    const matched = assets.filter((a: any) => {
      const name = String(a?.name || '').toLowerCase();
      if (!name.match(/\.(zip|tar\.gz|tgz)$/)) return false;
      if (!name.includes(primaryAssetPattern)) return false;
      if (!name.includes(arch)) return false;
      return true;
    });
    const picked = matched[0] || assets.find((a: any) => String(a?.name || '').toLowerCase().includes(primaryAssetPattern) && String(a?.name || '').toLowerCase().match(/\.(zip|tar\.gz|tgz)$/));
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

    const fetchRes = await fetch(url, { signal: controller.signal });
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

    // Extract (requires tar - Windows 10+ ships tar.exe)
    const wantsZip = safeName.toLowerCase().endsWith('.zip') || safeName.toLowerCase().includes('.zip');
    const args = wantsZip ? ['-xf', safeName, '-C', runtimeDir] : ['-xzf', safeName, '-C', runtimeDir];
    try {
      execFileSync('tar', args, { cwd: runtimeDir, stdio: 'ignore', timeout: 120000 });
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

function lmstudioHost(req: any, bodyHost?: unknown): string {
  const raw =
    (typeof bodyHost === 'string' && bodyHost.trim()) ||
    (typeof req?.query?.host === 'string' && req.query.host.trim()) ||
    // El modal local guarda el host en cookie httpOnly; sin leerla, el chat
    // seguía yendo a localhost aunque el usuario hubiera configurado su PC.
    getRequestApiKey(req, 'LMSTUDIO_HOST') ||
    process.env.LMSTUDIO_HOST ||
    getProviderSecret('lmstudio', 'host') ||
    'http://localhost:1234/v1';
  return normalizeLmStudioHost(String(raw));
}

/**
 * Consulta el catálogo de LM Studio por las dos rutas que existen en sus
 * versiones: `/v1/models` (OpenAI-compatible) y `/api/v0/models` (nativa).
 * Devuelve también si el servidor respondió, porque «conectado sin modelos»
 * no es un error de conexión: es LM Studio abierto sin modelo cargado.
 */
async function fetchLmstudioModels(host: string): Promise<{ models: string[]; host: string }> {
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
  const errors: string[] = [];
  let answered = false;
  for (const result of settled) {
    if (result.status === 'rejected') {
      errors.push(result.reason?.message || String(result.reason));
      continue;
    }
    answered = true;
    for (const id of parseLmStudioModels(result.value)) models.add(id);
  }

  if (!answered) {
    throw new Error(
      `No se pudo conectar a LM Studio en ${base}. Comprueba el puerto 1234, que «Serve on Local Network» esté activo y el firewall. ${errors[0] || ''}`.trim()
    );
  }
  return { models: [...models], host: base };
}

app.get('/api/lmstudio/models', async (req, res) => {
  try {
    const probe = await fetchLmstudioModels(lmstudioHost(req));
    return res.json({
      success: true,
      models: probe.models,
      host: probe.host,
      warning: probe.models.length === 0 ? 'LM Studio responde, pero no tiene modelos cargados.' : undefined,
    });
  } catch (e: any) {
    return res.json({ success: false, models: [], error: e?.message || 'LM Studio no responde' });
  }
});

// POST para poder probar un host que aún no está guardado (botón «Probar»).
app.post('/api/lmstudio/models', async (req, res) => {
  try {
    const probe = await fetchLmstudioModels(lmstudioHost(req, req.body?.host));
    return res.json({
      success: true,
      models: probe.models,
      host: probe.host,
      warning: probe.models.length === 0 ? 'LM Studio responde, pero no tiene modelos cargados.' : undefined,
    });
  } catch (e: any) {
    return res.json({ success: false, models: [], error: e?.message || 'LM Studio no responde' });
  }
});

app.post('/api/lmstudio/generate', async (req, res) => {
  try {
    const { prompt, model, systemInstruction = '', temperature = 0.7, maxTokens = 2048, host: bodyHost } = req.body || {};
    const host = lmstudioHost(req, bodyHost);
    const target = model
      ? String(model).replace(/^lmstudio\//, '')
      : getProviderSecret('lmstudio', 'defaultModel') || '';
    if (!target) return res.json({ ok: false, error: 'Modelo requerido' });

    const response = await fetch(`${host}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: target,
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
    return res.json({
      success: true,
      text: data.choices?.[0]?.message?.content || '',
      metrics: {
        promptTokens: data.usage?.prompt_tokens || 0,
        responseTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        latencyMs: 0,
      },
    });
  } catch (e: any) {
    return res.json({ ok: false, error: e?.message || 'LM Studio generate falló' });
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
    res.json({ success: response.ok, models, host, error: response.ok ? undefined : ('HTTP ' + response.status) });
  } catch (error: any) {
    res.json({ success: false, models: [], host, error: error?.message || 'unreachable' });
  }
});

app.get('/api/ollama/health', async (req, res) => {
  const host = String(
    req.query.host || getRequestApiKey(req, 'OLLAMA_HOST') || process.env.OLLAMA_HOST || 'http://localhost:11434'
  );
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
    res.json({ success: response.ok, ok: response.ok, models, host, error: response.ok ? undefined : ('HTTP ' + response.status) });
  } catch (error: any) {
    res.json({ success: false, ok: false, models: [], host, error: error?.message || 'unreachable' });
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
      return res.json({ ok: false, error: error.message || 'Pull failed' });
    } else {
      res.write(`data: ${JSON.stringify({ ok: false, error: error.message })}\n\n`);
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
    return res.json({ ok: false, error: error.message || 'Delete failed' });
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
    const [modelsDevModels, ollamaModels, lmstudioModels, nvidiaModels] = await Promise.all([
      fetchModelsDevCatalog(),
      (async () => {
        try {
          const host = req.query.host || process.env.OLLAMA_HOST || getProviderSecret('ollama', 'host') || 'http://localhost:11434';
          const response = await fetch(`${host}/api/tags`, {
            headers: { 'User-Agent': 'CommanderAIStudio/2.5' },
          });
          if (!response.ok) return [];
          const data = await response.json();
          return (data.models || []).map((m: any) => ({
            id: `ollama/${typeof m === 'string' ? m : m.name}`,
            name: typeof m === 'string' ? m : m.name,
            provider: 'ollama',
            context_window: 128_000,
            tags: ['local'],
          }));
        } catch {
          return [];
        }
      })(),
      (async () => {
        try {
          const probe = await fetchLmstudioModels(lmstudioHost(req));
          return probe.models.map((id) => ({
            id: `lmstudio/${id}`,
            name: id,
            provider: 'lmstudio',
            context_window: 32_768,
            tags: ['local'],
          }));
        } catch {
          return [];
        }
      })(),
      fetchNvidiaLiveModels(),
    ]);

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
        deprecated: m.deprecated,
      })),
      ...ollamaModels,
      ...lmstudioModels,
      ...nvidiaModels,
    ];

    // Estado por proveedor: `available` dice si tiene modelos listados y
    // `configured` si hay credenciales. Antes ambos eran lo mismo (count > 0),
    // así que todo aparecía «disponible» aunque no hubiera ni una clave.
    const providerStatus: Record<string, { available: boolean; count: number; configured: boolean; source: string; error?: string }> = {};
    const envIds = new Set(getEnvProviderIds());
    const specs = new Map(PROVIDER_SPECS.map((s) => [s.id, s]));
    for (const p of new Set(allEntries.map((m) => m.provider))) {
      const count = allEntries.filter((m) => m.provider === p).length;
      const spec = specs.get(p);
      const st = spec ? describeProvider(spec, getConfig().providers as any, envIds) : { configured: true, source: 'none' };
      providerStatus[p] = { available: count > 0, count, configured: st.configured, source: st.source };
    }
    // Los proveedores sin entradas en el catálogo (HF, custom, freebuff) deben
    // salir igualmente: su disponibilidad es tener credenciales, no modelos.
    for (const spec of PROVIDER_SPECS) {
      if (providerStatus[spec.id]) continue;
      const st = describeProvider(spec, getConfig().providers as any, envIds);
      providerStatus[spec.id] = { available: st.configured, count: 0, configured: st.configured, source: st.source };
    }
    providerStatus.ollama = { available: ollamaModels.length > 0, count: ollamaModels.length, configured: true, source: 'local' };
    providerStatus.lmstudio = { available: lmstudioModels.length > 0, count: lmstudioModels.length, configured: true, source: 'local' };

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
    return res.json({ ok: false, error: error.message || 'Ollama no disponible' });
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
    return res.json({ ok: false, error: error.message || 'Ollama generate falló' });
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
    const { prompt, model = 'openai/gpt-4o-mini', systemInstruction = '', temperature = 0.7, maxTokens = 2048, apiKey } = req.body;
    const key = apiKey || process.env.OPENROUTER_API_KEY || getProviderSecret('openrouter', 'apiKey');
    if (!key) return res.json({ ok: false, error: 'OPENROUTER_API_KEY requerida' });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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

app.post('/api/custom/generate', async (req, res) => {
  try {
    const { prompt, model, systemInstruction = '', temperature = 0.7, maxTokens = 2048, baseURL, apiKey } = req.body;
    const key = apiKey || process.env.CUSTOM_API_KEY || process.env.OPENCODE_API_KEY || getProviderSecret('custom', 'apiKey');
    const url = baseURL || process.env.CUSTOM_BASE_URL || getProviderSecret('custom', 'baseUrl');

    if (!url) return res.json({ ok: false, error: 'CUSTOM_BASE_URL requerido' });
    if (!key) return res.json({ ok: false, error: 'CUSTOM_API_KEY requerida' });

    const response = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
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
      throw new Error(err?.error?.message || `Custom HTTP ${response.status}`);
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
    return res.json({ ok: false, error: error.message || 'Custom generate falló' });
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

    const base = isOpenAI ? 'https://api.openai.com/v1' : 'https://integrate.api.nvidia.com/v1';
    const fallbackModel = isOpenAI ? 'gpt-4.1-mini' : 'meta/llama-3.3-70b-instruct';
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

    return res.json({
      success: true,
      text: message.content || '',
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
  // Vite middleware for dev mode
  if (process.env.NODE_ENV === 'production') {
    // Serve static files in production only
    const distPath = path.join(currentDir, '..', 'dist');
    app.use(express.static(distPath));
    // @ts-ignore
    app.get(/.*/, (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Desarrollo: montar Vite como middleware (HMR + API en mismo puerto)
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

const PORT = Number(process.env.PORT || loadConfig().server?.port || 3280);
const HOST = '127.0.0.1';
const server = app.listen(PORT, HOST, () => {
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

  // Terminal persistente vía WebSocket en /ws/terminal (deshabilitado temporalmente).
  // const { attachTerminalWs } = await import('./src/terminal/wsServer.js');
  // attachTerminalWs(server);

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
