import React from 'react';
import { X, Palette, Globe, Eye, EyeOff, Type, FolderOpen, Zap, Battery, BatteryCharging, Timer } from 'lucide-react';
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
}

const selectClass =
  'bg-[#000055] border border-[#00ffff]/50 text-[#00ffff] text-[11px] px-1 py-0.5 rounded-sm focus:outline-none focus:border-[#ffff55]';

const MenuRow: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({
  icon,
  label,
  children,
}) => (
  <div className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] text-white">
    <span className="flex items-center gap-2 min-w-0">
      {icon}
      <span className="truncate">{label}</span>
    </span>
    <span className="shrink-0">{children}</span>
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
}) => {
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-md h-[calc(100vh-3rem)] max-h-[600px] mx-3">
        <div className="nc-panel flex flex-col h-full w-full border-2 border-[#00ffff] rounded-lg overflow-hidden shadow-[0_0_40px_rgba(0,255,255,0.25)]">
          <div className="flex items-center justify-between px-3 py-2 bg-[#00aaaa] border-b-2 border-[#000055] shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-black font-bold text-sm">{lang === 'es' ? 'Preferencias' : lang === 'de' ? 'Einstellungen' : 'Preferences'}</span>
            </div>
            <button
              onClick={onClose}
              className="text-black hover:text-red-500 font-bold text-lg leading-none px-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-[#000080] text-white">
            {/* Apariencia */}
            <div className="border border-[#00ffff]/40 rounded bg-[#000066]/60">
              <div className="px-2 py-1 border-b border-[#00ffff]/25 text-[11px] font-bold text-[#ffff55] uppercase">
                {lang === 'es' ? 'Apariencia' : lang === 'de' ? 'Erscheinungsbild' : 'Appearance'}
              </div>
              <div className="py-1">
                <MenuRow icon={<Palette className="w-4 h-4 text-[#00ffff]" />} label={lang === 'es' ? 'Tema' : lang === 'de' ? 'Design' : 'Theme'}>
                  <select
                    value={theme}
                    onChange={(e) => setTheme && setTheme(e.target.value as ConsoleTheme)}
                    className={selectClass}
                  >
                    <option value="norton">Norton Retro</option>
                    <option value="matrix">Matrix Green</option>
                    <option value="amber">Amber Terminal</option>
                    <option value="dos">DOS Retro</option>
                  </select>
                </MenuRow>
                <MenuRow icon={<Globe className="w-4 h-4 text-[#00ffff]" />} label={lang === 'es' ? 'Idioma' : lang === 'de' ? 'Sprache' : 'Language'}>
                  <select
                    value={lang}
                    onChange={(e) => setLang && setLang(e.target.value as Language)}
                    className={selectClass}
                  >
                    <option value="es">Español</option>
                    <option value="en">English</option>
                    <option value="de">Deutsch</option>
                  </select>
                </MenuRow>
                <MenuRow icon={showTooltips ? <Eye className="w-4 h-4 text-[#00ffff]" /> : <EyeOff className="w-4 h-4 text-[#00ffff]" />} label={lang === 'es' ? 'Tooltips' : lang === 'de' ? 'Tooltips' : 'Tooltips'}>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showTooltips}
                      onChange={(e) => setShowTooltips && setShowTooltips(e.target.checked)}
                      className="accent-[#00ffff]"
                    />
                    <span className="text-[10px]">{showTooltips ? (lang === 'es' ? 'Mostrar' : lang === 'de' ? 'Anzeigen' : 'Show') : (lang === 'es' ? 'Ocultar' : lang === 'de' ? 'Verbergen' : 'Hide')}</span>
                  </label>
                </MenuRow>
                <MenuRow icon={<Type className="w-4 h-4 text-[#00ffff]" />} label={lang === 'es' ? 'Tamaño de texto' : lang === 'de' ? 'Textgröße' : 'Text size'}>
                  <select
                    value={fontScale}
                    onChange={(e) => handleSetFontScale(e.target.value as 'normal' | 'lg' | 'xl')}
                    className={selectClass}
                  >
                    <option value="normal">Normal</option>
                    <option value="lg">{lang === 'es' ? 'Grande' : lang === 'de' ? 'Groß' : 'Large'}</option>
                    <option value="xl">{lang === 'es' ? 'Muy grande' : lang === 'de' ? 'Sehr groß' : 'Extra large'}</option>
                  </select>
                </MenuRow>
              </div>
            </div>

            {/* Rendimiento / Energía */}
            <div className="border border-[#00ffff]/40 rounded bg-[#000066]/60">
              <div className="px-2 py-1 border-b border-[#00ffff]/25 text-[11px] font-bold text-[#ffff55] uppercase">
                {lang === 'es' ? 'Rendimiento y Energía' : lang === 'de' ? 'Leistung & Energie' : 'Performance & Power'}
              </div>
              <div className="py-1">
                <MenuRow icon={<Zap className="w-4 h-4 text-[#00ffff]" />} label={lang === 'es' ? 'Modo Bajo Recursos' : lang === 'de' ? 'Modus für wenig Ressourcen' : 'Low Resource Mode'}>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lowResourceMode}
                      onChange={(e) => setLowResourceMode && setLowResourceMode(e.target.checked)}
                      className="accent-[#00ffff]"
                    />
                  </label>
                </MenuRow>
                <MenuRow icon={batteryInfo?.charging ? <BatteryCharging className="w-4 h-4 text-[#00ffff]" /> : <Battery className="w-4 h-4 text-[#00ffff]" />} label={lang === 'es' ? 'Ahorro de Batería' : lang === 'de' ? 'Energiesparmodus' : 'Power Saver'}>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={powerSaverMode}
                      onChange={(e) => setPowerSaverMode && setPowerSaverMode(e.target.checked)}
                      className="accent-[#00ffff]"
                    />
                  </label>
                </MenuRow>
                {batteryInfo && (
                  <div className="px-2 py-0.5 text-[9px] text-[#00ffff]/60">
                    {lang === 'es' ? 'Batería' : lang === 'de' ? 'Akku' : 'Battery'}: {Math.round(batteryInfo.level)}% {batteryInfo.charging ? '• ' + (lang === 'es' ? 'Cargando' : lang === 'de' ? 'Lädt' : 'Charging') : ''}
                  </div>
                )}
              </div>
            </div>

            {/* Subagentes */}
            <div className="border border-[#00ffff]/40 rounded bg-[#000066]/60">
              <div className="px-2 py-1 border-b border-[#00ffff]/25 text-[11px] font-bold text-[#ffff55] uppercase">
                {lang === 'es' ? 'Subagentes' : lang === 'de' ? 'Subagenten' : 'Subagents'}
              </div>
              <div className="py-1">
                <MenuRow icon={<Timer className="w-4 h-4 text-[#00ffff]" />} label={lang === 'es' ? 'Aviso de atasco (min)' : lang === 'de' ? 'Hänger-Warnung (Min.)' : 'Stuck alert (min)'}>
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
                    className="bg-[#000044] border border-[#00ffff]/40 text-[#00ffff] text-[10px] px-1 py-0.5 rounded w-16 outline-none focus:border-[#ffff55]"
                    data-testid="stuck-threshold-input"
                  />
                </MenuRow>
              </div>
            </div>

            {/* Rutas */}
            <div className="border border-[#00ffff]/40 rounded bg-[#000066]/60">
              <div className="px-2 py-1 border-b border-[#00ffff]/25 text-[11px] font-bold text-[#ffff55] uppercase">
                {lang === 'es' ? 'Rutas' : lang === 'de' ? 'Pfade' : 'Paths'}
              </div>
              <div className="py-1">
                <MenuRow icon={<FolderOpen className="w-4 h-4 text-[#00ffff]" />} label={lang === 'es' ? 'Carpeta Exportación' : lang === 'de' ? 'Exportordner' : 'Export Folder'}>
                  <input
                    type="text"
                    value={defaultExportFolder}
                    onChange={(e) => setDefaultExportFolder && setDefaultExportFolder(e.target.value)}
                    className="bg-[#000044] border border-[#00ffff]/40 text-[#00ffff] text-[10px] px-1 py-0.5 rounded w-36 outline-none focus:border-[#ffff55]"
                  />
                </MenuRow>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end px-3 py-2 bg-[#000066] border-t border-[#004466] shrink-0 gap-2">
            <button onClick={onClose} className="nc-button text-xs px-3 py-1">
              {lang === 'es' ? 'Cerrar' : lang === 'de' ? 'Schließen' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreferencesModal;
