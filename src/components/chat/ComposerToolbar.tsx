/**
 * Barra inferior del compositor: adjuntar, selector de modelo, indicador de
 * LLM local, modo Build/Plan/Read-only, ajustes avanzados y acciones (texto,
 * limpiar, enviar).
 *
 * Extraído de `ChatPlayground`. Es puramente presentacional: recibe el estado
 * ya resuelto por props y devuelve callbacks, sin manejar estado propio.
 */
import React, { useRef } from 'react';
import {
  Send,
  RefreshCw,
  Paperclip,
  Settings,
  HelpCircle,
  Cpu,
} from 'lucide-react';
import { getCachedApiKey } from '../../lib/apiKeys';
import type { Language } from '../../i18n/translations';
import type { RunMode } from '../../types/studio';
import { MODEL_GROUPS, isLocalModelId, type ModelGroup } from './modelGroups';

/** `true` si hay un servidor local configurado (Ollama u OpenAI-compatible). */
const hasLocalServer = (): boolean =>
  !!(getCachedApiKey('OLLAMA_HOST') || getCachedApiKey('CUSTOM_BASE_URL'));

const localServerLabel = (): string =>
  getCachedApiKey('OLLAMA_HOST') || getCachedApiKey('CUSTOM_BASE_URL') || '';

export type FontScale = 'normal' | 'lg' | 'xl';

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
  fontScale: FontScale;
  onCycleFontScale: () => void;
  isGenerating: boolean;
  canSend: boolean;
  onSend: () => void;
  onClearChat: () => void;
  onAttach: (files: FileList) => void;
  onOpenLocalLlmConfig?: () => void;
  onOpenAdvanced: () => void;
  onOpenMentionHelp: () => void;
}

export const ComposerToolbar: React.FC<ComposerToolbarProps> = ({
  lang,
  selectedModel,
  onSelectModel,
  currentModel,
  modelGroups = MODEL_GROUPS,
  runMode,
  onChangeRunMode,
  fontScale,
  onCycleFontScale,
  isGenerating,
  canSend,
  onSend,
  onClearChat,
  onAttach,
  onOpenLocalLlmConfig,
  onOpenAdvanced,
  onOpenMentionHelp,
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

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-mono [&_button]:min-h-9 [&_button]:min-w-9 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-[#ffff55]">
      {/* Icono de ayuda para menciones @ */}
      <button
        type="button"
        onClick={onOpenMentionHelp}
        title={lang === 'es'
          ? 'Ayuda: @nono = abre Nono · @archivo = archivos · @ayuda = info'
          : lang === 'de' ? 'Hilfe: @nono = öffnet Nono · @archivo = Dateien · @ayuda = Info' : 'Help: @nono = opens Nono · @archivo = files · @ayuda = info'
        }
        aria-label={lang === 'es' ? 'Ayuda de menciones' : lang === 'de' ? 'Erwähnungshilfe' : 'Mention help'}
        className="shrink-0 p-1.5 bg-[#000080] border border-cyan-400/40 rounded hover:bg-[#0000cc] transition-colors cursor-help"
      >
        <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
      </button>

      {/* Botón adjuntar: antes de la elección de modelo */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer shrink-0 p-2 bg-[#0000aa] border border-cyan-400/40 rounded hover:bg-[#0000cc] transition-colors"
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

      {/* Selector de modelo: el que se usará para responder */}
      <select
        value={selectedModel}
        onChange={(e) => onSelectModel(e.target.value)}
        aria-label={lang === 'es' ? 'Modelo que se usará para responder' : lang === 'de' ? 'Modell für die Antwort' : 'Model used to answer'}
        title={
          lang === 'es'
            ? `Modelo en uso${currentModel?.description ? `: ${currentModel.description}` : ''}`
            : lang === 'de'
              ? `Verwendetes Modell${currentModel?.description ? `: ${currentModel.description}` : ''}`
              : `Model in use${currentModel?.description ? `: ${currentModel.description}` : ''}`
        }
        className="order-first w-full min-w-0 min-h-10 sm:order-none sm:w-auto sm:min-w-[240px] sm:flex-1 bg-[#000080] border border-cyan-400/60 text-[#00ffff] text-sm font-mono px-2 py-2 rounded focus-visible:outline-2 focus-visible:outline-[#ffff55] cursor-pointer"
      >
        {/* Modelo no listado (p. ej. descargado de HuggingFace) */}
        {!currentModel && <option value={selectedModel}>{selectedModel}</option>}
        {modelGroups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.badge ? ` · ${m.badge}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

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
              ? 'border-[#00aa00] bg-[#002200] text-[#00ff00]'
              : 'border-[#00aaaa]/40 bg-[#0000aa] text-[#00ffff] hover:bg-[#0000cc]'
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
        className={`min-h-9 max-w-full flex items-center gap-1 rounded border px-2 py-2 text-xs font-bold shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#ffff55] ${
          runMode === 'build'
            ? 'border-[#00aa00] bg-[#002200] text-[#00ff00]'
            : runMode === 'plan'
              ? 'border-[#ffff55] bg-[#222200] text-[#ffff55]'
              : 'border-[#aa0000] bg-[#220000] text-[#ff5555]'
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
        className="flex items-center gap-1 rounded border border-cyan-400/40 px-2 py-2 text-xs font-bold text-[#00ffff] hover:bg-[#0000aa] shrink-0"
      >
        <Settings className="w-3 h-3" />
        {lang === 'es' ? 'Avanzado' : lang === 'de' ? 'Erweitert' : 'Advanced'}
      </button>

      <div className="flex items-center gap-2 ml-auto shrink-0">
        <button
          onClick={onCycleFontScale}
          title={lang === 'es' ? 'Tamaño del texto' : lang === 'de' ? 'Textgröße' : 'Text size'}
          aria-label={lang === 'es' ? 'Tamaño del texto' : lang === 'de' ? 'Textgröße' : 'Text size'}
          className="px-2 text-cyan-200 hover:text-white"
        >
          A{fontScale === 'lg' ? '+' : fontScale === 'xl' ? '++' : ''}
        </button>
        <details className="relative" onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.currentTarget.open = false;
            e.currentTarget.querySelector('summary')?.focus();
          }
        }}>
          <summary className="min-h-9 flex items-center px-2 border border-cyan-400/40 cursor-pointer text-[#00ffff] hover:bg-[#0000aa] focus-visible:outline-2 focus-visible:outline-[#ffff55]" aria-label={lang === 'es' ? 'Opciones de conversación' : lang === 'de' ? 'Unterhaltungsoptionen' : 'Conversation options'}>
            {lang === 'es' ? 'Opciones' : lang === 'de' ? 'Optionen' : 'Options'}
          </summary>
          <div className="absolute bottom-full right-0 z-20 mb-2 w-56 max-w-[80vw] border border-[#00ffff] bg-[#000080] p-1 shadow-lg">
            <button type="button" onClick={(e) => {
              const menu = e.currentTarget.closest('details');
              if (menu) {
                menu.open = false;
                menu.querySelector('summary')?.focus();
              }
              onClearChat();
            }} className="w-full px-3 py-2 text-left text-red-300 hover:bg-[#0000aa]">
              {lang === 'es' ? 'Limpiar conversación' : lang === 'de' ? 'Unterhaltung leeren' : 'Clear conversation'}
            </button>
          </div>
        </details>
        <button
          onClick={onSend}
          disabled={isGenerating || !canSend}
          aria-label={lang === 'es' ? 'Enviar mensaje' : lang === 'de' ? 'Nachricht senden' : 'Send message'}
          title={lang === 'es' ? 'Enviar mensaje' : lang === 'de' ? 'Nachricht senden' : 'Send message'}
          className="flex min-h-10 items-center gap-2 px-4 py-2 border-2 border-[#ffff55] bg-[#ffff55] text-[#000080] font-bold hover:bg-white hover:border-white disabled:bg-[#333355] disabled:border-[#666688] disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {isGenerating ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          {isGenerating
            ? lang === 'es' ? 'Generando…' : lang === 'de' ? 'Generiert…' : 'Generating…'
            : lang === 'es' ? 'Enviar' : lang === 'de' ? 'Senden' : 'Send'}
        </button>
      </div>
    </div>
  );
};

export default ComposerToolbar;
