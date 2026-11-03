import React, { useEffect, useState } from 'react';
import { saveApiKey, getApiKey } from '../lib/apiKeys';
import { Key, CheckCircle, XCircle } from 'lucide-react';

interface ApiKeyInputProps {
  provider: 'google' | 'xai' | 'anthropic' | 'huggingface' | 'openrouter';
  onSave: (key: string) => void;
}

export const ApiKeyInput: React.FC<ApiKeyInputProps> = ({ provider, onSave }) => {
  const storageKey = provider === 'google' 
    ? 'GEMINI_API_KEY' 
    : provider === 'anthropic'
    ? 'ANTHROPIC_API_KEY'
    : provider === 'huggingface'
    ? 'HF_API_TOKEN'
    : provider === 'openrouter'
    ? 'OPENROUTER_API_KEY'
    : 'XAI_API_KEY';
  const providerLabel = provider === 'google' 
    ? 'GOOGLE GEMINI' 
    : provider === 'anthropic' 
    ? 'ANTHROPIC CLAUDE' 
    : provider === 'huggingface'
    ? 'HUGGING FACE (ROUTER)'
    : provider === 'openrouter'
    ? 'OPENROUTER (GRATIS)'
    : 'XAI GROK';
  const placeholderText = provider === 'google' 
    ? 'Google Gemini API Key' 
    : provider === 'anthropic'
    ? 'Anthropic Claude API (sk-ant-...)'
    : provider === 'huggingface'
    ? 'Hugging Face Token opcional (hf_...)'
    : provider === 'openrouter'
    ? 'OpenRouter Key gratuita (sk-or-...)'
    : 'xAI Grok API Key';

  const [key, setKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error' | 'saved'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // Carga la key existente desde la cookie httpOnly (nunca accesible desde JS en crudo)
  useEffect(() => {
    let cancelled = false;
    getApiKey(storageKey).then((v) => {
      if (!cancelled && v) setKey(v);
    });
    return () => { cancelled = true; };
  }, [storageKey]);

  const testConnection = async () => {
    const cleanKey = key.trim();
    if (!cleanKey) return;
    setStatus('testing');
    setErrorMessage('');
    try {
      const response = await fetch('/api/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key: cleanKey }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(data.error || 'Error de autenticación con el proveedor.');
      }
    } catch (e: any) {
      setStatus('error');
      setErrorMessage(
        e.message?.includes('Failed to fetch')
          ? 'No se puede comunicar con el servidor backend (/api/test-key). Asegúrate de que el servidor esté activo.'
          : (e.message || 'Error de conexión de red')
      );
    }
  };

  const saveKey = async () => {
    const cleanKey = key.trim();
    if (!cleanKey) return;
    const ok = await saveApiKey(storageKey, cleanKey);
    if (ok) {
      // No almacenamos en localStorage; el backend emite la cookie httpOnly
      onSave(cleanKey);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 3000);
    } else {
      setStatus('error');
      setErrorMessage('No se pudo guardar la clave en el servidor backend.');
    }
  };

  return (
    <div className="bg-[var(--nc-bg-panel)] border border-[var(--nc-border-light)] p-2 space-y-2">
      <label className="text-[10px] font-bold text-[var(--nc-text-accent)] flex items-center gap-1">
        <Key size={10} /> API KEY ({providerLabel}):
      </label>
      <input
        type="password"
        value={key}
        onChange={(e) => { setKey(e.target.value); setStatus('idle'); setErrorMessage(''); }}
        className="w-full bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-[10px] text-white p-1 outline-none"
        placeholder={`Ingresa tu clave ${placeholderText}`}
      />
      <div className="flex gap-1">
        <button 
          type="button"
          onClick={testConnection}
          disabled={status === 'testing' || !key.trim()}
          className="flex-1 bg-[var(--nc-header-bg)] text-black text-[10px] font-bold py-1 hover:bg-[var(--nc-highlight-bg)] transition-colors disabled:opacity-50"
        >
          {status === 'testing' ? 'PROBANDO...' : 'PROBAR'}
        </button>
        <button 
          type="button"
          onClick={saveKey}
          disabled={!key.trim()}
          className="flex-1 bg-[var(--nc-highlight-bg)] text-black text-[10px] font-bold py-1 disabled:opacity-50 hover:bg-white transition-colors"
        >
          GUARDAR
        </button>
      </div>
      {status === 'success' && <div className="text-[10px] text-green-400 flex items-center gap-1 font-bold"><CheckCircle size={10} /> Conexión exitosa y clave válida</div>}
      {status === 'saved' && <div className="text-[10px] text-[var(--nc-text-accent)] flex items-center gap-1 font-bold"><CheckCircle size={10} /> Clave guardada correctamente en sesión local</div>}
      {status === 'error' && (
        <div className="text-[10px] text-red-400 flex flex-col gap-0.5 bg-red-950/40 p-1 border border-red-500/50">
          <div className="flex items-center gap-1 font-bold">
            <XCircle size={10} /> {providerLabel}: No se pudo validar
          </div>
          {errorMessage && (
            <div className="text-[9px] text-red-200 pl-3 leading-tight break-words">
              {errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
