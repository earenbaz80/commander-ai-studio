import React from 'react';
import {
  X,
  Palette,
  Globe,
  Type,
  FolderOpen,
  Zap,
  Battery,
  BatteryCharging,
  Timer,
  Settings2,
  SlidersHorizontal,
  ArrowDown,
  ArrowUp,
  FileJson,
  FlaskConical,
  Plus,
  Trash2,
  Puzzle,
  HelpCircle,
  Info,
} from 'lucide-react';
import { ConsoleTheme } from './Header';
import { Language } from '../i18n/translations';
// El umbral lo consume el panel de subagentes; la clave y el aviso viven ahí
// para que no haya dos copias del nombre que se puedan desincronizar.
import { ATASCO_KEY, PREFERENCIAS_EVENT, normalizarUmbralAtasco } from './ServerSubAgents';
import { ProviderManager } from './panel/ProviderManager';
import { ExtensionsSettings } from './settings/ExtensionsSettings';
import { ParameterConfig, StructuredExample } from '../types/studio';
import { SYSTEM_PRESETS } from '../data/systemPresets';
import { GEMINI_FALLBACK_MODELS, MAX_FALLBACK_MODELS } from '../config/geminiModels';
import { probeFirstResponder, probeModel, type ChainProbeResult } from '../lib/modelProbe';

// El manual y la ficha se cargan sólo al abrir su sección: el panel de
// configuración no arrastra su contenido en el trozo de código inicial.
const HelpModalInline = React.lazy(() =>
  import('./HelpModal').then((m) => ({ default: m.HelpModal }))
);
const AboutModalInline = React.lazy(() =>
  import('./AboutModal').then((m) => ({ default: m.AboutModal }))
);

/** Secciones del único panel de configuración. */
export type SettingsSection =
  | 'general'
  | 'modelo'
  | 'proveedores'
  | 'agente'
  | 'extensiones'
  | 'ayuda'
  | 'acerca';

export interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: ConsoleTheme;
  setTheme?: (theme: ConsoleTheme) => void;
  lang?: Language;
  setLang?: (lang: Language) => void;
  showTooltips?: boolean;
  setShowTooltips?: (show: boolean) => void;
  lowResourceMode?: boolean;
  setLowResourceMode?: (low: boolean) => void;
  powerSaverMode?: boolean;
  setPowerSaverMode?: (power: boolean) => void;
  batteryInfo?: { level: number; charging: boolean; autoTriggered?: boolean } | null;
  defaultExportFolder?: string;
  setDefaultExportFolder?: (path: string) => void;
  /** Modelo activo, para que la sección de modelos no hable en abstracto. */
  selectedModel?: string;
  selectedProvider?: string;
  /** Parámetros de generación de la sesión activa. */
  parameters?: ParameterConfig;
  setParameters?: React.Dispatch<React.SetStateAction<ParameterConfig>>;
  /** Sección que se muestra al abrir (útil para accesos contextuales). */
  initialSection?: SettingsSection;
  /** Abre el gestor completo de extensiones (pestaña MCP con OAuth y tools). */
  onOpenExtensions?: () => void;

}

// Todos los colores salen de los tokens del tema (`--nc-*`). Los literales
// Norton que había aquí hacían que el modal se quedara azul con otro tema.
const selectClass =
  'bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-[var(--nc-text)] text-[11px] px-1 py-0.5 rounded-sm focus:outline-none focus:border-[var(--nc-text-accent)]';

/**
 * Fila de ajuste: etiqueta a la izquierda, control a la derecha y una pista
 * corta debajo. Antes cada fila era solo un nombre y un control, y no había
 * forma de saber qué hacía sin probarlo.
 */
const MenuRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ icon, label, hint, children }) => (
  <div className="flex items-start justify-between gap-3 px-2 py-1.5 text-[11px] text-[var(--nc-text)]">
    <span className="min-w-0">
      <span className="flex items-center gap-2">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {hint && <span className="block pl-6 text-[9px] leading-snug text-[var(--nc-text)] opacity-70">{hint}</span>}
    </span>
    <span className="shrink-0 pt-0.5">{children}</span>
  </div>
);

/** Control deslizante con su valor siempre visible. */
const ParamSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint: string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step, hint, onChange }) => (
  <div className="px-2 py-2 border-b border-[var(--nc-border-dark)] last:border-b-0">
    <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-[var(--nc-text-accent)]">
      <span>{label}</span>
      <span className="tabular-nums text-[var(--nc-text)]">{value.toFixed(step < 1 ? 2 : 0)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="mt-1 w-full h-2 bg-[var(--nc-bg-main)] accent-[var(--nc-text-accent)] border border-[var(--nc-border-light)] cursor-pointer"
      aria-label={label}
    />
    <p className="mt-0.5 text-[9px] leading-snug text-[var(--nc-text)] opacity-70">{hint}</p>
  </div>
);

export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  isOpen,
  onClose,
  theme = 'norton',
  setTheme,
  lang = 'es',
  setLang,
  showTooltips = true,
  setShowTooltips,
  lowResourceMode = false,
  setLowResourceMode,
  powerSaverMode = false,
  setPowerSaverMode,
  batteryInfo,
  defaultExportFolder = 'C:\\CommanderExports',
  setDefaultExportFolder,
  selectedModel,
  selectedProvider,
  parameters,
  setParameters,
  initialSection = 'general',
  onOpenExtensions,
}) => {
  const t = React.useCallback(
    (es: string, en: string, de: string) => (lang === 'es' ? es : lang === 'de' ? de : en),
    [lang]
  );

  const contentRef = React.useRef<HTMLDivElement>(null);
  /** Contenedor del diálogo: recibe el foco al abrir y encierra el tabulador. */
  const panelRef = React.useRef<HTMLDivElement>(null);

  // El panel reúne cuatro bloques largos: se navega por secciones en vez de
  // recorrer una página kilométrica. `initialSection` abre directo la sección
  // que pide cada acceso de la app.
  const [active, setActive] = React.useState<SettingsSection>(initialSection);
  React.useEffect(() => {
    if (isOpen) setActive(initialSection);
  }, [isOpen, initialSection]);
  React.useEffect(() => {
    // Al cambiar de sección el scroll arranca arriba, no a mitad del bloque.
    contentRef.current?.scrollTo?.({ top: 0 });
  }, [active]);

  const secciones: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: t('General', 'General', 'Allgemein'), icon: <Settings2 className="w-3.5 h-3.5" /> },
    { id: 'modelo', label: t('Modelo', 'Model', 'Modell'), icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
    { id: 'proveedores', label: t('Proveedores', 'Providers', 'Anbieter'), icon: <Globe className="w-3.5 h-3.5" /> },
    { id: 'agente', label: t('Agente', 'Agent', 'Agent'), icon: <Timer className="w-3.5 h-3.5" /> },
    {
      id: 'extensiones',
      label: t('Extensiones', 'Extensions', 'Erweiterungen'),
      icon: <Puzzle className="w-3.5 h-3.5" />,
    },
    { id: 'ayuda', label: t('Ayuda', 'Help', 'Hilfe'), icon: <HelpCircle className="w-3.5 h-3.5" /> },
    { id: 'acerca', label: t('Acerca de', 'About', 'Über'), icon: <Info className="w-3.5 h-3.5" /> },
  ];

  // Tamaño de texto (antes en el menú del Header; ahora solo aquí).
  const [fontScale, setFontScale] = React.useState<'normal' | 'lg' | 'xl'>('normal');

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('commander_font_scale');
      if (saved === 'lg' || saved === 'xl' || saved === 'normal') setFontScale(saved);
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  // Minutos que debe llevar un subagente corriendo para marcarse como atasco.
  // `atascoMin` es el valor vigente y `atascoDraft` lo que se está teclando:
  // acotar en cada pulsación impedía escribir «10» (el «1» ya se guardaba).
  const [atascoMin, setAtascoMin] = React.useState(5);
  const [atascoDraft, setAtascoDraft] = React.useState('5');

  // Cadena de respaldo de Gemini: se lee y se guarda en commander.json.
  const [fallback, setFallback] = React.useState<{
    models: string[];
    defaultModels: string[];
    configured: boolean;
  } | null>(null);
  const [fallbackDraft, setFallbackDraft] = React.useState('');
  const [fallbackStatus, setFallbackStatus] = React.useState<
    'idle' | 'loading' | 'saving' | 'saved' | 'error'
  >('idle');
  const [fallbackError, setFallbackError] = React.useState('');
  const [exampleDraft, setExampleDraft] = React.useState({ input: '', output: '' });
  const [probeResults, setProbeResults] = React.useState<
    Record<string, { status: 'working' | 'ok' | 'substituted' | 'failed'; detail: string }>
  >({});
  const [lastProbe, setLastProbe] = React.useState<{
    status: 'working' | 'ok' | 'substituted' | 'failed';
    detail: string;
  } | null>(null);
  const [chainProbe, setChainProbe] = React.useState<{
    running: boolean;
    result?: ChainProbeResult;
  } | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setFallbackStatus('loading');
    setFallbackError('');
    fetch('/api/gemini/fallback-models')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'No se pudo leer la cadena de respaldo');
        }
        if (cancelled) return;
        setFallback({
          models: Array.isArray(data.models) ? data.models : [],
          defaultModels: Array.isArray(data.defaultModels) ? data.defaultModels : [],
          configured: data.configured === true,
        });
        setFallbackStatus('idle');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFallbackStatus('error');
        setFallbackError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const saveFallback = async (models: string[]) => {
    setFallbackStatus('saving');
    setFallbackError('');
    try {
      const response = await fetch('/api/gemini/fallback-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'No se pudo guardar la cadena de respaldo');
      }
      setFallback((prev) => ({
        models: Array.isArray(data.models) ? data.models : models,
        defaultModels: prev?.defaultModels ?? [],
        configured: true,
      }));
      // La cadena cambió: el resultado anterior ya no describe este orden.
      setChainProbe(null);
      setLastProbe(null);
      setFallbackStatus('saved');
    } catch (error) {
      setFallbackStatus('error');
      setFallbackError(error instanceof Error ? error.message : String(error));
    }
  };

  const addFallbackModel = () => {
    if (!fallback) return;
    const model = fallbackDraft.trim();
    if (!model) return;
    if (fallback.models.includes(model)) {
      setFallbackStatus('error');
      setFallbackError(
        t('Ese modelo ya está en la lista.', 'That model is already in the list.', 'Dieses Modell steht bereits in der Liste.')
      );
      return;
    }
    if (fallback.models.length >= MAX_FALLBACK_MODELS) {
      setFallbackStatus('error');
      setFallbackError(
        t(
          `Máximo ${MAX_FALLBACK_MODELS} modelos.`,
          `Maximum ${MAX_FALLBACK_MODELS} models.`,
          `Höchstens ${MAX_FALLBACK_MODELS} Modelle.`
        )
      );
      return;
    }
    setFallbackDraft('');
    void saveFallback([...fallback.models, model]);
  };

  const moveFallbackModel = (index: number, delta: number) => {
    if (!fallback) return;
    const target = index + delta;
    if (target < 0 || target >= fallback.models.length) return;
    const models = [...fallback.models];
    [models[index], models[target]] = [models[target], models[index]];
    void saveFallback(models);
  };

  const removeFallbackModel = (model: string) => {
    if (!fallback) return;
    void saveFallback(fallback.models.filter((id) => id !== model));
  };

  const probeFallbackModel = async (modelId: string) => {
    setProbeResults((prev) => ({ ...prev, [modelId]: { status: 'working', detail: '' } }));
    setLastProbe({
      status: 'working',
      detail: t(`Probando ${modelId}…`, `Testing ${modelId}…`, `Teste ${modelId}…`),
    });
    // Sin respaldo: un «✓» debe significar que respondió ESTE modelo.
    const result = await probeModel({ baseUrl: '', model: modelId, disableFallback: true });
    const detail =
      result.status === 'ok'
        ? `${modelId}: ${t('responde', 'responds', 'antwortet')}`
        : result.status === 'substituted'
        ? `${modelId}: ${t('respondió otro modelo', 'another model answered', 'ein anderes Modell antwortete')} (${result.fallback?.to ?? '?'})`
        : `${modelId}: ${result.error || t('sin respuesta', 'no response', 'keine Antwort')}`;
    setProbeResults((prev) => ({ ...prev, [modelId]: { status: result.status, detail } }));
    setLastProbe({ status: result.status, detail });
  };

  const probeFallbackChain = async () => {
    const models = fallback?.models ?? [];
    if (models.length === 0) return;
    setChainProbe({ running: true });
    setLastProbe(null);
    const result = await probeFirstResponder(models, (model) =>
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
  };

  const jsonSchemaError = React.useMemo(() => {
    if (!parameters || parameters.responseFormat !== 'json') return null;
    const raw = parameters.jsonSchema?.trim();
    if (!raw) return null;
    try {
      JSON.parse(raw);
      return null;
    } catch {
      return t(
        'El esquema no es JSON válido.',
        'The schema is not valid JSON.',
        'Das Schema ist kein gültiges JSON.'
      );
    }
  }, [parameters, t]);

  React.useEffect(() => {
    try {
      const guardado = Number(localStorage.getItem(ATASCO_KEY));
      if (Number.isFinite(guardado) && guardado > 0) {
        const minutos = normalizarUmbralAtasco(guardado);
        setAtascoMin(minutos);
        setAtascoDraft(String(minutos));
      }
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  // Se valida al salir del campo (o con Enter), no mientras se escribe.
  const confirmarAtasco = () => {
    const crudo = atascoDraft.trim();
    // Campo vacío o no numérico: se restaura el valor vigente sin tocarlo.
    const minutos = crudo === '' ? atascoMin : normalizarUmbralAtasco(Number(crudo));
    setAtascoDraft(String(minutos));
    if (minutos === atascoMin) return;
    setAtascoMin(minutos);
    try {
      localStorage.setItem(ATASCO_KEY, String(minutos));
      // El panel ya montado se entera sin esperar a recargar.
      window.dispatchEvent(new Event(PREFERENCIAS_EVENT));
    } catch {
      /* sin almacenamiento */
    }
  };

  const handleSetFontScale = (scale: 'normal' | 'lg' | 'xl') => {
    setFontScale(scale);
    try {
      localStorage.setItem('commander_font_scale', scale);
      document.documentElement.classList.remove('font-scale-normal', 'font-scale-lg', 'font-scale-xl');
      document.documentElement.classList.add(`font-scale-${scale}`);
    } catch (e) {
      console.warn('Failed to persist font scale', e);
    }
  };

  // Todo vive en una sola página: el acceso contextual solo desplaza hasta
  // su bloque. No hay navegación interna ni un menú dentro de otro.
  React.useEffect(() => {
    if (!isOpen) return;
    const target = contentRef.current?.querySelector<HTMLElement>(
      `[data-settings-section="${initialSection}"]`
    );
    target?.scrollIntoView?.({ block: 'start' });
  }, [isOpen, initialSection]);

  React.useEffect(() => {
    if (!isOpen) return;
    // El fondo sigue montado tras el modal: el foco entra en el panel y el
    // tabulador da la vuelta dentro, en vez de escaparse a la aplicación.
    const previo = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const primero = focusables[0];
      const ultimo = focusables[focusables.length - 1];
      const activo = document.activeElement as HTMLElement | null;
      const fuera = !activo || activo === panel || !panel.contains(activo);
      if (e.shiftKey && (activo === primero || fuera)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (activo === ultimo || fuera)) {
        e.preventDefault();
        primero.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Devolver el foco a quien abrió el modal (botón del Header o Ctrl+,).
      previo?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const groupTitle = (title: string) => (
    <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--nc-text-accent)] border-b border-[var(--nc-border-dark)] pb-1">
      {title}
    </h3>
  );

  const sectionBlock = (title: string, body: React.ReactNode) => (
    <div className="border border-[var(--nc-border-light)] rounded bg-[var(--nc-bg-panel)] overflow-hidden">
      <div className="px-2 py-1 border-b border-[var(--nc-border-light)] text-[11px] font-bold text-[var(--nc-text-accent)] uppercase">
        {title}
      </div>
      <div className="py-1">{body}</div>
    </div>
  );

  const updateParam = <K extends keyof ParameterConfig,>(key: K, value: ParameterConfig[K]) => {
    setParameters?.((prev) => ({ ...prev, [key]: value }));
  };

  const updateTools = (patch: Partial<NonNullable<ParameterConfig['tools']>>) => {
    setParameters?.((prev) => ({
      ...prev,
      tools: {
        googleSearch: prev.tools?.googleSearch ?? false,
        codeExecution: prev.tools?.codeExecution ?? false,
        urlContext: prev.tools?.urlContext ?? true,
        ...patch,
      },
    }));
  };

  const addExample = () => {
    const input = exampleDraft.input.trim();
    const output = exampleDraft.output.trim();
    if (!input || !output) return;
    setParameters?.((prev) => ({
      ...prev,
      examples: [
        ...(prev.examples ?? []),
        {
          id: `few-shot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          input,
          output,
        },
      ],
    }));
    setExampleDraft({ input: '', output: '' });
  };

  const updateExample = (id: string, patch: Partial<StructuredExample>) => {
    setParameters?.((prev) => ({
      ...prev,
      examples: (prev.examples ?? []).map((example) =>
        example.id === id ? { ...example, ...patch } : example
      ),
    }));
  };

  const removeExample = (id: string) => {
    setParameters?.((prev) => ({
      ...prev,
      examples: (prev.examples ?? []).filter((example) => example.id !== id),
    }));
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-4xl h-[calc(100vh-3rem)] max-h-[720px] mx-3">
        <div
          ref={panelRef}
          tabIndex={-1}
          className="nc-panel flex flex-col h-full w-full border-2 border-[var(--nc-border-light)] rounded-lg overflow-hidden shadow-[0_0_40px_rgba(0,255,255,0.25)] outline-none"
          role="dialog"
          aria-modal="true"
          aria-label={t('Configuración', 'Settings', 'Einstellungen')}
        >
          <div className="flex items-center justify-between px-3 py-2 bg-[var(--nc-header-bg)] border-b-2 border-[var(--nc-border-dark)] shrink-0">
            <div className="min-w-0">
              <div className="text-[var(--nc-header-text)] font-bold text-sm">
                {t('Configuración', 'Settings', 'Einstellungen')}
              </div>
              <div className="text-[10px] text-[var(--nc-header-text)] opacity-70 truncate">
                {t(
                  'Modelo, proveedores, apariencia, agente, extensiones, ayuda y rutas en un solo lugar',
                  'Model, providers, appearance, agent, extensions, help and paths in one place',
                  'Modell, Anbieter, Darstellung, Agent, Erweiterungen, Hilfe und Pfade an einem Ort'
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--nc-header-text)] hover:text-red-500 font-bold text-lg leading-none px-1 shrink-0"
              title={t('Cerrar (Escape)', 'Close (Escape)', 'Schließen (Escape)')}
              aria-label={t('Cerrar', 'Close', 'Schließen')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
            <nav
              aria-label={t('Secciones de configuración', 'Settings sections', 'Einstellungsbereiche')}
              className="flex sm:flex-col flex-row flex-wrap gap-1 p-2 border-b sm:border-b-0 sm:border-r border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] sm:w-44 shrink-0"
            >
              {secciones.map((seccion) => {
                const activa = active === seccion.id;
                return (
                  <button
                    key={seccion.id}
                    type="button"
                    onClick={() => setActive(seccion.id)}
                    aria-current={activa ? 'page' : undefined}
                    className={`nc-button !py-1 !px-2 text-[10px] font-bold flex items-center gap-1.5 justify-start ${
                      activa
                        ? 'bg-[var(--nc-active-bg)] text-[var(--nc-active-text)]'
                        : 'bg-[var(--nc-bg-panel)] text-[var(--nc-text)]'
                    }`}
                  >
                    {seccion.icon}
                    <span className="truncate">{seccion.label}</span>
                  </button>
                );
              })}
            </nav>

            <div ref={contentRef} className="flex-1 min-w-0 h-full overflow-y-auto p-3 space-y-5 bg-[var(--nc-bg-panel)] text-[var(--nc-text)]">
              {active === 'general' && (
              <section data-settings-section="general" className="space-y-3 scroll-mt-2">
                {groupTitle(t('General', 'General', 'Allgemein'))}
                {sectionBlock(
                    t('Apariencia e idioma', 'Appearance & language', 'Darstellung & Sprache'),
                    <>
                      <MenuRow icon={<Globe className="w-4 h-4 text-[var(--nc-text)]" />} label={t('Idioma', 'Language', 'Sprache')}>
                        <select
                          value={lang}
                          onChange={(e) => setLang && setLang(e.target.value as Language)}
                          className={selectClass}
                          aria-label={t('Idioma', 'Language', 'Sprache')}
                        >
                          <option value="es">Español</option>
                          <option value="en">English</option>
                          <option value="de">Deutsch</option>
                        </select>
                      </MenuRow>
                      <MenuRow
                        icon={<Palette className="w-4 h-4 text-[var(--nc-text)]" />}
                        label={t('Tema', 'Theme', 'Design')}
                        hint={t('Se aplica al instante en toda la app', 'Applies instantly across the app', 'Gilt sofort in der ganzen App')}
                      >
                        <select
                          value={theme}
                          onChange={(e) => setTheme && setTheme(e.target.value as ConsoleTheme)}
                          className={selectClass}
                          aria-label={t('Tema', 'Theme', 'Design')}
                        >
                          <option value="norton">Norton Retro</option>
                          <option value="matrix">Matrix Green</option>
                          <option value="amber">Amber Terminal</option>
                          <option value="dos">DOS Retro</option>
                          <option value="light">{t('Claro (papel)', 'Light (paper)', 'Hell (Papier)')}</option>
                          <option value="solarized">{t('Solarizado (oscuro)', 'Solarized (dark)', 'Solarized (dunkel)')}</option>
                        </select>
                      </MenuRow>
                      <MenuRow
                        icon={<Settings2 className="w-4 h-4 text-[var(--nc-text)]" />}
                        label={t('Tooltips', 'Tooltips', 'Tooltips')}
                        hint={t('Descripciones al pasar el ratón', 'Hover descriptions', 'Beschreibungen beim Überfahren')}
                      >
                        <input
                          type="checkbox"
                          checked={showTooltips}
                          onChange={(e) => setShowTooltips && setShowTooltips(e.target.checked)}
                          className="accent-[var(--nc-text)]"
                          aria-label={t('Mostrar tooltips', 'Show tooltips', 'Tooltips anzeigen')}
                        />
                      </MenuRow>
                      <MenuRow icon={<Type className="w-4 h-4 text-[var(--nc-text)]" />} label={t('Tamaño de texto', 'Text size', 'Textgröße')}>
                        <select
                          value={fontScale}
                          onChange={(e) => handleSetFontScale(e.target.value as 'normal' | 'lg' | 'xl')}
                          className={selectClass}
                          aria-label={t('Tamaño de texto', 'Text size', 'Textgröße')}
                        >
                          <option value="normal">Normal</option>
                          <option value="lg">{t('Grande', 'Large', 'Groß')}</option>
                          <option value="xl">{t('Muy grande', 'Extra large', 'Sehr groß')}</option>
                        </select>
                      </MenuRow>
                    </>
                  )}

                  {sectionBlock(
                    t('Rendimiento y energía', 'Performance & power', 'Leistung & Energie'),
                    <>
                      <MenuRow
                        icon={<Zap className="w-4 h-4 text-[var(--nc-text)]" />}
                        label={t('Modo bajo recursos', 'Low resource mode', 'Modus für wenig Ressourcen')}
                        hint={t('Quita sombras y efectos que más cuestan', 'Drops the heaviest shadows and effects', 'Entfernt die teuersten Schatten und Effekte')}
                      >
                        <input
                          type="checkbox"
                          checked={lowResourceMode}
                          onChange={(e) => setLowResourceMode && setLowResourceMode(e.target.checked)}
                          className="accent-[var(--nc-text)]"
                          aria-label={t('Modo bajo recursos', 'Low resource mode', 'Modus für wenig Ressourcen')}
                        />
                      </MenuRow>
                      <MenuRow
                        icon={batteryInfo?.charging ? <BatteryCharging className="w-4 h-4 text-[var(--nc-text)]" /> : <Battery className="w-4 h-4 text-[var(--nc-text)]" />}
                        label={t('Ahorro de batería', 'Power saver', 'Energiesparmodus')}
                        hint={t('Frena animaciones y brillos', 'Slows animations and glows', 'Drosselt Animationen und Glühen')}
                      >
                        <input
                          type="checkbox"
                          checked={powerSaverMode}
                          onChange={(e) => setPowerSaverMode && setPowerSaverMode(e.target.checked)}
                          className="accent-[var(--nc-text)]"
                          aria-label={t('Ahorro de batería', 'Power saver', 'Energiesparmodus')}
                        />
                      </MenuRow>
                      {batteryInfo && (
                        <div className="px-2 py-0.5 text-[9px] text-[var(--nc-text)] opacity-60">
                          {t('Batería', 'Battery', 'Akku')}: {Math.round(batteryInfo.level)}%{' '}
                          {batteryInfo.charging ? '• ' + t('cargando', 'charging', 'lädt') : ''}
                          {batteryInfo.autoTriggered ? ' • ' + t('ahorro automático', 'auto saver', 'automatisch') : ''}
                        </div>
                      )}
                    </>
                  )}

                  {sectionBlock(
                    t('Rutas', 'Paths', 'Pfade'),
                    <MenuRow
                      icon={<FolderOpen className="w-4 h-4 text-[var(--nc-text)]" />}
                      label={t('Carpeta de exportación', 'Export folder', 'Exportordner')}
                      hint={t(
                        'Destino por defecto de Compilar / Exportar proyecto',
                        'Default destination for Compile / Export project',
                        'Standardziel für Kompilieren / Projekt exportieren'
                      )}
                    >
                      <input
                        type="text"
                        value={defaultExportFolder}
                        onChange={(e) => setDefaultExportFolder && setDefaultExportFolder(e.target.value)}
                        className="bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-[var(--nc-text)] text-[10px] px-1 py-0.5 rounded w-64 max-w-[42vw] outline-none focus:border-[var(--nc-text-accent)]"
                        aria-label={t('Carpeta de exportación', 'Export folder', 'Exportordner')}
                      />
                    </MenuRow>
                  )}
              </section>
              )}

              {active === 'modelo' && (
              <section data-settings-section="modelo" className="space-y-3 scroll-mt-2">
                {groupTitle(t('Modelo', 'Model', 'Modell'))}
                {sectionBlock(
                    t('Modelo activo', 'Active model', 'Aktives Modell'),
                    <MenuRow
                      icon={<SlidersHorizontal className="w-4 h-4 text-[var(--nc-text)]" />}
                      label={selectedModel || '—'}
                      hint={
                        selectedProvider
                          ? t(`Proveedor: ${selectedProvider}`, `Provider: ${selectedProvider}`, `Anbieter: ${selectedProvider}`)
                          : t('Elige el modelo en el compositor', 'Pick the model in the composer', 'Modell im Composer wählen')
                      }
                    >
                      <span className="text-[9px] text-[var(--nc-text)] opacity-70">
                        {t('Cambiar en el compositor', 'Change in composer', 'Im Composer ändern')}
                      </span>
                    </MenuRow>
                  )}

                  {!parameters || !setParameters ? (
                    <div className="text-[10px] text-[var(--nc-text)] opacity-70 px-2 py-2">
                      {t('No hay una sesión activa.', 'No active session.', 'Keine aktive Sitzung.')}
                    </div>
                  ) : (
                    <>
                      {sectionBlock(
                        t('Parámetros de generación', 'Generation parameters', 'Generierungsparameter'),
                        <>
                          <ParamSlider
                            label={t('Temperatura', 'Temperature', 'Temperatur')}
                            value={parameters.temperature}
                            min={0}
                            max={2}
                            step={0.05}
                            hint={t(
                              'Más alta = más creatividad; más baja = respuestas más deterministas.',
                              'Higher = more creative; lower = more deterministic answers.',
                              'Höher = kreativer; niedriger = deterministischer.'
                            )}
                            onChange={(value) => updateParam('temperature', value)}
                          />
                          <ParamSlider
                            label={t('Top P', 'Top P', 'Top P')}
                            value={parameters.topP}
                            min={0}
                            max={1}
                            step={0.05}
                            hint={t(
                              'Núcleo de probabilidad. 0.95 es un buen equilibrio general.',
                              'Probability nucleus. 0.95 is a good general balance.',
                              'Wahrscheinlichkeitskern. 0,95 ist ein guter allgemeiner Wert.'
                            )}
                            onChange={(value) => updateParam('topP', value)}
                          />
                          <ParamSlider
                            label={t('Top K', 'Top K', 'Top K')}
                            value={parameters.topK}
                            min={1}
                            max={100}
                            step={1}
                            hint={t(
                              'Limita cuántos candidatos considera el modelo en cada paso.',
                              'Limits how many candidates the model considers at each step.',
                              'Begrenzt die Kandidaten, die das Modell pro Schritt prüft.'
                            )}
                            onChange={(value) => updateParam('topK', value)}
                          />
                          <MenuRow
                            icon={<Settings2 className="w-4 h-4 text-[var(--nc-text)]" />}
                            label={t('Máximo de tokens', 'Max tokens', 'Maximale Token')}
                            hint={t(
                              'Longitud máxima de la respuesta generada.',
                              'Maximum length of the generated response.',
                              'Maximale Länge der generierten Antwort.'
                            )}
                          >
                            <input
                              type="number"
                              min={1}
                              max={32768}
                              value={parameters.maxTokens}
                              onChange={(e) => {
                                const next = Number.parseInt(e.target.value, 10);
                                if (Number.isFinite(next) && next > 0) updateParam('maxTokens', Math.min(32768, next));
                              }}
                              className="bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-[var(--nc-text)] text-[10px] px-1 py-0.5 rounded w-20 outline-none focus:border-[var(--nc-text-accent)]"
                              aria-label={t('Máximo de tokens', 'Max tokens', 'Maximale Token')}
                            />
                          </MenuRow>
                          {selectedModel?.startsWith('gemini-3') && (
                            <MenuRow
                              icon={<Zap className="w-4 h-4 text-[var(--nc-text)]" />}
                              label={t('Nivel de razonamiento', 'Thinking level', 'Denkstufe')}
                              hint={t(
                                'Solo para Gemini 3: más nivel cuesta más tokens.',
                                'Gemini 3 only: a higher level costs more tokens.',
                                'Nur Gemini 3: eine höhere Stufe kostet mehr Token.'
                              )}
                            >
                              <div className="flex gap-1">
                                {(['MINIMAL', 'LOW', 'HIGH'] as const).map((level) => (
                                  <button
                                    key={level}
                                    type="button"
                                    onClick={() => updateParam('thinkingLevel', level)}
                                    className={`px-1.5 py-0.5 text-[9px] font-bold border ${
                                      parameters.thinkingLevel === level
                                        ? 'bg-[var(--nc-highlight-bg)] text-black border-white'
                                        : 'bg-[var(--nc-bg-main)] text-[var(--nc-text)] border-[var(--nc-border-mid)]'
                                    }`}
                                  >
                                    {level}
                                  </button>
                                ))}
                              </div>
                            </MenuRow>
                          )}
                        </>
                      )}

                      {sectionBlock(
                        t('Salida estructurada', 'Structured output', 'Strukturierte Ausgabe'),
                        <div className="px-2 py-1.5 space-y-1.5">
                          <MenuRow
                            icon={<FileJson className="w-4 h-4 text-[var(--nc-text)]" />}
                            label={t('Formato de respuesta', 'Response format', 'Antwortformat')}
                            hint={t(
                              'JSON obliga al modelo a devolver un objeto válido.',
                              'JSON forces the model to return a valid object.',
                              'JSON zwingt das Modell, ein gültiges Objekt zurückzugeben.'
                            )}
                          >
                            <div className="flex gap-1">
                              {(['text', 'json'] as const).map((format) => (
                                <button
                                  key={format}
                                  type="button"
                                  onClick={() => updateParam('responseFormat', format)}
                                  className={`px-1.5 py-0.5 text-[9px] font-bold border ${
                                    parameters.responseFormat === format
                                      ? 'bg-[var(--nc-highlight-bg)] text-black border-white'
                                      : 'bg-[var(--nc-bg-main)] text-[var(--nc-text)] border-[var(--nc-border-mid)]'
                                  }`}
                                >
                                  {format === 'text' ? t('TEXTO', 'TEXT', 'TEXT') : 'JSON'}
                                </button>
                              ))}
                            </div>
                          </MenuRow>
                          {parameters.responseFormat === 'json' && (
                            <>
                              <textarea
                                value={parameters.jsonSchema ?? ''}
                                onChange={(e) => updateParam('jsonSchema', e.target.value)}
                                rows={4}
                                spellCheck={false}
                                placeholder={'{\n  "type": "object",\n  "properties": {}\n}'}
                                aria-label={t('Esquema JSON', 'JSON schema', 'JSON-Schema')}
                                className="w-full bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] p-1.5 text-[10px] text-[var(--nc-text)] outline-none resize-y font-mono leading-snug"
                              />
                              <p
                                className={`text-[9px] ${
                                  jsonSchemaError
                                    ? 'text-[var(--nc-danger)]'
                                    : 'text-[var(--nc-text)] opacity-70'
                                }`}
                              >
                                {jsonSchemaError
                                  ? jsonSchemaError
                                  : t(
                                      'Opcional. Se envía como responseSchema; déjalo vacío para JSON libre.',
                                      'Optional. Sent as responseSchema; leave empty for freeform JSON.',
                                      'Optional. Wird als responseSchema gesendet; leer lassen für freies JSON.'
                                    )}
                              </p>
                            </>
                          )}
                        </div>
                      )}

                      {sectionBlock(
                        t('Herramientas de Gemini', 'Gemini tools', 'Gemini-Werkzeuge'),
                        <div className="px-2 py-1.5 space-y-1.5">
                          <p className="text-[9px] text-[var(--nc-text)] opacity-70">
                            {t(
                              'Solo se aplican a Gemini. Si el modelo no las soporta, el servidor puede desactivarlas.',
                              'Gemini only. If the model does not support them, the server can turn them off.',
                              'Nur für Gemini. Wenn das Modell sie nicht unterstützt, kann der Server sie abschalten.'
                            )}
                          </p>
                          <label className="flex items-start justify-between gap-2 text-[10px] cursor-pointer">
                            <span>
                              <span className="font-bold text-[var(--nc-text-accent)]">
                                {t('Búsqueda web', 'Web search', 'Websuche')}
                              </span>
                              <span className="block text-[9px] opacity-70">
                                {t('Grounding con Google Search.', 'Grounding with Google Search.', 'Grounding mit Google Search.')}
                              </span>
                            </span>
                            <input
                              type="checkbox"
                              checked={parameters.tools?.googleSearch ?? false}
                              onChange={(e) => updateTools({ googleSearch: e.target.checked })}
                              className="accent-[var(--nc-text)] mt-0.5"
                              aria-label={t('Búsqueda web', 'Web search', 'Websuche')}
                            />
                          </label>
                          <label className="flex items-start justify-between gap-2 text-[10px] cursor-pointer">
                            <span>
                              <span className="font-bold text-[var(--nc-text-accent)]">
                                {t('Ejecución de código', 'Code execution', 'Codeausführung')}
                              </span>
                              <span className="block text-[9px] opacity-70">
                                {t('Sandbox de Python del proveedor.', 'Provider Python sandbox.', 'Python-Sandbox des Anbieters.')}
                              </span>
                            </span>
                            <input
                              type="checkbox"
                              checked={parameters.tools?.codeExecution ?? false}
                              onChange={(e) => updateTools({ codeExecution: e.target.checked })}
                              className="accent-[var(--nc-text)] mt-0.5"
                              aria-label={t('Ejecución de código', 'Code execution', 'Codeausführung')}
                            />
                          </label>
                          {selectedModel === 'antigravity-preview-09-2026' && (
                            <label className="flex items-start justify-between gap-2 text-[10px] cursor-pointer">
                              <span>
                                <span className="font-bold text-[var(--nc-text-accent)]">
                                  {t('Contexto de URLs', 'URL context', 'URL-Kontext')}
                                </span>
                                <span className="block text-[9px] opacity-70">
                                  {t(
                                    'Permite leer enlaces durante la sesión.',
                                    'Lets the agent read links during the session.',
                                    'Erlaubt dem Agenten, Links zu lesen.'
                                  )}
                                </span>
                              </span>
                              <input
                                type="checkbox"
                                checked={parameters.tools?.urlContext ?? true}
                                onChange={(e) => updateTools({ urlContext: e.target.checked })}
                                className="accent-[var(--nc-text)] mt-0.5"
                                aria-label={t('Contexto de URLs', 'URL context', 'URL-Kontext')}
                              />
                            </label>
                          )}
                        </div>
                      )}

                      {sectionBlock(
                        t('Cadena de respaldo', 'Fallback chain', 'Ausweichkette'),
                        <div className="px-2 py-1.5 space-y-2">
                          <p className="text-[9px] text-[var(--nc-text)] opacity-70">
                            {t(
                              `Solo Gemini. Hasta ${MAX_FALLBACK_MODELS} modelos, en orden de prioridad.`,
                              `Gemini only. Up to ${MAX_FALLBACK_MODELS} models, in priority order.`,
                              `Nur Gemini. Bis zu ${MAX_FALLBACK_MODELS} Modelle, nach Priorität.`
                            )}
                          </p>
                          {fallbackStatus === 'loading' && (
                            <p className="text-[9px] text-[var(--nc-text)] opacity-70">
                              {t('Cargando cadena…', 'Loading chain…', 'Kette wird geladen…')}
                            </p>
                          )}
                          {fallbackError && (
                            <p role="alert" className="text-[9px] text-[var(--nc-danger)]">
                              {fallbackError}
                            </p>
                          )}
                          {fallback && (
                            <>
                              {fallback.models.length === 0 ? (
                                <p className="text-[9px] text-[var(--nc-text)] opacity-70">
                                  {t(
                                    'Sin respaldo: si el modelo principal falla, la petición falla.',
                                    'No fallback: if the main model fails, the request fails.',
                                    'Kein Ausweichmodell: Wenn das Hauptmodell ausfällt, schlägt die Anfrage fehl.'
                                  )}
                                </p>
                              ) : (
                                <div className="space-y-1">
                                  {fallback.models.map((model, index) => (
                                    <div
                                      key={`${model}-${index}`}
                                      className="flex items-center gap-1 border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] px-1 py-0.5 text-[10px]"
                                    >
                                      <span className="w-3 shrink-0 text-[var(--nc-text-accent)]">
                                        {index + 1}.
                                      </span>
                                      <span className="flex-1 break-all font-mono" title={model}>
                                        {model}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => void probeFallbackModel(model)}
                                        disabled={
                                          probeResults[model]?.status === 'working' ||
                                          fallbackStatus === 'saving'
                                        }
                                        className="p-0.5 text-[var(--nc-text-accent)] disabled:opacity-30"
                                        aria-label={`${t('Probar', 'Test', 'Testen')} ${model}`}
                                        title={
                                          probeResults[model]?.detail ||
                                          t(
                                            'Hace una llamada mínima; no guarda nada',
                                            'Makes one minimal call; saves nothing',
                                            'Macht einen minimalen Aufruf; speichert nichts'
                                          )
                                        }
                                      >
                                        <FlaskConical className="w-3 h-3" />
                                      </button>
                                      {probeResults[model] && (
                                        <span
                                          role="status"
                                          aria-label={`${model}: ${probeResults[model].detail || '…'}`}
                                          title={probeResults[model].detail || '…'}
                                          className={
                                            'w-3 shrink-0 text-center ' +
                                            (probeResults[model].status === 'ok'
                                              ? 'text-[var(--nc-success)]'
                                              : probeResults[model].status === 'substituted'
                                              ? 'text-[var(--nc-text-accent)]'
                                              : probeResults[model].status === 'working'
                                              ? 'text-[var(--nc-text)]'
                                              : 'text-[var(--nc-danger)]')
                                          }
                                        >
                                          {probeResults[model].status === 'ok'
                                            ? '✓'
                                            : probeResults[model].status === 'working'
                                            ? '…'
                                            : probeResults[model].status === 'substituted'
                                            ? '⚠'
                                            : '✖'}
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => moveFallbackModel(index, -1)}
                                        disabled={index === 0 || fallbackStatus === 'saving'}
                                        className="p-0.5 disabled:opacity-30"
                                        aria-label={`${t('Subir', 'Move up', 'Nach oben')} ${model}`}
                                      >
                                        <ArrowUp className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => moveFallbackModel(index, 1)}
                                        disabled={
                                          index === fallback.models.length - 1 ||
                                          fallbackStatus === 'saving'
                                        }
                                        className="p-0.5 disabled:opacity-30"
                                        aria-label={`${t('Bajar', 'Move down', 'Nach unten')} ${model}`}
                                      >
                                        <ArrowDown className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeFallbackModel(model)}
                                        disabled={fallbackStatus === 'saving'}
                                        className="p-0.5 text-red-300 hover:text-red-100 disabled:opacity-30"
                                        aria-label={`${t('Quitar', 'Remove', 'Entfernen')} ${model}`}
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-1">
                                <input
                                  type="text"
                                  value={fallbackDraft}
                                  onChange={(e) => {
                                    setFallbackDraft(e.target.value);
                                    if (fallbackStatus === 'error') {
                                      setFallbackStatus('idle');
                                      setFallbackError('');
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      addFallbackModel();
                                    }
                                  }}
                                  placeholder={GEMINI_FALLBACK_MODELS[0] ?? 'modelo-de-respaldo'}
                                  aria-label={t(
                                    'Añadir modelo de respaldo',
                                    'Add fallback model',
                                    'Ausweichmodell hinzufügen'
                                  )}
                                  className="flex-1 min-w-0 bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-[var(--nc-text)] text-[10px] px-1 py-0.5 rounded outline-none focus:border-[var(--nc-text-accent)] font-mono"
                                />
                                <button
                                  type="button"
                                  onClick={addFallbackModel}
                                  disabled={
                                    !fallbackDraft.trim() ||
                                    fallbackStatus === 'saving' ||
                                    fallback.models.length >= MAX_FALLBACK_MODELS
                                  }
                                  className="nc-button px-1.5 py-0.5 text-[9px] font-bold disabled:opacity-30 flex items-center gap-1"
                                >
                                  <Plus className="w-3 h-3" />
                                  {t('Añadir', 'Add', 'Hinzufügen')}
                                </button>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-[9px] opacity-70">
                                <span>
                                  {!fallback.configured
                                    ? t(
                                        'Usando la cadena por defecto.',
                                        'Using the default chain.',
                                        'Standardkette wird verwendet.'
                                      )
                                    : fallback.models.length === 0
                                    ? t('Respaldo desactivado.', 'Fallback disabled.', 'Ausweichen deaktiviert.')
                                    : t(
                                        'Guardada en commander.json.',
                                        'Saved in commander.json.',
                                        'In commander.json gespeichert.'
                                      )}
                                </span>
                                {fallbackStatus === 'saving' && (
                                  <span>{t('Guardando…', 'Saving…', 'Speichern…')}</span>
                                )}
                                {fallbackStatus === 'saved' && (
                                  <span className="text-[var(--nc-success)]">
                                    ✓ {t('Guardado', 'Saved', 'Gespeichert')}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => void probeFallbackChain()}
                                disabled={
                                  chainProbe?.running === true ||
                                  fallback.models.length === 0 ||
                                  fallbackStatus === 'saving'
                                }
                                className="nc-button w-full text-center text-[9px] py-1 bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] flex items-center justify-center gap-1 disabled:opacity-30"
                                title={t(
                                  'Prueba la cadena en orden y para en el primero que responda; no guarda nada.',
                                  'Tests the chain in order and stops at the first answer; saves nothing.',
                                  'Testet die Kette der Reihe nach und stoppt beim ersten Treffer; speichert nichts.'
                                )}
                              >
                                <FlaskConical className="w-3 h-3 text-[var(--nc-text-accent)]" />
                                {chainProbe?.running
                                  ? t('PROBANDO LA CADENA…', 'TESTING THE CHAIN…', 'KETTE WIRD GETESTET…')
                                  : t('PROBAR ORDEN', 'TEST ORDER', 'REIHENFOLGE TESTEN')}
                              </button>
                              {lastProbe && (
                                <p
                                  role="status"
                                  aria-live="polite"
                                  className={
                                    'text-[9px] px-1 ' +
                                    (lastProbe.status === 'ok'
                                      ? 'text-[var(--nc-success)]'
                                      : lastProbe.status === 'failed'
                                      ? 'text-[var(--nc-danger)]'
                                      : 'text-[var(--nc-text-accent)]')
                                  }
                                >
                                  {lastProbe.detail}
                                </p>
                              )}
                              {chainProbe?.result && !chainProbe.running && (
                                <p
                                  role="status"
                                  aria-live="polite"
                                  className={
                                    'text-[9px] px-1 ' +
                                    (chainProbe.result.answeredIndex === 0
                                      ? 'text-[var(--nc-success)]'
                                      : chainProbe.result.answeredIndex > 0
                                      ? 'text-[var(--nc-text-accent)]'
                                      : 'text-[var(--nc-danger)]')
                                  }
                                >
                                  {chainProbe.result.answeredIndex < 0
                                    ? `✖ ${t(
                                        'Ningún modelo de la cadena respondió',
                                        'No model in the chain responded',
                                        'Kein Modell der Kette antwortete'
                                      )} (${chainProbe.result.attempts.length})`
                                    : chainProbe.result.answeredIndex === 0
                                    ? `✓ ${chainProbe.result.answeredModel} ${t(
                                        'respondería primero',
                                        'would answer first',
                                        'würde zuerst antworten'
                                      )}`
                                    : `⚠ ${chainProbe.result.answeredModel} ${t(
                                        'respondería en la posición',
                                        'would answer at position',
                                        'würde an Position'
                                      )} ${chainProbe.result.answeredIndex + 1}`}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {sectionBlock(
                        t('Instrucción del sistema', 'System instruction', 'Systemanweisung'),
                        <div className="px-2 py-1.5 space-y-1.5">
                          <select
                            onChange={(e) => {
                              const preset = SYSTEM_PRESETS.find((p) => p.id === e.target.value);
                              if (preset) updateParam('systemInstruction', preset.instruction);
                            }}
                            defaultValue=""
                            aria-label={t('Preset de rol', 'Role preset', 'Rollenvorlage')}
                            className={`${selectClass} w-full`}
                          >
                            <option value="" disabled>
                              {t('⚡ Usar un preset de rol…', '⚡ Use a role preset…', '⚡ Rollenvorlage verwenden…')}
                            </option>
                            {SYSTEM_PRESETS.map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.name}
                              </option>
                            ))}
                          </select>
                          <textarea
                            value={parameters.systemInstruction}
                            onChange={(e) => updateParam('systemInstruction', e.target.value)}
                            rows={5}
                            placeholder={t('Instrucción del sistema…', 'System instruction…', 'Systemanweisung…')}
                            aria-label={t('Instrucciones del sistema', 'System instructions', 'Systemanweisungen')}
                            className="w-full bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] p-1.5 text-[10px] text-[var(--nc-text)] outline-none resize-y font-mono leading-snug"
                          />
                          <p className="text-[9px] text-[var(--nc-text)] opacity-70">
                            {t(
                              'Se envía como rol del sistema en cada mensaje de esta pestaña.',
                              'Sent as the system role with every message in this tab.',
                              'Wird bei jeder Nachricht dieses Tabs als Systemrolle gesendet.'
                            )}
                          </p>
                        </div>
                      )}

                      {sectionBlock(
                        t('Ejemplos few-shot', 'Few-shot examples', 'Few-shot-Beispiele'),
                        <div className="px-2 py-1.5 space-y-2">
                          <p className="text-[9px] text-[var(--nc-text)] opacity-70">
                            {t(
                              'Pares de entrada y salida que se añaden al prompt como ejemplos. No entrenan el modelo ni suben un dataset.',
                              'Input/output pairs added to the prompt as examples. They do not train the model or upload a dataset.',
                              'Eingabe/Ausgabe-Paare, die dem Prompt als Beispiele hinzugefügt werden. Sie trainieren das Modell nicht und laden kein Dataset hoch.'
                            )}
                          </p>
                          {(parameters.examples ?? []).length === 0 ? (
                            <p className="text-[9px] text-[var(--nc-text)] opacity-70">
                              {t('Sin ejemplos todavía.', 'No examples yet.', 'Noch keine Beispiele.')}
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {(parameters.examples ?? []).map((example, index) => (
                                <div
                                  key={example.id}
                                  className="border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] p-1.5 space-y-1"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-[9px] font-bold text-[var(--nc-text-accent)]">
                                      #{index + 1}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => removeExample(example.id)}
                                      className="p-0.5 text-red-300 hover:text-red-100"
                                      aria-label={`${t('Quitar ejemplo', 'Remove example', 'Beispiel entfernen')} ${index + 1}`}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <label className="block text-[9px] text-[var(--nc-text)] opacity-80">
                                    {t('Entrada', 'Input', 'Eingabe')}
                                    <textarea
                                      value={example.input}
                                      onChange={(e) => updateExample(example.id, { input: e.target.value })}
                                      rows={2}
                                      aria-label={`${t('Entrada del ejemplo', 'Example input', 'Beispiel-Eingabe')} ${index + 1}`}
                                      className="mt-0.5 w-full bg-[var(--nc-bg-panel)] border border-[var(--nc-border-light)] p-1 text-[10px] text-[var(--nc-text)] outline-none resize-y font-mono"
                                    />
                                  </label>
                                  <label className="block text-[9px] text-[var(--nc-text)] opacity-80">
                                    {t('Salida', 'Output', 'Ausgabe')}
                                    <textarea
                                      value={example.output}
                                      onChange={(e) => updateExample(example.id, { output: e.target.value })}
                                      rows={2}
                                      aria-label={`${t('Salida del ejemplo', 'Example output', 'Beispiel-Ausgabe')} ${index + 1}`}
                                      className="mt-0.5 w-full bg-[var(--nc-bg-panel)] border border-[var(--nc-border-light)] p-1 text-[10px] text-[var(--nc-text)] outline-none resize-y font-mono"
                                    />
                                  </label>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="border-t border-[var(--nc-border-light)] pt-1.5 space-y-1">
                            <div className="text-[9px] font-bold text-[var(--nc-text-accent)]">
                              {t('Añadir ejemplo', 'Add example', 'Beispiel hinzufügen')}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                              <label className="block text-[9px] text-[var(--nc-text)] opacity-80">
                                {t('Entrada', 'Input', 'Eingabe')}
                                <textarea
                                  value={exampleDraft.input}
                                  onChange={(e) => setExampleDraft((prev) => ({ ...prev, input: e.target.value }))}
                                  rows={2}
                                  aria-label={t('Entrada del ejemplo', 'Example input', 'Beispiel-Eingabe')}
                                  className="mt-0.5 w-full bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] p-1 text-[10px] text-[var(--nc-text)] outline-none resize-y font-mono"
                                />
                              </label>
                              <label className="block text-[9px] text-[var(--nc-text)] opacity-80">
                                {t('Salida', 'Output', 'Ausgabe')}
                                <textarea
                                  value={exampleDraft.output}
                                  onChange={(e) => setExampleDraft((prev) => ({ ...prev, output: e.target.value }))}
                                  rows={2}
                                  aria-label={t('Salida del ejemplo', 'Example output', 'Beispiel-Ausgabe')}
                                  className="mt-0.5 w-full bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] p-1 text-[10px] text-[var(--nc-text)] outline-none resize-y font-mono"
                                />
                              </label>
                            </div>
                            <button
                              type="button"
                              onClick={addExample}
                              disabled={!exampleDraft.input.trim() || !exampleDraft.output.trim()}
                              className="nc-button w-full px-1.5 py-0.5 text-[9px] font-bold disabled:opacity-30 flex items-center justify-center gap-1"
                            >
                              <Plus className="w-3 h-3" />
                              {t('Añadir ejemplo', 'Add example', 'Beispiel hinzufügen')}
                            </button>
                          </div>
                          <p className="text-[9px] text-[var(--nc-text)] opacity-70">
                            {t(
                              'Se envían antes del mensaje actual, en este orden.',
                              'Sent before the current message, in this order.',
                              'Sie werden vor der aktuellen Nachricht in dieser Reihenfolge gesendet.'
                            )}
                          </p>
                        </div>
                      )}
                    </>
                  )}
              </section>
              )}

              {active === 'proveedores' && (
              <section data-settings-section="proveedores" className="space-y-3 scroll-mt-2">
                {groupTitle(t('Proveedores', 'Providers', 'Anbieter'))}
                <div className="space-y-2">
                  <div className="text-[10px] text-[var(--nc-text)] opacity-75 leading-snug">
                    {t(
                      'Aquí se configuran las claves, hosts y filtros de todos los proveedores. Ollama, LM Studio y OpenAI-compatible son entradas independientes.',
                      'Configure keys, hosts and filters for every provider here. Ollama, LM Studio and OpenAI-compatible are separate entries.',
                      'Hier werden Schlüssel, Hosts und Filter aller Anbieter konfiguriert. Ollama, LM Studio und OpenAI-kompatibel sind getrennte Einträge.'
                    )}
                  </div>
                  <ProviderManager isOpen embedded lang={lang} />
                </div>
              </section>
              )}

              {active === 'agente' && (
              <section data-settings-section="agente" className="space-y-3 scroll-mt-2">
                {groupTitle(t('Agente', 'Agent', 'Agent'))}
                {sectionBlock(
                  t('Agente y subagentes', 'Agent & subagents', 'Agent & Unteragenten'),
                  <MenuRow
                    icon={<Timer className="w-4 h-4 text-[var(--nc-text)]" />}
                    label={t('Aviso de atasco (min)', 'Stuck alert (min)', 'Hänger-Warnung (Min.)')}
                    hint={t(
                      'Un subagente que lleve más de esto corriendo se marca como atascado',
                      'A subagent running longer than this is flagged as stuck',
                      'Ein Unteragent, der länger läuft, gilt als hängend'
                    )}
                  >
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={atascoDraft}
                      onChange={(e) => setAtascoDraft(e.target.value)}
                      onBlur={confirmarAtasco}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      className="bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-[var(--nc-text)] text-[10px] px-1 py-0.5 rounded w-16 outline-none focus:border-[var(--nc-text-accent)]"
                      data-testid="stuck-threshold-input"
                      aria-label={t('Aviso de atasco en minutos', 'Stuck alert in minutes', 'Hänger-Warnung in Minuten')}
                    />
                  </MenuRow>
                )}
              </section>
              )}

              {active === 'extensiones' && (
              <section data-settings-section="extensiones" className="space-y-3 scroll-mt-2">
                {groupTitle(t('Extensiones', 'Extensions', 'Erweiterungen'))}
                {sectionBlock(
                  t('MCP, skills y plugins', 'MCP, skills and plugins', 'MCP, Skills und Plugins'),
                  <ExtensionsSettings lang={lang} onOpenManager={onOpenExtensions} />
                )}
              </section>
              )}

              {active === 'ayuda' && (
              <section data-settings-section="ayuda" className="space-y-3 scroll-mt-2">
                {groupTitle(t('Ayuda', 'Help', 'Hilfe'))}
                <React.Suspense
                  fallback={
                    <p className="px-2 py-2 text-[10px] text-[var(--nc-text)] opacity-70">
                      {t('Cargando el manual…', 'Loading the manual…', 'Handbuch wird geladen…')}
                    </p>
                  }
                >
                  {/* El manual se lee aquí mismo: sin ventana encima ni un cierre aparte. */}
                  <HelpModalInline isOpen inline onClose={() => {}} lang={lang} />
                </React.Suspense>
              </section>
              )}

              {active === 'acerca' && (
              <section data-settings-section="acerca" className="space-y-3 scroll-mt-2">
                {groupTitle(t('Acerca de', 'About', 'Über'))}
                <React.Suspense
                  fallback={
                    <p className="px-2 py-2 text-[10px] text-[var(--nc-text)] opacity-70">
                      {t('Cargando la ficha…', 'Loading details…', 'Details werden geladen…')}
                    </p>
                  }
                >
                  <AboutModalInline isOpen inline onClose={() => {}} lang={lang} />
                </React.Suspense>
              </section>
              )}
            </div>
          </div>

          <div className="px-3 py-1.5 bg-[var(--nc-bg-panel)] border-t border-[var(--nc-border-dark)] shrink-0">
            <span className="text-[9px] text-[var(--nc-text)] opacity-60 truncate block">
              {t(
                'Los cambios se guardan al momento · Escape o clic fuera para cerrar',
                'Changes save immediately · Escape or click outside to close',
                'Änderungen werden sofort gespeichert · Escape oder außen klicken zum Schließen'
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreferencesModal;
