import { useCallback } from 'react';
import { resolveChatRoute } from '../lib/aiRouting';
import { formatErrorMessage } from '../utils/errorFormatter';
import { sendBrowserNotification, playRetroSuccessSound } from '../utils/browserNotifications';
import type { ChatMessage, StructuredExample, StudioMode } from '../types/studio';

export interface AppExecutorContext {
  selectedModel: string;
  selectedProvider: string;
  parameters: any;
  downloadedModels: any[];
  lang: string;
  setIsGenerating: (v: boolean) => void;
  addToHistory: (title: string, mode: StudioMode, msgs?: ChatMessage[]) => void;
  messages: ChatMessage[];
}

export function useAppExecutors(ctx: AppExecutorContext) {
  const {
    selectedModel,
    selectedProvider,
    parameters,
    downloadedModels,
    lang,
    setIsGenerating,
    addToHistory,
    messages,
  } = ctx;

  const handleExecuteFreeform = useCallback(async (promptText: string) => {
    setIsGenerating(true);
    try {
      const { endpoint, isAnthropic, isFreeProvider, isCustom, isHf, isLocal } = resolveChatRoute({
        modelId: selectedModel,
        provider: selectedProvider,
        downloadedModels,
      });

      const historyForProvider = messages.map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: promptText }]);

      const payload = isAnthropic
        ? {
            prompt: promptText,
            messages: historyForProvider,
            model: selectedModel,
            systemInstruction: parameters.systemInstruction,
            temperature: parameters.temperature,
            maxTokens: parameters.maxTokens,
          }
        : isHf
        ? {
            prompt: promptText,
            messages: historyForProvider,
            model: selectedModel,
            systemInstruction: parameters.systemInstruction,
            temperature: parameters.temperature,
            maxTokens: parameters.maxTokens,
          }
        : isFreeProvider || isLocal
        ? {
            prompt: promptText,
            messages: historyForProvider,
            model: isLocal ? selectedModel.replace(/^local\//, '') : selectedModel,
            systemInstruction: parameters.systemInstruction,
            temperature: parameters.temperature,
            maxTokens: parameters.maxTokens,
          }
        : isCustom
        ? {
            prompt: promptText,
            messages: historyForProvider,
            model: selectedModel,
            systemInstruction: parameters.systemInstruction,
            temperature: parameters.temperature,
            maxTokens: parameters.maxTokens,
          }
        : {
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
  }, [selectedModel, selectedProvider, parameters, downloadedModels, lang, setIsGenerating, addToHistory, messages]);

  const handleExecuteStructured = useCallback(async (examples: StructuredExample[], testInput: string) => {
    setIsGenerating(true);
    try {
      const { endpoint, isAnthropic, isFreeProvider, isCustom, isHf, isLocal } = resolveChatRoute({
        modelId: selectedModel,
        provider: selectedProvider,
        downloadedModels,
      });

      const formattedPrompt = `${examples.map((ex) => `Entrada: ${ex.input}\nSalida: ${ex.output}`).join('\n\n')}\n\nEntrada: ${testInput}\nSalida:`;
      const historyForProvider = messages.map(m => ({ role: m.role, content: m.content })).concat([{ role: 'user', content: formattedPrompt }]);
      const payload = isAnthropic
        ? {
            prompt: formattedPrompt,
            messages: historyForProvider,
            model: selectedModel,
            systemInstruction: parameters.systemInstruction || 'Responde manteniendo exactamente la estructura de los ejemplos anteriores.',
            temperature: parameters.temperature,
          }
        : isHf
        ? {
            prompt: formattedPrompt,
            messages: historyForProvider,
            model: selectedModel,
            systemInstruction: parameters.systemInstruction || 'Responde manteniendo exactamente la estructura de los ejemplos anteriores.',
            temperature: parameters.temperature,
          }
        : isFreeProvider || isLocal
        ? {
            prompt: formattedPrompt,
            messages: historyForProvider,
            model: isLocal ? selectedModel.replace(/^local\\/, '') : selectedModel,
            systemInstruction: parameters.systemInstruction || 'Responde manteniendo exactamente la estructura de los ejemplos anteriores.',
            temperature: parameters.temperature,
          }
        : isCustom
        ? {
            prompt: formattedPrompt,
            messages: historyForProvider,
            model: selectedModel,
            systemInstruction: parameters.systemInstruction || 'Responde manteniendo exactamente la estructura de los ejemplos anteriores.',
            temperature: parameters.temperature,
          }
        : {
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
  }, [selectedModel, selectedProvider, parameters, downloadedModels, lang, setIsGenerating, addToHistory, messages]);

  const handleExecuteHfTab = useCallback(async (prompt: string, hfModel: string) => {
    setIsGenerating(true);
    try {
      const response = await fetch('/api/hf/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          model: hfModel,
          systemInstruction: parameters.systemInstruction,
          temperature: parameters.temperature,
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
