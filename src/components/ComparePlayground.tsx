import { getCachedApiKey } from '../lib/apiKeys';
import React, { useState } from 'react';
import { Play, Clock, Zap, Columns, Layers } from 'lucide-react';
import { ParameterConfig } from '../types/studio';
import { ALL_MODELS } from '../data/models';
import { resolveChatRoute } from '../lib/aiRouting';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Language } from '../i18n/translations';
import { GEMINI_DEFAULT_MODEL, GEMINI_PRO_MODEL } from '../config/geminiModels';

export interface ComparePlaygroundProps {
  parameters: ParameterConfig;
  setParameters: React.Dispatch<React.SetStateAction<ParameterConfig>>;
  lang?: Language;
}

export const ComparePlayground: React.FC<ComparePlaygroundProps> = ({
  parameters,
  lang = 'es',
}) => {
  const [modelA, setModelA] = useState(GEMINI_DEFAULT_MODEL);
  const [modelB, setModelB] = useState(GEMINI_PRO_MODEL);
  const [tempA, setTempA] = useState(0.2);
  const [tempB, setTempB] = useState(0.9);
  const [prompt, setPrompt] = useState('Escribe una función recursiva para revertir una lista enlazada en TypeScript y analiza su complejidad temporal O(N).');

  const [isLoading, setIsLoading] = useState(false);
  const [resultA, setResultA] = useState<{ text: string; latencyMs?: number; tokens?: number }>({ text: '' });
  const [resultB, setResultB] = useState<{ text: string; latencyMs?: number; tokens?: number }>({ text: '' });

  const handleRunComparison = async () => {
    if (!prompt.trim() || isLoading) return;
    setIsLoading(true);
    setResultA({ text: '' });
    setResultB({ text: '' });

    const fetchModelResult = async (model: string, temp: number) => {
      const start = Date.now();
      try {
        const modelObj = ALL_MODELS.find(m => m.id === model);
        const route = resolveChatRoute({ modelId: model, provider: modelObj?.provider });
        const isAnthropic = route.isAnthropic;
        const isHf = route.isHf;
        const isFreeProvider = route.isFreeProvider;
        const isLocal = route.isLocal;
        const isCustom = route.isCustom;
        const endpoint = route.endpoint;
        const anthropicApiKey = parameters.anthropicApiKey || getCachedApiKey('ANTHROPIC_API_KEY') || undefined;
        const geminiApiKey = getCachedApiKey('GEMINI_API_KEY') || undefined;

        const payload = isAnthropic
          ? {
              prompt,
              model,
              anthropicApiKey,
              systemInstruction: parameters.systemInstruction,
              temperature: temp,
              maxTokens: parameters.maxTokens,
            }
          : isHf
          ? {
              prompt,
              model,
              hfApiToken: parameters.hfApiToken,
              systemInstruction: parameters.systemInstruction,
              temperature: temp,
              maxTokens: parameters.maxTokens,
              geminiApiKey: geminiApiKey || getCachedApiKey('GEMINI_API_KEY') || undefined,
            }
          : isFreeProvider || isLocal
          ? {
              prompt,
              model: isLocal ? model.replace(/^local\//, '') : model,
              systemInstruction: parameters.systemInstruction,
              temperature: temp,
              maxTokens: parameters.maxTokens,
              openrouterApiKey: getCachedApiKey('OPENROUTER_API_KEY') || undefined,
              ollamaHost: getCachedApiKey('OLLAMA_HOST') || undefined,
            }
          : isCustom
          ? {
              prompt,
              model: getCachedApiKey('CUSTOM_MODEL') || model,
              systemInstruction: parameters.systemInstruction,
              temperature: temp,
              maxTokens: parameters.maxTokens,
              baseURL: getCachedApiKey('CUSTOM_BASE_URL') || undefined,
              apiKey: getCachedApiKey('CUSTOM_API_KEY') || getCachedApiKey('OPENCODE_API_KEY') || undefined,
            }
          : {
              apiKey: geminiApiKey,
              contents: prompt,
              systemInstruction: parameters.systemInstruction,
              model,
              temperature: temp,
              topP: parameters.topP,
              maxTokens: parameters.maxTokens,
              stopSequences: parameters.stopSequences,
            };

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        const latency = Date.now() - start;
        if (data.success) {
          return {
            text: data.text || '',
            latencyMs: latency,
            tokens: data.metrics?.totalTokens || Math.ceil((data.text?.length || 0) / 4),
          };
        } else {
          return { text: `Error: ${data.error || 'Respuesta no válida'}` };
        }
      } catch (err: any) {
        return { text: `Error de red: ${err.message}` };
      }
    };

    // Run both models concurrently
    const [resA, resB] = await Promise.all([
      fetchModelResult(modelA, tempA),
      fetchModelResult(modelB, tempB),
    ]);

    setResultA(resA);
    setResultB(resB);
    setIsLoading(false);
  };

  const modelObjA = ALL_MODELS.find((m) => m.id === modelA);
  const modelObjB = ALL_MODELS.find((m) => m.id === modelB);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#000080] font-mono text-xs text-white overflow-hidden p-2 gap-2">
      {/* Top Banner Header */}
      <div className="bg-[#00aaaa] text-black font-bold px-3 py-1.5 flex items-center justify-between border-2 border-black shrink-0">
        <div className="flex items-center gap-2">
          <Columns className="w-5 h-5 text-black" />
          <span className="text-sm">{lang === 'es' ? 'MODO COMPARATIVO BENCHMARK (SIDE-BY-SIDE)' : lang === 'de' ? 'MODELLVERGLEICH NEBENEINANDER' : 'SIDE-BY-SIDE MODEL BENCHMARK'}</span>
        </div>
        <span className="text-xs bg-[#0000aa] text-[#ffff55] px-2 py-0.5 border border-black font-bold">
          {lang === 'es' ? '[Doble Inferencia Concurrente]' : lang === 'de' ? '[Paralleles Doppel-Inferenz]' : '[Concurrent Dual Inference]'}
        </span>
      </div>

      {/* Model Config Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 shrink-0">
        {/* Model A Selector */}
        <div className="bg-[#0000aa] border-2 border-[#00ffff] p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#ffff55] flex items-center gap-1">
              <Layers className="w-4 h-4 text-[#00ffff]" /> {lang === 'es' ? 'MODELO A:' : lang === 'de' ? 'MODELL A:' : 'MODEL A:'}
            </span>
            <span className="bg-[#00ffff] text-black px-1 font-bold text-[10px]">{lang === 'es' ? 'LADO IZQUIERDO' : lang === 'de' ? 'LINKE SEITE' : 'LEFT SIDE'}</span>
          </div>

          <select
            value={modelA}
            onChange={(e) => setModelA(e.target.value)}
            className="w-full bg-[#000080] border border-[#00ffff] p-1 text-xs text-white font-bold outline-none cursor-pointer"
          >
            {ALL_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider.toUpperCase()})
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-[#00ffff] font-bold">TEMP A ({tempA}):</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={tempA}
              onChange={(e) => setTempA(parseFloat(e.target.value))}
              className="flex-1 accent-[#00ffff]"
            />
          </div>
        </div>

        {/* Model B Selector */}
        <div className="bg-[#0000aa] border-2 border-[#00ffff] p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#ffff55] flex items-center gap-1">
              <Layers className="w-4 h-4 text-[#ffff55]" /> {lang === 'es' ? 'MODELO B:' : lang === 'de' ? 'MODELL B:' : 'MODEL B:'}
            </span>
            <span className="bg-[#ffff55] text-black px-1 font-bold text-[10px]">{lang === 'es' ? 'LADO DERECHO' : lang === 'de' ? 'RECHTE SEITE' : 'RIGHT SIDE'}</span>
          </div>

          <select
            value={modelB}
            onChange={(e) => setModelB(e.target.value)}
            className="w-full bg-[#000080] border border-[#00ffff] p-1 text-xs text-white font-bold outline-none cursor-pointer"
          >
            {ALL_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider.toUpperCase()})
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-[#ffff55] font-bold">TEMP B ({tempB}):</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={tempB}
              onChange={(e) => setTempB(parseFloat(e.target.value))}
              className="flex-1 accent-[#ffff55]"
            />
          </div>
        </div>
      </div>

      {/* Prompt Input Box */}
      <div className="bg-[#0000aa] border-2 border-[#00ffff] p-2 flex flex-col gap-1.5 shrink-0">
        <label className="text-[11px] font-bold text-[#ffff55] flex items-center justify-between">
          <span>{lang === 'es' ? 'PROMPT ÚNICO PARA AMBOS MODELOS:' : lang === 'de' ? 'GEMEINSAMER PROMPT FÜR BEIDE MODELLE:' : 'SHARED PROMPT FOR BOTH MODELS:'}</span>
        </label>
        <div className="flex gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            className="flex-1 bg-[#000080] border border-[#00ffff] p-2 text-xs text-white outline-none resize-none font-mono"
            placeholder={lang === 'es' ? "Escribe el prompt a comparar..." : lang === 'de' ? 'Prompt zum Vergleichen eingeben...' : "Type prompt to compare..."}
          />
          <button
            type="button"
            onClick={handleRunComparison}
            disabled={isLoading || !prompt.trim()}
            className="bg-[#ffff55] text-black font-bold px-4 hover:bg-white border-2 border-black flex flex-col items-center justify-center gap-1 disabled:opacity-50 shrink-0"
          >
            <Play className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="text-[10px] uppercase">{isLoading ? (lang === 'es' ? 'EVALUANDO...' : lang === 'de' ? 'AUSWERTUNG...' : 'EVALUATING...') : (lang === 'es' ? 'EJECUTAR' : lang === 'de' ? 'AUSFÜHREN' : 'RUN')}</span>
          </button>
        </div>
      </div>

      {/* Comparison Split Outputs */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-2 overflow-hidden">
        {/* Column A Output */}
        <div className="bg-[#0000aa] border-2 border-[#00ffff] p-2 flex flex-col min-h-0 overflow-hidden">
          <div className="bg-[#000080] border-b border-[#00ffff] px-2 py-1 flex items-center justify-between text-[11px] shrink-0 mb-1">
            <span className="font-bold text-[#00ffff] truncate">{modelObjA?.name || modelA}</span>
            <div className="flex items-center gap-2 text-[10px]">
              {resultA.latencyMs && (
                <span className="text-[#ffff55] flex items-center gap-0.5">
                  <Clock className="w-3 h-3" /> {resultA.latencyMs}ms
                </span>
              )}
              {resultA.tokens && (
                <span className="text-[#00ffff] flex items-center gap-0.5">
                  <Zap className="w-3 h-3" /> ~{resultA.tokens} tokens
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-[#000080] p-3 border border-[#00aaaa]">
            {isLoading && !resultA.text ? (
              <div className="flex items-center justify-center h-full text-[#ffff55] animate-pulse">
                {lang === 'es' ? `Procesando en ${modelObjA?.name}...` : lang === 'de' ? `Verarbeitung mit ${modelObjA?.name}...` : `Processing on ${modelObjA?.name}...`}
              </div>
            ) : resultA.text ? (
              <MarkdownRenderer content={resultA.text} />
            ) : (
              <div className="text-gray-400 text-center py-10">
                {lang === 'es' ? 'Presiona "EJECUTAR" para comparar la respuesta de este modelo.' : lang === 'de' ? 'Klicke auf "RUN", um die Antwort dieses Modells zu vergleichen.' : 'Click "RUN" to compare this model\'s response.'}
              </div>
            )}
          </div>
        </div>

        {/* Column B Output */}
        <div className="bg-[#0000aa] border-2 border-[#00ffff] p-2 flex flex-col min-h-0 overflow-hidden">
          <div className="bg-[#000080] border-b border-[#00ffff] px-2 py-1 flex items-center justify-between text-[11px] shrink-0 mb-1">
            <span className="font-bold text-[#ffff55] truncate">{modelObjB?.name || modelB}</span>
            <div className="flex items-center gap-2 text-[10px]">
              {resultB.latencyMs && (
                <span className="text-[#ffff55] flex items-center gap-0.5">
                  <Clock className="w-3 h-3" /> {resultB.latencyMs}ms
                </span>
              )}
              {resultB.tokens && (
                <span className="text-[#00ffff] flex items-center gap-0.5">
                  <Zap className="w-3 h-3" /> ~{resultB.tokens} tokens
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-[#000080] p-3 border border-[#00aaaa]">
            {isLoading && !resultB.text ? (
              <div className="flex items-center justify-center h-full text-[#ffff55] animate-pulse">
                {lang === 'es' ? `Procesando en ${modelObjB?.name}...` : lang === 'de' ? `Verarbeitung mit ${modelObjB?.name}...` : `Processing on ${modelObjB?.name}...`}
              </div>
            ) : resultB.text ? (
              <MarkdownRenderer content={resultB.text} />
            ) : (
              <div className="text-gray-400 text-center py-10">
                {lang === 'es' ? 'Presiona "EJECUTAR" para comparar la respuesta de este modelo.' : lang === 'de' ? 'Klicke auf "RUN", um die Antwort dieses Modells zu vergleichen.' : 'Click "RUN" to compare this model\'s response.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
