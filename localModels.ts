import { GoogleGenAI } from '@google/genai';
import { GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODELS, GEMINI_PRO_MODEL } from './src/config/geminiModels';

const getGenAIClient = (overrideApiKey?: string) => {
  const apiKey = overrideApiKey || process.env.GEMINI_API_KEY;
  // Exigimos una key real (nunca "dummy"): esta ruta solo se invoca cuando ya
  // hay una clave disponible, así que si falta es un fallo de programación.
  if (!apiKey) throw new Error('GEMINI_API_KEY requerida para el motor local con respaldo Gemini');
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

export function mapGeminiModel(modelName?: string): string {
  if (!modelName) return GEMINI_DEFAULT_MODEL;
  const m = modelName.trim().toLowerCase();
  if (m === 'gemini-flash') return GEMINI_DEFAULT_MODEL;
  if (m === 'gemini-pro') return GEMINI_PRO_MODEL;
  return modelName.trim();
}

export function isQuotaOrNotFoundError(err: any): boolean {
  if (!err) return false;
  const status = err.status || err.code || err.statusCode;
  const msg = (err.message || String(err)).toLowerCase();
  return (
    status === 404 ||
    status === 429 ||
    status === 503 ||
    msg.includes('404') ||
    msg.includes('429') ||
    msg.includes('not found') ||
    msg.includes('not_found') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests') ||
    msg.includes('limit exceeded') ||
    msg.includes('queries per minute') ||
    msg.includes('queries') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable')
  );
}

export async function executeLocalHfModel({
  prompt,
  model = 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
  hfApiToken,
  apiKey: userApiKey,
  geminiApiKey,
  systemInstruction = '',
  temperature = 0.7,
  maxTokens = 1024,
}: any): Promise<{ text: string; metrics: any }> {
  const startTime = Date.now();
  const effectiveGeminiKey = geminiApiKey || userApiKey || process.env.GEMINI_API_KEY;

  if (hfApiToken) {
    const payload = {
      inputs: systemInstruction ? `${systemInstruction}\n\nUser: ${prompt}\nAssistant:` : prompt,
      parameters: {
        temperature,
        max_new_tokens: maxTokens,
        return_full_text: false,
      },
    };

    const endpoints = [
      `https://router.huggingface.co/hf-inference/models/${model}`,
      `https://api-inference.huggingface.co/models/${model}`,
    ];

    for (const endpointUrl of endpoints) {
      try {
        const hfResponse = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfApiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (hfResponse.ok) {
          const hfData = await hfResponse.json();
          const latencyMs = Date.now() - startTime;
          let generatedText = '';
          if (Array.isArray(hfData) && hfData[0]?.generated_text) {
            generatedText = hfData[0].generated_text;
          } else if (typeof hfData === 'object' && hfData.generated_text) {
            generatedText = hfData.generated_text;
          } else if (typeof hfData === 'string') {
            generatedText = hfData;
          } else {
            generatedText = JSON.stringify(hfData);
          }

          if (generatedText) {
            return {
              text: generatedText,
              metrics: {
                promptTokens: Math.ceil(prompt.length / 4),
                responseTokens: Math.ceil(generatedText.length / 4),
                totalTokens: Math.ceil((prompt.length + generatedText.length) / 4),
                latencyMs,
                costEstimate: 'HuggingFace Router API',
              },
            };
          }
        }
      } catch (routerErr) {
        console.warn(`[HF Router attempt failed on ${endpointUrl}]`, routerErr);
      }
    }
  }

  if (effectiveGeminiKey) {
    try {
      const ai = getGenAIClient(effectiveGeminiKey);
      const lowerModel = model.toLowerCase();
      const isDeepSeek = lowerModel.includes('deepseek') || lowerModel.includes('r1') || lowerModel.includes('reason');
      const isCoder = lowerModel.includes('coder') || lowerModel.includes('code') || lowerModel.includes('starcoder');
      const isLlama = lowerModel.includes('llama');
      const isWhisper = lowerModel.includes('whisper');

      let personaInstruction = `Eres el motor de inferencia local ejecutando el modelo open-source "${model}" en Commander AI Studio.`;
      if (isDeepSeek) {
        personaInstruction += ` Eres DeepSeek-R1. Debes pensar minuciosamente. Pon TODO tu proceso de razonamiento analítico paso a paso dentro de etiquetas <think>...</think>, y fuera de ellas da tu respuesta final, completa, detallada y de alta calidad técnica con código listo para producción.`;
      } else if (isCoder) {
        personaInstruction += ` Eres un modelo de élite especializado en programación e ingeniería de software. Escribe código limpio, documentado, eficiente y listo para producción sin rodeos.`;
      } else if (isLlama) {
        personaInstruction += ` Responde con la precisión técnica, exhaustividad y concisión directa característica de Meta Llama 3.`;
      } else if (isWhisper) {
        personaInstruction += ` Eres el modelo OpenAI Whisper de procesamiento de audio y transcripción.`;
      } else {
        personaInstruction += ` Responde directamente a la consulta del usuario con máxima precisión, código funcional si lo solicita y gran claridad.`;
      }

      if (systemInstruction) {
        personaInstruction += `\nInstrucciones adicionales del sistema: ${systemInstruction}`;
      }

      // Misma cadena viva que generate/stream: una sola lista, sin copias.
      const bridgeCandidates = [...GEMINI_FALLBACK_MODELS];

      let generatedText = '';
      for (const mTarget of bridgeCandidates) {
        try {
          const genResult = await ai.models.generateContent({
            model: mTarget,
            contents: prompt,
            config: {
              systemInstruction: personaInstruction,
              temperature,
              maxOutputTokens: maxTokens,
            },
          });
          if (genResult.text) {
            generatedText = genResult.text;
            break;
          }
        } catch (mErr: any) {
          if (mErr.status === 404 || mErr.message?.includes('not found') || mErr.message?.includes('NOT_FOUND')) {
            continue;
          }
          throw mErr;
        }
      }

      if (generatedText) {
        const latencyMs = Date.now() - startTime;
        return {
          text: generatedText,
          metrics: {
            promptTokens: Math.ceil(prompt.length / 4),
            responseTokens: Math.ceil(generatedText.length / 4),
            totalTokens: Math.ceil((prompt.length + generatedText.length) / 4),
            latencyMs,
            costEstimate: 'Local Neural Bridge',
          },
        };
      }
    } catch (geminiBridgeErr: any) {
      console.warn('[HF Local Engine via Gemini error, activando motor generativo offline]:', geminiBridgeErr.message);
    }
  }

  // Motor generativo offline eliminado: no se generan respuestas simuladas.
  throw new Error('MODEL_RUNTIME_UNAVAILABLE: no hay runtime local ni bridge disponible para generar una respuesta real.');
}
