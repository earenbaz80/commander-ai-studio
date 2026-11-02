import type { Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { mapGeminiModel, isQuotaOrNotFoundError, executeLocalHfModel } from './localModels';
import {
  capabilityTtlMs,
  DEFAULT_CAPABILITY_TTL_MS,
  builtinToolsMemory,
  forgetToolsMemory,
  keyLacksBuiltinTools,
  rememberKeyLacksBuiltinTools,
} from './keyCapabilities';
import {
  GEMINI_DEFAULT_MODEL,
  GEMINI_FALLBACK_MODELS,
  MAX_FALLBACK_MODELS,
  normalizeFallbackChain,
} from './src/config/geminiModels';
import { getGoogleFallbackModels, setGoogleFallbackModels } from './src/config/index';

/**
 * Cadena de respaldo efectiva para una petición.
 *
 * Prioridad: lo que pide el cliente → `providers.google.fallbackModels` de la
 * config → `GEMINI_FALLBACK_MODELS`. Un array vacío en cualquiera de los dos
 * primeros niveles es una decisión («sin respaldo»), no un hueco, así que no se
 * sigue bajando de nivel: devolver modelos que nadie pidió es justo lo que se
 * quería evitar pasando la cadena en cada petición.
 */
export function resolveFallbackChain(requested: unknown): string[] {
  const fromRequest = normalizeFallbackChain(requested);
  if (fromRequest) return fromRequest;
  const fromConfig = getGoogleFallbackModels();
  if (fromConfig) return fromConfig;
  return [...GEMINI_FALLBACK_MODELS];
}

/** Mensaje único para cuando falta la API key de Google. */
export const GEMINI_KEY_REQUIRED =
  'GEMINI_API_KEY requerida. Añádela en Configuración → GOOGLE GEMINI (o en el archivo .env) para usar los modelos de Google.';


class MissingApiKeyError extends Error {
  code = 'MISSING_API_KEY';
  constructor() {
    super(GEMINI_KEY_REQUIRED);
    this.name = 'MissingApiKeyError';
  }
}

/**
 * Aviso que acompaña a una respuesta generada sin las herramientas integradas.
 * Sin él, el usuario no entendería por qué no hay fuentes web ni ejecución de código.
 */
const TOOLS_DROPPED_NOTICE =
  '⚡ *[Aviso: tu API Key no admite las herramientas integradas (búsqueda de Google / ejecución de código). Respuesta generada sin ellas]*';

/**
 * Se queda sólo con las declaraciones de funciones y descarta las herramientas
 * del plan (`googleSearch`, `codeExecution`).
 *
 * Comprobado el 2026-10-28: la misma petición con `googleSearch`/`codeExecution`
 * devuelve 429 RESOURCE_EXHAUSTED con una key cuyo plan no las incluye, y sin
 * ellas responde con normalidad. Antes, esa key dejaba el chat sin respuesta.
 */
function toolsWithoutBuiltins(tools: any[]): any[] | undefined {
  const kept = tools.filter((t) => t && typeof t === 'object' && 'functionDeclarations' in t);
  return kept.length > 0 ? kept : undefined;
}

/** ¿El reintento sin herramientas cambiaría algo respecto a la primera pasada? */
function toolsCanBeDropped(tools: any[]): boolean {
  return JSON.stringify(toolsWithoutBuiltins(tools) ?? null) !== JSON.stringify(tools);
}

const getGenAIClient = (overrideApiKey?: string) => {
  const apiKey = overrideApiKey || process.env.GEMINI_API_KEY;
  // Nunca inventamos una key "dummy": enviarla a Google producía un error
  // confuso ("API key not valid") en lugar de un mensaje claro y accionable.
  if (!apiKey) throw new MissingApiKeyError();
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

export async function handleGeminiGenerate(req: Request, res: Response) {
  try {
    const {
      apiKey: userApiKey,
      geminiApiKey,
      contents,
      systemInstruction,
      model = GEMINI_DEFAULT_MODEL,
      temperature = 0.7,
      topP = 0.95,
      topK = 40,
      maxTokens = 2048,
      thinkingLevel,
      responseMimeType,
      responseSchema,
      tools,
      stopSequences,
      fallbackModels,
    } = req.body;

    if (model.includes('/') || model.includes('deepseek') || model.includes('llama') || model.includes('qwen') || model.includes('whisper')) {
      const promptText = typeof contents === 'string'
        ? contents
        : Array.isArray(contents)
        ? contents.map((c: any) => c.text || JSON.stringify(c)).join('\n')
        : JSON.stringify(contents);
      const localResult = await executeLocalHfModel({
        prompt: promptText,
        model,
        systemInstruction,
        temperature,
        maxTokens,
        geminiApiKey: userApiKey || geminiApiKey,
      });
      return res.json({
        success: true,
        text: localResult.text,
        metrics: localResult.metrics,
      });
    }

    const cookieKey = (req as any).apiKeys?.GEMINI_API_KEY || '';
    // Incluye la key del entorno: es la que realmente usa el cliente y la que
    // hace falta para recordar qué keys no admiten las herramientas integradas.
    const effectiveKey = userApiKey || geminiApiKey || cookieKey || process.env.GEMINI_API_KEY || '';
    const ai = getGenAIClient(effectiveKey);
    const activeModel = mapGeminiModel(model);

    let mappedThinkingLevel: ThinkingLevel | undefined = undefined;
    if (thinkingLevel === 'HIGH') mappedThinkingLevel = ThinkingLevel.HIGH;
    else if (thinkingLevel === 'LOW') mappedThinkingLevel = ThinkingLevel.LOW;
    else if (thinkingLevel === 'MINIMAL') mappedThinkingLevel = ThinkingLevel.MINIMAL;

    const startTime = Date.now();

    const config: any = {
      temperature,
      topP,
      topK,
      maxOutputTokens: maxTokens,
    };

    if (stopSequences && Array.isArray(stopSequences) && stopSequences.length > 0) {
      config.stopSequences = stopSequences;
    }

    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    if (responseMimeType) {
      config.responseMimeType = responseMimeType;
    }

    if (responseSchema && responseMimeType === 'application/json') {
      try {
        config.responseSchema = typeof responseSchema === 'string' ? JSON.parse(responseSchema) : responseSchema;
      } catch (e) {
        console.warn('Error parsing responseSchema JSON:', e);
      }
    }

    if (tools && Array.isArray(tools) && tools.length > 0) {
      config.tools = tools;
    }

    if (mappedThinkingLevel && (activeModel.includes('pro') || activeModel.includes('thinking'))) {
      config.thinkingConfig = { thinkingLevel: mappedThinkingLevel };
    }

    // Cadena explícita si el cliente la pide; si no, la guardada en la config y,
    // en último término, la de por defecto. Un array vacío desactiva el respaldo:
    // preferimos el error a medir otro modelo.
    const fallbackCandidates = Array.from(
      new Set([activeModel, ...resolveFallbackChain(fallbackModels)])
    );

    // Si esta key ya falló con las herramientas integradas hace poco, se omiten
    // desde el principio: la primera pasada costaba cinco llamadas por mensaje.
    const hadBuiltins = Array.isArray(config.tools) && toolsCanBeDropped(config.tools);
    const skipBuiltins = hadBuiltins && keyLacksBuiltinTools(effectiveKey);
    if (skipBuiltins) config.tools = toolsWithoutBuiltins(config.tools);

    let response: any;
    let fallbackUsed = false;
    let fallbackModelName = '';
    let toolsDropped = skipBuiltins;
    /** Qué modelo falló y con qué estado; viaja en la respuesta si nada funciona. */
    const failures: string[] = [];

    // Primera pasada con las herramientas pedidas; si la cadena entera falla
    // por cuota, se repite sin las integradas antes de darse por vencido.
    const attempts = config.tools && toolsCanBeDropped(config.tools)
      ? [
          { config, droppedTools: false },
          { config: { ...config, tools: toolsWithoutBuiltins(config.tools) }, droppedTools: true },
        ]
      : [{ config, droppedTools: false }];

    chain: for (const attempt of attempts) {
      for (const modelToTry of fallbackCandidates) {
        try {
          response = await ai.models.generateContent({
            model: modelToTry,
            contents: contents || 'Hola',
            config: attempt.config,
          });
          if (attempt.droppedTools) {
            toolsDropped = true;
            rememberKeyLacksBuiltinTools(effectiveKey);
          }
          if (modelToTry !== activeModel) {
            fallbackUsed = true;
            fallbackModelName = modelToTry;
            console.warn(`[Auto-Fallback]: ${activeModel} no disponible, respondiendo con ${modelToTry}`);
          }
          break chain;
        } catch (err: any) {
          if (isQuotaOrNotFoundError(err)) {
            failures.push(`${modelToTry} (${err?.status || err?.code || 'error'})`);
            console.warn(`Modelo ${modelToTry} agotó cuota o falló (${err.status || err.message}), intentando alternativa con mayor cuota...`);
            continue;
          }
          throw err;
        }
      }
      console.warn('[Google]: la cadena falló con las herramientas integradas; reintentando sin búsqueda ni ejecución de código');
    }

    if (!response) {
      console.warn(`[Google]: ningún modelo respondió (${failures.join(', ')}). Probando el motor local.`);
      const promptText = typeof contents === 'string'
        ? contents
        : Array.isArray(contents)
        ? contents.map((c: any) => c.text || JSON.stringify(c)).join('\n')
        : JSON.stringify(contents);
      try {
        const localResult = await executeLocalHfModel({
          prompt: promptText,
          model: activeModel,
          systemInstruction,
          temperature,
          maxTokens,
        });
        return res.json({
          success: true,
          text: `⚡ *[Aviso: La cuota gratuita de tu API Key de Google se ha agotado en Google AI Studio (Rate Limit 429). Tu respuesta fue generada exitosamente mediante Inferencia Local sin cortes]*\n\n${localResult.text}`,
          metrics: localResult.metrics,
        });
      } catch (localErr: any) {
        // Sin runtime local no hay respuesta posible. Devolvemos qué falló en
        // Google —accionable— en vez del error interno del motor local
        // («MODEL_RUNTIME_UNAVAILABLE»), que no explica nada.
        console.warn('[Google]: motor local no disponible:', localErr?.message || localErr);
        return res.status(503).json({
          success: false,
          code: 'ALL_GEMINI_MODELS_UNAVAILABLE',
          error:
            `Ningún modelo de Gemini respondió (${failures.join(', ') || 'sin intentos'}). ` +
            'Revisa tu cuota en Google AI Studio o elige otro modelo en Configuración.',
          tried: failures,
          provider: 'google',
        });
      }
    }

    console.log('Gemini API Response received');
    const latencyMs = Date.now() - startTime;
    let textOutput = response.text || '';
    if (fallbackUsed) {
      textOutput = `⚡ *[Aviso: ${activeModel} no respondió (cuota agotada o modelo retirado). Respuesta generada con ${fallbackModelName}]*\n\n` + textOutput;
    }
    if (toolsDropped) {
      textOutput = `${TOOLS_DROPPED_NOTICE}\n\n` + textOutput;
    }

    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    const functionCalls = response.functionCalls;
    let groundingSources: any[] = [];
    let webSearchQueries: string[] = [];

    if (groundingMetadata) {
      if (groundingMetadata.webSearchQueries) {
        webSearchQueries = groundingMetadata.webSearchQueries;
      }
      if (groundingMetadata.groundingChunks) {
        groundingSources = groundingMetadata.groundingChunks
          .map((chunk: any) => ({
            title: chunk.web?.title || 'Fuente web consultada',
            url: chunk.web?.uri,
          }))
          .filter((s: any) => s.url);
      }
    }

    const promptTokens = Math.ceil((typeof contents === 'string' ? contents.length : JSON.stringify(contents).length) / 4);
    const responseTokens = Math.ceil(textOutput.length / 4);

    return res.json({
      success: true,
      text: textOutput,
      // Qué modelo contestó de verdad: el cliente no tiene que deducirlo del
      // texto ni de un aviso con emojis.
      model: fallbackUsed ? fallbackModelName : activeModel,
      requestedModel: activeModel,
      fallback: fallbackUsed ? { from: activeModel, to: fallbackModelName } : null,
      groundingSources,
      webSearchQueries,
      functionCalls,
      metrics: {
        promptTokens,
        responseTokens,
        totalTokens: promptTokens + responseTokens,
        latencyMs,
        costEstimate: model.includes('pro') ? '$0.0015 USD' : 'Gratis / Standard',
      },
      candidates: response.candidates,
    });
  } catch (error: any) {
    if (error instanceof MissingApiKeyError || error?.code === 'MISSING_API_KEY') {
      return res.status(400).json({
        success: false,
        error: GEMINI_KEY_REQUIRED,
        code: 'MISSING_API_KEY',
        provider: 'google',
      });
    }
    console.error('Error en /api/gemini/generate:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al comunicarse con la API de Gemini',
    });
  }
}

/**
 * Mensaje legible para un error de la API de Google.
 *
 * El SDK entrega a veces el error como un JSON anidado dentro de `message`
 * (`{"error":{"message":"{\n \"error\": {..."`), y eso llega a la UI como un
 * volcado ilegible. Aquí se baja por los niveles de `message` hasta el texto real.
 */
export function readableStreamError(error: any): string {
  let text = (typeof error?.message === 'string' ? error.message : String(error ?? '')).trim();
  for (let depth = 0; depth < 3 && text.startsWith('{'); depth++) {
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      break;
    }
    const inner = parsed?.error?.message ?? parsed?.message;
    if (typeof inner !== 'string' || !inner.trim()) break;
    text = inner.trim();
  }
  return text || 'Error en streaming';
}

export async function handleGeminiStream(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  let sseClosed = false;
  // Ojo: `req.on('close')` NO significa «el cliente se fue». En Node se dispara
  // en cuanto se consume el cuerpo de la petición, así que el stream nacía ya
  // cerrado: la respuesta se cortaba en el primer fragmento y, si todos los
  // modelos fallaban, el `catch` retornaba sin escribir el error ni cerrar, y el
  // chat se quedaba en «Generando…» para siempre. El evento bueno es el de la
  // respuesta, que sí llega cuando el cliente aborta.
  res.on('close', () => {
    if (!res.writableEnded) sseClosed = true;
  });
  req.socket.setTimeout(5 * 60 * 1000);

  try {
    const {
      apiKey: userApiKey,
      geminiApiKey,
      contents,
      systemInstruction,
      model = GEMINI_DEFAULT_MODEL,
      temperature = 0.7,
      topP = 0.95,
      topK = 40,
      maxTokens = 2048,
      thinkingLevel,
      responseMimeType,
      responseSchema,
      tools,
      stopSequences,
      fallbackModels,
    } = req.body;

    if (model.includes('/') || model.includes('deepseek') || model.includes('llama') || model.includes('qwen') || model.includes('whisper')) {
      const promptText = typeof contents === 'string'
        ? contents
        : Array.isArray(contents)
        ? contents.map((c: any) => c.text || (typeof c === 'string' ? c : JSON.stringify(c))).join('\n')
        : JSON.stringify(contents);
      const localResult = await executeLocalHfModel({
        prompt: promptText,
        model,
        systemInstruction,
        temperature,
        maxTokens,
        geminiApiKey: userApiKey || geminiApiKey,
      });

      const words = localResult.text.split(' ');
      for (let i = 0; i < words.length; i++) {
        const chunkWord = words[i] + (i < words.length - 1 ? ' ' : '');
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunkWord })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({
        type: 'done',
        fullText: localResult.text,
        groundingSources: [],
        webSearchQueries: [],
        functionCalls: [],
        metrics: localResult.metrics,
      })}\n\n`);
      res.end();
      return;
    }

    const cookieKey = (req as any).apiKeys?.GEMINI_API_KEY || '';
    // Incluye la key del entorno: es la que realmente usa el cliente y la que
    // hace falta para recordar qué keys no admiten las herramientas integradas.
    const effectiveKey = userApiKey || geminiApiKey || cookieKey || process.env.GEMINI_API_KEY || '';
    const ai = getGenAIClient(effectiveKey);
    const activeModel = mapGeminiModel(model);

    let mappedThinkingLevel: ThinkingLevel | undefined = undefined;
    if (thinkingLevel === 'HIGH') mappedThinkingLevel = ThinkingLevel.HIGH;
    else if (thinkingLevel === 'LOW') mappedThinkingLevel = ThinkingLevel.LOW;
    else if (thinkingLevel === 'MINIMAL') mappedThinkingLevel = ThinkingLevel.MINIMAL;

    const startTime = Date.now();

    const config: any = {
      temperature,
      topP,
      topK,
      maxOutputTokens: maxTokens,
    };

    if (stopSequences && Array.isArray(stopSequences) && stopSequences.length > 0) {
      config.stopSequences = stopSequences;
    }

    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (responseMimeType) config.responseMimeType = responseMimeType;
    if (responseSchema && responseMimeType === 'application/json') {
      try {
        config.responseSchema = typeof responseSchema === 'string' ? JSON.parse(responseSchema) : responseSchema;
      } catch (e) {
        console.warn('Error parsing responseSchema JSON:', e);
      }
    }
    if (tools && Array.isArray(tools) && tools.length > 0) {
      config.tools = tools;
    }
    if (mappedThinkingLevel && (activeModel.includes('pro') || activeModel.includes('thinking'))) {
      config.thinkingConfig = { thinkingLevel: mappedThinkingLevel };
    }

    // Misma regla que en generate: cadena explícita si llega, si no la de la
    // config; un array vacío la desactiva.
    const fallbackStreamCandidates = Array.from(
      new Set([activeModel, ...resolveFallbackChain(fallbackModels)])
    );

    // Misma memoria que en generate: una key sin herramientas integradas no
    // vuelve a pagar las cinco llamadas fallidas en cada mensaje.
    const hadBuiltins = Array.isArray(config.tools) && toolsCanBeDropped(config.tools);
    const skipBuiltins = hadBuiltins && keyLacksBuiltinTools(effectiveKey);
    if (skipBuiltins) config.tools = toolsWithoutBuiltins(config.tools);

    /** Recorre la cadena de modelos con una config dada y abre el primer stream vivo. */
    const openStream = async (streamConfig: any) => {
      let lastError: any = null;
      for (const modelToTry of fallbackStreamCandidates) {
        try {
          const stream = await ai.models.generateContentStream({
            model: modelToTry,
            contents: contents || 'Hola',
            config: streamConfig,
          });

          const iterator = (stream as any)[Symbol.asyncIterator]();
          const firstStep = await iterator.next();

          if (modelToTry !== activeModel) {
            console.warn(`[Stream Auto-Fallback]: ${activeModel} agotó cuota o falló, transmitiendo con ${modelToTry}`);
          }
          return { iterator, initialChunk: firstStep.done ? null : firstStep.value, error: null as any };
        } catch (err: any) {
          lastError = err;
          console.warn(`Modelo stream ${modelToTry} arrojó error (${err?.status || err?.code || err?.message}), evaluando alternativa...`);
          if (isQuotaOrNotFoundError(err)) continue;
          throw err;
        }
      }
      return { iterator: null as any, initialChunk: null as any, error: lastError };
    };

    // Igual que en generate: si con herramientas integradas no responde ningún
    // modelo, se repite la cadena sin ellas en vez de cerrar el chat con error.
    const streamAttempts = config.tools && toolsCanBeDropped(config.tools)
      ? [
          { config, droppedTools: false },
          { config: { ...config, tools: toolsWithoutBuiltins(config.tools) }, droppedTools: true },
        ]
      : [{ config, droppedTools: false }];

    let activeIterator: any = null;
    let initialChunk: any = null;
    let toolsDropped = skipBuiltins;
    let lastStreamError: any = null;

    for (const attempt of streamAttempts) {
      const opened = await openStream(attempt.config);
      if (opened.iterator) {
        activeIterator = opened.iterator;
        initialChunk = opened.initialChunk;
        toolsDropped = attempt.droppedTools || skipBuiltins;
        if (attempt.droppedTools) rememberKeyLacksBuiltinTools(effectiveKey);
        break;
      }
      lastStreamError = opened.error;
      if (!attempt.droppedTools) {
        console.warn('[Stream]: la cadena falló con las herramientas integradas; reintentando sin búsqueda ni ejecución de código');
      }
    }

    if (!activeIterator) {
      throw lastStreamError || new Error('No se pudo iniciar stream');
    }

    const processChunk = (chunk: any) => {
      const text = chunk?.text || '';
      if (text) {
        res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
      }
    };

    let fullText = '';
    if (toolsDropped) {
      fullText = `${TOOLS_DROPPED_NOTICE}\n\n`;
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: `${TOOLS_DROPPED_NOTICE}\n\n` })}\n\n`);
    }
    if (initialChunk) processChunk(initialChunk);

    fullText += initialChunk?.text || '';
    let groundingSources: any[] = [];
    let webSearchQueries: string[] = [];
    let functionCalls: any[] = [];

    while (true) {
      if (sseClosed) { try { await activeIterator.return?.(); } catch { /* ignore */ } break; }
      const { done, value } = await activeIterator.next();
      if (done) break;
      processChunk(value);
      fullText += value?.text || '';
      if (value?.candidates?.[0]?.groundingMetadata) {
        const gm = value.candidates[0].groundingMetadata;
        if (gm.webSearchQueries) webSearchQueries = gm.webSearchQueries;
        if (gm.groundingChunks) {
          groundingSources = gm.groundingChunks
            .map((chunk: any) => ({ title: chunk.web?.title || 'Fuente', url: chunk.web?.uri }))
            .filter((s: any) => s.url);
        }
      }
      if (value?.functionCalls) functionCalls = value.functionCalls;
    }

    // El cliente se soltó a mitad: no hay a quién entregar el cierre.
    if (sseClosed) {
      try { res.end(); } catch { /* socket ya caído */ }
      return;
    }

    const latencyMs = Date.now() - startTime;
    const promptTokens = Math.ceil((typeof contents === 'string' ? contents.length : JSON.stringify(contents).length) / 4);
    const responseTokens = Math.ceil(fullText.length / 4);

    res.write(`data: ${JSON.stringify({
      type: 'done',
      fullText,
      groundingSources,
      webSearchQueries,
      functionCalls,
      metrics: {
        promptTokens,
        responseTokens,
        totalTokens: promptTokens + responseTokens,
        latencyMs,
        costEstimate: model.includes('pro') ? '$0.0015 USD' : 'Gratis / Standard',
      },
    })}\n\n`);

    res.end();
  } catch (error: any) {
    const missingKey = error instanceof MissingApiKeyError || error?.code === 'MISSING_API_KEY';
    if (!missingKey) console.error('Error en /api/gemini/stream:', error);
    if (sseClosed) return;
    try {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: readableStreamError(error),
        ...(missingKey ? { code: 'MISSING_API_KEY', provider: 'google' } : {}),
      })}\n\n`);
    } catch { /* cliente caído */ }
    res.end();
  }
}

/**
 * Estado de la marca «esta key no admite herramientas integradas» para la key
 * en uso. Permite al panel explicar cuándo se volverá a intentar solo.
 */
export async function handleToolsMemoryStatus(req: Request, res: Response) {
  try {
    const currentKey =
      (req as any).apiKeys?.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
    const memory = builtinToolsMemory(currentKey);
    return res.json({
      success: true,
      keyKnown: Boolean(currentKey),
      marked: memory.marked,
      expiresAt: memory.expiresAt,
      ttlMs: capabilityTtlMs(),
    });
  } catch (error: any) {
    console.error('Error en GET /api/gemini/tools-memory:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'No se pudo leer la memoria de herramientas',
    });
  }
}

/** Límites aceptados para la duración de la marca (minutos). */
export const TOOLS_MEMORY_TTL_MIN = 1;
export const TOOLS_MEMORY_TTL_MAX = 24 * 60;

/**
 * Cadena de respaldo guardada, tal como la usará el servidor si la petición no
 * trae `fallbackModels`. El panel la muestra y la edita desde aquí.
 */
export async function handleFallbackModelsStatus(_req: Request, res: Response) {
  try {
    const fromConfig = getGoogleFallbackModels();
    return res.json({
      success: true,
      models: fromConfig ?? [...GEMINI_FALLBACK_MODELS],
      defaultModels: [...GEMINI_FALLBACK_MODELS],
      // true = lo guardado es una decisión explícita; false = sigue el default.
      configured: fromConfig !== null,
      maxModels: MAX_FALLBACK_MODELS,
    });
  } catch (error: any) {
    console.error('Error en GET /api/gemini/fallback-models:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'No se pudo leer la cadena de respaldo',
    });
  }
}

/**
 * Guarda la cadena de respaldo en `commander.json` a partir de lo que elija la
 * UI. Rechaza listas con entradas repetidas o vacías en vez de corregirlas en
 * silencio: si se ignora una, el usuario cree tener un respaldo que no existe.
 */
export async function handleSetFallbackModels(req: Request, res: Response) {
  try {
    const raw = req.body?.models ?? req.body?.fallbackModels;
    if (!Array.isArray(raw)) {
      return res.status(400).json({
        success: false,
        error: '`models` debe ser una lista de identificadores de modelo (una lista vacía desactiva el respaldo).',
      });
    }

    // Se compara sobre lo que llegó, no sobre lo normalizado: normalizar ya
    // deduplica, así que mirar ahí nunca vería un repetido.
    const trimmed = raw.map((item) => (typeof item === 'string' ? item.trim() : ''));
    const models = normalizeFallbackChain(raw) ?? [];
    const hasGarbage =
      raw.some((item) => typeof item !== 'string') ||
      trimmed.some((id) => id === '' || id.length > 80);
    const duplicated = trimmed.length !== new Set(trimmed).size;
    if (hasGarbage || duplicated || raw.length > MAX_FALLBACK_MODELS) {
      return res.status(400).json({
        success: false,
        error: `La cadena admite hasta ${MAX_FALLBACK_MODELS} modelos distintos, con identificadores no vacíos de menos de 80 caracteres y sin repetir.`,
      });
    }

    const configPath = setGoogleFallbackModels(models);
    return res.json({
      success: true,
      models,
      // Vacía = respaldo desactivado; la UI lo dice con todas las letras.
      fallbackEnabled: models.length > 0,
      maxModels: MAX_FALLBACK_MODELS,
      configPath,
    });
  } catch (error: any) {
    console.error('Error en POST /api/gemini/fallback-models:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'No se pudo guardar la cadena de respaldo',
    });
  }
}

/**
 * Cambia cuánto dura la marca desde el panel, persistiéndolo en `commander.json`.
 * La siguiente marca nace ya con el valor nuevo; las vigentes conservan el suyo.
 */
export async function handleSetToolsMemoryTtl(req: Request, res: Response) {
  try {
    const raw = req.body?.minutes ?? req.body?.ttlMinutes;
    // Los números deben ser enteros exactos: 2,5 no se redondea en silencio.
    const minutes = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
    if (
      !Number.isInteger(minutes) ||
      minutes < TOOLS_MEMORY_TTL_MIN ||
      minutes > TOOLS_MEMORY_TTL_MAX
    ) {
      return res.status(400).json({
        success: false,
        error: `La duración debe ser un número entero de minutos entre ${TOOLS_MEMORY_TTL_MIN} y ${TOOLS_MEMORY_TTL_MAX}.`,
      });
    }

    const { setGoogleToolsMemoryTtlMinutes } = await import('./src/config/index');
    const configPath = setGoogleToolsMemoryTtlMinutes(minutes);

    return res.json({
      success: true,
      ttlMinutes: minutes,
      ttlMs: capabilityTtlMs(),
      defaultTtlMs: DEFAULT_CAPABILITY_TTL_MS,
      configPath,
    });
  } catch (error: any) {
    console.error('Error en POST /api/gemini/tools-memory/ttl:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'No se pudo guardar la duración de la marca',
    });
  }
}

/**
 * Borra lo aprendido de la key en uso para volver a probar las herramientas
 * integradas ya mismo, sin esperar a que caduque la memoria.
 */
export async function handleResetToolsMemory(req: Request, res: Response) {
  try {
    const bodyKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    const currentKey =
      bodyKey ||
      (req as any).apiKeys?.GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      '';
    // Si se conoce la key se olvida sólo la suya; si no, se limpia todo: el
    // botón debe recuperar la búsqueda en cualquier caso.
    forgetToolsMemory(currentKey || undefined);
    return res.json({
      success: true,
      scope: currentKey ? 'key' : 'all',
      message: 'El próximo mensaje volverá a intentar la búsqueda de Google y la ejecución de código.',
    });
  } catch (error: any) {
    console.error('Error en /api/gemini/tools-memory/reset:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'No se pudo borrar la memoria de herramientas',
    });
  }
}

export async function handleGeminiInteractions(req: Request, res: Response) {
  try {
    const {
      agent = 'antigravity-preview-09-2026',
      input,
      environment = 'remote',
      previous_interaction_id,
      tools,
      apiKey: userApiKey,
    } = req.body;

    const apiKey = userApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'No se encontró la GEMINI_API_KEY. Por favor ingrésala en el panel de configuración.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const interactionParams: any = {
      agent,
      input,
      environment,
    };

    if (previous_interaction_id) {
      interactionParams.previous_interaction_id = previous_interaction_id;
    }

    if (tools && Array.isArray(tools) && tools.length > 0) {
      interactionParams.tools = tools;
    }

    const startTime = Date.now();
    const interaction: any = await (ai as any).interactions.create(interactionParams, { timeout: 300000 });
    const latencyMs = Date.now() - startTime;

    return res.json({
      success: true,
      interaction: {
        id: interaction.id,
        environment_id: interaction.environment_id,
        output_text: interaction.output_text || '',
        status: interaction.status || 'completed',
        steps: interaction.steps || [],
        usage: interaction.usage || {},
        latencyMs,
      },
    });
  } catch (error: any) {
    console.error('Error en /api/gemini/interactions/create:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al ejecutar la interacción con el Agente Antigravity',
    });
  }
}
