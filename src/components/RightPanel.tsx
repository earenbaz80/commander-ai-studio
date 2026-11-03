import React, { useCallback, useState, useEffect, useRef } from 'react';
import { 
  Sliders, 
  FileJson, 
  Terminal,
  Globe,
  Wrench,
  Database,
  X,
  Server,
  Settings,
  ArrowUp,
  ArrowDown,
  FlaskConical,
} from 'lucide-react';
import { saveApiKey } from '../lib/apiKeys';
import { ApiKeyInput } from './ApiKeyInput';
import { JsonSchemaModal } from './JsonSchemaModal';
import { FunctionCallingModal } from './FunctionCallingModal';
import { DatasetFineTuningModal } from './DatasetFineTuningModal';
import { ProviderManager } from './panel/ProviderManager';
import { ParameterConfig, ProviderType, StudioMode } from '../types/studio';
import { useModelsCatalog } from '../data/modelsLoader';
import { Language, TRANSLATIONS } from '../i18n/translations';
import { MAX_FALLBACK_MODELS } from '../config/geminiModels';
import { addModel, moveModel } from '../lib/fallbackChain';
import { probeFirstResponder, probeModel, type ChainProbeResult } from '../lib/modelProbe';
import { SYSTEM_PRESETS } from '../data/systemPresets';

interface RightPanelProps {
  parameters: ParameterConfig;
  setParameters: React.Dispatch<React.SetStateAction<ParameterConfig>>;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  selectedProvider: ProviderType;
  setSelectedProvider: (provider: ProviderType) => void;
  setMode: (mode: StudioMode) => void;
  onShowCodeModal: () => void;
  onSaveVersion: (title: string, note?: string) => Promise<void>;
  onViewHistory: () => void;
  onClose?: () => void;
  lang?: Language;
  showTooltips?: boolean;
  onOpenHelp?: () => void;
  onOpenAbout?: () => void;
  onOpenCompile?: () => void;
  /** Abre el modal de configuración del LLM local (Ollama / OpenAI-compatible). */
  onOpenLocalLlmConfig?: () => void;
  /** Ancho inicial del panel (px) */
  initialWidth?: number;
  /** Callback cuando cambia el ancho del panel (px) */
  onWidthChange?: (width: number) => void;
}

export const RightPanel: React.FC<RightPanelProps> = ({
  parameters,
  setParameters,
  selectedModel,
  setSelectedModel,
  selectedProvider,
  setSelectedProvider,
  onShowCodeModal,
  onSaveVersion,
  onViewHistory,
  onClose,
  lang = 'es',
  showTooltips = true,
  onOpenLocalLlmConfig,
  initialWidth = 320,
  onWidthChange,
}) => {
  const t = TRANSLATIONS[lang];
  /** Tres idiomas en una línea: las etiquetas nuevas no necesitan su ternario. */
  const tx = (es: string, de: string, en: string) => (lang === 'es' ? es : lang === 'de' ? de : en);
  /** Sección visible: las tres son el mismo sitio de ajustes. */
  const [settingsTab, setSettingsTab] = useState<'modelo' | 'parametros' | 'instrucciones'>('modelo');
  const [showSafety, setShowSafety] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
  const [isFunctionModalOpen, setIsFunctionModalOpen] = useState(false);
  const [isDatasetModalOpen, setIsDatasetModalOpen] = useState(false);
  /** Estado del reintento manual de las herramientas integradas de Gemini. */
  const [toolsRetry, setToolsRetry] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  /** Marca del servidor: la key en uso no admite grounding / code execution. */
  const [toolsMemory, setToolsMemory] = useState<{ marked: boolean; expiresAt: number | null; keyKnown: boolean; ttlMs: number | null } | null>(null);
  /** Aviso pasajero cuando la marca caduca con el panel abierto. */
  const [toolsExpiryNotice, setToolsExpiryNotice] = useState(false);
  /** Duración de la marca: borrador editable y estado del guardado. */
  const [ttlDraft, setTtlDraft] = useState('');
  const [ttlSave, setTtlSave] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  /** Cadena de respaldo guardada en commander.json: borrador y estado. */
  const [fallbackRows, setFallbackRows] = useState<string[]>([]);
  /** Modelo que se va a añadir a la cadena (el orden se cambia con flechas). */
  const [fallbackNew, setFallbackNew] = useState('');
  const [fallbackState, setFallbackState] = useState<{
    models: string[];
    defaultModels: string[];
    configured: boolean;
  } | null>(null);
  const [fallbackSave, setFallbackSave] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [fallbackError, setFallbackError] = useState('');
  /** Resultado de probar un modelo de la cadena, por id. */
  const [probeResults, setProbeResults] = useState<
    Record<string, { status: 'working' | 'ok' | 'substituted' | 'failed'; detail: string }>
  >({});
  /** Último resultado, en texto: el glifo de la fila no cabe explicar el motivo. */
  const [lastProbe, setLastProbe] = useState<{
    status: 'working' | 'ok' | 'substituted' | 'failed';
    detail: string;
  } | null>(null);
  /** Recorrido de la cadena entera; `result` sólo cuando ya terminó. */
  const [chainProbe, setChainProbe] = useState<{
    running: boolean;
    result?: ChainProbeResult;
  } | null>(null);
  const [isProviderManagerOpen, setIsProviderManagerOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(initialWidth);
  const [, setIsResizing] = useState(false);
  const safetyRef = useRef<HTMLDivElement>(null);
  const examplesRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  
  // Estado de la marca de herramientas integradas de la key en uso.
  const refreshToolsMemory = useCallback(async () => {
    try {
      const res = await fetch('/api/gemini/tools-memory', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        setToolsMemory({
          marked: data.marked === true,
          expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : null,
          keyKnown: data.keyKnown === true,
          ttlMs: typeof data.ttlMs === 'number' ? data.ttlMs : null,
        });
      }
    } catch {
      // Sin servidor, el panel sigue usable: el estado es informativo.
    }
  }, []);

  useEffect(() => {
    void refreshToolsMemory();
  }, [refreshToolsMemory]);

  // Reloj local: hace que la cuenta atrás de la marca avance sola con el panel abierto.
  const [now, setNow] = useState(() => Date.now());
  const expiredRefreshRef = useRef<number | null>(null);

  useEffect(() => {
    if (!toolsMemory?.marked) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    // Disparo exacto en el vencimiento: el aviso de caducidad no espera al tick.
    const expiresAt = toolsMemory.expiresAt;
    const untilExpiry = expiresAt != null ? expiresAt - Date.now() : -1;
    const expiryId = untilExpiry > 0 ? setTimeout(() => setNow(Date.now()), untilExpiry) : null;
    return () => {
      clearInterval(id);
      if (expiryId != null) clearTimeout(expiryId);
    };
  }, [toolsMemory?.marked, toolsMemory?.expiresAt]);

  // Al llegar la hora de caducidad, el servidor ya no la considera marcada:
  // se relee una sola vez por cada vencimiento para no encadenar peticiones.
  useEffect(() => {
    const expiresAt = toolsMemory?.expiresAt;
    if (!toolsMemory?.marked || expiresAt == null || now < expiresAt) return;
    if (expiredRefreshRef.current === expiresAt) return;
    expiredRefreshRef.current = expiresAt;
    setToolsExpiryNotice(true);
    void refreshToolsMemory();
  }, [now, toolsMemory, refreshToolsMemory]);

  // El aviso de caducidad es breve: se retira solo a los pocos segundos.
  useEffect(() => {
    if (!toolsExpiryNotice) return;
    const id = setTimeout(() => setToolsExpiryNotice(false), 8000);
    return () => clearTimeout(id);
  }, [toolsExpiryNotice]);

  /** Duración efectiva que anuncia el servidor, en minutos. */
  const ttlMinutes = toolsMemory?.ttlMs ? Math.round(toolsMemory.ttlMs / 60000) : null;

  useEffect(() => {
    if (ttlMinutes != null) setTtlDraft(String(ttlMinutes));
  }, [ttlMinutes]);

  /** Cadena de respaldo tal como la usará el servidor si la petición no la trae. */
  const refreshFallbackModels = useCallback(async () => {
    try {
      const res = await fetch('/api/gemini/fallback-models', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        const models = Array.isArray(data.models) ? data.models.map(String) : [];
        setFallbackState({
          models,
          defaultModels: Array.isArray(data.defaultModels) ? data.defaultModels.map(String) : [],
          configured: data.configured === true,
        });
        setFallbackRows(models);
      }
    } catch {
      // Sin servidor el editor sigue visible; guardar avisará del fallo.
    }
  }, []);

  useEffect(() => {
    void refreshFallbackModels();
  }, [refreshFallbackModels]);

  const saveFallbackModels = useCallback(
    async (models: string[]) => {
      setFallbackSave('working');
      setFallbackError('');
      try {
        const res = await fetch('/api/gemini/fallback-models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ models }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success === true) {
          setFallbackSave('done');
          await refreshFallbackModels();
        } else {
          setFallbackSave('error');
          setFallbackError(typeof data.error === 'string' ? data.error : '');
        }
      } catch {
        setFallbackSave('error');
        setFallbackError('');
      }
    },
    [refreshFallbackModels]
  );

  /** Una edición del borrador invalida el «✓ guardada» anterior. */
  const touchFallbackDraft = useCallback(() => {
    setFallbackSave('idle');
    setFallbackError('');
    // Un «respondería X» de una cadena que ya no es ésa sería una mentira
    // tranquilizadora.
    setChainProbe(null);
  }, []);

  /** Mueve un modelo una posición; el índice 0 es el primero que se prueba. */
  const moveFallbackModel = useCallback(
    (index: number, delta: number) => {
      setFallbackRows((rows) => moveModel(rows, index, delta));
      touchFallbackDraft();
    },
    [touchFallbackDraft]
  );

  const removeFallbackModel = useCallback(
    (index: number) => {
      // El id se lee del render actual: dentro del updater de `setFallbackRows`
      // no se puede saber cuándo se ejecutará.
      const removed = fallbackRows[index] ?? '';
      setFallbackRows((rows) => rows.filter((_, i) => i !== index));
      // Un «✓» de un modelo que ya no está en la lista confundiría al volver a
      // añadirlo: la prueba se olvida con él.
      if (removed) {
        setProbeResults((prev) => {
          if (!(removed in prev)) return prev;
          const next = { ...prev };
          delete next[removed];
          return next;
        });
      }
      touchFallbackDraft();
    },
    [fallbackRows, touchFallbackDraft]
  );

  /**
   * Añadir se niega a duplicar: el servidor rechaza la lista entera si repite,
   * así que avisar aquí evita un guardado que falla por un detalle invisible.
   */
  const addFallbackModel = useCallback(() => {
    const result = addModel(fallbackRows, fallbackNew, MAX_FALLBACK_MODELS);
    if (result.error) {
      setFallbackError(result.error);
      setFallbackSave('idle');
      return;
    }
    if (result.rows === fallbackRows) return;
    setFallbackRows(result.rows);
    setFallbackNew('');
    touchFallbackDraft();
  }, [fallbackNew, fallbackRows, touchFallbackDraft]);

  /**
   * Prueba un modelo de la cadena con una llamada mínima, sin guardar nada.
   *
   * Se manda `fallbackModels: []` a propósito: si el servidor pudiera cambiar
   * de modelo, un «✓» diría que responde cuando en realidad responde otro — que
   * es justo lo que este botón viene a despejar.
   */
  const probeFallbackModel = useCallback(async (modelId: string) => {
    setProbeResults((prev) => ({ ...prev, [modelId]: { status: 'working', detail: '' } }));
    setLastProbe({ status: 'working', detail: `Probando ${modelId}…` });
    const result = await probeModel({ baseUrl: '', model: modelId, disableFallback: true });
    const detail =
      result.status === 'ok'
        ? `${modelId} responde`
        : result.status === 'substituted'
        ? `${result.fallback?.from ?? modelId} no respondió; contestó ${result.fallback?.to ?? 'otro modelo'}`
        : `${modelId}: ${result.error || 'sin respuesta'}`;
    setProbeResults((prev) => ({ ...prev, [modelId]: { status: result.status, detail } }));
    setLastProbe({ status: result.status, detail });
  }, []);

  /**
   * Prueba la cadena en el orden en que se guardará y para en el primero que
   * responda: es lo mismo que hará el servidor, así que seguir probando sería
   * gastar llamadas para saber algo que ya no se usa.
   */
  const probeFallbackChain = useCallback(async () => {
    if (fallbackRows.length === 0) return;
    setChainProbe({ running: true });
    setLastProbe(null);
    const result = await probeFirstResponder(fallbackRows, (model) =>
      probeModel({ baseUrl: '', model, disableFallback: true })
    );
    setProbeResults((prev) => {
      const next = { ...prev };
      for (const attempt of result.attempts) {
        next[attempt.model] = { status: attempt.status, detail: attempt.detail };
      }
      return next;
    });
    setChainProbe({ running: false, result });
  }, [fallbackRows]);

  // Persist panel width
  useEffect(() => {
    const saved = localStorage.getItem('ai_studio_right_panel_width');
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= 280 && w <= 800) setPanelWidth(w);
    }
  }, []);
  
  useEffect(() => {
    localStorage.setItem('ai_studio_right_panel_width', String(panelWidth));
    onWidthChange?.(panelWidth);
  }, [panelWidth, onWidthChange]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!showSafety && !showExamples) return;

    const handleClickOutside = (event: Event) => {
      const target = event.target as Node;
      if (!target) return;

      if (showSafety && safetyRef.current && !safetyRef.current.contains(target)) {
        setShowSafety(false);
      }
      if (showExamples && examplesRef.current && !examplesRef.current.contains(target)) {
        setShowExamples(false);
      }
    };

    window.addEventListener('click', handleClickOutside);

    return () => {
      window.removeEventListener('click', handleClickOutside);
    };
  }, [showSafety, showExamples]);

  const { models: catalog, providers } = useModelsCatalog();
  const ollamaStatus = providers.ollama;
  const ollamaOffline = ollamaStatus?.available === false;
  const geminiList = catalog.filter((m) => m.provider === 'google');
  const anthropicList = catalog.filter((m) => m.provider === 'anthropic');
  const xaiList = catalog.filter((m) => m.provider === 'xai');
  const hfList = catalog.filter((m) => m.provider === 'huggingface');
  const ollamaList = catalog.filter((m) => m.provider === 'ollama');
  const openrouterList = catalog.filter((m) => m.provider === 'openrouter');
  const customList = catalog.filter((m) => m.provider === 'custom');

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    const p = catalog.find((m) => m.id === modelId)?.provider;
    setSelectedProvider(p || 'google');
  };

  const currentModelObj = catalog.find((m) => m.id === selectedModel);

  return (
    <aside 
      ref={panelRef} 
      className="shrink-0 bg-[#0000aa] border-l-2 border-[#00ffff] flex flex-col overflow-y-auto h-full min-h-0 text-xs text-[#00ffff] font-mono p-2 z-30 resize-x min-w-[200px] max-w-[480px]"
      style={{ width: panelWidth, minWidth: 280, maxWidth: 800 }}
      aria-label={lang === 'es' ? 'Panel de configuración' : lang === 'de' ? 'Konfigurationspanel' : 'Configuration panel'}
    >
      {/* Resize handle */}
      <div
        ref={resizeHandleRef}
        className="w-full h-1 cursor-col-resize bg-transparent hover:bg-[#00ffff]/30 transition-colors -ml-2"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
          const startX = e.clientX;
          const startWidth = panelWidth;
          
          const handleMouseMove = (moveEvent: MouseEvent) => {
            const newWidth = Math.max(280, Math.min(800, startWidth - (moveEvent.clientX - startX)));
            setPanelWidth(newWidth);
          };
          
          const handleMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };
          
          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
        aria-label={lang === 'es' ? 'Redimensionar panel' : lang === 'de' ? 'Panel skalieren' : 'Resize panel'}
        title={lang === 'es' ? 'Arrastrar para redimensionar' : lang === 'de' ? 'Zum Skalieren ziehen' : 'Drag to resize'}
      >
        <div className="mx-auto w-8 h-0.5 bg-[#00ffff]/30 hover:bg-[#00ffff] transition-colors rounded" />
      </div>
      
      <div className="border-2 border-[#00ffff] bg-[#000080] p-3 space-y-4 flex-1 min-h-0">
        {/* Panel Header */}
        <div className="bg-[#00aaaa] text-black font-bold px-2 py-1 uppercase tracking-wider flex items-center justify-between border-b border-black">
          <div className="flex items-center gap-1 truncate">
            <Sliders className="w-4 h-4 text-black shrink-0" />
            <span className="text-xs truncate">{tx('AJUSTES', 'EINSTELLUNGEN', 'SETTINGS')}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="nc-button !px-1.5 !py-0.5 text-xs bg-red-600 text-white hover:bg-red-500 font-bold flex items-center gap-1 shrink-0 ml-1"
                title={lang === 'es' ? 'Cerrar / Plegar Panel de Configuración' : lang === 'de' ? 'Konfigurationspanel schließen / einklappen' : 'Close / Fold Config Panel'}
              >
                <X className="w-3.5 h-3.5" />
                <span className="text-[10px]">{lang === 'es' ? 'CERRAR' : lang === 'de' ? 'SCHLIESSEN' : 'CLOSE'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Tres pestañas para el mismo sitio de ajustes: el modelo estaba aquí y en el
            selector del compositor, y las instrucciones vivían en el sidebar. */}
        <div className="grid grid-cols-3 gap-1" role="tablist" aria-label={tx('Secciones de ajustes', 'Einstellungsbereiche', 'Settings sections')}>
          {([
            { id: 'modelo' as const, label: tx('MODELO', 'MODELL', 'MODEL') },
            { id: 'parametros' as const, label: tx('PARÁMETROS', 'PARAMETER', 'PARAMETERS') },
            { id: 'instrucciones' as const, label: tx('INSTRUCCIONES', 'ANWEISUNGEN', 'INSTRUCTIONS') },
          ]).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={settingsTab === tab.id}
              onClick={() => setSettingsTab(tab.id)}
              className={`py-1 text-[10px] font-bold border ${
                settingsTab === tab.id
                  ? 'bg-[#00ffff] text-black border-white'
                  : 'bg-[#000080] text-[#00ffff] border-[#00aaaa]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {settingsTab === 'modelo' && (
        <>
        {/* 1. Model Selector */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-[#ffff55] flex items-center justify-between">
            <span>{t.modelSelector}:</span>
          </label>

          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            className={`w-full bg-[#0000aa] border-2 border-[#00ffff] p-1.5 text-xs font-bold outline-none cursor-pointer ${
              selectedModel.startsWith('ollama/') && ollamaOffline
                ? 'text-red-400'
                : 'text-green-600'
            }`}
          >
            {/* Sólo se puede elegir lo que se puede usar: el grupo de un
                proveedor sin credenciales queda con sus opciones deshabilitadas
                y dice cómo arreglarlo, en vez de prometer un modelo que
                responderá con error. Ollama se libra: funciona en local con su
                host por defecto. */}
            {[
              { id: 'google', label: '🌟 GOOGLE GEMINI', models: geminiList },
              { id: 'anthropic', label: '🧠 ANTHROPIC CLAUDE', models: anthropicList },
              { id: 'xai', label: '🚀 XAI GROK', models: xaiList },
              { id: 'huggingface', label: '🤗 HUGGING FACE', models: hfList },
              {
                id: 'ollama',
                label: ollamaOffline ? '💻 OLLAMA LOCAL (sin conexión)' : '💻 OLLAMA LOCAL',
                models: ollamaList,
              },
              { id: 'openrouter', label: '🆓 OPENROUTER', models: openrouterList },
              { id: 'custom', label: '🔌 CUSTOM ENDPOINT', models: customList },
            ].map((group) => {
              const enabled = group.id === 'ollama' || providers[group.id]?.configured === true;
              return (
                <optgroup
                  key={group.id}
                  label={`${group.label} ${
                    enabled
                      ? '✓'
                      : lang === 'es'
                        ? '(sin configurar)'
                        : lang === 'de'
                          ? '(nicht konfiguriert)'
                          : '(not configured)'
                  }`}
                >
                  {group.models.map((m) => (
                    <option key={m.id} value={m.id} disabled={!enabled}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>

          <div className="bg-[#0000aa] border border-[#00aaaa] p-2 text-[10px] text-[#ffffff]">
            {currentModelObj?.description}
            {currentModelObj?.supportsTools === true && (
              <div className="mt-1 text-[#ffff55] font-bold">⚙ TOOL-CALLING: disponible</div>
            )}
            {currentModelObj?.provider === 'ollama' && ollamaOffline && (
              <div className="mt-1 text-[#ffff55] font-bold">
                ⚠ OLLAMA NO DISPONIBLE{ollamaStatus?.host ? ` (${ollamaStatus.host})` : ''}: arráncalo o ajusta el host en «CONFIGURAR LLM LOCAL (Ollama / OpenAI)».
              </div>
            )}
          </div>
          
          <ApiKeyInput provider="google" onSave={(k) => saveApiKey('GEMINI_API_KEY', k)} />
          {toolsMemory?.marked && (
            <div className="text-[9px] text-[#ffff55] px-1" title={toolsMemory.expiresAt ? new Date(toolsMemory.expiresAt).toLocaleString() : undefined}>
              {(() => {
                const minutes = toolsMemory.expiresAt
                  ? Math.max(0, Math.ceil((toolsMemory.expiresAt - now) / 60000))
                  : 0;
                return lang === 'es'
                  ? `⚑ Marcada sin herramientas integradas · caduca en ${minutes} min`
                  : lang === 'de'
                  ? `⚑ Ohne integrierte Tools markiert · läuft in ${minutes} Min. ab`
                  : `⚑ Marked as lacking built-in tools · expires in ${minutes} min`;
              })()}
            </div>
          )}
          {toolsMemory?.keyKnown && !toolsMemory.marked && (
            <div className="text-[9px] text-[#00ffff] px-1">
              {lang === 'es'
                ? '✓ Búsqueda de Google y ejecución de código: se piden en cada mensaje'
                : lang === 'de'
                ? '✓ Google-Suche und Code-Ausführung: werden bei jeder Nachricht angefragt'
                : '✓ Google Search and code execution: requested on every message'}
            </div>
          )}
          {toolsExpiryNotice && (
            <div className="text-[9px] text-[#00ff00] px-1" role="status" aria-live="polite">
              {lang === 'es'
                ? '⏱ La marca caducó: la búsqueda de Google se vuelve a pedir desde ahora.'
                : lang === 'de'
                ? '⏱ Markierung abgelaufen: Google-Suche wird ab jetzt wieder angefragt.'
                : '⏱ Mark expired: Google Search is requested again from now on.'}
            </div>
          )}
          {/* Si una key demostró no admitir grounding / code execution, el chat
              las omite para no pagar una pasada fallida en cada mensaje. Este
              botón borra esa memoria y vuelve a probarlas en el próximo envío. */}
          <button
            type="button"
            onClick={async () => {
              setToolsRetry('working');
              try {
                const res = await fetch('/api/gemini/tools-memory/reset', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                });
                const data = await res.json().catch(() => ({}));
                setToolsRetry(res.ok && data.success === true ? 'done' : 'error');
                await refreshToolsMemory();
              } catch {
                setToolsRetry('error');
              }
            }}
            disabled={toolsRetry === 'working'}
            className="nc-button w-full text-left flex items-center gap-1.5 text-[10px] bg-[#0000aa] border-[#00ffff] mt-1"
            title={
              lang === 'es'
                ? 'Borra la memoria de «esta key no admite búsqueda de Google» y vuelve a intentarlo'
                : lang === 'de'
                ? 'Löscht «dieser Key kann keine Google-Suche» und versucht es erneut'
                : 'Clears “this key has no Google Search” and tries again'
            }
          >
            <Globe className="w-3.5 h-3.5 text-[#ffff55]" />
            <span>
              {toolsRetry === 'working'
                ? (lang === 'es' ? 'REINICIANDO PRUEBA…' : lang === 'de' ? 'TEST WIRD ZURÜCKGESETZT…' : 'RESETTING TEST…')
                : (lang === 'es' ? 'VOLVER A PROBAR BÚSQUEDA DE GOOGLE' : lang === 'de' ? 'GOOGLE-SUCHE ERNEUT TESTEN' : 'RETRY GOOGLE SEARCH')}
            </span>
          </button>
          {toolsRetry === 'done' && (
            <div className="text-[9px] text-[#00ff00] px-1">
              {lang === 'es'
                ? '✓ Se probará de nuevo en el próximo mensaje.'
                : lang === 'de'
                ? '✓ Wird bei der nächsten Nachricht erneut versucht.'
                : '✓ Will be retried on the next message.'}
            </div>
          )}
          {toolsRetry === 'error' && (
            <div className="text-[9px] text-[#ff5555] px-1">
              {lang === 'es'
                ? '✗ No se pudo reiniciar la prueba.'
                : lang === 'de'
                ? '✗ Test konnte nicht zurückgesetzt werden.'
                : '✗ Could not reset the retry.'}
            </div>
          )}
          {/* Cuánto dura la marca. Se guarda en commander.json, así que la
              siguiente marca nace ya con el valor elegido. */}
          <div className="mt-1 px-1 text-[9px] text-[#ffff55]">
            {lang === 'es'
              ? 'DURACIÓN DE LA MARCA (MINUTOS):'
              : lang === 'de'
              ? 'DAUER DER MARKIERUNG (MINUTEN):'
              : 'MARK DURATION (MINUTES):'}
          </div>
          <div className="flex items-center gap-1 px-1">
            <input
              type="number"
              min={1}
              max={1440}
              value={ttlDraft}
              onChange={(e) => {
                setTtlDraft(e.target.value);
                setTtlSave('idle');
              }}
              disabled={ttlSave === 'working' || ttlMinutes == null}
              aria-label={
                lang === 'es'
                  ? 'Minutos que dura la marca sin herramientas integradas'
                  : lang === 'de'
                  ? 'Minuten, die die Markierung ohne integrierte Tools gilt'
                  : 'Minutes the built-in-tools mark lasts'
              }
              className="w-16 bg-[#000040] border border-[#00ffff] text-[#00ffff] text-[10px] px-1 py-0.5 font-mono"
            />
            <button
              type="button"
              onClick={async () => {
                const minutes = Number.parseInt(ttlDraft, 10);
                if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
                  setTtlSave('error');
                  return;
                }
                setTtlSave('working');
                try {
                  const res = await fetch('/api/gemini/tools-memory/ttl', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ minutes }),
                  });
                  const data = await res.json().catch(() => ({}));
                  setTtlSave(res.ok && data.success === true ? 'done' : 'error');
                  await refreshToolsMemory();
                } catch {
                  setTtlSave('error');
                }
              }}
              disabled={ttlSave === 'working' || ttlMinutes == null}
              className="nc-button text-[10px] bg-[#0000aa] border-[#00ffff] px-2"
              title={
                lang === 'es'
                  ? 'Guarda la duración en commander.json (1–1440 minutos)'
                  : lang === 'de'
                  ? 'Dauer in commander.json speichern (1–1440 Minuten)'
                  : 'Save the duration in commander.json (1–1440 minutes)'
              }
            >
              {ttlSave === 'working'
                ? (lang === 'es' ? 'GUARDANDO…' : lang === 'de' ? 'SPEICHERN…' : 'SAVING…')
                : (lang === 'es' ? 'GUARDAR' : lang === 'de' ? 'SPEICHERN' : 'SAVE')}
            </button>
          </div>
          {ttlSave === 'done' && (
            <div className="text-[9px] text-[#00ff00] px-1">
              {lang === 'es'
                ? `✓ Guardado: la próxima marca durará ${ttlMinutes} min.`
                : lang === 'de'
                ? `✓ Gespeichert: die nächste Markierung gilt ${ttlMinutes} Min.`
                : `✓ Saved: the next mark will last ${ttlMinutes} min.`}
            </div>
          )}
          {ttlSave === 'error' && (
            <div className="text-[9px] text-[#ff5555] px-1">
              {lang === 'es'
                ? '✗ Valor no válido o no se pudo guardar (1–1440 min).'
                : lang === 'de'
                ? '✗ Ungültiger Wert oder Speichern fehlgeschlagen (1–1440 Min.).'
                : '✗ Invalid value or save failed (1–1440 min).'}
            </div>
          )}
          {/* Cadena de respaldo de Gemini. Se guarda en commander.json para no
              repetirla en cada petición. El orden es la prioridad, así que se
              cambia con flechas: reescribir el texto entero para subir un
              modelo una posición era la forma fácil de equivocarse. */}
          <div className="mt-2 px-1 text-[9px] text-[#ffff55]">
            {lang === 'es'
              ? `CADENA DE RESPALDO (MÁX. ${MAX_FALLBACK_MODELS}, EN ORDEN):`
              : lang === 'de'
              ? `AUSWEICHKETTE (MAX. ${MAX_FALLBACK_MODELS}, IN REIHENFOLGE):`
              : `FALLBACK CHAIN (MAX. ${MAX_FALLBACK_MODELS}, IN ORDER):`}
          </div>
          <div
            className="border border-[#00ffff] bg-[#000040] px-1 py-0.5"
            aria-label={
              lang === 'es'
                ? 'Modelos de respaldo de Gemini en orden'
                : lang === 'de'
                ? 'Gemini-Ausweichmodelle in Reihenfolge'
                : 'Gemini fallback models in order'
            }
          >
            {fallbackRows.length === 0 && !(fallbackState?.configured && fallbackState.models.length === 0) && (
              <div className="text-[9px] text-[#00ffff]/70 py-0.5">
                {lang === 'es'
                  ? '· Sin modelos de respaldo.'
                  : lang === 'de'
                  ? '· Keine Ausweichmodelle.'
                  : '· No fallback models.'}
              </div>
            )}
            {fallbackRows.map((modelId, index) => (
              <div
                key={`${modelId}-${index}`}
                className="flex items-center gap-1 text-[10px] py-0.5 border-b border-[#00ffff]/20 last:border-b-0"
              >
                <span className="text-[#ffff55] w-3 shrink-0">{index + 1}.</span>
                {/* Partido en dos líneas, no truncado: con el panel estrecho
                    dos ids que sólo se distinguen por el sufijo quedaban
                    idénticos y no se sabía cuál se estaba moviendo. */}
                <span className="flex-1 break-all" title={modelId}>
                  {modelId}
                </span>
                {/* Probar este modelo sin guardar la cadena. El resultado se
                    queda pegado al id, no a la posición: reordenar no borra
                    lo que ya sabes de cada modelo. */}
                <button
                  type="button"
                  onClick={() => void probeFallbackModel(modelId)}
                  disabled={probeResults[modelId]?.status === 'working'}
                  className="nc-button px-1 py-0 disabled:opacity-30"
                  aria-label={
                    lang === 'es'
                      ? `Probar ${modelId}`
                      : lang === 'de'
                      ? `${modelId} testen`
                      : `Test ${modelId}`
                  }
                  title={
                    lang === 'es'
                      ? 'Hace una llamada mínima a este modelo; no guarda nada'
                      : lang === 'de'
                      ? 'Macht einen minimalen Aufruf an dieses Modell; speichert nichts'
                      : 'Makes one minimal call to this model; saves nothing'
                  }
                >
                  <FlaskConical className="w-3 h-3" />
                </button>
                {probeResults[modelId] && (
                  <span
                    role="status"
                    aria-label={`${modelId}: ${probeResults[modelId].detail}`}
                    title={probeResults[modelId].detail}
                    className={
                      'w-3 shrink-0 text-center ' +
                      (probeResults[modelId].status === 'ok'
                        ? 'text-[#00ff00]'
                        : probeResults[modelId].status === 'working'
                        ? 'text-[#00ffff]'
                        : probeResults[modelId].status === 'substituted'
                        ? 'text-[#ffff55]'
                        : 'text-[#ff5555]')
                    }
                  >
                    {probeResults[modelId].status === 'ok'
                      ? '✓'
                      : probeResults[modelId].status === 'working'
                      ? '…'
                      : probeResults[modelId].status === 'substituted'
                      ? '⚠'
                      : '✖'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => moveFallbackModel(index, -1)}
                  disabled={index === 0 || fallbackSave === 'working'}
                  className="nc-button px-1 py-0 disabled:opacity-30"
                  aria-label={
                    lang === 'es'
                      ? `Subir ${modelId}`
                      : lang === 'de'
                      ? `${modelId} nach oben`
                      : `Move ${modelId} up`
                  }
                  title={
                    lang === 'es' ? 'Subir' : lang === 'de' ? 'Nach oben' : 'Move up'
                  }
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => moveFallbackModel(index, 1)}
                  disabled={index === fallbackRows.length - 1 || fallbackSave === 'working'}
                  className="nc-button px-1 py-0 disabled:opacity-30"
                  aria-label={
                    lang === 'es'
                      ? `Bajar ${modelId}`
                      : lang === 'de'
                      ? `${modelId} nach unten`
                      : `Move ${modelId} down`
                  }
                  title={
                    lang === 'es' ? 'Bajar' : lang === 'de' ? 'Nach unten' : 'Move down'
                  }
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => removeFallbackModel(index)}
                  disabled={fallbackSave === 'working'}
                  className="nc-button px-1 py-0"
                  aria-label={
                    lang === 'es'
                      ? `Quitar ${modelId}`
                      : lang === 'de'
                      ? `${modelId} entfernen`
                      : `Remove ${modelId}`
                  }
                  title={lang === 'es' ? 'Quitar' : lang === 'de' ? 'Entfernen' : 'Remove'}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 px-1 mt-1">
            <input
              type="text"
              value={fallbackNew}
              onChange={(e) => {
                setFallbackNew(e.target.value);
                setFallbackError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addFallbackModel();
                }
              }}
              spellCheck={false}
              disabled={fallbackSave === 'working'}
              placeholder={
                lang === 'es'
                  ? 'modelo a añadir…'
                  : lang === 'de'
                  ? 'Modell hinzufügen…'
                  : 'model to add…'
              }
              aria-label={
                lang === 'es'
                  ? 'Identificador del modelo que se añade al final de la cadena'
                  : lang === 'de'
                  ? 'Kennung des Modells, das ans Ende der Kette kommt'
                  : 'Id of the model added to the end of the chain'
              }
              className="flex-1 min-w-0 bg-[#000040] border border-[#00ffff] text-[#00ffff] text-[10px] px-1 py-0.5 font-mono"
            />
            <button
              type="button"
              onClick={() => addFallbackModel()}
              disabled={
                fallbackSave === 'working' ||
                !fallbackNew.trim() ||
                fallbackRows.length >= MAX_FALLBACK_MODELS
              }
              className="nc-button text-[10px] bg-[#0000aa] border-[#00ffff] px-2 disabled:opacity-30"
              title={
                lang === 'es'
                  ? 'Añade el modelo al final; luego colócalo con las flechas'
                  : lang === 'de'
                  ? 'Modell ans Ende hängen; dann mit den Pfeilen sortieren'
                  : 'Adds the model at the end; position it with the arrows'
              }
            >
              {lang === 'es' ? 'AÑADIR' : lang === 'de' ? 'HINZU' : 'ADD'}
            </button>
          </div>
          {/* Probar la cadena en orden: para en el primero que conteste, igual
              que hará el servidor, así que en el caso sano cuesta una llamada. */}
          <button
            type="button"
            onClick={() => void probeFallbackChain()}
            disabled={chainProbe?.running === true || fallbackRows.length === 0}
            className="nc-button w-full text-left flex items-center gap-1.5 text-[10px] bg-[#0000aa] border-[#00ffff] mt-1 disabled:opacity-30"
            title={
              lang === 'es'
                ? 'Prueba la cadena en orden y para en el primero que responda; no guarda nada'
                : lang === 'de'
                ? 'Testet die Kette der Reihe nach und stoppt beim ersten Treffer; speichert nichts'
                : 'Tests the chain in order and stops at the first answer; saves nothing'
            }
          >
            <FlaskConical className="w-3.5 h-3.5 text-[#ffff55]" />
            <span>
              {chainProbe?.running
                ? lang === 'es'
                  ? 'PROBANDO LA CADENA…'
                  : lang === 'de'
                  ? 'KETTE WIRD GETESTET…'
                  : 'TESTING THE CHAIN…'
                : lang === 'es'
                ? 'PROBAR ORDEN'
                : lang === 'de'
                ? 'REIHENFOLGE TESTEN'
                : 'TEST ORDER'}
            </span>
          </button>
          {chainProbe?.result && !chainProbe.running && (
            <div
              role="status"
              aria-live="polite"
              className={
                'text-[9px] px-1 ' +
                (chainProbe.result.answeredIndex === 0
                  ? 'text-[#00ff00]'
                  : chainProbe.result.answeredIndex > 0
                  ? 'text-[#ffff55]'
                  : 'text-[#ff5555]')
              }
            >
              {chainProbe.result.answeredIndex < 0
                ? lang === 'es'
                  ? `✖ ningún modelo de la cadena respondió (${chainProbe.result.attempts.length} probados)`
                  : lang === 'de'
                  ? `✖ kein Modell der Kette antwortete (${chainProbe.result.attempts.length} getestet)`
                  : `✖ no model in the chain answered (${chainProbe.result.attempts.length} tested)`
                : chainProbe.result.answeredIndex === 0
                ? lang === 'es'
                  ? `✓ respondería el primero: ${chainProbe.result.answeredModel}`
                  : lang === 'de'
                  ? `✓ das erste Modell würde antworten: ${chainProbe.result.answeredModel}`
                  : `✓ the first model would answer: ${chainProbe.result.answeredModel}`
                : lang === 'es'
                ? `⚠ ${chainProbe.result.answeredIndex} modelo(s) sin responder antes; respondería ${chainProbe.result.answeredModel} (posición ${chainProbe.result.answeredIndex + 1})`
                : lang === 'de'
                ? `⚠ ${chainProbe.result.answeredIndex} Modell(e) davor ohne Antwort; ${chainProbe.result.answeredModel} würde antworten (Position ${chainProbe.result.answeredIndex + 1})`
                : `⚠ ${chainProbe.result.answeredIndex} model(s) did not answer before; ${chainProbe.result.answeredModel} would (position ${chainProbe.result.answeredIndex + 1})`}
            </div>
          )}
          <div className="flex items-center gap-1 px-1 mt-1">
            <button
              type="button"
              onClick={() => void saveFallbackModels(fallbackRows)}
              disabled={fallbackSave === 'working'}
              className="nc-button text-[10px] bg-[#0000aa] border-[#00ffff] px-2"
              title={
                lang === 'es'
                  ? 'Guarda la cadena en commander.json; se usará cuando la petición no traiga la suya'
                  : lang === 'de'
                  ? 'Kette in commander.json speichern; gilt, wenn die Anfrage keine eigene schickt'
                  : 'Save the chain in commander.json; used when the request brings none'
              }
            >
              {fallbackSave === 'working'
                ? (lang === 'es' ? 'GUARDANDO…' : lang === 'de' ? 'SPEICHERN…' : 'SAVING…')
                : (lang === 'es' ? 'GUARDAR CADENA' : lang === 'de' ? 'KETTE SPEICHERN' : 'SAVE CHAIN')}
            </button>
            <button
              type="button"
              onClick={() => void saveFallbackModels(fallbackState?.defaultModels ?? [])}
              disabled={fallbackSave === 'working' || !fallbackState}
              className="nc-button text-[10px] bg-[#0000aa] border-[#00ffff] px-2"
              title={
                lang === 'es'
                  ? 'Vuelve a la cadena de respaldo de fábrica'
                  : lang === 'de'
                  ? 'Zurück zur Standard-Ausweichkette'
                  : 'Restore the factory fallback chain'
              }
            >
              {lang === 'es' ? 'POR DEFECTO' : lang === 'de' ? 'STANDARD' : 'DEFAULT'}
            </button>
          </div>
          {fallbackState && !fallbackState.configured && (
            <div className="text-[9px] text-[#00ffff] px-1">
              {lang === 'es'
                ? '· Sin guardar: se usa la cadena de fábrica.'
                : lang === 'de'
                ? '· Nicht gespeichert: Standard-Kette ist aktiv.'
                : '· Not saved: the factory chain is in use.'}
            </div>
          )}
          {fallbackState?.configured && fallbackState.models.length === 0 && (
            <div className="text-[9px] text-[#ffff55] px-1">
              {lang === 'es'
                ? '⚑ Respaldo desactivado: si el modelo falla, el error se muestra en vez de cambiarlo por detrás.'
                : lang === 'de'
                ? '⚑ Ausweichen deaktiviert: bei einem Fehler erscheint der Fehler statt eines anderen Modells.'
                : '⚑ Fallback disabled: on failure the error is shown instead of switching model behind your back.'}
            </div>
          )}
          {fallbackSave === 'done' && (
            <div className="text-[9px] text-[#00ff00] px-1" role="status" aria-live="polite">
              {lang === 'es'
                ? `✓ Guardada: ${fallbackState?.models.length ?? 0} modelo(s) de respaldo.`
                : lang === 'de'
                ? `✓ Gespeichert: ${fallbackState?.models.length ?? 0} Ausweichmodell(e).`
                : `✓ Saved: ${fallbackState?.models.length ?? 0} fallback model(s).`}
            </div>
          )}
          {lastProbe && (
            <div
              role="status"
              aria-live="polite"
              className={
                'text-[9px] px-1 ' +
                (lastProbe.status === 'ok'
                  ? 'text-[#00ff00]'
                  : lastProbe.status === 'working'
                  ? 'text-[#00ffff]'
                  : lastProbe.status === 'substituted'
                  ? 'text-[#ffff55]'
                  : 'text-[#ff5555]')
              }
            >
              {lastProbe.status === 'ok'
                ? '✓ '
                : lastProbe.status === 'working'
                ? '… '
                : lastProbe.status === 'substituted'
                ? '⚠ '
                : '✖ '}
              {lastProbe.detail}
            </div>
          )}
          {fallbackError && (
            <div className="text-[9px] text-[#ff5555] px-1">{fallbackError}</div>
          )}
          {fallbackSave === 'error' && !fallbackError && (
            <div className="text-[9px] text-[#ff5555] px-1">
              {lang === 'es'
                ? '✗ No se pudo guardar la cadena.'
                : lang === 'de'
                ? '✗ Kette konnte nicht gespeichert werden.'
                : '✗ Could not save the chain.'}
            </div>
          )}
          <ApiKeyInput provider="anthropic" onSave={(k) => saveApiKey('ANTHROPIC_API_KEY', k)} />
          <ApiKeyInput provider="xai" onSave={(k) => saveApiKey('XAI_API_KEY', k)} />
          <ApiKeyInput provider="huggingface" onSave={(k) => saveApiKey('HF_API_TOKEN', k)} />
          <ApiKeyInput provider="openrouter" onSave={(k) => saveApiKey('OPENROUTER_API_KEY', k)} />
          <button
            type="button"
            onClick={() => onOpenLocalLlmConfig?.()}
            className="nc-button w-full text-left flex items-center gap-1.5 text-[10px] bg-[#0000aa] border-[#00ffff] mt-1.5"
            title={lang === 'es' ? 'Configurar el servidor y modelo del LLM local' : lang === 'de' ? 'Lokalen LLM-Server & Modell konfigurieren' : 'Configure local LLM server & model'}
          >
            <Server className="w-3.5 h-3.5 text-[#ffff55]" />
            <span>{lang === 'es' ? 'CONFIGURAR LLM LOCAL (Ollama / OpenAI)' : lang === 'de' ? 'LOKALES LLM KONFIGURIEREN (Ollama / OpenAI)' : 'CONFIGURE LOCAL LLM (Ollama / OpenAI)'}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsProviderManagerOpen(true)}
            className="nc-button w-full text-left flex items-center gap-1.5 text-[10px] bg-[#0000aa] border-[#00ffff] mt-1.5"
            title={lang === 'es' ? 'Gestionar todos los proveedores (API keys, hosts, modelos)' : lang === 'de' ? 'Alle Anbieter verwalten (API-Keys, Hosts, Modelle)' : 'Manage all providers (API keys, hosts, models)'}
          >
            <Settings className="w-3.5 h-3.5 text-[#ffff55]" />
            <span>{lang === 'es' ? 'GESTIONAR PROVEEDORES' : lang === 'de' ? 'ANBIETER VERWALTEN' : 'MANAGE PROVIDERS'}</span>
          </button>
        </div>

        {/* La instrucción del sistema vive en la pestaña INSTRUCCIONES. */}

        </>
        )}

        {settingsTab === 'parametros' && (
        <>
        {/* 3. Ejemplos (Few-Shot / Dataset Grid) */}
        <div className="space-y-1" ref={examplesRef}>
          <button 
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowExamples((prev) => !prev);
            }}
            className="w-full flex items-center justify-between text-[11px] font-bold text-[#ffff55] border-2 border-[#00ffff] p-1 bg-[#0000aa]"
          >
            <span>{showExamples ? (lang === 'es' ? '▲ OCULTAR EJEMPLOS' : lang === 'de' ? '▲ BEISPIELE AUSBLENDEN' : '▲ HIDE EXAMPLES') : (lang === 'es' ? '▼ EJEMPLOS (FEW-SHOT GRID)' : lang === 'de' ? '▼ FEW-SHOT-BEISPIELE' : '▼ FEW-SHOT EXAMPLES')}</span>
            <span className="text-[9px] text-[#00ffff] bg-[#000080] px-1">
              {parameters.examples.length}
            </span>
          </button>
          
          {showExamples && (
            <div className="bg-[#0000aa] border-2 border-[#00ffff] p-2 space-y-2">
              <button
                type="button"
                onClick={() => setIsDatasetModalOpen(true)}
                className="w-full bg-[#ffff55] text-black font-bold py-1 px-2 text-[10px] flex items-center justify-center gap-1.5 hover:bg-white border border-black"
              >
                <Database className="w-3.5 h-3.5 text-[#000080]" />
                <span>{lang === 'es' ? '🧪 ABRIR EDITOR DE DATASET & FINE-TUNING' : lang === 'de' ? '🧪 DATASET- & FINE-TUNING-EDITOR ÖFFNEN' : '🧪 OPEN DATASET & FINE-TUNING EDITOR'}</span>
              </button>

              {parameters.examples.map((ex) => (
                <div key={ex.id} className="border border-[#00ffff] p-1 bg-[#000080]">
                  <div className="text-[9px] text-[#00ffff] nc-x-scroll nc-x-nowrap">IN: {ex.input}</div>
                  <div className="text-[9px] text-[#ffff55] nc-x-scroll nc-x-nowrap">OUT: {ex.output}</div>
                </div>
              ))}
              <div className="space-y-1">
                <input 
                  placeholder={lang === 'es' ? "Agregar input rápido..." : lang === 'de' ? 'Schnelle Eingabe hinzufügen...' : "Add quick input..."}
                  className="w-full bg-[#000080] border border-[#00ffff] text-[10px] text-white p-1 outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value) {
                      const input = e.currentTarget.value;
                      const output = prompt(lang === 'es' ? "Output esperado para este ejemplo:" : lang === 'de' ? 'Erwartete Ausgabe für dieses Beispiel:' : "Expected output for this example:");
                      if (output) {
                          setParameters(p => ({
                              ...p,
                              examples: [...p.examples, { id: Date.now().toString(), input, output }]
                          }));
                      }
                      e.currentTarget.value = '';
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 4. Thinking Level (Gemini 3) */}
        {selectedModel.startsWith('gemini-3') && (
          <div className="border border-[#00ffff] bg-[#0000aa] p-2 space-y-1">
            <label className="text-[11px] font-bold text-[#ffff55] block">
              {t.thinkingLevel}:
            </label>
            <div className="grid grid-cols-3 gap-1">
              {(['MINIMAL', 'LOW', 'HIGH'] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setParameters((p) => ({ ...p, thinkingLevel: lvl }))}
                  className={`py-1 text-[10px] font-bold border transition-colors ${
                    parameters.thinkingLevel === lvl
                      ? 'bg-[#ffff55] text-black border-[#ffffff]'
                      : 'bg-[#000080] text-[#00ffff] border-[#00aaaa]'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 5. Stop Sequences */}
        <div className="border border-[#00ffff] bg-[#0000aa] p-2 space-y-1">
          <label className="text-[11px] font-bold text-[#ffff55] block">
            {lang === 'es' ? 'SECUENCIAS DE PARADA (STOP SEQUENCES):' : lang === 'de' ? 'STOPPSEQUENZEN:' : 'STOP SEQUENCES:'}
          </label>
          <div className="flex flex-wrap gap-1 mb-1">
            {(parameters.stopSequences || []).map((seq, idx) => (
              <span key={idx} className="bg-[#000080] border border-[#00ffff] text-[#ffff55] text-[9px] px-1.5 py-0.5 flex items-center gap-1 font-mono">
                {JSON.stringify(seq)}
                <button
                  type="button"
                  onClick={() => setParameters((p) => ({
                    ...p,
                    stopSequences: (p.stopSequences || []).filter((_, i) => i !== idx)
                  }))}
                  className="text-red-400 hover:text-white font-bold ml-1"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            type="text"
            placeholder={lang === 'es' ? "Escribe secuencia y presiona Enter (ej: END, ###)..." : lang === 'de' ? 'Sequenz eingeben und Enter drücken (z. B. END, ###)...' : "Type sequence and press Enter (e.g. END, ###)..."}
            className="w-full bg-[#000080] border border-[#00ffff] p-1 text-[10px] text-white outline-none font-mono"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value) {
                const val = e.currentTarget.value;
                setParameters((p) => ({
                  ...p,
                  stopSequences: [...(p.stopSequences || []), val]
                }));
                e.currentTarget.value = '';
              }
            }}
          />
        </div>

        {/* 6. Hugging Face Device */}
        {selectedProvider === 'huggingface' && (
          <div className="border border-[#ffff55] bg-[#0000aa] p-2 space-y-2 text-[#ffff55]">
            <label className="text-[11px] font-bold block">
              {lang === 'es' ? 'DISPOSITIVO HUGGING FACE:' : lang === 'de' ? 'HUGGING-FACE-GERÄT:' : 'HUGGING FACE DEVICE:'}
            </label>
            <div className="grid grid-cols-3 gap-1 text-[10px]">
              {(['webgpu', 'wasm', 'api'] as const).map((dev) => (
                <button
                  key={dev}
                  onClick={() => setParameters((p) => ({ ...p, hfDevice: dev }))}
                  className={`py-1 font-bold border ${
                    parameters.hfDevice === dev ? 'bg-[#ffff55] text-black border-white' : 'bg-[#000080] text-[#00ffff]'
                  }`}
                >
                  {dev.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 7. Temperature Slider */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] font-bold text-[#ffff55]">
            <span>{t.temperature}:</span>
            <span>{parameters.temperature.toFixed(2)}</span>
          </div>
          {showTooltips && (
            <div className="text-[9px] text-[#00aaaa] italic bg-[#000080] p-1 border border-[#000055]">
              💡 {t.tt_temperature}
            </div>
          )}
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={parameters.temperature}
            onChange={(e) => {
              const next = parseFloat(e.target.value);
              setParameters((p) => ({ ...p, temperature: next }));
            }}
            className="w-full bg-[#0000aa] accent-[#00ffff] h-2 border border-[#00ffff] cursor-pointer"
            title={showTooltips ? t.tt_temperature : undefined}
          />
        </div>

        {/* 8. Top P & Top K */}
        <div className="grid grid-cols-2 gap-2 text-[11px] font-bold text-[#ffff55]">
          <div>
            <span>TOP P: {parameters.topP.toFixed(2)}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={parameters.topP}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                setParameters((p) => ({ ...p, topP: next }));
              }}
              className="w-full bg-[#0000aa] accent-[#00ffff] h-2 border border-[#00ffff] cursor-pointer"
              title={showTooltips ? t.tt_topP : undefined}
            />
          </div>
          <div>
            <span>TOP K: {parameters.topK}</span>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={parameters.topK}
              onChange={(e) => {
                const next = parseInt(e.target.value);
                setParameters((p) => ({ ...p, topK: next }));
              }}
              className="w-full bg-[#0000aa] accent-[#00ffff] h-2 border border-[#00ffff] cursor-pointer"
              title={showTooltips ? t.tt_topK : undefined}
            />
          </div>
        </div>

        {/* 9. Format Toggle & Structured Output Designer */}
        <div className="pt-2 border-t border-[#00aaaa] space-y-2">
          <div className="flex items-center justify-between font-bold text-[#ffff55]">
            <span>{lang === 'es' ? 'FORMATO DE SALIDA:' : lang === 'de' ? 'AUSGABEFORMAT:' : 'OUTPUT FORMAT:'}</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setParameters((p) => ({ ...p, responseFormat: 'text' }))}
                className={`px-2 py-0.5 text-[10px] border ${
                  parameters.responseFormat === 'text' ? 'bg-[#00ffff] text-black font-bold' : 'bg-[#0000aa] text-white'
                }`}
              >
                {lang === 'es' ? 'TEXTO' : lang === 'de' ? 'TEXT' : 'TEXT'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setParameters((p) => ({ ...p, responseFormat: 'json' }));
                  setIsSchemaModalOpen(true);
                }}
                className={`px-2 py-0.5 text-[10px] border ${
                  parameters.responseFormat === 'json' ? 'bg-[#ffff55] text-black font-bold' : 'bg-[#0000aa] text-white'
                }`}
              >
                JSON (SCHEMA)
              </button>
            </div>
          </div>

          {parameters.responseFormat === 'json' && (
            <div className="bg-[#0000aa] border border-[#00ffff] p-2 space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[#ffff55] font-bold">{lang === 'es' ? 'ESQUEMA ESTRUCTURADO:' : lang === 'de' ? 'STRUKTURIERTES SCHEMA:' : 'STRUCTURED SCHEMA:'}</span>
                <span className="text-[#00ffff] font-mono text-[9px]">
                  {parameters.jsonSchema ? (lang === 'es' ? '✓ DEFINIDO' : lang === 'de' ? '✓ DEFINIERT' : '✓ DEFINED') : 'DEFAULT'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsSchemaModalOpen(true)}
                className="nc-button w-full text-center text-[10px] py-1 bg-[#00aaaa] text-black font-bold flex items-center justify-center gap-1.5"
              >
                <FileJson className="w-3.5 h-3.5" />
                <span>{lang === 'es' ? 'DISEÑADOR VISUAL JSON SCHEMA' : lang === 'de' ? 'VISUELLER JSON-SCHEMA-EDITOR' : 'VISUAL JSON SCHEMA DESIGNER'}</span>
              </button>
              {parameters.jsonSchema && (
                <button
                  type="button"
                  onClick={() => setParameters((p) => ({ ...p, jsonSchema: undefined }))}
                  className="w-full text-center text-[9px] text-red-300 hover:text-white underline pt-0.5"
                >
                  {lang === 'es' ? 'Restablecer a JSON libre' : lang === 'de' ? 'Auf freies JSON zurücksetzen' : 'Reset to freeform JSON'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 10. Tools & Grounding (Commander AI Studio Capabilities) */}
        {selectedProvider === 'google' && (
          <div className="pt-2 border-t border-[#00aaaa] space-y-2">
            <div className="text-[11px] font-bold text-[#ffff55] flex items-center justify-between">
              <span>{selectedModel === 'antigravity-preview-09-2026' ? '🔍 ANTIGRAVITY TOOL MATRIX:' : (lang === 'es' ? 'HERRAMIENTAS & GROUNDING:' : lang === 'de' ? 'TOOLS & GROUNDING:' : 'TOOLS & GROUNDING:')}</span>
              <span className="text-[9px] text-[#00ffff]">{selectedModel === 'antigravity-preview-09-2026' ? '[REMOTE SANDBOX]' : '[COMMANDER TOOLS]'}</span>
            </div>

            <div className="space-y-1.5">
              {/* Web Search Grounding */}
              <button
                type="button"
                onClick={() => setParameters((p) => ({
                  ...p,
                  tools: {
                    googleSearch: !p.tools?.googleSearch,
                    codeExecution: p.tools?.codeExecution || false,
                    urlContext: p.tools?.urlContext ?? true,
                    customFunctions: p.tools?.customFunctions || [],
                  }
                }))}
                className={`w-full flex items-center justify-between p-1.5 border text-[10px] font-bold transition-colors ${
                  parameters.tools?.googleSearch
                    ? 'bg-[#00ffff] text-black border-white'
                    : 'bg-[#0000aa] text-[#00ffff] border-[#00aaaa]'
                }`}
                data-tooltip={selectedModel === 'antigravity-preview-09-2026' ? 'google_search (Antigravity)' : 'Búsqueda Web en Vivo'}
                data-tooltip-sub={selectedModel === 'antigravity-preview-09-2026' ? 'Permite al agente buscar información actualizada en Google Search' : 'Conecta el modelo a internet para responder consultas recientes'}
              >
                <div className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" />
                  <span>{selectedModel === 'antigravity-preview-09-2026' ? 'google_search (Google Search)' : (lang === 'es' ? 'BÚSQUEDA WEB GROUNDING' : lang === 'de' ? 'WEBSUCHE ALS GRUNDLAGE' : 'WEB SEARCH GROUNDING')}</span>
                </div>
                <span>{parameters.tools?.googleSearch ? (lang === 'es' ? '[ACTIVO]' : lang === 'de' ? '[EIN]' : '[ON]') : '[OFF]'}</span>
              </button>

              {/* Python Code Execution Sandbox */}
              <button
                type="button"
                onClick={() => setParameters((p) => ({
                  ...p,
                  tools: {
                    googleSearch: p.tools?.googleSearch || false,
                    codeExecution: !p.tools?.codeExecution,
                    urlContext: p.tools?.urlContext ?? true,
                    customFunctions: p.tools?.customFunctions || [],
                  }
                }))}
                className={`w-full flex items-center justify-between p-1.5 border text-[10px] font-bold transition-colors ${
                  parameters.tools?.codeExecution
                    ? 'bg-[#ffff55] text-black border-white'
                    : 'bg-[#0000aa] text-[#ffff55] border-[#00aaaa]'
                }`}
                data-tooltip={selectedModel === 'antigravity-preview-09-2026' ? 'code_execution (Python Sandbox)' : 'Sandbox de Ejecución de Código'}
                data-tooltip-sub={selectedModel === 'antigravity-preview-09-2026' ? 'Permite al agente ejecutar scripts de Python/Bash reales en su contenedor' : 'Habilita al modelo a probar y ejecutar algoritmos en Python'}
              >
                <div className="flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>{selectedModel === 'antigravity-preview-09-2026' ? 'code_execution (Python & Bash)' : (lang === 'es' ? 'EJECUCIÓN DE CÓDIGO PYTHON' : lang === 'de' ? 'PYTHON-CODEAUSFÜHRUNG' : 'PYTHON CODE EXECUTION')}</span>
                </div>
                <span>{parameters.tools?.codeExecution ? (lang === 'es' ? '[ACTIVO]' : lang === 'de' ? '[EIN]' : '[ON]') : '[OFF]'}</span>
              </button>

              {/* URL Context (only relevant / highlighted for Antigravity) */}
              {selectedModel === 'antigravity-preview-09-2026' ? (
                <button
                  type="button"
                  onClick={() => setParameters((p) => ({
                    ...p,
                    tools: {
                      googleSearch: p.tools?.googleSearch || false,
                      codeExecution: p.tools?.codeExecution || false,
                      urlContext: !(p.tools?.urlContext ?? true),
                      customFunctions: p.tools?.customFunctions || [],
                    }
                  }))}
                  className={`w-full flex items-center justify-between p-1.5 border text-[10px] font-bold transition-colors ${
                    (parameters.tools?.urlContext ?? true)
                      ? 'bg-[#ff88ff] text-black border-white'
                      : 'bg-[#0000aa] text-[#ff88ff] border-[#00aaaa]'
                  }`}
                  data-tooltip="url_context (Inspección Web)"
                  data-tooltip-sub="Permite al agente visitar y extraer contenido de enlaces web específicos"
                >
                  <div className="flex items-center gap-1.5">
                    <FileJson className="w-3.5 h-3.5" />
                    <span>url_context (Extract URLs)</span>
                  </div>
                  <span>{(parameters.tools?.urlContext ?? true) ? (lang === 'es' ? '[ACTIVO]' : lang === 'de' ? '[EIN]' : '[ON]') : '[OFF]'}</span>
                </button>
              ) : (
                /* Custom Function Calling Sandbox */
                <button
                  type="button"
                  onClick={() => setIsFunctionModalOpen(true)}
                  className={`w-full flex items-center justify-between p-1.5 border text-[10px] font-bold transition-colors ${
                    (parameters.tools?.customFunctions?.length || 0) > 0
                      ? 'bg-[#00aaaa] text-black border-white'
                      : 'bg-[#0000aa] text-[#00ffff] border-[#00aaaa]'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5" />
                    <span>{lang === 'es' ? 'FUNCTION CALLING (HERRAMIENTAS)' : lang === 'de' ? 'EIGENE FUNKTIONSAUFRUFE' : 'CUSTOM FUNCTION CALLING'}</span>
                  </div>
                  <span>{(parameters.tools?.customFunctions?.length || 0) > 0 ? `[${parameters.tools?.customFunctions?.length}]` : '[OFF]'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 11. Seguridad (Safety Filters) */}
        <div className="space-y-1" ref={safetyRef}>
          <button 
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowSafety((prev) => !prev);
            }}
            className="w-full flex items-center justify-between text-[11px] font-bold text-[#ffff55] border-2 border-[#00ffff] p-1 bg-[#0000aa]"
          >
            <span>{showSafety ? (lang === 'es' ? '▲ OCULTAR FILTROS DE SEGURIDAD' : lang === 'de' ? '▲ SICHERHEITSFILTER AUSBLENDEN' : '▲ HIDE SAFETY FILTERS') : (lang === 'es' ? '▼ FILTROS DE SEGURIDAD (SAFETY SLIDERS)' : lang === 'de' ? '▼ SICHERHEITSFILTER (SCHIEBEREGLER)' : '▼ SAFETY FILTERS (SLIDERS)')}</span>
          </button>
          
          {showSafety && (
            <div className="bg-[#0000aa] border-2 border-[#00ffff] p-2 space-y-2.5 text-[10px]">
              {[
                { label: lang === 'es' ? 'ACOSO (HARASSMENT)' : lang === 'de' ? 'BELÄSTIGUNG' : 'HARASSMENT', key: 'safetyHarassment' },
                { label: lang === 'es' ? 'DISCURSO DE ODIO (HATE SPEECH)' : lang === 'de' ? 'HASSREDE' : 'HATE SPEECH', key: 'safetyHateSpeech' },
                { label: lang === 'es' ? 'CONTENIDO SEXUAL' : lang === 'de' ? 'SEXUELL EXPLIZIT' : 'SEXUALLY EXPLICIT', key: 'safetySexuallyExplicit' },
                { label: lang === 'es' ? 'CONTENIDO PELIGROSO' : lang === 'de' ? 'GEFÄHRLICHE INHALTE' : 'DANGEROUS CONTENT', key: 'safetyDangerousContent' },
              ].map((cat) => (
                <div key={cat.key} className="space-y-1">
                  <div className="flex justify-between font-bold text-[#00ffff]">
                    <span>{cat.label}:</span>
                    <span className="text-[#ffff55]">{(parameters as any)[cat.key]}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-0.5">
                    {(['BLOCK_NONE', 'BLOCK_FEW', 'BLOCK_SOME', 'BLOCK_MOST'] as const).map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setParameters((p) => ({ ...p, [cat.key]: val }))}
                        className={`py-0.5 text-[8px] font-bold border ${
                          (parameters as any)[cat.key] === val
                            ? 'bg-[#ffff55] text-black border-white'
                            : 'bg-[#000080] text-white border-[#00aaaa]'
                        }`}
                      >
                        {val.replace('BLOCK_', '')}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        </>
        )}

        {settingsTab === 'instrucciones' && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#ffff55] block">
              {tx('ROL E INSTRUCCIÓN DEL SISTEMA', 'ROLLE & SYSTEMANWEISUNG', 'ROLE & SYSTEM INSTRUCTION')}:
            </label>
            <select
              onChange={(e) => {
                const preset = SYSTEM_PRESETS.find((p) => p.id === e.target.value);
                if (preset) setParameters((p) => ({ ...p, systemInstruction: preset.instruction }));
              }}
              defaultValue=""
              aria-label={tx('Preset de rol', 'Rollenvorlage', 'Role preset')}
              className="w-full bg-[#0000aa] border border-[#00ffff] p-1 text-[10px] text-[#00ffff] font-bold outline-none cursor-pointer"
            >
              <option value="" disabled>{tx('⚡ PRESET DE ROL...', '⚡ ROLLENVORLAGE...', '⚡ ROLE PRESET...')}</option>
              {SYSTEM_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </select>
            <textarea
              value={parameters.systemInstruction}
              onChange={(e) => {
                // Capturar el valor en el evento: React restaura el DOM controlado
                // después y leer e.target.value dentro del updater daría el previo.
                const next = e.target.value;
                setParameters((p) => ({ ...p, systemInstruction: next }));
              }}
              rows={6}
              placeholder={tx('Instrucción del sistema...', 'Systemanweisung...', 'System instruction...')}
              aria-label={tx('Instrucciones del sistema', 'Systemanweisungen', 'System instructions')}
              className="w-full bg-[#000080] border border-[#00ffff] p-1.5 text-[10px] text-white outline-none resize-y font-mono leading-snug"
            />
            <p className="text-[9px] text-[#00ffff]/70">
              {tx('Va como rol del sistema en cada mensaje de esta pestaña.', 'Geht bei jeder Nachricht dieses Tabs als Systemrolle mit.', 'Goes as the system role with every message in this tab.')}
            </p>
          </div>
        )}

        {/* Acciones del prompt */}
        <div className="bg-[#000080] border-2 border-[#00ffff] p-2 space-y-1">
          <div className="text-[10px] font-bold text-[#ffff55] mb-1 flex items-center justify-between">
            <span>── {t.projectActions} ──</span>
            {onClose && (
              <button 
                type="button" 
                onClick={onClose} 
                className="text-[#ff5555] hover:text-white font-bold cursor-pointer text-[10px]"
                title={lang === 'es' ? 'Plegar panel' : lang === 'de' ? 'Panel einklappen' : 'Fold panel'}
              >
                [{lang === 'es' ? 'PLEGAR ✖' : lang === 'de' ? 'EINKLAPPEN ✖' : 'FOLD ✖'}]
              </button>
            )}
          </div>
          {onClose && (
            <button onClick={onClose} className="nc-button w-full text-left bg-red-900/60 text-white hover:bg-red-700 flex items-center justify-between">
              <span>{t.closePanel}</span>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onShowCodeModal} className="nc-button w-full text-left">
            {t.viewCode}
          </button>
          <button onClick={() => {
            const title = prompt(lang === 'es' ? "Título de la versión:" : lang === 'de' ? 'Titel der Version:' : "Version title:");
            const note = prompt(lang === 'es' ? "Nota (opcional):" : lang === 'de' ? 'Notiz (optional):' : "Note (optional):");
            if (title) onSaveVersion(title, note || undefined);
          }} className="nc-button w-full text-left">
            {t.saveVersion}
          </button>
          <button onClick={onViewHistory} className="nc-button w-full text-left">
            {t.viewHistory}
          </button>
        </div>
      </div>

      <JsonSchemaModal
        isOpen={isSchemaModalOpen}
        onClose={() => setIsSchemaModalOpen(false)}
        config={parameters.structuredOutput}
        onSaveSchema={(schemaStr, schemaCfg) => {
          setParameters((p) => ({
            ...p,
            responseFormat: 'json',
            jsonSchema: schemaStr,
            structuredOutput: schemaCfg,
          }));
        }}
      />

      <FunctionCallingModal
        isOpen={isFunctionModalOpen}
        onClose={() => setIsFunctionModalOpen(false)}
        functions={parameters.tools?.customFunctions || []}
        onSaveFunctions={(funcs) => {
          setParameters((p) => ({
            ...p,
            tools: {
              googleSearch: p.tools?.googleSearch || false,
              codeExecution: p.tools?.codeExecution || false,
              customFunctions: funcs,
            }
          }));
        }}
      />

      <DatasetFineTuningModal
        isOpen={isDatasetModalOpen}
        onClose={() => setIsDatasetModalOpen(false)}
        parameters={parameters}
        setParameters={setParameters}
        selectedModel={selectedModel}
      />
      <ProviderManager
        isOpen={isProviderManagerOpen}
        onClose={() => setIsProviderManagerOpen(false)}
        lang={lang}
      />
    </aside>
  );
};

// Live Preview Component
const PREVIEW_EMPTY_HINT = 'Enter a URL or load local HTML';
const COMMAND_PLACEHOLDER = 'Enter command...';

export const LivePreview: React.FC<{ 
  projectPath: string; 
  selectedModel: string;
  parameters: ParameterConfig;
}> = () => {
  const [previewUrl, setPreviewUrl] = useState<string>('http://localhost:3001');
  const [, setIsLoading] = useState(false);
  const [previewContent] = useState<string>('');
  const [mode, setMode] = useState<'iframe' | 'local'>('iframe');
  const reloadKey = useRef(0);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center gap-2 p-2 border-b border-[#004466] bg-[#00243e]">
        <span className="text-[10px] font-mono text-[#00ffff] flex-1 truncate">{mode === 'iframe' ? 'Iframe Preview' : 'Local HTML Preview'}</span>
        <input
          type="text"
          value={previewUrl}
          onChange={(e) => setPreviewUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setMode('iframe')}
          placeholder="http://localhost:3001"
          className="flex-1 bg-[#000d1a] text-[10px] font-mono text-[#00ffff] px-2 py-1 rounded border border-[#004466] outline-none focus:border-[#00ffff]"
        />
        <button
          onClick={() => { setMode(mode === 'iframe' ? 'local' : 'iframe'); reloadKey.current += 1; }}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded"
          title={mode === 'iframe' ? 'Switch to Local HTML' : 'Switch to Iframe'}
        >
          {mode === 'iframe' ? '📁' : '🌐'}
        </button>
        <button
          onClick={() => { reloadKey.current += 1; }}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded"
          title="Reload"
        >
          ↻
        </button>
      </div>
      <div className="flex-1 relative bg-white">
        {mode === 'local' && previewContent ? (
          <iframe
            key={`local-${reloadKey.current}`}
            srcDoc={previewContent}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            className="w-full h-full border-0 bg-white"
          />
        ) : previewUrl ? (
          <iframe
            key={`iframe-${previewUrl}-${reloadKey.current}`}
            src={previewUrl}
            className="w-full h-full border-0 bg-white"
            onLoad={() => setIsLoading(false)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-4 text-[#00ffff]/50">
            <span className="text-[11px] font-mono">{PREVIEW_EMPTY_HINT}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Live Console Component
export const LiveConsole: React.FC<{ 
  projectPath: string; 
  selectedModel: string;
}> = ({ selectedModel }) => {
  const [logs, setLogs] = useState<Array<{type: 'log' | 'error' | 'warn' | 'info', message: string, time: string}>>([]);
  const [command, setCommand] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (type: 'log' | 'error' | 'warn' | 'info', message: string) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev.slice(-99), { type, message, time }]);
  };

  const handleCommand = (cmd: string) => {
    addLog('log', `> ${cmd}`);
    setCommand('');
    // Simulate command execution
    setTimeout(() => {
      addLog('info', `Executing: ${cmd}`);
      setTimeout(() => {
        addLog('log', `Command completed: ${cmd}`);
      }, 500);
    }, 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && command.trim()) {
      handleCommand(command.trim());
    }
  };

  // Demo logs
  useEffect(() => {
    if (!isConnected) {
      setIsConnected(true);
      addLog('info', 'Console connected to project');
      addLog('log', 'Type commands to execute in the project context');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typeClasses: Record<'log' | 'error' | 'warn' | 'info', string> = {
    log: 'text-[var(--nc-text)]',
    error: 'text-red-300',
    warn: 'text-[var(--nc-text-accent)]',
    info: 'text-emerald-300',
  };

  return (
    <div className="flex flex-col h-full bg-[var(--nc-bg-panel)]">
      <div className="flex items-center gap-2 p-2 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)]">
        <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
        <span className="text-[10px] font-mono text-[var(--nc-text)]">{`Live Console - ${selectedModel}`}</span>
        <div className="flex-1" />
        <button
          onClick={() => setLogs([])}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded text-[10px]"
          title="Clear"
        >
          🗑
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[10px]">
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2 text-[var(--nc-text)]">
            <span className="shrink-0">{log.time}</span>
            <span className={`shrink-0 ${typeClasses[log.type]}`}>
              {log.type === 'error' ? '✗' : log.type === 'warn' ? '⚠' : log.type === 'info' ? 'ℹ' : '▶'}
            </span>
            <span className={typeClasses[log.type]}>{log.message}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
      <div className="flex gap-1 p-2 border-t border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)]">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={COMMAND_PLACEHOLDER}
          className="flex-1 bg-[var(--nc-bg-panel)] text-[var(--nc-text)] text-[10px] px-2 py-1 rounded border border-[var(--nc-border-dark)] outline-none"
        />
        <button
          onClick={() => command.trim() && handleCommand(command.trim())}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded"
        >
          ▶
        </button>
      </div>
    </div>
  );
};

// Network Monitor Component
export const NetworkMonitor: React.FC<{ projectPath: string }> = () => {
  const [requests, setRequests] = useState<Array<{
    id: string;
    method: string;
    url: string;
    status: number | 'pending';
    time: string;
    duration: number;
  }>>([]);
  const [filter, setFilter] = useState<'all' | 'xhr' | 'fetch' | 'ws'>('all');

  const addRequest = (req: { method: string; url: string }) => {
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const newReq = { ...req, id, status: 'pending' as const, time, duration: 0 };
    setRequests(prev => [...prev.slice(-49), newReq]);
    
    // Simulate response
    setTimeout(() => {
      setRequests(prev => prev.map(r => 
        r.id === id ? { 
          ...r, 
          status: Math.random() > 0.1 ? 200 : 500, 
          duration: Math.floor(Math.random() * 500) + 50 
        } : r
      ));
    }, Math.random() * 1000 + 200);
  };

  // Demo requests
  useEffect(() => {
    const demoRequests = [
      { method: 'POST', url: '/api/models/live' },
      { method: 'GET', url: '/api/agent/session/123/stream' },
      { method: 'POST', url: '/api/tools/execute' },
      { method: 'GET', url: '/api/files?path=src' },
    ];
    demoRequests.forEach((req, i) => setTimeout(() => addRequest(req), i * 300));
  }, []);

  return (
    <div className="flex flex-col h-full bg-[var(--nc-bg-panel)]">
      <div className="flex items-center gap-2 p-2 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)]">
        <span className="text-[10px] font-mono text-[var(--nc-text-accent)]">{'Network Monitor'}</span>
        <div className="flex-1" />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="bg-[var(--nc-bg-panel)] text-[var(--nc-text)] text-[9px] px-1 py-0.5 rounded border border-[var(--nc-border-dark)] outline-none"
        >
          <option value="all">All</option>
          <option value="xhr">XHR</option>
          <option value="fetch">Fetch</option>
          <option value="ws">WebSocket</option>
        </select>
        <button
          onClick={() => setRequests([])}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded text-[10px]"
          title="Clear"
        >
          🗑
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[9px]">
        {requests.length === 0 ? (
          <div className="text-center text-[var(--nc-text)] py-8">{'No requests captured'}</div>
        ) : (
          requests.slice().reverse().map((req) => (
            <div key={req.id} className="flex gap-2 px-1 py-0.5 bg-[var(--nc-bg-panel)] rounded border border-[var(--nc-border-dark)] hover:border-[var(--nc-border-light)] transition-colors">
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold ${req.method === 'GET' ? 'bg-emerald-400/20 text-emerald-300' : req.method === 'POST' ? 'bg-cyan-400/20 text-cyan-300' : req.method === 'DELETE' ? 'bg-red-400/20 text-red-300' : 'bg-yellow-400/20 text-yellow-300'}`}>
                {req.method}
              </span>
              <span className="flex-1 truncate text-[var(--nc-text)]">{req.url}</span>
              <span className={`shrink-0 font-bold ${req.status === 'pending' ? 'text-[var(--nc-text-accent)]' : req.status === 200 ? 'text-emerald-300' : 'text-red-300'}`}>
                {req.status === 'pending' ? '⏳' : req.status}
              </span>
              <span className="shrink-0 text-[var(--nc-text)]">{req.duration}ms</span>
              <span className="shrink-0 text-[var(--nc-text)]">{req.time}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default RightPanel;
