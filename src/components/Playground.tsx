import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { StudioMode } from '../types/studio';
import type { Language } from '../i18n/translations';

/**
 * Armazón único de los playgrounds.
 *
 * Los seis modos de prueba (chat, libre, estructurado, composer, comparar y
 * Hugging Face local) comparten ahora una sola barra: se cambia de modo sin
 * volver a la barra lateral y el modelo activo queda siempre a la vista. La
 * lógica de cada pantalla sigue viviendo en su componente; aquí sólo se monta
 * el que esté activo.
 */
export const PLAYGROUND_MODES = ['chat', 'freeform', 'structured', 'composer', 'compare', 'huggingface'] as const;

export type PlaygroundMode = (typeof PLAYGROUND_MODES)[number];

export function isPlaygroundMode(mode: StudioMode): mode is PlaygroundMode {
  return (PLAYGROUND_MODES as readonly string[]).includes(mode);
}

interface ModeSpec {
  id: PlaygroundMode;
  es: string;
  de: string;
  en: string;
}

const MODES: ModeSpec[] = [
  { id: 'chat', es: 'Chat', de: 'Chat', en: 'Chat' },
  { id: 'freeform', es: 'Libre', de: 'Frei', en: 'Freeform' },
  { id: 'structured', es: 'Estructurado', de: 'Struktur', en: 'Structured' },
  { id: 'composer', es: 'Composer', de: 'Composer', en: 'Composer' },
  { id: 'compare', es: 'Comparar', de: 'Vergleich', en: 'Compare' },
  { id: 'huggingface', es: 'HF local', de: 'HF lokal', en: 'HF local' },
];

export interface PlaygroundProps {
  mode: StudioMode;
  setMode: (mode: StudioMode) => void;
  lang?: Language;
  /** Modelo activo, sólo como referencia: cada pantalla decide cuál usa. */
  selectedModel?: string;
  /** Abre el panel de ajustes del modelo. */
  onOpenSettings?: () => void;
  children: React.ReactNode;
}

export const Playground: React.FC<PlaygroundProps> = ({
  mode,
  setMode,
  lang = 'es',
  selectedModel,
  onOpenSettings,
  children,
}) => {
  // Fuera de los seis modos (agente, voz…) el contenido lo pinta App.
  if (!isPlaygroundMode(mode)) return null;

  const modelLabel = lang === 'es' ? 'Modelo' : lang === 'de' ? 'Modell' : 'Model';
  const settingsLabel =
    lang === 'es' ? 'Ajustes del modelo' : lang === 'de' ? 'Modell-Einstellungen' : 'Model settings';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-2 py-1 bg-[#00aaaa] border-b-2 border-[#000055] shrink-0 overflow-x-auto">
        {MODES.map((spec) => {
          const active = spec.id === mode;
          return (
            <button
              key={spec.id}
              type="button"
              onClick={() => setMode(spec.id)}
              aria-pressed={active}
              data-testid={`playground-mode-${spec.id}`}
              className={`px-2 py-0.5 text-[11px] font-bold rounded-sm border whitespace-nowrap transition-colors ${
                active
                  ? 'bg-[#000080] text-[#00ffff] border-[#00ffff]'
                  : 'text-black hover:bg-black/10 border-transparent'
              }`}
            >
              {lang === 'es' ? spec.es : lang === 'de' ? spec.de : spec.en}
            </button>
          );
        })}

        <span className="ml-auto flex items-center gap-1 shrink-0 pl-2">
          <span className="text-[10px] text-black/70 font-bold">{modelLabel}:</span>
          <code
            className="text-[10px] text-[#ffff55] bg-[#000055] px-1.5 py-0.5 rounded-sm max-w-[220px] truncate"
            title={selectedModel || ''}
            data-testid="playground-model"
          >
            {selectedModel || '—'}
          </code>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              title={settingsLabel}
              aria-label={settingsLabel}
              className="p-0.5 text-black hover:text-[#ffff55] rounded-sm"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
};

export default Playground;
