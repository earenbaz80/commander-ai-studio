/**
 * Barra inferior del compositor: adjuntar, selector de modelo, indicador de
 * LLM local, modo Build/Plan/Read-only, ajustes avanzados y acciones (limpiar,
 * enviar).
 *
 * Extraído de `ChatPlayground`. Es puramente presentacional: recibe el estado
 * ya resuelto por props y devuelve callbacks, sin manejar estado propio.
 */
import React, { useRef } from 'react';
import {
  Send,
  Play,
  Square,
  Paperclip,
  Settings,
  HelpCircle,
  Cpu,
  Mic,
  MicOff,
  Loader2,
} from 'lucide-react';
import { getCachedApiKey } from '../../lib/apiKeys';
import type { Language } from '../../i18n/translations';
import type { RunMode } from '../../types/studio';
import { MODEL_GROUPS, isLocalModelId, type ModelGroup } from './modelGroups';
import { useConfiguredProviderIds } from '../../hooks/useConfiguredProviderIds';
import { filterModelIds } from '../../lib/providerFilters';
import { lmStudioHostScope } from '../../lib/lmStudio';
import { ModelPicker } from './ModelPicker';

/** `true` si hay un servidor local configurado (Ollama, LM Studio u otro). */
const hasLocalServer = (): boolean =>
  !!(getCachedApiKey('OLLAMA_HOST') || getCachedApiKey('LMSTUDIO_HOST') || getCachedApiKey('CUSTOM_BASE_URL'));

const localServerLabel = (): string => {
  const ollama = getCachedApiKey('OLLAMA_HOST');
  if (ollama) return ollama;
  const lmstudio = getCachedApiKey('LMSTUDIO_HOST');
  if (lmstudio) return `LM Studio ${lmStudioHostScope(lmstudio)}`;
  return getCachedApiKey('CUSTOM_BASE_URL') || '';
};

interface ComposerToolbarProps {
  lang: Language;
  /** Modelo activo (id). */
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  /** Modelo activo resuelto en el catálogo (`undefined` si fue descargado). */
  currentModel?: { description?: string };
  modelGroups?: ModelGroup[];
  runMode: RunMode;
  onChangeRunMode: (mode: RunMode) => void;
  isGenerating: boolean;
  /** Detiene la generación en curso. */
  onStop: () => void;
  /** Retoma una corrida detenida, si la hay. */
  onResume?: () => void;
  resumable?: boolean;
  canSend: boolean;
  onSend: () => void;
  onClearChat: () => void;
  onAttach: (files: FileList) => void;
  onOpenLocalLlmConfig?: () => void;
  onOpenAdvanced: () => void;
  onOpenMentionHelp: () => void;
  /** Dictado por voz: graba y escribe la transcripción en el mensaje. */
  dictationState?: 'idle' | 'recording' | 'transcribing';
  dictationSupported?: boolean;
  dictationError?: string;
  dictationSeconds?: number;
  onToggleDictation?: () => void;
}

export const ComposerToolbar: React.FC<ComposerToolbarProps> = ({
  lang,
  selectedModel,
  onSelectModel,
  currentModel,
  modelGroups = MODEL_GROUPS,
  runMode,
  onChangeRunMode,
  isGenerating,
  onStop,
  onResume,
  resumable = false,
  canSend,
  onSend,
  onClearChat,
  onAttach,
  onOpenLocalLlmConfig,
  onOpenAdvanced,
  onOpenMentionHelp,
  dictationState = 'idle',
  dictationSupported = false,
  dictationError = '',
  dictationSeconds = 0,
  onToggleDictation,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runModeLabel =
    runMode === 'build'
      ? lang === 'es' ? 'Build (ejecuta)' : lang === 'de' ? 'Build (führt aus)' : 'Build (acts)'
      : runMode === 'plan'
        ? lang === 'es' ? 'Plan (solo analiza)' : lang === 'de' ? 'Plan (analysiert nur)' : 'Plan (analyzes only)'
        : lang === 'es' ? 'Solo lectura' : lang === 'de' ? 'Nur Lesen' : 'Read-only';

  const runModeOption = (mode: Exclude<RunMode, 'build' | 'plan' | 'readonly'> | RunMode) =>
    mode === 'build'
      ? lang === 'es' ? 'Build (ejecuta)' : lang === 'de' ? 'Build (handelt)' : 'Build (acts)'
      : mode === 'plan'
        ? lang === 'es' ? 'Plan (solo analiza)' : lang === 'de' ? 'Plan (nur Analyse)' : 'Plan (analyzes only)'
        : lang === 'es' ? 'Solo lectura' : lang === 'de' ? 'Nur lesen' : 'Read-only';

  const isLocal = isLocalModelId(selectedModel);
  const localConfigured = hasLocalServer();

  // Sólo se ofrecen modelos de proveedores configurados. Si la consulta falla
  // (servidor caído) se cae a la lista base para no dejar el selector vacío.
  const {
    ids: configuredIds,
    filters: providerFilters,
    loaded: providersLoaded,
    failed: providersFailed,
  } = useConfiguredProviderIds();
  // Mientras llega la respuesta se muestra la lista base: el filtro estricto
  // se aplica en cuanto se sabe qué proveedores están configurados. Los
  // apagados no aparecen y las listas blanca/negra recortan cada grupo.
  const visibleGroups = (providersFailed || !providersLoaded
    ? modelGroups
    : modelGroups.filter((group) => configuredIds.has(group.id)))
    .map((group) => ({ ...group, models: filterModelIds(group.models, providerFilters[group.id]) }))
    .filter((group) => group.models.length > 0);

  return (
    <div className="relative mt-2 flex flex-wrap items-center gap-2 text-xs font-mono [&_button]:min-h-9 [&_button]:min-w-9 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-[var(--nc-text-accent)]">
      {/* Icono de ayuda para menciones @ */}
      <button
        type="button"
        onClick={onOpenMentionHelp}
        title={lang === 'es'
          ? 'Ayuda: @nono = abre Nono · @archivo = archivos · @ayuda = info'
          : lang === 'de' ? 'Hilfe: @nono = öffnet Nono · @archivo = Dateien · @ayuda = Info' : 'Help: @nono = opens Nono · @archivo = files · @ayuda = info'
        }
        aria-label={lang === 'es' ? 'Ayuda de menciones' : lang === 'de' ? 'Erwähnungshilfe' : 'Mention help'}
        className="shrink-0 p-1.5 bg-[var(--nc-bg-panel)] border border-cyan-400/40 rounded hover:bg-[var(--nc-bg-hover)] transition-colors cursor-help"
      >
        <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
      </button>

      {/* Botón adjuntar: antes de la elección de modelo */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer shrink-0 p-2 bg-[var(--nc-bg-main)] border border-cyan-400/40 rounded hover:bg-[var(--nc-bg-hover)] transition-colors"
        title={lang === 'es' ? 'Adjuntar archivos' : lang === 'de' ? 'Dateien anhängen' : 'Attach files'}
        aria-label={lang === 'es' ? 'Adjuntar archivos' : lang === 'de' ? 'Dateien anhängen' : 'Attach files'}
      >
        <Paperclip className="w-3.5 h-3.5 text-cyan-400" />
      </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => e.target.files && onAttach(e.target.files)}
          className="hidden"
          accept="image/*,.pdf,.txt,.md,.json,.js,.ts,.tsx,.jsx,.html,.css"
        />

      {/* Dictado: la voz sirve para escribir la instrucción, no para responder
          por audio. La transcripción se inserta en el mensaje y se revisa. */}
      {dictationSupported && onToggleDictation && (
        <button
          type="button"
          onClick={onToggleDictation}
          disabled={isGenerating || dictationState === 'transcribing'}
          aria-label={
            dictationState === 'recording'
              ? lang === 'es' ? 'Detener dictado' : lang === 'de' ? 'Diktat stoppen' : 'Stop dictation'
              : lang === 'es' ? 'Dictar por voz' : lang === 'de' ? 'Per Sprache diktieren' : 'Dictate by voice'
          }
          aria-pressed={dictationState === 'recording'}
          title={
            dictationState === 'recording'
              ? lang === 'es'
                ? 'Grabando… pulsa para transcribir al mensaje'
                : lang === 'de'
                  ? 'Aufnahme… klicken, um in die Nachricht zu übertragen'
                  : 'Recording… click to transcribe into the message'
              : dictationState === 'transcribing'
                ? lang === 'es' ? 'Transcribiendo…' : lang === 'de' ? 'Transkribiere…' : 'Transcribing…'
                : lang === 'es'
                  ? 'Dictar al mensaje con el micrófono'
                  : lang === 'de'
                    ? 'Nachricht per Mikrofon diktieren'
                    : 'Dictate into the message with the microphone'
          }
          className={`shrink-0 p-2 border rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            dictationState === 'recording'
              ? 'bg-red-600 border-red-400 text-white animate-pulse'
              : 'bg-[var(--nc-bg-panel)] border-cyan-400/40 text-cyan-400 hover:bg-[var(--nc-bg-hover)]'
          }`}
        >
          {dictationState === 'recording' ? (
            <MicOff className="w-3.5 h-3.5" />
          ) : dictationState === 'transcribing' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Mic className="w-3.5 h-3.5" />
          )}
        </button>
      )}
      {dictationState === 'recording' && (
        <span
          role="status"
          aria-live="polite"
          className="flex min-w-0 items-center gap-1 rounded border border-red-500/50 bg-red-500/10 px-2 py-1 text-[10px] text-red-200"
        >
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-400" aria-hidden="true" />
          <span className="truncate">
            {lang === 'es'
              ? `Grabando ${dictationSeconds}s…`
              : lang === 'de'
                ? `Aufnahme ${dictationSeconds}s…`
                : `Recording ${dictationSeconds}s…`}
          </span>
          <span className="hidden text-red-200/70 sm:inline">
            {lang === 'es'
              ? '· pulsa el micro para transcribir'
              : lang === 'de'
                ? '· Mikrofon zum Übertragen drücken'
                : '· tap the mic to transcribe'}
          </span>
        </span>
      )}
      {dictationError && (
        <span
          role="status"
          title={dictationError}
          className="min-w-0 max-w-[18rem] truncate rounded border border-red-500/50 bg-red-500/10 px-2 py-1 text-[10px] text-red-300"
        >
          {dictationError}
        </span>
      )}

      {/* Selector de modelo con búsqueda por proveedor y modelo */}
      <ModelPicker
        lang={lang}
        selectedModel={selectedModel}
        currentModel={currentModel}
        groups={visibleGroups}
        onSelectModel={onSelectModel}
        loading={providersLoaded}
        failed={providersFailed}
      />


      {/* Quick Local LLM indicator / switcher */}
      {localConfigured && (
        <button
          onClick={() => onOpenLocalLlmConfig?.()}
          title={lang === 'es'
            ? isLocal
              ? `Usando LLM local · ${selectedModel} · Clic para configurar`
              : `LLM local configurado (${localServerLabel()}) · Clic para activar`
            : lang === 'de'
              ? isLocal
                ? `Lokales LLM in Verwendung · ${selectedModel} · Klicken zum Konfigurieren`
                : `Lokales LLM konfiguriert (${localServerLabel()}) · Klicken zum Aktivieren`
              : isLocal
                ? `Using local LLM · ${selectedModel} · Click to configure`
                : `Local LLM configured (${localServerLabel()}) · Click to activate`
          }
          aria-label={lang === 'es' ? 'Configurar LLM local' : lang === 'de' ? 'Lokales LLM konfigurieren' : 'Configure local LLM'}
          className={`flex items-center gap-1 rounded border px-2 py-2 text-xs font-bold shrink-0 transition-colors ${
            isLocal
              ? 'border-[#00aa00] bg-[#002200] text-[var(--nc-success)]'
              : 'border-[var(--nc-border-mid)]/40 bg-[var(--nc-bg-main)] text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)]'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          {lang === 'es' ? 'Local' : lang === 'de' ? 'Lokal' : 'Local'}
        </button>
      )}

      {/* Run Mode (Build / Plan / Read-only) as collapsible select menu */}
      <select
        value={runMode}
        onChange={(e) => onChangeRunMode(e.target.value as RunMode)}
        title={`${
          lang === 'es' ? 'Modo' : lang === 'de' ? 'Modus' : 'Mode'
        }: ${runModeLabel} · ${
          lang === 'es' ? 'Menú para cambiar' : lang === 'de' ? 'Menü zum Ändern' : 'Menu to change'
        }`}
        aria-label={lang === 'es' ? 'Modo del agente' : lang === 'de' ? 'Agentenmodus' : 'Agent mode'}
        className={`min-h-9 max-w-full flex items-center gap-1 rounded border px-2 py-2 text-xs font-bold shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--nc-text-accent)] ${
          runMode === 'build'
            ? 'border-[#00aa00] bg-[#002200] text-[var(--nc-success)]'
            : runMode === 'plan'
              ? 'border-[var(--nc-text-accent)] bg-[#222200] text-[var(--nc-text-accent)]'
              : 'border-[#aa0000] bg-[#220000] text-[var(--nc-danger)]'
        }`}
      >
        <option value="build">{runModeOption('build')}</option>
        <option value="plan">{runModeOption('plan')}</option>
        <option value="readonly">{runModeOption('readonly')}</option>
      </select>

      <button
        onClick={onOpenAdvanced}
        title={lang === 'es' ? 'Configuración avanzada (tools, globs)' : lang === 'de' ? 'Erweiterte Einstellungen (Tools, Globs)' : 'Advanced settings (tools, globs)'}
        aria-label={lang === 'es' ? 'Configuración avanzada' : lang === 'de' ? 'Erweiterte Einstellungen' : 'Advanced settings'}
        className="flex items-center gap-1 rounded border border-cyan-400/40 px-2 py-2 text-xs font-bold text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] shrink-0"
      >
        <Settings className="w-3 h-3" />
        {lang === 'es' ? 'Avanzado' : lang === 'de' ? 'Erweitert' : 'Advanced'}
      </button>

      <div className="flex items-center gap-2 ml-auto shrink-0">
        <details className="relative" onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.currentTarget.open = false;
            e.currentTarget.querySelector('summary')?.focus();
          }
        }}>
          <summary className="min-h-9 flex items-center px-2 border border-cyan-400/40 cursor-pointer text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nc-text-accent)]" aria-label={lang === 'es' ? 'Opciones de conversación' : lang === 'de' ? 'Unterhaltungsoptionen' : 'Conversation options'}>
            {lang === 'es' ? 'Opciones' : lang === 'de' ? 'Optionen' : 'Options'}
          </summary>
          <div className="absolute bottom-full right-0 z-20 mb-2 w-56 max-w-[80vw] border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] p-1 shadow-lg">
            <button type="button" onClick={(e) => {
              const menu = e.currentTarget.closest('details');
              if (menu) {
                menu.open = false;
                menu.querySelector('summary')?.focus();
              }
              onClearChat();
            }} className="w-full px-3 py-2 text-left text-[var(--nc-danger)] hover:bg-[var(--nc-bg-hover)]">
              {lang === 'es' ? 'Limpiar conversación' : lang === 'de' ? 'Unterhaltung leeren' : 'Clear conversation'}
            </button>
          </div>
        </details>
        {/* Mientras corre algo el botón deja de ser Enviar y pasa a Detener: el
            usuario puede cortar una respuesta o una corrida del agente. */}
        {isGenerating ? (
          <button
            onClick={onStop}
            aria-label={lang === 'es' ? 'Detener generación' : lang === 'de' ? 'Generierung stoppen' : 'Stop generation'}
            title={lang === 'es' ? 'Detener la generación en curso' : lang === 'de' ? 'Laufende Generierung stoppen' : 'Stop the current generation'}
            className="flex min-h-10 items-center gap-2 px-4 py-2 border-2 border-[var(--nc-danger)] bg-[#330000] text-[var(--nc-danger)] font-bold hover:bg-[var(--nc-danger)] hover:text-black transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            {lang === 'es' ? 'Detener' : lang === 'de' ? 'Stopp' : 'Stop'}
          </button>
        ) : (
          <>
            {resumable && (
              <button
                onClick={onResume}
                aria-label={lang === 'es' ? 'Continuar la corrida detenida' : lang === 'de' ? 'Gestoppten Lauf fortsetzen' : 'Resume the stopped run'}
                title={lang === 'es' ? 'Retomar donde se quedó' : lang === 'de' ? 'Dort weitermachen, wo es aufgehört hat' : 'Continue where it stopped'}
                className="flex min-h-10 items-center gap-2 px-3 py-2 border-2 border-[var(--nc-success)] text-[var(--nc-success)] font-bold hover:bg-[var(--nc-success)] hover:text-black transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                {lang === 'es' ? 'Continuar' : lang === 'de' ? 'Fortsetzen' : 'Resume'}
              </button>
            )}
            <button
              onClick={onSend}
              disabled={!canSend}
              aria-label={lang === 'es' ? 'Enviar mensaje' : lang === 'de' ? 'Nachricht senden' : 'Send message'}
              title={lang === 'es' ? 'Enviar mensaje' : lang === 'de' ? 'Nachricht senden' : 'Send message'}
              className="flex min-h-10 items-center gap-2 px-4 py-2 border-2 border-[var(--nc-text-accent)] bg-[var(--nc-active-bg)] text-[var(--nc-active-text)] font-bold hover:bg-white hover:border-white disabled:bg-[var(--nc-bg-deep)] disabled:border-[var(--nc-border-dark)] disabled:text-[var(--nc-text-dim)] disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              {lang === 'es' ? 'Enviar' : lang === 'de' ? 'Senden' : 'Send'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ComposerToolbar;
