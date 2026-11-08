import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { ParameterConfig, ProviderType } from '../types/studio';
import { Language } from '../i18n/translations';
import { copyTextToClipboard } from '../utils/clipboard';

export interface FreeformPlaygroundProps {
  parameters: ParameterConfig;
  setParameters: React.Dispatch<React.SetStateAction<ParameterConfig>>;
  selectedModel: string;
  selectedProvider: ProviderType;
  isGenerating: boolean;
  onExecute: (promptText: string) => Promise<string | undefined>;
  lang?: Language;
}

export const FreeformPlayground: React.FC<FreeformPlaygroundProps> = ({
  selectedModel,
  isGenerating,
  onExecute,
  lang = 'es',
}) => {
  const [promptText, setPromptText] = useState(
    'Escribe una guía paso a paso para crear un software ejecutable (.exe) de Windows y app Android utilizando un modelo local de Hugging Face y React.'
  );
  const [outputResult, setOutputResult] = useState('');
  const [copied, setCopied] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);

  const handleEnhancePrompt = async () => {
    if (!promptText.trim() || isEnhancing) return;
    setIsEnhancing(true);
    try {
      const systemInstruction = `Eres un Ingeniero Principal de Prompts. Toma el prompt del usuario y transfórmalo en un prompt optimizado, claro y estructurado para modelos de lenguaje. Devuelve ÚNICAMENTE el prompt mejorado final.`;
      
      const response = await fetch('/api/gemini/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: promptText,
          systemInstruction,
          model: selectedModel,
          parameters: { temperature: 0.4, topP: 0.9, maxTokens: 1024 },
        }),
      });

      if (!response.ok) throw new Error('Error optimizando prompt');
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let enhancedResult = '';
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '').trim();
              if (dataStr === '[DONE]') break;
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.error) throw new Error(parsed.error);
                if (parsed.text) {
                  enhancedResult += parsed.text;
                }
              } catch (e: any) {
                if (e.message && !e.message.includes('JSON')) {
                  throw e;
                }
              }
            }
          }
        }
      }

      if (enhancedResult.trim()) {
        setPromptText(enhancedResult.trim());
      }
    } catch (error) {
      console.error('Error enhancing prompt:', error);
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleRun = async () => {
    if (!promptText.trim() || isGenerating) return;
    const res = await onExecute(promptText);
    if (res) setOutputResult(res);
  };

  const handleCopy = async () => {
    if (!(await copyTextToClipboard(outputResult))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col bg-[var(--nc-bg-main)] font-mono text-xs text-[var(--nc-text)] p-2 overflow-hidden select-text">
      {/* Top Banner */}
      <div className="bg-[var(--nc-header-bg)] text-black font-bold px-3 py-1 flex items-center justify-between border-2 border-black shrink-0">
        <div className="flex items-center gap-2">
          <span>╔═ NC EDITOR: PROMPT.TXT ═╗</span>
          <span className="bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)] px-2 py-0.2 border border-white text-[10px]">
            {lang === 'es' ? 'MODELO:' : lang === 'de' ? 'MODELL:' : 'MODEL:'} {selectedModel}
          </span>
        </div>

        <button
          onClick={handleRun}
          disabled={isGenerating || !promptText.trim()}
          className="bg-[var(--nc-active-bg)] text-black font-bold px-3 py-0.5 border border-black hover:bg-white text-xs"
        >
          {isGenerating ? (lang === 'es' ? '[PROCESANDO...]' : lang === 'de' ? '[VERARBEITUNG...]' : '[PROCESSING...]') : (lang === 'es' ? '[EJECUTAR PROMPT (F2)]' : lang === 'de' ? '[PROMPT AUSFÜHREN (F2)]' : '[RUN PROMPT (F2)]')}
        </button>
      </div>

      {/* Editor Canvas Grid */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 my-2 overflow-hidden">
        {/* Left Text Area Input */}
        <div className="border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] p-3 flex flex-col space-y-2 overflow-hidden">
          <div className="bg-[var(--nc-header-bg)] text-black font-bold px-2 py-0.5 flex justify-between items-center">
            <span>{lang === 'es' ? 'ENTRADA DEL PROMPT' : lang === 'de' ? 'PROMPT-EINGABE' : 'PROMPT INPUT'}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleEnhancePrompt}
                disabled={!promptText.trim() || isEnhancing}
                className="bg-[var(--nc-active-bg)] text-black px-2 py-0.2 border border-black hover:bg-white text-[10px] font-bold flex items-center gap-1"
                title="Enhance Prompt AI"
              >
                <Sparkles className="w-3 h-3 text-[var(--nc-active-text)]" />
                <span>{isEnhancing ? (lang === 'es' ? 'OPTIMIZANDO...' : lang === 'de' ? 'VERBESSERE...' : 'ENHANCING...') : (lang === 'es' ? '✨ MEJORAR PROMPT' : lang === 'de' ? '✨ PROMPT VERBESSERN' : '✨ ENHANCE PROMPT')}</span>
              </button>
              <span>{promptText.length} CHARS</span>
            </div>
          </div>

          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            className="flex-1 bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] p-3 text-xs text-[#ffffff] font-mono outline-none resize-none leading-relaxed"
            placeholder={lang === 'es' ? "Escribe tu prompt aquí..." : lang === 'de' ? 'Gib deinen Prompt hier ein...' : "Type your prompt here..."}
          />
        </div>

        {/* Right Output Area */}
        <div className="border-2 border-[var(--nc-text-accent)] bg-[var(--nc-bg-panel)] p-3 flex flex-col space-y-2 overflow-hidden">
          <div className="bg-[var(--nc-active-bg)] text-black font-bold px-2 py-0.5 flex justify-between">
            <span>{lang === 'es' ? 'RESULTADO GENERADO' : lang === 'de' ? 'ERZEUGTE AUSGABE' : 'GENERATED OUTPUT'}</span>
            {outputResult && (
              <button onClick={handleCopy} className="bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)] px-1.5 text-[10px]">
                {copied ? (lang === 'es' ? '[COPIADO]' : lang === 'de' ? '[KOPIERT]' : '[COPIED]') : (lang === 'es' ? '[COPIAR]' : lang === 'de' ? '[KOPIEREN]' : '[COPY]')}
              </button>
            )}
          </div>

          <div className="flex-1 bg-[var(--nc-bg-main)] border border-[var(--nc-text-accent)] p-3 text-xs text-[var(--nc-text)] font-mono overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
            {isGenerating ? (
              <div className="text-[var(--nc-text-accent)] animate-pulse">
                ► {lang === 'es' ? 'PROCESANDO TENSORES EN MOTOR COMMANDER...' : lang === 'de' ? 'TENSOREN WERDEN IN DER COMMANDER-ENGINE VERARBEITET...' : 'PROCESSING TENSORS IN COMMANDER ENGINE...'}
              </div>
            ) : outputResult ? (
              outputResult
            ) : (
              <div className="text-gray-400 text-center py-12">
                {lang === 'es' ? 'Haz clic en [EJECUTAR PROMPT] para ver los resultados aquí...' : lang === 'de' ? 'Klicke auf [PROMPT AUSFÜHREN], um die erzeugte Ausgabe hier zu sehen...' : 'Click [RUN PROMPT] to view generated output here...'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
