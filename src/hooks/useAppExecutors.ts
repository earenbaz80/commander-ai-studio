import { useCallback } from 'react';
import { resolveChatRoute } from '../lib/aiRouting';
import { getCachedApiKey } from '../lib/apiKeys';
import { formatErrorMessage } from '../utils/errorFormatter';
import { sendBrowserNotification, playRetroSuccessSound } from '../utils/browserNotifications';
import type { ChatMessage, StructuredExample, StudioMode } from '../types/studio';

export interface AppExecutorContext {
  selectedModel: string;
  selectedProvider: string;
  parameters: any;
  downloadedModels: any[];
  lang: string;
  messages: ChatMessage[];
  setIsGenerating: (v: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  addToHistory: (title: string, mode: StudioMode, msgs?: ChatMessage[]) => void;
}

export function useAppExecutors(ctx: AppExecutorContext) {
  const {
    selectedModel,
    selectedProvider,
    parameters,
    downloadedModels,
    lang,
    messages,
    setIsGenerating,
    setMessages,
    addToHistory,
  } = ctx;

  const handleExecuteFreeform = useCallback(async (promptText: string) => {
    setIsGenerating(true);
    try {
      const { endpoint, isAnthropic, isFreeProvider, isCustom, isHf } = resolveChatRoute({
        modelId: selectedModel,
        provider: selectedProvider,
        downloadedModels,
      });
      const anthropicApiKey = parameters.anthropicApiKey || getCachedApiKey('ANTHROPIC_API_KEY') || undefined;
      const geminiApiKey = getCachedApiKey('GEMINI_API_KEY') || undefined;

      const payload = isAnthropic
        ? {
            prompt: promptText,
            model: selectedModel,
            anthropicApiKey,
            systemInstruction: parameters.systemInstruction,
            temperature: parameters.temperature,
            maxTokens: parameters.maxTokens,
          }
        : isHf
        ? {
            prompt: promptText,
            model: selectedModel,
            hfApiToken: parameters.hfApiToken || getCachedApiKey('HF_API_TOKEN') || undefined,
            systemInstruction: parameters.systemInstruction,
            temperature: parameters.temperature,
            geminiApiKey: geminiApiKey || getCachedApiKey('GEMINI_API_KEY') || undefined,
          }
        : isFreeProvider
        ? {
            prompt: promptText,
            model: selectedModel,
            systemInstruction: parameters.systemInstruction,
            temperature: parameters.temperature,
            maxTokens: parameters.maxTokens,
            openrouterApiKey: getCachedApiKey('OPENROUTER_API_KEY') || undefined,
            ollamaHost: getCachedApiKey('OLLAMA_HOST') || undefined,
          }
        : isCustom
        ? {
            prompt: promptText,
            model: getCachedApiKey('CUSTOM_MODEL') || selectedModel,
            systemInstruction: parameters.systemInstruction,
            temperature: parameters.temperature,
            maxTokens: parameters.maxTokens,
            baseURL: getCachedApiKey('CUSTOM_BASE_URL') || undefined,
            apiKey: getCachedApiKey('CUSTOM_API_KEY') || getCachedApiKey('OPENCODE_API_KEY') || undefined,
          }
        : {
            apiKey: geminiApiKey,
            contents: promptText,
            systemInstruction: parameters.systemInstruction,
            model: selectedModel,
            temperature: parameters.temperature,
            topP: parameters.topP,
            topK: parameters.topK,
            maxTokens: parameters.maxTokens,
            thinkingLevel: parameters.thinkingLevel,
            responseMimeType: parameters.responseFormat === 'json' ? 'application/json' : undefined,
            responseSchema: parameters.jsonSchema,
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (data.success) {
        addToHistory('Freeform: ' + promptText.slice(0, 25), 'freeform');
        sendBrowserNotification(
          lang === 'es' ? '✨ Freeform Completado' : lang === 'de' ? '✨ Freier Prompt abgeschlossen' : '✨ Freeform Completed',
          lang === 'es'
            ? 'La ejecución freeform ha finalizado con éxito.'
            : lang === 'de' ? 'Die freie Ausführung wurde erfolgreich abgeschlossen.' : 'The freeform execution finished successfully.'
        );
        playRetroSuccessSound();
        return data.text;
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      return `⚠️ Error: ${formatErrorMessage(error, selectedModel)}`;
    } finally {
      setIsGenerating(false);
    }
  }, [selectedModel, selectedProvider, parameters, downloadedModels, lang, messages, setIsGenerating, setMessages, addToHistory]);

  const handleExecuteStructured = useCallback(async (examples: StructuredExample[], testInput: string) => {
    setIsGenerating(true);
    try {
      const { endpoint, isAnthropic, isFreeProvider, isCustom, isHf } = resolveChatRoute({
        modelId: selectedModel,
        provider: selectedProvider,
        downloadedModels,
      });
      const anthropicApiKey = parameters.anthropicApiKey || getCachedApiKey('ANTHROPIC_API_KEY') || undefined;
      const geminiApiKey = getCachedApiKey('GEMINI_API_KEY') || undefined;

      const formattedPrompt = `${examples.map((ex) => `Entrada: ${ex.input}\nSalida: ${ex.output}`).join('\n\n')}\n\nEntrada: ${testInput}\nSalida:`;
      const payload = isAnthropic
        ? {
            prompt: formattedPrompt,
            model: selectedModel,
            anthropicApiKey,
            systemInstruction: parameters.systemInstruction || 'Responde manteniendo exactamente la estructura de los ejemplos anteriores.',
            temperature: parameters.temperature,
          }
        : isHf
        ? {
            prompt: formattedPrompt,
            model: selectedModel,
            hfApiToken: parameters.hfApiToken || getCachedApiKey('HF_API_TOKEN') || undefined,
            geminiApiKey: geminiApiKey || getCachedApiKey('GEMINI_API_KEY') || undefined,
            systemInstruction: parameters.systemInstruction || 'Responde manteniendo exactamente la estructura de los ejemplos anteriores.',
            temperature: parameters.temperature,
          }
        : isFreeProvider
        ? {
            prompt: formattedPrompt,
            model: selectedModel,
            systemInstruction: parameters.systemInstruction || 'Responde manteniendo exactamente la estructura de los ejemplos anteriores.',
            temperature: parameters.temperature,
            openrouterApiKey: getCachedApiKey('OPENROUTER_API_KEY') || undefined,
            ollamaHost: getCachedApiKey('OLLAMA_HOST') || undefined,
          }
        : isCustom
        ? {
            prompt: formattedPrompt,
            model: getCachedApiKey('CUSTOM_MODEL') || selectedModel,
            systemInstruction: parameters.systemInstruction || 'Responde manteniendo exactamente la estructura de los ejemplos anteriores.',
            temperature: parameters.temperature,
            baseURL: getCachedApiKey('CUSTOM_BASE_URL') || undefined,
            apiKey: getCachedApiKey('CUSTOM_API_KEY') || getCachedApiKey('OPENCODE_API_KEY') || undefined,
          }
        : {
            apiKey: geminiApiKey,
            contents: formattedPrompt,
            prompt: formattedPrompt,
            systemInstruction: parameters.systemInstruction || 'Responde manteniendo exactamente la estructura de los ejemplos anteriores.',
            model: selectedModel,
            temperature: parameters.temperature,
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (data.success) {
        addToHistory('Structured: ' + testInput.slice(0, 25), 'structured');
        sendBrowserNotification(
          lang === 'es' ? '📋 Structured Completado' : lang === 'de' ? '📋 Strukturierter Prompt abgeschlossen' : '📋 Structured Completed',
          lang === 'es'
            ? 'La ejecución structured ha finalizado con éxito.'
            : lang === 'de' ? 'Die strukturierte Ausführung wurde erfolgreich abgeschlossen.' : 'The structured execution finished successfully.'
        );
        playRetroSuccessSound();
        return data.text;
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      return `⚠️ Error: ${formatErrorMessage(error, selectedModel)}`;
    } finally {
      setIsGenerating(false);
    }
  }, [selectedModel, selectedProvider, parameters, downloadedModels, lang, setIsGenerating, addToHistory]);

  const handleExecuteHfTab = useCallback(async (prompt: string, hfModel: string) => {
    setIsGenerating(true);
    try {
      const response = await fetch('/api/hf/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          model: hfModel,
          hfApiToken: parameters.hfApiToken || getCachedApiKey('HF_API_TOKEN') || undefined,
          systemInstruction: parameters.systemInstruction,
          temperature: parameters.temperature,
          geminiApiKey: getCachedApiKey('GEMINI_API_KEY') || undefined,
        }),
      });

      const data = await response.json();
      if (data.success) {
        addToHistory('HF Local: ' + prompt.slice(0, 25), 'huggingface');
        sendBrowserNotification(
          lang === 'es' ? '🤗 HuggingFace Completado' : lang === 'de' ? '🤗 HuggingFace abgeschlossen' : '🤗 HuggingFace Completed',
          lang === 'es'
            ? `Modelo "${hfModel}" finalizó la ejecución.`
            : lang === 'de'
              ? `Modell "${hfModel}" hat die Ausführung abgeschlossen.`
              : `Model "${hfModel}" finished the execution.`
        );
        playRetroSuccessSound();
        return data.text;
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      return `⚠️ Error HF: ${formatErrorMessage(error, hfModel)}`;
    } finally {
      setIsGenerating(false);
    }
  }, [parameters, lang, setIsGenerating, addToHistory]);

  return { handleExecuteFreeform, handleExecuteStructured, handleExecuteHfTab };
}
