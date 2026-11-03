import React, { useState, useEffect } from 'react';
import { ParameterConfig } from '../types/studio';
import { Zap, Coins, Database } from 'lucide-react';

export const TokenCounter: React.FC<{
  inputText: string;
  parameters: ParameterConfig;
  selectedModel: string;
}> = ({ inputText, parameters, selectedModel }) => {
  const [tokenCount, setTokenCount] = useState<number>(0);

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/gemini/countTokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: inputText || ' ',
            systemInstruction: parameters.systemInstruction,
            model: selectedModel
          })
        });
        const data = await response.json();
        if (data.success) setTokenCount(data.totalTokens);
      } catch (e) {
        console.error("Token count failed", e);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [inputText, parameters.systemInstruction, selectedModel]);

  const isPro = selectedModel.includes('pro');
  const pricePer1k = isPro ? 0.00125 : 0.00015;
  const cost = ((tokenCount / 1000) * pricePer1k).toFixed(6);
  const isCacheable = tokenCount >= 32768;

  return (
    <div className="text-[10px] font-mono px-2 py-1 bg-[var(--nc-bg-main)] border border-[var(--nc-border-mid)] flex flex-wrap items-center justify-between gap-2 text-[var(--nc-text)] select-none">
      <div className="flex items-center gap-3">
        <span className="font-bold text-white flex items-center gap-1">
          <Zap className="w-3 h-3 text-[var(--nc-text-accent)]" />
          Tokens: <span className="text-[var(--nc-text-accent)] font-bold">{tokenCount.toLocaleString()}</span>
        </span>

        <span className="flex items-center gap-1 text-[var(--nc-text)]">
          <Coins className="w-3 h-3 text-green-400" />
          Costo Est.: <span className="text-green-400 font-bold">${cost} USD</span>
        </span>
      </div>

      <div className="flex items-center gap-2 text-[9px]">
        {isCacheable && (
          <span className="bg-[var(--nc-active-bg)] text-black font-bold px-1.5 py-0.2 rounded border border-white flex items-center gap-1">
            <Database className="w-2.5 h-2.5" /> CACHÉ DE CONTEXTO ACTIVO (-75% COSTO)
          </span>
        )}
        <span className="text-[var(--nc-text-accent)] opacity-80">
          Límite: {isPro ? '2,000,000' : '1,000,000'} ctx
        </span>
      </div>
    </div>
  );
};
