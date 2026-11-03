import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { StudioMode } from '../types/studio';
import type { Language } from '../i18n/translations';
import { ChatPlayground, type ChatPlaygroundProps } from './ChatPlayground';
import { FreeformPlayground, type FreeformPlaygroundProps } from './FreeformPlayground';
import { StructuredPlayground, type StructuredPlaygroundProps } from './StructuredPlayground';
import type { ComposerPlaygroundProps } from './ComposerPlayground';
import type { ComparePlaygroundProps } from './ComparePlayground';
import type { HuggingFacePlaygroundProps } from './HuggingFacePlayground';

// Las tres pantallas pesadas siguen entrando por su propio chunk: el composer
// arrastra jszip y HF el runtime de Transformers.js, así que se descargan la
// primera vez que se abre su modo, no al arrancar.
const ComposerPlayground = React.lazy(() =>
  import('./ComposerPlayground').then((m) => ({ default: m.ComposerPlayground }))
);
const ComparePlayground = React.lazy(() =>
  import('./ComparePlayground').then((m) => ({ default: m.ComparePlayground }))
);
const HuggingFacePlayground = React.lazy(() =>
  import('./HuggingFacePlayground').then((m) => ({ default: m.HuggingFacePlayground }))
);

/**
 * Armazón único de los playgrounds.
 *
 * Los seis modos de prueba comparten una sola barra: se cambia de modo sin
 * volver a la barra lateral y el modelo activo queda siempre a la vista.
 *
 * Las seis pantallas se montan aquí dentro, cada una con sus propias props, así
 * que App deja de conocer sus componentes y añadir un playground no obliga a
 * tocar la raíz. Quien no pase las props de un modo recibe `children`, que se
 * mantiene como salida de emergencia.
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
  /** Props de cada pantalla; sin ellas se pinta `children`. */
  chat?: ChatPlaygroundProps;
  freeform?: FreeformPlaygroundProps;
  structured?: StructuredPlaygroundProps;
  composer?: ComposerPlaygroundProps;
  compare?: ComparePlaygroundProps;
  huggingface?: HuggingFacePlaygroundProps;
  /** Lo que se ve mientras carga una pantalla diferida. */
  fallback?: React.ReactNode;
  children?: React.ReactNode;
}

export const Playground: React.FC<PlaygroundProps> = ({
  mode,
  setMode,
  lang = 'es',
  selectedModel,
  onOpenSettings,
  chat,
  freeform,
  structured,
  composer,
  compare,
  huggingface,
  fallback,
  children,
}) => {
  // Fuera de los seis modos (agente, voz…) el contenido lo pinta App.
  if (!isPlaygroundMode(mode)) return null;

  const modelLabel = lang === 'es' ? 'Modelo' : lang === 'de' ? 'Modell' : 'Model';
  const settingsLabel =
    lang === 'es' ? 'Ajustes del modelo' : lang === 'de' ? 'Modell-Einstellungen' : 'Model settings';

  // Pantallas propias primero; `children` queda como salida de emergencia.
  let screen: React.ReactNode = children;
  if (mode === 'chat' && chat) screen = <ChatPlayground {...chat} />;
  else if (mode === 'freeform' && freeform) screen = <FreeformPlayground {...freeform} />;
  else if (mode === 'structured' && structured) screen = <StructuredPlayground {...structured} />;
  else if (mode === 'composer' && composer)
    screen = (
      <React.Suspense fallback={fallback}>
        <ComposerPlayground {...composer} />
      </React.Suspense>
    );
  else if (mode === 'compare' && compare)
    screen = (
      <React.Suspense fallback={fallback}>
        <ComparePlayground {...compare} />
      </React.Suspense>
    );
  else if (mode === 'huggingface' && huggingface)
    screen = (
      <React.Suspense fallback={fallback}>
        <HuggingFacePlayground {...huggingface} />
      </React.Suspense>
    );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-2 py-1 bg-[var(--nc-header-bg)] border-b-2 border-[var(--nc-border-dark)] shrink-0 overflow-x-auto">
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
                  ? 'bg-[var(--nc-bg-panel)] text-[var(--nc-text)] border-[var(--nc-border-light)]'
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
            className="text-[10px] text-[var(--nc-text-accent)] bg-[var(--nc-bg-deep)] px-1.5 py-0.5 rounded-sm max-w-[220px] truncate"
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
              className="p-0.5 text-black hover:text-[var(--nc-text-accent)] rounded-sm"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">{screen}</div>
    </div>
  );
};

export default Playground;
