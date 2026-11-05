/**
 * Selector de modelo del compositor con búsqueda.
 *
 * Un `<select>` nativo no deja buscar y el catálogo ya pasa de cien modelos
 * entre proveedores, así que se abre un panel con una caja de búsqueda (por
 * proveedor o modelo) y atajos de proveedor. Sigue siendo presentacional: el
 * modelo activo y el cambio viven en `ChatPlayground`, como antes.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { Language } from '../../i18n/translations';
import type { ModelGroup, ModelGroupStatus } from './modelGroups';
import { countModels, filterModelGroups } from './modelSearch';

const STATUS_TEXT: Record<ModelGroupStatus, { es: string; en: string; de: string }> = {
  connected: { es: 'Conectado', en: 'Connected', de: 'Verbunden' },
  saved: { es: 'Guardado', en: 'Saved', de: 'Gespeichert' },
  offline: { es: 'Sin conexión', en: 'Offline', de: 'Nicht erreichbar' },
  disabled: { es: 'Desactivado', en: 'Disabled', de: 'Deaktiviert' },
};

const STATUS_TITLE: Record<ModelGroupStatus, { es: string; en: string; de: string }> = {
  connected: {
    es: 'El proveedor responde ahora mismo',
    en: 'The provider is responding right now',
    de: 'Der Anbieter antwortet gerade',
  },
  saved: {
    es: 'Sin conexión: modelos guardados de la última detección',
    en: 'Offline: models saved from the last detection',
    de: 'Offline: zuletzt erkannte Modelle gespeichert',
  },
  offline: {
    es: 'Proveedor configurado pero sin respuesta',
    en: 'Provider configured but not responding',
    de: 'Anbieter konfiguriert, antwortet aber nicht',
  },
  disabled: { es: 'Proveedor sin configurar', en: 'Provider not configured', de: 'Anbieter nicht konfiguriert' },
};

const STATUS_STYLE: Record<ModelGroupStatus, { text: string; dot: string }> = {
  connected: { text: 'text-emerald-300', dot: 'bg-emerald-400' },
  saved: { text: 'text-amber-300', dot: 'bg-amber-400' },
  offline: { text: 'text-red-300', dot: 'bg-red-400' },
  disabled: { text: 'text-[var(--nc-text-dim)]', dot: 'bg-[var(--nc-text-dim)]' },
};

interface ModelPickerProps {
  lang: Language;
  /** Id del modelo activo. */
  selectedModel: string;
  /** Modelo activo resuelto en el catálogo (`undefined` si no está listado). */
  currentModel?: { name?: string; badge?: string; description?: string };
  groups: ModelGroup[];
  onSelectModel: (modelId: string) => void;
  /** Aún no se sabe qué proveedores están configurados. */
  loading?: boolean;
  /** La consulta de proveedores falló y se muestra el catálogo base. */
  failed?: boolean;
}

const OPTION_ID = 'model-picker-listbox';

export const ModelPicker: React.FC<ModelPickerProps> = ({
  lang,
  selectedModel,
  currentModel,
  groups,
  onSelectModel,
  loading = false,
  failed = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const text = {
    button: lang === 'es' ? 'Modelo que se usará para responder' : lang === 'de' ? 'Modell für die Antwort' : 'Model used to answer',
    open: lang === 'es' ? 'Elegir modelo' : lang === 'de' ? 'Modell wählen' : 'Choose model',
    search: lang === 'es' ? 'Buscar modelo o proveedor' : lang === 'de' ? 'Modell oder Anbieter suchen' : 'Search model or provider',
    placeholder: lang === 'es' ? 'Proveedor o modelo…' : lang === 'de' ? 'Anbieter oder Modell…' : 'Provider or model…',
    all: lang === 'es' ? 'Todos' : lang === 'de' ? 'Alle' : 'All',
    empty: lang === 'es' ? 'Sin coincidencias' : lang === 'de' ? 'Keine Treffer' : 'No matches',
    noProvider: lang === 'es' ? 'Configura un proveedor…' : lang === 'de' ? 'Anbieter konfigurieren…' : 'Configure a provider…',
    results: (n: number) =>
      lang === 'es' ? `${n} modelos` : lang === 'de' ? `${n} Modelle` : `${n} models`,
  };

  const visible = useMemo(() => filterModelGroups(groups, query, providerId), [groups, query, providerId]);
  const flat = useMemo(() => visible.flatMap((group) => group.models), [visible]);
  const total = countModels(visible);

  // El índice activo es por lista visible: al cambiar el texto o el proveedor
  // se reinicia para no seleccionar algo que ya no está en pantalla.
  useEffect(() => {
    setActive(-1);
  }, [query, providerId]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (active < 0) return;
    // jsdom no implementa scrollIntoView; el guardado evita romper los tests.
    document.getElementById(`${OPTION_ID}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setProviderId(null);
    triggerRef.current?.focus();
  };

  const choose = (modelId: string) => {
    onSelectModel(modelId);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => {
        if (current < 0) return delta > 0 ? 0 : flat.length - 1;
        return (current + delta + flat.length) % flat.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = flat[active] ?? (flat.length === 1 ? flat[0] : undefined);
      if (target) choose(target.id);
    }
  };

  const shown = currentModel?.name
    ? `${currentModel.name}${currentModel.badge ? ` · ${currentModel.badge}` : ''}`
    : selectedModel;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={text.button}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={
          lang === 'es'
            ? `Modelo en uso${currentModel?.description ? `: ${currentModel.description}` : ''}`
            : lang === 'de'
              ? `Verwendetes Modell${currentModel?.description ? `: ${currentModel.description}` : ''}`
              : `Model in use${currentModel?.description ? `: ${currentModel.description}` : ''}`
        }
        className="order-first flex w-full min-w-0 min-h-10 items-center justify-between gap-2 bg-[var(--nc-bg-panel)] border border-cyan-400/60 text-[var(--nc-text)] text-sm font-mono px-2 py-2 rounded sm:order-none sm:w-auto sm:min-w-[240px] sm:flex-1 focus-visible:outline-2 focus-visible:outline-[var(--nc-text-accent)] cursor-pointer text-left"
      >
        <span className="truncate">{shown}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={text.open}
          className="absolute bottom-full left-0 z-40 mb-2 flex w-[min(30rem,92vw)] flex-col border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-[var(--nc-border-dark)] px-2 py-1.5">
            <Search className="w-3.5 h-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              aria-label={text.search}
              aria-controls={OPTION_ID}
              aria-autocomplete="list"
              placeholder={text.placeholder}
              className="w-full bg-transparent text-sm font-mono text-[var(--nc-text)] placeholder:text-[var(--nc-text-dim)] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-1 border-b border-[var(--nc-border-dark)] px-2 py-1.5">
            {[{ id: null as string | null, label: text.all }, ...groups.map((group) => ({ id: group.id, label: group.label }))].map(
              (chip) => (
                <button
                  key={chip.id ?? 'all'}
                  type="button"
                  onClick={() => setProviderId(chip.id)}
                  aria-pressed={providerId === chip.id}
                  className={`px-2 py-0.5 text-[11px] font-mono border rounded transition-colors ${
                    providerId === chip.id
                      ? 'border-[var(--nc-text-accent)] bg-[var(--nc-active-bg)] text-[var(--nc-active-text)]'
                      : 'border-cyan-400/40 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)]'
                  }`}
                >
                  {chip.label}
                </button>
              )
            )}
          </div>

          {total === 0 ? (
            <p role="status" className="px-3 py-4 text-xs font-mono text-[var(--nc-text-dim)]">
              {loading ? text.noProvider : failed ? text.empty : text.empty}
            </p>
          ) : (
            <ul
              id={OPTION_ID}
              role="listbox"
              aria-label={text.open}
              className="max-h-72 overflow-y-auto py-1"
            >
              {visible.map((group) => (
                <li key={group.id} className="list-none">
                  <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-[var(--nc-bg-panel)] px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--nc-text-dim)]">
                    <span>{group.label}</span>
                    {group.status && (
                      <span
                        className={`flex items-center gap-1 normal-case tracking-normal ${STATUS_STYLE[group.status].text}`}
                        title={STATUS_TITLE[group.status][lang === 'es' ? 'es' : lang === 'de' ? 'de' : 'en']}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_STYLE[group.status].dot}`} aria-hidden="true" />
                        {STATUS_TEXT[group.status][lang === 'es' ? 'es' : lang === 'de' ? 'de' : 'en']}
                      </span>
                    )}
                  </div>
                  <ul role="group" aria-label={group.label} className="list-none">
                    {group.models.map((model) => {
                      const index = flat.findIndex((item) => item.id === model.id);
                      const isActive = index === active;
                      const isSelected = model.id === selectedModel;
                      return (
                        <li
                          key={model.id}
                          id={`${OPTION_ID}-${index}`}
                          role="option"
                          aria-selected={isSelected}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => choose(model.id)}
                          className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs font-mono ${
                            isActive ? 'bg-[var(--nc-bg-hover)]' : ''
                          } ${isSelected ? 'text-[var(--nc-text-accent)]' : 'text-[var(--nc-text)]'}`}
                        >
                          <span className="w-3.5 shrink-0">
                            {isSelected && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {model.name}
                            {model.badge && <span className="text-[var(--nc-text-dim)]"> · {model.badge}</span>}
                            {model.deprecated && (
                              <span
                                className="text-amber-300"
                                title={
                                  lang === 'es'
                                    ? 'Modelo discontinuado por el proveedor'
                                    : lang === 'de'
                                      ? 'Vom Anbieter eingestelltes Modell'
                                      : 'Model discontinued by the provider'
                                }
                              >
                                {' · '}
                                {lang === 'es' ? 'discontinuado' : lang === 'de' ? 'veraltet' : 'discontinued'}
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          <p className="border-t border-[var(--nc-border-dark)] px-3 py-1 text-[10px] font-mono text-[var(--nc-text-dim)]">
            {text.results(total)}
          </p>
        </div>
      )}
    </>
  );
};

export default ModelPicker;
