import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, CheckCircle2, AlertTriangle, ExternalLink, Loader2, Shield } from 'lucide-react';
import { Language } from '../../i18n/translations';

const PROVIDER_SPECS = [
  { id: 'google', name: 'Google Gemini', requires: ['apiKey'], optional: ['defaultModel'], testEndpoint: '/api/test-key?provider=google' },
  { id: 'anthropic', name: 'Anthropic Claude', requires: ['apiKey'], optional: ['defaultModel'], testEndpoint: '/api/test-key?provider=anthropic' },
  { id: 'huggingface', name: 'Hugging Face', requires: ['apiToken'], optional: ['defaultModel', 'device', 'quantization'], testEndpoint: '/api/test-key?provider=huggingface' },
  { id: 'ollama', name: 'Ollama (Local)', requires: ['host'], optional: ['defaultModel'], testEndpoint: '/api/ollama/health' },
  { id: 'openrouter', name: 'OpenRouter', requires: ['apiKey'], optional: ['defaultModel'], testEndpoint: '/api/test-key?provider=openrouter' },
  { id: 'pollinations', name: 'Pollinations (Free)', requires: [], optional: ['defaultModel'], testEndpoint: null },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', requires: ['baseUrl'], optional: ['apiKey', 'defaultModel'], testEndpoint: '/api/custom/models' },
  { id: 'xai', name: 'xAI Grok', requires: ['apiKey'], optional: ['defaultModel'], testEndpoint: '/api/test-key?provider=xai' },
] as const;

type ProviderId = typeof PROVIDER_SPECS[number]['id'];

interface ProviderConfig {
  id: ProviderId;
  apiKey?: string;
  apiToken?: string;
  host?: string;
  baseUrl?: string;
  defaultModel?: string;
  device?: 'webgpu' | 'wasm' | 'cpu';
  quantization?: 'q4' | 'q8' | 'fp16' | 'fp32';
}

interface ProviderManagerProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: Language;
}

export const ProviderManager: React.FC<ProviderManagerProps> = ({ isOpen, onClose, lang = 'es' }) => {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const t = useCallback((es: string, en: string, de: string) => lang === 'es' ? es : lang === 'de' ? de : en, [lang]);

  const loadProviders = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/providers', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setProviders(data.providers || []);
      } else {
        setError(data.error || t('Error cargando proveedores', 'Error loading providers', 'Fehler beim Laden der Anbieter'));
      }
    } catch (e: any) {
      setError(e?.message || t('Error de red', 'Network error', 'Netzwerkfehler'));
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) loadProviders();
  }, [isOpen, loadProviders]);

  const saveProvider = async (id: ProviderId, config: Partial<ProviderConfig>) => {
    setError('');
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, config, target: 'project' }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        loadProviders();
      } else {
        setError(data.error || t('Error guardando', 'Error saving', 'Fehler beim Speichern'));
      }
    } catch (e: any) {
      setError(e?.message || t('Error de red', 'Network error', 'Netzwerkfehler'));
    }
  };

  const removeProvider = async (id: ProviderId) => {
    setError('');
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        loadProviders();
      } else {
        setError(data.error || t('Error eliminando', 'Error deleting', 'Fehler beim Löschen'));
      }
    } catch (e: any) {
      setError(e?.message || t('Error de red', 'Network error', 'Netzwerkfehler'));
    }
  };

  const testProvider = async (id: ProviderId, config: ProviderConfig) => {
    setTesting(prev => ({ ...prev, [id]: true }));
    setTestResults(prev => ({ ...prev, [id]: { ok: false, message: t('Probando...', 'Testing...', 'Teste...') } }));
    try {
      const spec = PROVIDER_SPECS.find(s => s.id === id);
      if (!spec?.testEndpoint) {
        setTestResults(prev => ({ ...prev, [id]: { ok: true, message: t('Sin test automático (gratis)', 'No auto-test (free)', 'Kein Auto-Test (kostenlos)') } }));
        setTesting(prev => ({ ...prev, [id]: false }));
        return;
      }
      let url = spec.testEndpoint;
      if (spec.id === 'ollama') url += `?host=${encodeURIComponent(config.host || 'http://localhost:11434')}`;
      if (spec.id === 'custom' && config.baseUrl) url += `?baseURL=${encodeURIComponent(config.baseUrl)}&apiKey=${encodeURIComponent(config.apiKey || '')}`;
      
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      const ok = res.ok && (data.success || data.healthy);
      setTestResults(prev => ({ ...prev, [id]: { ok, message: ok ? t('Conexión OK', 'Connection OK', 'Verbindung OK') : (data.error || data.details || t('Falló', 'Failed', 'Fehlgeschlagen')) } }));
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [id]: { ok: false, message: e?.message || t('Error de red', 'Network error', 'Netzwerkfehler') } }));
    } finally {
      setTesting(prev => ({ ...prev, [id]: false }));
    }
  };

  const getConfigured = (id: ProviderId) => providers.find(p => p.id === id);

  const renderConfigInput = (id: ProviderId, field: string, value: string, onChange: (v: string) => void, label: string, type: 'text' | 'password' | 'url' = 'text') => {
    const spec = PROVIDER_SPECS.find(s => s.id === id)!;
    const required = (spec.requires as readonly string[]).includes(field);
    return (
      <div key={field} className="flex items-center gap-2">
        <label className="text-[10px] text-[#00ffff] w-20 font-bold">{label}:</label>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 bg-[#000080] border border-[#00ffff]/40 text-[#00ffff] text-xs px-2 py-1 font-mono outline-none"
          placeholder={required ? t('Requerido', 'Required', 'Erforderlich') : t('Opcional', 'Optional', 'Optional')}
        />
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[90vw] max-w-2xl max-h-[85vh] flex flex-col nc-panel border-2 border-[#00ffff] bg-[#000044]">
        <div className="flex items-center justify-between px-3 py-2 border-b-2 border-[#00ffff] bg-[#00aaaa]">
          <span className="text-black font-bold text-sm">{t('Gestionar Proveedores', 'Manage Providers', 'Anbieter verwalten')}</span>
          <button onClick={onClose} className="text-black hover:text-red-600 font-bold">X</button>
        </div>

        <div className="flex-1 overflow-auto p-3 min-h-0">
          {error && <div className="mb-3 p-2 text-red-400 text-[10px] border border-red-400/40 bg-red-400/10">{error}</div>}

          <div className="space-y-3">
            {PROVIDER_SPECS.map(spec => {
              const configured = getConfigured(spec.id);
              const isConfigured = !!configured && spec.requires.every(r => (configured as any)[r]);
              const testResult = testResults[spec.id];
              const isTesting = testing[spec.id];

              return (
                <div key={spec.id} className="border border-[#004466] bg-[#000022] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[#00ffff] font-bold text-sm">{spec.name}</span>
                      {isConfigured && <span title={t('Configurado', 'Configured', 'Konfiguriert')}> <CheckCircle2 className="w-4 h-4 text-green-400" /> </span>}
                      {!isConfigured && spec.requires.length > 0 && <span title={t('Incompleto', 'Incomplete', 'Unvollständig')}> <AlertTriangle className="w-4 h-4 text-yellow-400" /> </span>}
                      {spec.id === 'pollinations' && <span title={t('Gratis - sin API key', 'Free - no API key', 'Kostenlos - kein API Key')}> <Shield className="w-4 h-4 text-[#ffff55]" /> </span>}
                    </div>
                    {!isConfigured ? (
                      <button
                        onClick={() => saveProvider(spec.id, {})}
                        className="nc-button !px-2 !py-1 text-xs font-bold bg-[#ffff55] text-black"
                      >
                        <Plus className="w-3.5 h-3.5" /> {t('Añadir', 'Add', 'Hinzufügen')}
                      </button>
                    ) : (
                      <button
                        onClick={() => removeProvider(spec.id)}
                        className="text-red-400 hover:text-red-300 p-1"
                        title={t('Eliminar', 'Remove', 'Entfernen')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {isConfigured && (
                    <div className="space-y-1.5 ml-1">
                      {spec.requires.map(req => renderConfigInput(spec.id, req, (configured as any)[req] || '', v => saveProvider(spec.id, { ...configured, [req]: v }), req, (String(req) === 'host' || String(req) === 'baseUrl') ? 'url' : 'password'))}
                      {spec.optional.map(opt => renderConfigInput(spec.id, opt, (configured as any)[opt] || '', v => saveProvider(spec.id, { ...configured, [opt]: v }), opt, (String(opt) === 'host' || String(opt) === 'baseUrl') ? 'url' : 'password'))}

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => testProvider(spec.id, configured!)}
                          disabled={isTesting}
                          className="nc-button !px-3 !py-1 text-xs font-bold"
                        >
                          {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                          {t('Test', 'Test', 'Test')}
                        </button>
                        {testResult && (
                          <span className={`text-[10px] ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                            {testResult.message}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProviderManager;