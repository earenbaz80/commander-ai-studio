import { getCachedApiKey } from '../lib/apiKeys';
import { deText } from '../i18n/de';
/**
 * Modal "Configurar LLM local" (accesible desde el grupo Modelos del sidebar).
 *
 * Permite poner o cambiar el servidor al que se conecta el LLM local:
 *  • Ollama (por defecto http://localhost:11434)
 *  • Endpoint OpenAI-compatible (LM Studio, llama.cpp, vLLM…): baseURL + apiKey opcional.
 *
 * Guarda en las MISMAS claves que ya usa el resto de la app
 * (`OLLAMA_HOST`, `CUSTOM_BASE_URL`, `CUSTOM_API_KEY`, `CUSTOM_MODEL`),
 * vía cookies httpOnly (saveApiKey) y con respaldo en localStorage.
 * Incluye "Probar conexión" para listar los modelos que responde el servidor.
 */
import React from 'react';
import { Server, Cpu, PlugZap, CheckCircle2, AlertTriangle, Loader2, Save, Cable, Boxes, Download, Search, Trash2 } from 'lucide-react';
import { Language } from '../i18n/translations';
import { saveApiKey, getApiKey } from '../lib/apiKeys';
import {
  testLocalLlm,
  type LocalLlmRuntime,
  pullOllamaModel,
  type PullProgress,
  POPULAR_OLLAMA_MODELS,
  type OllamaModelInfo,
  checkOllamaHealth,
} from '../utils/localLlmApi';

const OLLAMA_DEFAULT = 'http://localhost:11434';
const OPENAI_DEFAULT = 'http://localhost:1234/v1';

interface LocalLlmModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: Language;
}

export const LocalLlmModal: React.FC<LocalLlmModalProps> = ({ isOpen, onClose, lang = 'es' }) => {
  const [runtime, setRuntime] = React.useState<LocalLlmRuntime>('ollama');
  const [ollamaHost, setOllamaHost] = React.useState(OLLAMA_DEFAULT);
  const [baseUrl, setBaseUrl] = React.useState(OPENAI_DEFAULT);
  const [apiKey, setApiKey] = React.useState('');
  const [model, setModel] = React.useState('');
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; models?: string[]; error?: string } | null>(null);
  const [health, setHealth] = React.useState<{ ok: boolean; models?: string[]; error?: string } | null>(null);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const [autoDetecting, setAutoDetecting] = React.useState(false);
  const [detected, setDetected] = React.useState<{ ollama?: boolean; lmstudio?: boolean; vllm?: boolean } | null>(null);

  // Pull models UI state
  const [pullTab, setPullTab] = React.useState<'popular' | 'installed'>('popular');
  const [pullSearch, setPullSearch] = React.useState('');
  const [pullingModel, setPullingModel] = React.useState<string | null>(null);
  const [pullProgress, setPullProgress] = React.useState<PullProgress | null>(null);

  const t = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);

  // Al abrir: precarga localStorage (respaldo) y luego cookies httpOnly.
  React.useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    try {
      setOllamaHost(getCachedApiKey('OLLAMA_HOST') || OLLAMA_DEFAULT);
      setBaseUrl(getCachedApiKey('CUSTOM_BASE_URL') || OPENAI_DEFAULT);
      setApiKey(getCachedApiKey('CUSTOM_API_KEY') || '');
      setModel(getCachedApiKey('CUSTOM_MODEL') || '');
    } catch {
      /* almacenamiento no disponible */
    }
    setResult(null);
    setSavedFlash(false);
    (async () => {
      const [h, b, k, m] = await Promise.all([
        getApiKey('OLLAMA_HOST'),
        getApiKey('CUSTOM_BASE_URL'),
        getApiKey('CUSTOM_API_KEY'),
        getApiKey('CUSTOM_MODEL'),
      ]);
      if (!alive) return;
      if (h) setOllamaHost(h);
      if (b) setBaseUrl(b);
      if (k) setApiKey(k);
      if (m) setModel(m);
      checkOllamaHealth(h || getCachedApiKey('OLLAMA_HOST') || OLLAMA_DEFAULT).then(setHealth);
    })();
    // Auto-detect running local LLMs
    setAutoDetecting(true);
    (async () => {
      try {
        const checks = await Promise.allSettled([
          fetch('http://localhost:11434/api/tags', { method: 'GET', signal: AbortSignal.timeout(2000) }).then(r => r.ok),
          fetch('http://localhost:1234/v1/models', { method: 'GET', signal: AbortSignal.timeout(2000) }).then(r => r.ok),
          fetch('http://localhost:8000/v1/models', { method: 'GET', signal: AbortSignal.timeout(2000) }).then(r => r.ok),
        ]);
        if (!alive) return;
        const detectedNow = {
          ollama: checks[0].status === 'fulfilled' && checks[0].value === true,
          lmstudio: checks[1].status === 'fulfilled' && checks[1].value === true,
          vllm: checks[2].status === 'fulfilled' && checks[2].value === true,
        };
        setDetected(detectedNow);
        // Auto-switch if current runtime not detected but another is
        if (runtime === 'ollama' && !detectedNow.ollama && (detectedNow.lmstudio || detectedNow.vllm)) {
          setRuntime('openai');
        }
      } catch {
        if (alive) setDetected({ ollama: false, lmstudio: false, vllm: false });
      } finally {
        if (alive) setAutoDetecting(false);
      }
    })();
    return () => {
      alive = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const currentUrl = runtime === 'ollama' ? ollamaHost : baseUrl;

  const runtimeTab = (id: LocalLlmRuntime, labelEs: string, labelEn: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => {
        setRuntime(id);
        setResult(null);
      }}
      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-bold border transition-colors ${
        runtime === id
          ? 'bg-[#00ffff] text-black border-[#00ffff]'
          : 'bg-[#0000aa] text-[#00ffff] border-[#00aaaa]/40 hover:border-[#00ffff]'
      }`}
      aria-pressed={runtime === id}
    >
      {icon}
      {t(labelEs, labelEn)}
    </button>
  );

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    const res = await testLocalLlm(runtime, currentUrl.trim(), apiKey.trim() || undefined);
    setResult(res);
    setTesting(false);
  };

  const handlePullModel = async (modelName: string) => {
    setPullingModel(modelName);
    setPullProgress({ status: 'starting', completed: 0, total: 0 });
    const res = await pullOllamaModel(modelName, ollamaHost, (p) => setPullProgress(p));
    setPullingModel(null);
    setPullProgress(null);
    if (res.ok) {
      // Refresh installed list
      await handleTest();
    } else {
      alert(`${t('Error descargando', 'Pull error')}: ${res.error}`);
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    if (!confirm(`${t('Eliminar modelo', 'Delete model')} "${modelName}"?`)) return;
    try {
      const res = await fetch('/api/ollama/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, host: ollamaHost }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok || data.success) {
        await handleTest();
      } else {
        alert(`${t('Error eliminando', 'Delete error')}: ${data.error || 'Unknown'}`);
      }
    } catch (e: any) {
      alert(`${t('Error eliminando', 'Delete error')}: ${e?.message}`);
    }
  };

  const handleSave = async () => {
    if (runtime === 'ollama') {
      const host = ollamaHost.trim() || OLLAMA_DEFAULT;
      await saveApiKey('OLLAMA_HOST', host);
      try {
        localStorage.setItem('OLLAMA_HOST', host);
      } catch {
        /* ignorar */
      }
    } else {
      const url = baseUrl.trim();
      await saveApiKey('CUSTOM_BASE_URL', url);
      await saveApiKey('CUSTOM_API_KEY', apiKey.trim());
      await saveApiKey('CUSTOM_MODEL', model.trim());
      try {
        localStorage.setItem('CUSTOM_BASE_URL', url);
        localStorage.setItem('CUSTOM_API_KEY', apiKey.trim());
        localStorage.setItem('CUSTOM_MODEL', model.trim());
      } catch {
        /* ignorar */
      }
    }
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  };

  // Tarjeta de modelo para la pestaña "Descargar modelos"
  const ModelPullCard = React.memo(function ModelPullCard({
    model,
    isPulling,
    progress,
    onPullStart,
    t,
  }: {
    model: OllamaModelInfo;
    isPulling: boolean;
    progress: PullProgress | null;
    onPullStart: () => void;
    t: (es: string, en: string) => string;
  }) {
    const pct = progress?.total && progress.completed
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

    return (
      <div className="bg-[#0000aa] border border-[#00ffff]/40 p-2 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[#ffff55] font-bold text-[10px] truncate">{model.name}</span>
              {model.tags?.map((tag) => (
                <span key={tag} className="px-1 py-0.5 text-[8px] bg-[#002200] border border-[#00ffff]/40 text-[#00ffff] rounded">{tag}</span>
              ))}
            </div>
            <div className="text-[9px] text-[#00aaaa] mt-0.5 truncate">{model.description}</div>
            <div className="text-[8px] text-[#00ffff]/50 mt-0.5">{model.size}</div>
          </div>
        </div>

        {isPulling ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[9px] font-mono">
              <span className="text-[#ffff55]">{progress?.status || t('Descargando…', 'Downloading…')}</span>
              <span className="text-[#00ffff]">{pct}%</span>
            </div>
            <div className="bg-[#000045] border border-[#00ffff]/40 h-1.5 rounded overflow-hidden">
              <div
                className="bg-[#00ffff] h-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            {progress?.digest && (
              <div className="text-[8px] text-[#00ffff]/50 font-mono truncate">
                {t('Capa:', 'Layer:')} {progress.digest.slice(0, 12)}…
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onPullStart}
            disabled={isPulling}
            className="w-full bg-[#ffff55] text-black font-bold py-1.5 text-[10px] hover:bg-white flex items-center justify-center gap-1"
            title={t('Descargar este modelo a Ollama', 'Pull this model to Ollama')}
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t('DESCARGAR', 'PULL')}</span>
          </button>
        )}
      </div>
    );
  });

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 font-mono select-none">
      <div className="w-full max-w-md nc-panel border-2 border-[#00ffff] p-5 relative shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">

        {/* Border corner accents */}
        <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[#ffff55] -mt-0.5 -ml-0.5" />
        <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-[#ffff55] -mt-0.5 -mr-0.5" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-[#ffff55] -mb-0.5 -ml-0.5" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-[#ffff55] -mb-0.5 -mr-0.5" />

        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-[#00ffff] pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-[#ffff55] animate-pulse" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">
              {t('── SERVIDOR LLM LOCAL ──', '── LOCAL LLM SERVER ──')}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-red-400 hover:text-white border border-red-500 hover:bg-red-600 px-1.5 py-0.5 text-xs font-bold transition-all"
          >
            [X]
          </button>
        </div>

        {/* Intro */}
        <div className="bg-[#000080] border border-[#00ffff]/40 p-2 text-[10px] text-[#00ffff] mb-3 flex items-start gap-2">
          <Cpu className="w-4 h-4 text-[#ffff55] shrink-0" />
          <p className="leading-tight">
            {t(
              'Configura o cambia el servidor donde corre tu LLM local. Se guarda y lo usan todos los modos de conversación.',
              'Set or change the server where your local LLM runs. It is saved and used by all chat modes.'
            )}
          </p>
        </div>

        {/* Runtime selector */}
        <div className="flex gap-1 mb-3">
          {runtimeTab('ollama', 'Ollama', 'Ollama', <Cable className="w-3.5 h-3.5" />)}
          {runtimeTab(
            'openai',
            'OpenAI-compatible',
            'OpenAI-compatible',
            <PlugZap className="w-3.5 h-3.5" />
          )}
        </div>

        {/* Auto-detection status */}
        {detected && (
          <div className="flex flex-wrap gap-1 mb-3 text-[9px] font-mono">
            {autoDetecting && <span className="text-[#ffff55] animate-pulse">{t('🔍 Detectando servidores…', '🔍 Detecting servers…')}</span>}
            {!autoDetecting && (
              <>
                {detected.ollama && <span className="px-2 py-0.5 bg-[#002200] border border-[#00aa00] text-[#00ff00] rounded">✅ Ollama (11434)</span>}
                {detected.lmstudio && <span className="px-2 py-0.5 bg-[#002200] border border-[#00aa00] text-[#00ff00] rounded">✅ LM Studio (1234)</span>}
                {detected.vllm && <span className="px-2 py-0.5 bg-[#002200] border border-[#00aa00] text-[#00ff00] rounded">✅ vLLM (8000)</span>}
                {!detected.ollama && !detected.lmstudio && !detected.vllm && <span className="px-2 py-0.5 bg-[#220000] border border-[#aa0000] text-[#ff0000] rounded">{t('❌ Ningún servidor detectado', '❌ No servers detected')}</span>}
              </>
            )}
          </div>
        )}

        {/* Pull Models Tab (solo Ollama) */}
        {runtime === 'ollama' && detected?.ollama && (
          <div className="mb-3 border border-[#00ffff]/40 bg-[#000080] rounded overflow-hidden">
            {/* Tab buttons */}
            <div className="flex border-b border-[#00ffff]/40 bg-[#0000aa]">
              <button
                type="button"
                onClick={() => setPullTab('popular')}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-bold border-r border-[#00ffff]/40 transition-colors ${
                  pullTab === 'popular'
                    ? 'bg-[#00ffff] text-black'
                    : 'bg-[#0000aa] text-[#00ffff] hover:bg-[#0000cc]'
                }`}
                aria-pressed={pullTab === 'popular'}
              >
                <Download className="w-3 h-3" />
                {t('Descargar modelos', 'Pull Models')}
              </button>
              <button
                type="button"
                onClick={() => { setPullTab('installed'); handleTest(); }}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-bold transition-colors ${
                  pullTab === 'installed'
                    ? 'bg-[#00ffff] text-black'
                    : 'bg-[#0000aa] text-[#00ffff] hover:bg-[#0000cc]'
                }`}
                aria-pressed={pullTab === 'installed'}
              >
                <Boxes className="w-3 h-3" />
                {t('Instalados', 'Installed')}
              </button>
            </div>

            {/* Popular models tab */}
            {pullTab === 'popular' && (
              <div className="p-3 space-y-2 max-h-[300px] overflow-y-auto">
                <div className="flex gap-1 mb-2">
                  <Search className="w-3.5 h-3.5 text-[#00ffff]/70 mt-1 shrink-0" />
                  <input
                    type="text"
                    value={pullSearch}
                    onChange={(e) => setPullSearch(e.target.value)}
                    placeholder={t('Buscar modelo (ej: coder, reasoning, tiny…)', 'Search model (e.g. coder, reasoning, tiny…)')}

                    spellCheck={false}
                    className="flex-1 bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1.5 text-[11px] font-mono outline-none focus:border-[#00ffff]"
                  />
                </div>
                <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                  {POPULAR_OLLAMA_MODELS
                    .filter((m) =>
                      pullSearch === '' ||
                      m.name.toLowerCase().includes(pullSearch.toLowerCase()) ||
                      m.description.toLowerCase().includes(pullSearch.toLowerCase()) ||
                      m.tags?.some((tag) => tag.toLowerCase().includes(pullSearch.toLowerCase()))
                    )
                    .map((m) => (
                      <ModelPullCard
                        key={m.name}
                        model={m}
                        isPulling={pullingModel === m.name}
                        progress={pullingModel === m.name ? pullProgress : null}
                        onPullStart={() => handlePullModel(m.name)}
                        t={t}
                      />
                    ))}
                </div>
              </div>
            )}

            {/* Installed models tab */}
            {pullTab === 'installed' && result?.ok && result.models && (
              <div className="p-3 space-y-2 max-h-[300px] overflow-y-auto">
                {result.models.length === 0 ? (
                  <p className="text-[10px] text-[#00ffff]/60 text-center py-4">
                    {t('No hay modelos instalados. Usa la pestaña "Descargar modelos" para añadir.', 'No models installed. Use "Pull Models" tab to add.')}
                  </p>
                ) : (
                  result.models.map((m: string) => (
                    <div
                      key={m}
                      className="flex items-center justify-between bg-[#0000aa] border border-[#00ffff]/40 px-2 py-1.5 text-[10px] font-mono"
                    >
                      <span className="text-[#00ffff] truncate max-w-[200px]">{m}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteModel(m)}
                        className="text-[#ff5555] hover:text-white px-1.5 py-0.5 text-[9px] border border-[#ff5555]/40 rounded"
                        title={t('Eliminar modelo', 'Delete model')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Fields */}
        <div className="space-y-2">
          {runtime === 'ollama' ? (
            <div>
              <label className="text-[10px] text-[#ffff55] font-bold uppercase flex items-center gap-1 mb-1">
                <Cable className="w-3 h-3" /> {t('Servidor Ollama', 'Ollama server')}
              </label>
              <input
                value={ollamaHost}
                onChange={(e) => setOllamaHost(e.target.value)}
                placeholder="http://localhost:11434"
                spellCheck={false}
                className="w-full bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1.5 text-[11px] font-mono outline-none focus:border-[#00ffff]"
              />
              <p className="text-[9px] text-[#00aaaa] mt-1">
                {t(
                  'Modelos gratis en tu máquina. Ej.: ollama pull llama3.2',
                  'Free models on your machine. E.g.: ollama pull llama3.2'
                )}
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="text-[10px] text-[#ffff55] font-bold uppercase flex items-center gap-1 mb-1">
                  <PlugZap className="w-3 h-3" /> {t('Base URL (OpenAI-compatible)', 'Base URL (OpenAI-compatible)')}
                </label>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:1234/v1"
                  spellCheck={false}
                  className="w-full bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1.5 text-[11px] font-mono outline-none focus:border-[#00ffff]"
                />
                <p className="text-[9px] text-[#00aaaa] mt-1">
                  {t(
                    'LM Studio, llama.cpp, vLLM, oMLX… (termina en /v1).',
                    'LM Studio, llama.cpp, vLLM, oMLX… (ends in /v1).'
                  )}
                </p>
              </div>
              <div>
                <label className="text-[10px] text-[#00ffff] uppercase font-bold mb-1 block">
                  {t('Modelo', 'Model')}
                </label>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="llama-3.1-8b"
                  spellCheck={false}
                  className="w-full bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1.5 text-[11px] font-mono outline-none focus:border-[#00ffff]"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#00ffff] uppercase font-bold mb-1 block">
                  {t('API key (opcional)', 'API key (optional)')}
                </label>
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  type="password"
                  placeholder=""
                  autoComplete="off"
                  className="w-full bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-1.5 text-[11px] font-mono outline-none focus:border-[#00ffff] placeholder:text-[#00ffff]/20"
                />
              </div>
            </>
          )}
        </div>

        {/* Test connection */}
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={handleTest}
            disabled={testing || !currentUrl.trim()}
            className="nc-button flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] bg-[#000080] text-[#00ffff] border border-[#00ffff] font-bold hover:text-white disabled:opacity-40"
            title={t('Probar conexión', 'Test connection')}
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cable className="w-3.5 h-3.5" />}
            {testing ? t('Probando…', 'Testing…') : t('Probar conexión', 'Test connection')}
          </button>
          <button
            onClick={handleSave}
            className="nc-button flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] bg-[#00ffff] text-black font-bold hover:bg-white"
            title={t('Guardar configuración', 'Save configuration')}
          >
            <Save className="w-3.5 h-3.5" />
            {t('Guardar', 'Save')}
          </button>
        </div>

        {/* Health real (endpoint backend) */}
        {health && (
          <div className={`mt-2 text-[10px] p-1.5 border ${health.ok ? 'border-green-500/60 bg-[#002200] text-green-300' : 'border-red-500/60 bg-[#220000] text-red-300'}`}>
            <span className="font-bold">{health.ok ? t('Backend saludable', 'Backend healthy') : t('Backend no disponible', 'Backend unavailable')}</span>
            {health.models && health.models.length > 0 ? ` (${health.models.length} ${t('modelos', 'models')})` : ''}
            {health.error ? ` ⚠ ${health.error}` : ''}
          </div>
        )}

        {/* Result */}
        {result &&
          (result.ok ? (
            <div className="mt-3 bg-[#003300] border border-[#00ff00]/50 text-[#88ff88] p-2 text-[10px] leading-relaxed">
              <div className="flex items-center gap-1.5 font-bold mb-1">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                {t('¡Conexión exitosa!', 'Connection successful!')}
              </div>
              {(result.models?.length || 0) > 0 ? (
                <div className="flex items-start gap-1.5">
                  <Boxes className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>
                    {t(
                      `${result.models!.length} modelo(s) detectado(s):`,
                      `${result.models!.length} model(s) found:`
                    )}
                    <span className="block mt-0.5 text-[#ffff55] max-h-16 overflow-y-auto">
                      {result.models!.slice(0, 12).join(' · ')}
                      {(result.models!.length || 0) > 12 ? ' …' : ''}
                    </span>
                  </span>
                </div>
              ) : (
                <span>{t('El servidor respondió pero no listó modelos.', 'Server responded but listed no models.')}</span>
              )}
            </div>
          ) : (
            <div className="mt-3 bg-[#330000] border border-[#ff5555]/50 text-[#ff8888] p-2 text-[10px] flex items-start gap-1.5 leading-relaxed">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{result.error || t('No se pudo conectar', 'Could not connect')}</span>
            </div>
          ))}

        {savedFlash && (
          <div className="mt-3 bg-[#003300] border border-[#00ff00]/50 text-[#88ff88] p-1.5 text-[10px] flex items-center gap-1.5 animate-in fade-in duration-150">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            {t(
              '✓ Configuración guardada. Ya la usa el chat.',
              '✓ Configuration saved. It is now used by chat.'
            )}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-4 text-[9px] text-[#00aaaa] uppercase font-mono tracking-wider pt-2 border-t border-[#000055]">
          {t('COMMANDER AI STUDIO - LLM LOCAL', 'COMMANDER AI STUDIO - LOCAL LLM')}
        </div>
      </div>
    </div>
  );
};

export default LocalLlmModal;