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
  Server,
  CheckCircle2,
  Loader2,
  Settings2,
} from 'lucide-react';
import { ConsoleTheme } from './Header';
import { Language } from '../i18n/translations';
// El umbral lo consume el panel de subagentes; la clave y el aviso viven ahí
// para que no haya dos copias del nombre que se puedan desincronizar.
import { ATASCO_KEY, PREFERENCIAS_EVENT, normalizarUmbralAtasco } from './ServerSubAgents';

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
  /** Abre el gestor completo (claves, hosts, filtros). */
  onOpenProviders?: () => void;
}

type SectionId = 'general' | 'modelos' | 'agente' | 'rendimiento' | 'rutas';

interface ProviderRow {
  id: string;
  name: string;
  enabled: boolean;
  modelCount: number;
  totalModels: number;
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
  <div className="flex items-start justify-between gap-3 px-2 py-1.5 text-[11px] text-white">
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
  onOpenProviders,
}) => {
  const t = React.useCallback(
    (es: string, en: string, de: string) => (lang === 'es' ? es : lang === 'de' ? de : en),
    [lang]
  );

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

  // ── Proveedores: resumen real, sin duplicar el gestor ──
  const [section, setSection] = React.useState<SectionId>('general');
  const [providers, setProviders] = React.useState<ProviderRow[] | null>(null);
  const [providersError, setProvidersError] = React.useState('');
  const [loadingProviders, setLoadingProviders] = React.useState(false);
  const [savingProvider, setSavingProvider] = React.useState<string | null>(null);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const sectionRefs = React.useRef<Partial<Record<SectionId, HTMLDivElement | null>>>({});

  const loadProviders = React.useCallback(async () => {
    setLoadingProviders(true);
    setProvidersError('');
    try {
      const res = await fetch('/api/providers', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || t('No se pudo leer la lista', 'Could not read the list', 'Liste konnte nicht gelesen werden'));
      const rows: ProviderRow[] = (Array.isArray(data.providers) ? data.providers : [])
        .filter((p: any) => p?.configured)
        .map((p: any) => ({
          id: String(p.id),
          name: String(p.name || p.id),
          enabled: p.enabled !== false,
          modelCount: Number(p.modelCount) || 0,
          totalModels: Number(p.totalModels) || 0,
        }));
      setProviders(rows);
    } catch (e: any) {
      setProvidersError(e?.message || t('Error de red', 'Network error', 'Netzwerkfehler'));
      setProviders([]);
    } finally {
      setLoadingProviders(false);
    }
  }, [t]);

  React.useEffect(() => {
    if (isOpen) void loadProviders();
  }, [isOpen, loadProviders]);

  const toggleProvider = async (row: ProviderRow) => {
    setSavingProvider(row.id);
    setProvidersError('');
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || t('No se pudo guardar', 'Could not save', 'Speichern fehlgeschlagen'));
      setProviders((prev) => (prev ?? []).map((p) => (p.id === row.id ? { ...p, enabled: !row.enabled } : p)));
    } catch (e: any) {
      setProvidersError(e?.message || t('No se pudo guardar', 'Could not save', 'Speichern fehlgeschlagen'));
    } finally {
      setSavingProvider(null);
    }
  };

  const go = (id: SectionId) => {
    setSection(id);
    sectionRefs.current[id]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  if (!isOpen) return null;

  const sections: Array<{ id: SectionId; label: string; icon: React.ReactNode }> = [
    { id: 'general', label: t('General', 'General', 'Allgemein'), icon: <Palette className="w-3.5 h-3.5" /> },
    { id: 'modelos', label: t('Modelos y proveedores', 'Models & providers', 'Modelle & Anbieter'), icon: <Server className="w-3.5 h-3.5" /> },
    { id: 'agente', label: t('Agente', 'Agent', 'Agent'), icon: <Timer className="w-3.5 h-3.5" /> },
    { id: 'rendimiento', label: t('Rendimiento', 'Performance', 'Leistung'), icon: <Zap className="w-3.5 h-3.5" /> },
    { id: 'rutas', label: t('Rutas', 'Paths', 'Pfade'), icon: <FolderOpen className="w-3.5 h-3.5" /> },
  ];

  const sectionBlock = (id: SectionId, title: string, body: React.ReactNode) => (
    <div
      key={id}
      ref={(el) => {
        sectionRefs.current[id] = el;
      }}
      className="border border-[var(--nc-border-light)] rounded bg-[var(--nc-bg-panel)] scroll-mt-2"
    >
      <div className="px-2 py-1 border-b border-[var(--nc-border-light)] text-[11px] font-bold text-[var(--nc-text-accent)] uppercase">
        {title}
      </div>
      <div className="py-1">{body}</div>
    </div>
  );

  const configuredCount = providers?.length ?? 0;
  const enabledCount = providers?.filter((p) => p.enabled).length ?? 0;
  const totalModels = providers?.reduce((sum, p) => sum + p.modelCount, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-3xl h-[calc(100vh-3rem)] max-h-[680px] mx-3">
        <div className="nc-panel flex flex-col h-full w-full border-2 border-[var(--nc-border-light)] rounded-lg overflow-hidden shadow-[0_0_40px_rgba(0,255,255,0.25)]">
          <div className="flex items-center justify-between px-3 py-2 bg-[var(--nc-header-bg)] border-b-2 border-[var(--nc-border-dark)] shrink-0">
            <div className="min-w-0">
              <div className="text-[var(--nc-header-text)] font-bold text-sm">
                {t('Configuración', 'Settings', 'Einstellungen')}
              </div>
              <div className="text-[10px] text-[var(--nc-header-text)] opacity-70 truncate">
                {t(
                  'Apariencia, modelos, agente y rutas en un solo sitio',
                  'Appearance, models, agent and paths in one place',
                  'Darstellung, Modelle, Agent und Pfade an einem Ort'
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--nc-header-text)] hover:text-red-500 font-bold text-lg leading-none px-1 shrink-0"
              title={t('Cerrar', 'Close', 'Schließen')}
              aria-label={t('Cerrar', 'Close', 'Schließen')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-1 min-h-0">
            <nav
              className="w-36 sm:w-44 shrink-0 border-r border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] p-1.5 space-y-0.5 overflow-y-auto"
              aria-label={t('Secciones de configuración', 'Settings sections', 'Einstellungsbereiche')}
            >
              {sections.map((spec) => (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() => go(spec.id)}
                  aria-current={section === spec.id ? 'true' : undefined}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left text-[11px] font-bold border transition-colors ${
                    section === spec.id
                      ? 'bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)] border-[var(--nc-border-light)]'
                      : 'text-[var(--nc-text)] border-transparent hover:bg-[var(--nc-bg-main)]'
                  }`}
                >
                  {spec.icon}
                  <span className="truncate">{spec.label}</span>
                </button>
              ))}
            </nav>

            <div ref={scrollerRef} className="flex-1 min-w-0 overflow-y-auto p-3 space-y-3 bg-[var(--nc-bg-panel)] text-white">
              {sectionBlock(
                'general',
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
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showTooltips}
                        onChange={(e) => setShowTooltips && setShowTooltips(e.target.checked)}
                        className="accent-[var(--nc-text)]"
                        aria-label={t('Mostrar tooltips', 'Show tooltips', 'Tooltips anzeigen')}
                      />
                    </label>
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
                'modelos',
                t('Modelos y proveedores', 'Models & providers', 'Modelle & Anbieter'),
                <>
                  <MenuRow
                    icon={<Settings2 className="w-4 h-4 text-[var(--nc-text)]" />}
                    label={t('Modelo activo', 'Active model', 'Aktives Modell')}
                    hint={
                      selectedProvider
                        ? t(`Proveedor: ${selectedProvider}`, `Provider: ${selectedProvider}`, `Anbieter: ${selectedProvider}`)
                        : t('Elige el modelo en el compositor o en Ajustes → MODELO', 'Pick it in the composer or in Settings → MODEL', 'Im Composer oder unter Einstellungen → MODELL wählen')
                    }
                  >
                    <span className="text-[10px] text-[var(--nc-text-accent)] max-w-[15rem] truncate inline-block align-middle" title={selectedModel || ''}>
                      {selectedModel || '—'}
                    </span>
                  </MenuRow>

                  <div className="px-2 pt-1 pb-1 text-[9px] text-[var(--nc-text)] opacity-70">
                    {providers === null
                      ? t('Leyendo proveedores…', 'Reading providers…', 'Anbieter werden gelesen…')
                      : t(
                          `${configuredCount} configurados · ${enabledCount} activos · ${totalModels} modelos disponibles`,
                          `${configuredCount} configured · ${enabledCount} enabled · ${totalModels} models available`,
                          `${configuredCount} konfiguriert · ${enabledCount} aktiv · ${totalModels} Modelle verfügbar`
                        )}
                  </div>

                  {providersError && (
                    <div className="mx-2 my-1 px-2 py-1 text-[10px] text-red-300 border border-red-400/40 bg-red-400/10">{providersError}</div>
                  )}

                  <div className="px-1.5">
                    {(providers ?? []).map((row) => (
                      <div key={row.id} className="flex items-center gap-2 px-1 py-1 border-b border-[var(--nc-border-dark)] last:border-b-0">
                        <button
                          type="button"
                          onClick={() => void toggleProvider(row)}
                          disabled={savingProvider === row.id}
                          aria-pressed={row.enabled}
                          aria-label={`${row.name}: ${row.enabled ? t('activo', 'enabled', 'aktiv') : t('apagado', 'disabled', 'inaktiv')}`}
                          title={row.enabled ? t('Apagar (no se ofrecerá)', 'Turn off (hidden)', 'Ausschalten (wird ausgeblendet)') : t('Encender', 'Turn on', 'Einschalten')}
                          className={`shrink-0 disabled:opacity-40 ${row.enabled ? 'text-emerald-300' : 'text-red-300'}`}
                        >
                          {savingProvider === row.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className={`w-4 h-4 ${row.enabled ? '' : 'opacity-40'}`} />
                          )}
                        </button>
                        <span className={`text-[11px] truncate ${row.enabled ? 'text-white' : 'text-white opacity-50'}`}>{row.name}</span>
                        <span className="ml-auto text-[9px] tabular-nums text-[var(--nc-text)] opacity-70 shrink-0">
                          {row.modelCount}/{row.totalModels}
                        </span>
                      </div>
                    ))}
                    {providers !== null && providers.length === 0 && (
                      <div className="px-1 py-1.5 text-[10px] text-[var(--nc-text)] opacity-70">
                        {t(
                          'Ninguno configurado todavía: añade una clave o un host en el gestor.',
                          'None configured yet: add a key or host in the manager.',
                          'Noch keiner konfiguriert: Schlüssel oder Host im Manager hinzufügen.'
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 px-2 pt-1.5 pb-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => onOpenProviders?.()}
                      className="nc-button text-[11px] font-bold bg-[var(--nc-bg-main)] border-[var(--nc-border-light)] flex items-center gap-1.5"
                      title={t(
                        'Claves, hosts, modelos y filtros de cada proveedor',
                        'Keys, hosts, models and filters per provider',
                        'Schlüssel, Hosts, Modelle und Filter je Anbieter'
                      )}
                    >
                      <Server className="w-3.5 h-3.5 text-[var(--nc-text-accent)]" />
                      {t('Gestionar proveedores…', 'Manage providers…', 'Anbieter verwalten…')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadProviders()}
                      disabled={loadingProviders}
                      className="nc-button text-[10px] bg-[var(--nc-bg-panel)] border-[var(--nc-border-light)] disabled:opacity-40"
                    >
                      {loadingProviders ? '…' : t('Actualizar', 'Refresh', 'Aktualisieren')}
                    </button>
                  </div>

                  <div className="px-2 pb-1 text-[9px] text-[var(--nc-text)] opacity-60">
                    {t(
                      'Solo los proveedores activos y sus modelos filtrados aparecen en los selectores.',
                      'Only enabled providers and their filtered models show up in the selectors.',
                      'Nur aktive Anbieter und ihre gefilterten Modelle erscheinen in den Auswahlen.'
                    )}
                  </div>
                </>
              )}

              {sectionBlock(
                'agente',
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

              {sectionBlock(
                'rendimiento',
                t('Rendimiento y energía', 'Performance & power', 'Leistung & Energie'),
                <>
                  <MenuRow
                    icon={<Zap className="w-4 h-4 text-[var(--nc-text)]" />}
                    label={t('Modo bajo recursos', 'Low resource mode', 'Modus für wenig Ressourcen')}
                    hint={t('Quita sombras y efectos que más cuestan', 'Drops the heaviest shadows and effects', 'Entfernt die teuersten Schatten und Effekte')}
                  >
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lowResourceMode}
                        onChange={(e) => setLowResourceMode && setLowResourceMode(e.target.checked)}
                        className="accent-[var(--nc-text)]"
                        aria-label={t('Modo bajo recursos', 'Low resource mode', 'Modus für wenig Ressourcen')}
                      />
                    </label>
                  </MenuRow>
                  <MenuRow
                    icon={batteryInfo?.charging ? <BatteryCharging className="w-4 h-4 text-[var(--nc-text)]" /> : <Battery className="w-4 h-4 text-[var(--nc-text)]" />}
                    label={t('Ahorro de batería', 'Power saver', 'Energiesparmodus')}
                    hint={t('Frena animaciones y brillos', 'Slows animations and glows', 'Drosselt Animationen und Glühen')}
                  >
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={powerSaverMode}
                        onChange={(e) => setPowerSaverMode && setPowerSaverMode(e.target.checked)}
                        className="accent-[var(--nc-text)]"
                        aria-label={t('Ahorro de batería', 'Power saver', 'Energiesparmodus')}
                      />
                    </label>
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
                'rutas',
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
                    className="bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-[var(--nc-text)] text-[10px] px-1 py-0.5 rounded w-44 outline-none focus:border-[var(--nc-text-accent)]"
                    aria-label={t('Carpeta de exportación', 'Export folder', 'Exportordner')}
                  />
                </MenuRow>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-2 bg-[var(--nc-bg-panel)] border-t border-[var(--nc-border-dark)] shrink-0 gap-2">
            <span className="text-[9px] text-[var(--nc-text)] opacity-60 truncate">
              {t(
                'Los cambios se guardan al momento; no hay botón de aplicar',
                'Changes save immediately; there is no apply button',
                'Änderungen werden sofort gespeichert; kein Übernehmen nötig'
              )}
            </span>
            <button onClick={onClose} className="nc-button text-xs px-3 py-1 shrink-0">
              {t('Cerrar', 'Close', 'Schließen')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreferencesModal;
