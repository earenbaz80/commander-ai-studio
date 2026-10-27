import type { Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { mapGeminiModel, isQuotaOrNotFoundError, executeLocalHfModel } from './localModels';

/** Mensaje único para cuando falta la API key de Google. */
export const GEMINI_KEY_REQUIRED =
  'GEMINI_API_KEY requerida. Añádela en Configuración → GOOGLE GEMINI (o en el archivo .env) para usar los modelos de Google.';

/**
 * Cadena de respaldo de Gemini, verificada contra la API el 2026-10-27.
 *
 * Los ids anteriores (2.0-flash, 2.0-flash-lite, 1.5-flash-8b, 2.5-flash) ya
 * devuelven 404 «no longer available»: reintentarlos sólo alargaba la espera
 * hasta el error del motor local. El orden va del mismo nivel al más ligero y
 * deja el alias `-latest` al final, que es el que más tarda en quedar obsoleto.
 */
export const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
  'gemini-flash-lite-latest',
];

class MissingApiKeyError extends Error {
  code = 'MISSING_API_KEY';
  constructor() {
    super(GEMINI_KEY_REQUIRED);
    this.name = 'MissingApiKeyError';
  }
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
      model = 'gemini-3.8-flash',
      temperature = 0.7,
      topP = 0.95,
      topK = 40,
      maxTokens = 2048,
      thinkingLevel,
      responseMimeType,
      responseSchema,
      tools,
      stopSequences,
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
    const effectiveKey = userApiKey || geminiApiKey || cookieKey;
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

    const fallbackCandidates = Array.from(new Set([
      activeModel,
      ...GEMINI_FALLBACK_MODELS,
    ]));

    let response: any;
    let fallbackUsed = false;
    let fallbackModelName = '';
    /** Qué modelo falló y con qué estado; viaja en la respuesta si nada funciona. */
    const failures: string[] = [];

    for (const modelToTry of fallbackCandidates) {
      try {
        response = await ai.models.generateContent({
          model: modelToTry,
          contents: contents || 'Hola',
          config,
        });
        if (modelToTry !== activeModel) {
          fallbackUsed = true;
          fallbackModelName = modelToTry;
          console.warn(`[Auto-Fallback]: ${activeModel} no disponible, respondiendo con ${modelToTry}`);
        }
        break;
      } catch (err: any) {
        if (isQuotaOrNotFoundError(err)) {
          failures.push(`${modelToTry} (${err?.status || err?.code || 'error'})`);
          console.warn(`Modelo ${modelToTry} agotó cuota o falló (${err.status || err.message}), intentando alternativa con mayor cuota...`);
          continue;
        }
        throw err;
      }
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

export async function handleGeminiStream(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  let sseClosed = false;
  req.on('close', () => { sseClosed = true; });
  req.socket.setTimeout(5 * 60 * 1000);

  try {
    const {
      apiKey: userApiKey,
      geminiApiKey,
      contents,
      systemInstruction,
      model = 'gemini-2.5-flash',
      temperature = 0.7,
      topP = 0.95,
      topK = 40,
      maxTokens = 2048,
      thinkingLevel,
      responseMimeType,
      responseSchema,
      tools,
      stopSequences,
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
    const effectiveKey = userApiKey || geminiApiKey || cookieKey;
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

    const fallbackStreamCandidates = Array.from(new Set([
      activeModel,
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash-8b',
      'gemini-2.5-flash',
    ]));

    let activeIterator: any = null;
    let initialChunk: any = null;
    let lastStreamError: any = null;

    for (const modelToTry of fallbackStreamCandidates) {
      try {
        const stream = await ai.models.generateContentStream({
          model: modelToTry,
          contents: contents || 'Hola',
          config,
        });

        const iterator = (stream as any)[Symbol.asyncIterator]();
        const firstStep = await iterator.next();

        activeIterator = iterator;
        if (!firstStep.done) {
          initialChunk = firstStep.value;
        }

        if (modelToTry !== activeModel) {
          console.warn(`[Stream Auto-Fallback]: ${activeModel} agotó cuota o falló, transmitiendo con ${modelToTry}`);
        }
        break;
      } catch (err: any) {
        lastStreamError = err;
        console.warn(`Modelo stream ${modelToTry} arrojó error (${err?.status || err?.code || err?.message}), evaluando alternativa...`);
        if (isQuotaOrNotFoundError(err)) continue;
        throw err;
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

    if (initialChunk) processChunk(initialChunk);

    let fullText = initialChunk?.text || '';
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
        error: error.message || 'Error en streaming',
        ...(missingKey ? { code: 'MISSING_API_KEY', provider: 'google' } : {}),
      })}\n\n`);
    } catch { /* cliente caído */ }
    res.end();
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
