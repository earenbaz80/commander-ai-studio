/**
 * Selector de modelo del compositor con búsqueda.
 *
 * Un `<select>` nativo no deja buscar y el catálogo ya pasa de cien modelos
 * entre proveedores, así que se abre un panel con una caja de búsqueda (por
 * proveedor o modelo) y atajos de proveedor. Sigue siendo presentacional: el
 * modelo activo y el cambio viven en `ChatPlayground`, como antes.
 *
 * Cada modelo detectado se puede apagar sin borrarlo del catálogo: se guarda en
 * la lista negra del proveedor. Por defecto sólo se ven los activos; el botón
 * «Mostrar desactivados» los enseña atenuados para volver a encenderlos.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Eye, EyeOff, Power, Search } from 'lucide-react';
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

/** Set vacío estable para no recrear el memo cuando no hay modelos apagados. */
const NO_DISABLED = new Set<string>();

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
  /** Ids apagados por las listas del proveedor. */
  disabledIds?: Set<string>;
  /** Guarda el interruptor de un modelo; sin esto no se muestran interruptores. */
  onToggleModel?: (modelId: string, enabled: boolean) => void;
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
  disabledIds = NO_DISABLED,
  onToggleModel,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [showDisabled, setShowDisabled] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const text = {
    button: lang === 'es' ? 'Modelo que se usará para responder' : lang === 'de' ? 'Modell für die Antwort' : 'Model used to answer',
    open: lang === 'es' ? 'Elegir modelo' : lang === 'de' ? 'Modell wählen' : 'Choose model',
    search: lang === 'es' ? 'Buscar modelo o proveedor' : lang === 'de' ? 'Modell oder Anbieter suchen' : 'Search model or provider',
    placeholder: lang === 'es' ? 'Proveedor o modelo…' : lang === 'de' ? 'Anbieter oder Modell…' : 'Provider or model…',
    all: lang === 'es' ? 'Todos' : lang === 'de' ? 'Alle' : 'All',
    tabs: lang === 'es' ? 'Proveedores' : lang === 'de' ? 'Anbieter' : 'Providers',
    empty: lang === 'es' ? 'Sin coincidencias' : lang === 'de' ? 'Keine Treffer' : 'No matches',
    noProvider: lang === 'es' ? 'Configura un proveedor…' : lang === 'de' ? 'Anbieter konfigurieren…' : 'Configure a provider…',
    noModels: lang === 'es' ? 'Sin modelos detectados' : lang === 'de' ? 'Keine Modelle erkannt' : 'No models detected',
    allDisabled: lang === 'es' ? 'Todos los modelos están desactivados' : lang === 'de' ? 'Alle Modelle sind deaktiviert' : 'All models are disabled',
    showDisabled: lang === 'es' ? 'Mostrar desactivados' : lang === 'de' ? 'Deaktivierte zeigen' : 'Show disabled',
    hideDisabled: lang === 'es' ? 'Ocultar desactivados' : lang === 'de' ? 'Deaktivierte ausblenden' : 'Hide disabled',
    enableModel: lang === 'es' ? 'Activar' : lang === 'de' ? 'Aktivieren' : 'Enable',
    disableModel: lang === 'es' ? 'Desactivar' : lang === 'de' ? 'Deaktivieren' : 'Disable',
    disabled: lang === 'es' ? 'desactivado' : lang === 'de' ? 'deaktiviert' : 'disabled',
    results: (n: number) =>
      lang === 'es' ? `${n} modelos` : lang === 'de' ? `${n} Modelle` : `${n} models`,
  };

  const providerTabs = useMemo(
    () => [
      { id: null as string | null, label: text.all },
      ...groups.map((group) => ({ id: group.id as string | null, label: group.label })),
    ],
    [groups, text.all]
  );

  const filtered = useMemo(() => filterModelGroups(groups, query, providerId), [groups, query, providerId]);
  const visible = useMemo(
    () =>
      filtered.map((group) => ({
        ...group,
        models: showDisabled ? group.models : group.models.filter((model) => !disabledIds.has(model.id)),
      })),
    [filtered, showDisabled, disabledIds]
  );
  const flat = useMemo(() => visible.flatMap((group) => group.models), [visible]);
  const total = countModels(visible);

  // El índice activo es por lista visible: al cambiar el texto, el proveedor o
  // la vista de desactivados se reinicia para no seleccionar algo oculto.
  useEffect(() => {
    setActive(-1);
  }, [query, providerId, showDisabled]);

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

  // La rueda vertical sobre las pestañas se traduce en scroll horizontal. Se
  // usa un listener nativo porque React registra `onWheel` como pasivo y
  // `preventDefault()` no tendría efecto. Si la tira ya está en el extremo en
  // esa dirección, no se intercepta: la página puede seguir scrolleando.
  useEffect(() => {
    if (!open) return;
    const el = tabsRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // deja pasar el zoom
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!raw) return;
      // deltaMode 1 = líneas, 2 = páginas; el resto ya viene en píxeles.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1;
      const next = Math.max(0, Math.min(max, el.scrollLeft + raw * unit));
      if (next === el.scrollLeft) return;
      event.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open]);

  useEffect(() => {
    if (active < 0) return;
    // jsdom no implementa scrollIntoView; el guardado evita romper los tests.
    document.getElementById(`${OPTION_ID}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  // La pestaña activa no puede quedar fuera de la tira horizontal al cambiar
  // con el teclado o al abrir el selector.
  useEffect(() => {
    if (!open) return;
    const index = providerId === null ? 0 : groups.findIndex((group) => group.id === providerId) + 1;
    const button = tabsRef.current?.querySelectorAll<HTMLButtonElement>('[data-provider-tab]')[index];
    button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [open, providerId, groups]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setProviderId(null);
    triggerRef.current?.focus();
  };

  const choose = (modelId: string) => {
    if (disabledIds.has(modelId)) return;
    onSelectModel(modelId);
    close();
  };

  const providerTabAt = (index: number): HTMLButtonElement | null =>
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[data-provider-tab]')[index] ?? null;

  const focusProviderTab = (index: number) => {
    const chip = providerTabs[index];
    if (!chip) return;
    setProviderId(chip.id);
    const button = providerTabAt(index);
    button?.focus();
    button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  const onProviderTabsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = tabsRef.current
      ? Array.from(tabsRef.current.querySelectorAll<HTMLButtonElement>('[data-provider-tab]'))
      : [];
    if (buttons.length === 0) return;
    event.preventDefault();
    const current = Math.max(0, buttons.indexOf(event.target as HTMLButtonElement));
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowRight'
            ? (current + 1) % buttons.length
            : (current - 1 + buttons.length) % buttons.length;
    focusProviderTab(next);
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

          <div className="flex items-center gap-1 border-b border-[var(--nc-border-dark)] px-2 py-1">
            <div
              ref={tabsRef}
              data-testid="model-provider-tabs"
              role="group"
              aria-label={text.tabs}
              style={{ touchAction: 'pan-x' }}
              className="flex min-w-0 flex-1 flex-nowrap gap-1 overflow-x-auto nc-x-scroll py-0.5"
              onKeyDown={onProviderTabsKeyDown}
            >
            {providerTabs.map((chip) => (
              <button
                key={chip.id ?? 'all'}
                type="button"
                data-provider-tab
                onClick={() => setProviderId(chip.id)}
                aria-pressed={providerId === chip.id}
                className={`shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[10px] font-mono border rounded transition-colors ${
                  providerId === chip.id
                    ? 'border-[var(--nc-text-accent)] bg-[var(--nc-active-bg)] text-[var(--nc-active-text)]'
                    : 'border-cyan-400/40 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)]'
                }`}
              >
                {chip.label}
              </button>
            ))}
            </div>
            {/* Sólo icono: el texto robaba ancho a las pestañas. El nombre
                accesible y el tooltip siguen explicando qué hace. */}
            <button
              type="button"
              onClick={() => setShowDisabled((value) => !value)}
              aria-pressed={showDisabled}
              aria-label={showDisabled ? text.hideDisabled : text.showDisabled}
              title={
                lang === 'es'
                  ? 'Ver también los modelos apagados, para volver a activarlos'
                  : lang === 'de'
                    ? 'Auch deaktivierte Modelle zeigen, um sie wieder zu aktivieren'
                    : 'Also show disabled models so they can be enabled again'
              }
              className={`flex h-5 w-5 shrink-0 items-center justify-center border rounded p-0 transition-colors ${
                showDisabled
                  ? 'border-amber-400/70 text-amber-300 bg-amber-500/10'
                  : 'border-cyan-400/40 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)]'
              }`}
            >
              {showDisabled ? (
                <Eye className="h-3 w-3" aria-hidden="true" />
              ) : (
                <EyeOff className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
          </div>

          {visible.length === 0 ? (
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
              {visible.map((group) => {
                const source = groups.find((item) => item.id === group.id);
                const hiddenCount = (source?.models || []).filter((model) => disabledIds.has(model.id)).length;
                return (
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
                      {group.models.length === 0 ? (
                        <li className="list-none px-3 py-1.5 text-[11px] font-mono text-[var(--nc-text-dim)]">
                          {hiddenCount > 0 && !showDisabled ? text.allDisabled : text.noModels}
                        </li>
                      ) : (
                        group.models.map((model) => {
                          const index = flat.findIndex((item) => item.id === model.id);
                          const isActive = index === active;
                          const isSelected = model.id === selectedModel;
                          const isDisabled = disabledIds.has(model.id);
                          return (
                            <li
                              key={model.id}
                              id={`${OPTION_ID}-${index}`}
                              role="option"
                              aria-selected={isSelected}
                              aria-disabled={isDisabled}
                              onMouseEnter={() => setActive(index)}
                              onClick={() => choose(model.id)}
                              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs font-mono ${
                                isActive ? 'bg-[var(--nc-bg-hover)]' : ''
                              } ${isDisabled ? 'opacity-60' : ''} ${
                                isSelected ? 'text-[var(--nc-text-accent)]' : 'text-[var(--nc-text)]'
                              }`}
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
                                {isDisabled && <span className="text-[var(--nc-text-dim)]"> · {text.disabled}</span>}
                              </span>
                              {onToggleModel && (
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={!isDisabled}
                                  aria-label={`${isDisabled ? text.enableModel : text.disableModel}: ${model.name}`}
                                  title={isDisabled ? text.enableModel : text.disableModel}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onToggleModel(model.id, isDisabled);
                                  }}
                                  style={{ minHeight: 0, minWidth: 0 }}
                                  className={`shrink-0 rounded border p-1 transition-colors ${
                                    isDisabled
                                      ? 'border-[var(--nc-border-mid)] text-[var(--nc-text-dim)] hover:border-emerald-400/60 hover:text-emerald-300'
                                      : 'border-emerald-500/50 text-emerald-300 hover:bg-[var(--nc-bg-hover)]'
                                  }`}
                                >
                                  <Power className="h-3 w-3" aria-hidden="true" />
                                </button>
                              )}
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </li>
                );
              })}
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
