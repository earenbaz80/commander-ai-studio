/**
 * Gestor de proveedores.
 *
 * Antes hablaba con rutas que no existían (`GET`/`DELETE /api/providers`) y
 * guardaba en un `commander.json` que ningún handler leía. Ahora la lista, el
 * estado y los modelos vienen del servidor, y lo guardado se usa de verdad: es
 * el mismo `commander.json` que consultan los handlers de generación.
 *
 * La UI separa «configurados» de «por configurar», muestra cuántos modelos
 * trae cada uno y deja editarlo en el sitio, sin modal encima de modal.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Search,
  Trash2,
  Save,
  X,
  ChevronRight,
  KeyRound,
  Server,
  Plus,
  Wand2,
  Power,
} from 'lucide-react';
import { Language } from '../../i18n/translations';
import {
  PROVIDER_FILTERS_CHANGED,
  isModelDisabledByFilter,
  parseFilterList as parseList,
  toggleModelFilter,
} from '../../lib/providerFilters';
import { slugifyProviderId } from '../../lib/openaiCompatibleProviders';

interface AvailableProvider {
  id: string;
  name: string;
  env: string[];
  doc?: string;
  api?: string;
  modelCount: number;
  supported: boolean;
  configured: boolean;
}

const EMPTY_NEW_PROVIDER = { id: '', name: '', baseUrl: '', apiKey: '', models: '' };

/** Evita sondear mientras la URL todavía está a medio escribir. */
const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
};

interface ProviderField {
  name: string;
  required: boolean;
  kind: 'secret' | 'url' | 'text';
}

interface ProviderModel {
  id: string;
  name: string;
  contextWindow?: string;
  supportsTools?: boolean;
}

interface ProviderEntry {
  id: string;
  name: string;
  env: string[];
  fields: ProviderField[];
  configured: boolean;
  missing: string[];
  source: 'env' | 'file' | 'local' | 'none';
  models: ProviderModel[];
  /** Todos los detectados, incluidos los apagados. */
  allModels: ProviderModel[];
  modelCount: number;
  totalModels: number;
  enabled: boolean;
  whitelist: string[];
  blacklist: string[];
  defaultModel?: string;
  /** Host que se está usando (sólo proveedores locales). */
  host?: string;
  /** `false` si el host local está configurado pero no responde. */
  reachable?: boolean;
  /** Motivo del fallo de la sonda (HTTP 503, timeout…). */
  probeError?: string;
  /** Añadido por el usuario como endpoint OpenAI-compatible. */
  custom?: boolean;
}

type AddCheckStatus = 'incompatible' | 'auth' | 'unreachable';

interface AddCheck {
  status: AddCheckStatus;
  detail: string;
  httpStatus?: number;
}

interface ProviderManagerProps {
  isOpen?: boolean;
  onClose?: () => void;
  lang?: Language;
  /** Se renderiza dentro de Configuración, sin overlay ni cabecera de modal. */
  embedded?: boolean;
}

const SOURCE_LABEL: Record<ProviderEntry['source'], { es: string; en: string; de: string }> = {
  env: { es: 'entorno', en: 'env', de: 'Umgebung' },
  file: { es: 'guardado', en: 'saved', de: 'gespeichert' },
  local: { es: 'local', en: 'local', de: 'lokal' },
  none: { es: 'sin configurar', en: 'not configured', de: 'nicht konfiguriert' },
};

export const ProviderManager: React.FC<ProviderManagerProps> = ({ isOpen = false, onClose, lang = 'es', embedded = false }) => {
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [configPath, setConfigPath] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [notice, setNotice] = useState('');
  /** Texto de las listas del proveedor abierto, tal cual lo escribe el usuario. */
  const [filterDraft, setFilterDraft] = useState<Record<string, { whitelist: string; blacklist: string }>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [available, setAvailable] = useState<AvailableProvider[]>([]);
  const [availableQuery, setAvailableQuery] = useState('');
  const [availableLoading, setAvailableLoading] = useState(false);
  const [newProvider, setNewProvider] = useState(EMPTY_NEW_PROVIDER);
  const [detectingModels, setDetectingModels] = useState(false);
  /** Aviso de compatibilidad pendiente de confirmar antes de guardar. */
  const [addCheck, setAddCheck] = useState<AddCheck | null>(null);
  /** Sonda automática al pegar o escribir la URL del endpoint. */
  const [liveCheck, setLiveCheck] = useState<'checking' | 'compatible' | null>(null);
  /** Modelos que devolvió la última sonda compatible; sólo se muestran, no se aplican. */
  const [liveCheckModelCount, setLiveCheckModelCount] = useState<number | null>(null);
  const liveCheckSeq = React.useRef(0);
  /** Búsqueda dentro de los modelos de cada proveedor. */
  const [modelQuery, setModelQuery] = useState<Record<string, string>>({});

  const t = useCallback(
    (es: string, en: string, de: string) => (lang === 'es' ? es : lang === 'de' ? de : en),
    [lang]
  );

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/providers', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setProviders(Array.isArray(data.providers) ? data.providers : []);
        // Se muestra dónde se escribe: config global del usuario, fuera del
        // proyecto, para que las claves no acaben en un commit.
        setConfigPath(typeof data.writePath === 'string' ? data.writePath : typeof data.configPath === 'string' ? data.configPath : '');
      } else {
        setError(data.error || t('No se pudo cargar la lista de proveedores', 'Could not load providers', 'Anbieter konnten nicht geladen werden'));
      }
    } catch (e: any) {
      setError(e?.message || t('Error de red', 'Network error', 'Netzwerkfehler'));
    }
  }, [t]);

  const openAdd = useCallback(async () => {
    setShowAdd((value) => !value);
    setAddCheck(null);
    setError('');
    if (available.length > 0) return;
    setAvailableLoading(true);
    try {
      const res = await fetch('/api/providers/available', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (data.success && Array.isArray(data.providers)) setAvailable(data.providers);
    } catch {
      /* el formulario manual sigue disponible */
    } finally {
      setAvailableLoading(false);
    }
  }, [available.length]);

  const useAvailable = (provider: AvailableProvider) => {
    setAddCheck(null);
    setNewProvider({
      id: slugifyProviderId(provider.id),
      name: provider.name,
      baseUrl: provider.api || '',
      apiKey: '',
      models: '',
    });
  };

  const setCompatibilityCheck = useCallback((data: any) => {
    setLiveCheck(null);
    setLiveCheckModelCount(null);
    const status: AddCheckStatus =
      data?.status === 'auth' || data?.status === 'unreachable' ? data.status : 'incompatible';
    setAddCheck({
      status,
      detail: typeof data?.error === 'string' ? data.error : '',
      ...(typeof data?.httpStatus === 'number' ? { httpStatus: data.httpStatus } : {}),
    });
  }, []);

  const detectNewModels = async () => {
    if (!newProvider.baseUrl.trim()) {
      setError(t('Escribe primero la URL base', 'Enter the base URL first', 'Gib zuerst die Basis-URL ein'));
      return;
    }
    setDetectingModels(true);
    setError('');
    setAddCheck(null);
    // La comprobación manual manda sobre cualquier sonda automática pendiente.
    liveCheckSeq.current += 1;
    setLiveCheck(null);
    setLiveCheckModelCount(null);
    try {
      const res = await fetch('/api/providers/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ baseURL: newProvider.baseUrl, apiKey: newProvider.apiKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || t('No se pudieron detectar modelos', 'Could not detect models', 'Modelle konnten nicht erkannt werden'));
      if (data.compatible !== true) {
        setCompatibilityCheck(data);
        return;
      }
      const models: string[] = Array.isArray(data.models) ? data.models : [];
      setNewProvider((prev) => ({ ...prev, models: models.join(', ') }));
      setLiveCheck('compatible');
      setLiveCheckModelCount(models.length);
      if (models.length === 0) setError(t('El endpoint respondió pero no lista modelos', 'The endpoint answered but lists no models', 'Der Endpoint antwortet, listet aber keine Modelle'));
    } catch (e: any) {
      setLiveCheck(null);
      setLiveCheckModelCount(null);
      setError(e?.message || t('No se pudieron detectar modelos', 'Could not detect models', 'Modelle konnten nicht erkannt werden'));
    } finally {
      setDetectingModels(false);
    }
  };

  const saveNewProvider = async (force = false) => {
    const id = slugifyProviderId(newProvider.id || newProvider.name);
    if (!id || !newProvider.name.trim() || !newProvider.baseUrl.trim()) {
      setError(t('Nombre, id y URL base son obligatorios', 'Name, id and base URL are required', 'Name, ID und Basis-URL sind erforderlich'));
      return;
    }
    // Guardar vuelve a comprobar el endpoint en el servidor; cancelamos la sonda
    // automática para que una respuesta tardía no pise el resultado del guardado.
    liveCheckSeq.current += 1;
    setLiveCheck(null);
    setLiveCheckModelCount(null);
    setBusy('new');
    setError('');
    try {
      const res = await fetch('/api/providers/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...newProvider, id, force }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.incompatible) {
        setCompatibilityCheck(data);
        return;
      }
      if (!data.success) throw new Error(data.error || t('No se pudo añadir', 'Could not add', 'Konnte nicht hinzugefügt werden'));
      setNotice(t(`Proveedor ${newProvider.name} añadido`, `Provider ${newProvider.name} added`, `Anbieter ${newProvider.name} hinzugefügt`));
      setAddCheck(null);
      setShowAdd(false);
      setNewProvider(EMPTY_NEW_PROVIDER);
      setAvailable((prev) => prev.filter((provider) => provider.id !== id));
      await load();
    } catch (e: any) {
      setError(e?.message || t('No se pudo añadir', 'Could not add', 'Konnte nicht hinzugefügt werden'));
    } finally {
      setBusy(null);
    }
  };

  // Comprueba el endpoint en cuanto la URL es válida, sin esperar a Añadir.
  // El retardo evita lanzar una petición por cada tecla de una URL a medias.
  useEffect(() => {
    if (!showAdd) {
      setLiveCheck(null);
      setLiveCheckModelCount(null);
      return;
    }

    const baseURL = newProvider.baseUrl.trim();
    const apiKey = newProvider.apiKey.trim();
    setLiveCheck(null);
    setLiveCheckModelCount(null);
    setAddCheck(null);
    if (!isHttpUrl(baseURL)) return;

    const seq = ++liveCheckSeq.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (seq !== liveCheckSeq.current) return;
      setLiveCheck('checking');
      void (async () => {
        try {
          const res = await fetch('/api/providers/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ baseURL, apiKey }),
            signal: controller.signal,
          });
          const data = await res.json().catch(() => ({}));
          if (seq !== liveCheckSeq.current) return;
          if (!data.success) {
            setCompatibilityCheck({
              status: 'unreachable',
              error: data.error || t('No se pudo comprobar el endpoint', 'Could not check the endpoint', 'Endpoint konnte nicht geprüft werden'),
            });
            return;
          }
          if (data.compatible === true) {
            setAddCheck(null);
            setLiveCheck('compatible');
            setLiveCheckModelCount(Array.isArray(data.models) ? data.models.length : 0);
            return;
          }
          setCompatibilityCheck(data);
        } catch (e: any) {
          if (seq !== liveCheckSeq.current || controller.signal.aborted) return;
          setCompatibilityCheck({
            status: 'unreachable',
            error: e?.message || t('No se pudo comprobar el endpoint', 'Could not check the endpoint', 'Endpoint konnte nicht geprüft werden'),
          });
        }
      })();
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (liveCheckSeq.current === seq) liveCheckSeq.current += 1;
    };
  }, [newProvider.baseUrl, newProvider.apiKey, showAdd, setCompatibilityCheck, t]);

  useEffect(() => {
    if (isOpen || embedded) {
      void load();
      setNotice('');
      setOpenId(null);
      setDraft({});
    }
  }, [isOpen, embedded, load]);

  const toggle = (provider: ProviderEntry) => {
    if (openId === provider.id) {
      setOpenId(null);
      setDraft({});
      return;
    }
    setOpenId(provider.id);
    // Los secretos no vuelven del servidor: se dejan vacíos y el placeholder
    // indica que ya hay algo guardado.
    const next: Record<string, string> = {};
    for (const field of provider.fields) next[field.name] = '';
    if (provider.id === 'ollama') next.host = 'http://localhost:11434';
    setDraft(next);
    setFilterDraft((prev) => ({
      ...prev,
      [provider.id]: {
        whitelist: provider.whitelist.join(', '),
        blacklist: provider.blacklist.join(', '),
      },
    }));
  };

  const save = async (provider: ProviderEntry) => {
    setBusy(provider.id);
    setError('');
    setNotice('');
    try {
      const config: Record<string, string> = {};
      for (const [key, value] of Object.entries(draft)) {
        if (typeof value === 'string' && value.trim()) config[key] = value.trim();
      }
      if (Object.keys(config).length === 0) {
        setError(t('Escribe al menos un campo antes de guardar', 'Fill at least one field before saving', 'Fülle mindestens ein Feld aus'));
        return;
      }
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: provider.id, config, target: 'global' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || t('Error guardando', 'Error saving', 'Fehler beim Speichern'));
      setNotice(t(`${provider.name} guardado`, `${provider.name} saved`, `${provider.name} gespeichert`));
      await load();
    } catch (e: any) {
      setError(e?.message || t('Error guardando', 'Error saving', 'Fehler beim Speichern'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (provider: ProviderEntry) => {
    setBusy(provider.id);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(provider.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || t('Error eliminando', 'Error deleting', 'Fehler beim Löschen'));
      setNotice(
        data.stillFromEnv
          ? t('Quitado del fichero, pero sigue llegando por entorno', 'Removed from file, still provided by env', 'Aus Datei entfernt, weiterhin per Umgebung')
          : t(`${provider.name} eliminado`, `${provider.name} removed`, `${provider.name} entfernt`)
      );
      await load();
    } catch (e: any) {
      setError(e?.message || t('Error eliminando', 'Error deleting', 'Fehler beim Löschen'));
    } finally {
      setBusy(null);
    }
  };

  const test = async (provider: ProviderEntry) => {
    setTesting(provider.id);
    setTestResults((prev) => ({ ...prev, [provider.id]: { ok: false, message: t('Probando…', 'Testing…', 'Teste…') } }));
    try {
      let ok = false;
      let message = '';

      if (provider.id === 'ollama') {
        const host = draft.host || 'http://localhost:11434';
        const res = await fetch(`/api/ollama/health?host=${encodeURIComponent(host)}`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        ok = data.success === true || data.healthy === true;
        message = ok ? t('Servidor local responde', 'Local server responds', 'Lokaler Server antwortet') : data.error || t('Sin respuesta', 'No response', 'Keine Antwort');
      } else if (provider.id === 'lmstudio') {
        const res = await fetch('/api/lmstudio/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ host: draft.host }),
        });
        const data = await res.json().catch(() => ({}));
        ok = data.success === true;
        message = ok
          ? t(`${data.models?.length ?? 0} modelos`, `${data.models?.length ?? 0} models`, `${data.models?.length ?? 0} Modelle`)
          : data.error || t('Sin respuesta', 'No response', 'Keine Antwort');
      } else if (provider.id === 'custom') {
        const res = await fetch('/api/custom/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ baseURL: draft.baseUrl, apiKey: draft.apiKey }),
        });
        const data = await res.json().catch(() => ({}));
        ok = data.success === true;
        message = ok
          ? t(`${data.models?.length ?? 0} modelos`, `${data.models?.length ?? 0} models`, `${data.models?.length ?? 0} Modelle`)
          : data.error || t('Sin respuesta', 'No response', 'Keine Antwort');
      } else {
        const key = draft.apiKey || draft.apiToken || '';
        if (!key) {
          setTestResults((prev) => ({ ...prev, [provider.id]: { ok: false, message: t('Escribe la clave para probar', 'Enter the key to test', 'Schlüssel zum Testen eingeben') } }));
          return;
        }
        const res = await fetch('/api/test-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ provider: provider.id, key }),
        });
        const data = await res.json().catch(() => ({}));
        ok = data.success === true;
        const count = Array.isArray(data.models) ? data.models.length : 0;
        message = ok
          ? count > 0
            ? t(`Clave válida · ${count} modelos`, `Key valid · ${count} models`, `Schlüssel gültig · ${count} Modelle`)
            : t('Clave válida', 'Key valid', 'Schlüssel gültig')
          : data.error || t('Clave rechazada', 'Key rejected', 'Schlüssel abgelehnt');
      }

      setTestResults((prev) => ({ ...prev, [provider.id]: { ok, message } }));
    } catch (e: any) {
      setTestResults((prev) => ({ ...prev, [provider.id]: { ok: false, message: e?.message || 'Error' } }));
    } finally {
      setTesting(null);
    }
  };

  /** PATCH de filtros: no exige credenciales como el POST de configuración. */
  const patchProvider = async (provider: ProviderEntry, patch: Record<string, unknown>): Promise<boolean> => {
    setBusy(provider.id);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(provider.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || t('Error guardando', 'Error saving', 'Fehler beim Speichern'));
      await load();
      return true;
    } catch (e: any) {
      setError(e?.message || t('Error guardando', 'Error saving', 'Fehler beim Speichern'));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const toggleEnabled = async (provider: ProviderEntry) => {
    const turningOn = !provider.enabled;
    const ok = await patchProvider(provider, { enabled: turningOn });
    if (!ok) return;
    setNotice(
      turningOn
        ? t(`${provider.name} activado`, `${provider.name} enabled`, `${provider.name} aktiviert`)
        : t(`${provider.name} apagado: no se ofrecerá`, `${provider.name} disabled: hidden`, `${provider.name} deaktiviert`)
    );
  };

  const saveFilters = async (provider: ProviderEntry) => {
    const current = filterDraft[provider.id] ?? { whitelist: '', blacklist: '' };
    const ok = await patchProvider(provider, {
      whitelist: parseList(current.whitelist),
      blacklist: parseList(current.blacklist),
    });
    if (ok) {
      setNotice(t(`Filtros de ${provider.name} guardados`, `${provider.name} filters saved`, `Filter für ${provider.name} gespeichert`));
    }
  };

  /** Enciende o apaga un modelo y lo guarda en las listas del proveedor. */
  const toggleModelEnabled = async (provider: ProviderEntry, model: ProviderModel) => {
    const disabled = isModelDisabledByFilter(model.id, {
      whitelist: provider.whitelist,
      blacklist: provider.blacklist,
    });
    const next = toggleModelFilter(
      { whitelist: provider.whitelist, blacklist: provider.blacklist },
      model.id,
      disabled
    );
    // Los campos de texto de filtros quedan sincronizados con los switches:
    // guardar después no debe deshacer lo que acabas de activar.
    setFilterDraft((prev) => ({
      ...prev,
      [provider.id]: { whitelist: next.whitelist.join(', '), blacklist: next.blacklist.join(', ') },
    }));
    // Optimista para que el interruptor responda al clic; `patchProvider` recarga.
    setProviders((prev) =>
      prev.map((item) =>
        item.id === provider.id
          ? {
              ...item,
              whitelist: next.whitelist,
              blacklist: next.blacklist,
              modelCount: disabled ? item.modelCount + 1 : Math.max(0, item.modelCount - 1),
              models: disabled ? [...item.models, model] : item.models.filter((entry) => entry.id !== model.id),
            }
          : item
      )
    );
    const ok = await patchProvider(provider, { whitelist: next.whitelist, blacklist: next.blacklist });
    if (ok) window.dispatchEvent(new Event(PROVIDER_FILTERS_CHANGED));
  };

  /** Activa o apaga de golpe todo el catálogo, no solo lo visible por la búsqueda. */
  const setAllModelsEnabled = async (provider: ProviderEntry, enabled: boolean) => {
    if (provider.allModels.length === 0) return;
    const next = enabled
      ? { whitelist: [], blacklist: [] }
      : { whitelist: [], blacklist: provider.allModels.map((model) => model.id) };

    setFilterDraft((prev) => ({
      ...prev,
      [provider.id]: { whitelist: next.whitelist.join(', '), blacklist: next.blacklist.join(', ') },
    }));
    // Optimista: la lista responde al clic; `patchProvider` recarga al guardar.
    setProviders((prev) =>
      prev.map((item) =>
        item.id === provider.id
          ? {
              ...item,
              whitelist: next.whitelist,
              blacklist: next.blacklist,
              models: enabled ? [...item.allModels] : [],
              modelCount: enabled ? item.allModels.length : 0,
            }
          : item
      )
    );

    const ok = await patchProvider(provider, next);
    if (!ok) {
      // Si el PATCH falla, no dejamos la lista mostrando un estado que no se guardó.
      setProviders((prev) => prev.map((item) => (item.id === provider.id ? provider : item)));
      setFilterDraft((prev) => ({
        ...prev,
        [provider.id]: {
          whitelist: provider.whitelist.join(', '),
          blacklist: provider.blacklist.join(', '),
        },
      }));
      return;
    }

    window.dispatchEvent(new Event(PROVIDER_FILTERS_CHANGED));
    setNotice(
      enabled
        ? t(`${provider.name}: todos los modelos activados`, `${provider.name}: all models enabled`, `${provider.name}: alle Modelle aktiviert`)
        : t(`${provider.name}: todos los modelos desactivados`, `${provider.name}: all models disabled`, `${provider.name}: alle Modelle deaktiviert`)
    );
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.env.some((e) => e.toLowerCase().includes(q))
    );
  }, [providers, query]);

  const configuredCount = providers.filter((p) => p.configured).length;
  const availableOptions = useMemo(() => {
    const q = availableQuery.trim().toLowerCase();
    return available
      .filter((provider) => !provider.configured)
      .filter(
        (provider) =>
          !q ||
          provider.name.toLowerCase().includes(q) ||
          provider.id.includes(q) ||
          provider.env.some((env) => env.toLowerCase().includes(q))
      )
      .slice(0, 50);
  }, [available, availableQuery]);

  React.useEffect(() => {
    if (!isOpen || embedded || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, embedded, onClose]);

  if (!isOpen && !embedded) return null;

  const content = (
      <div
        className={
          embedded
            ? 'w-full flex flex-col'
            : 'w-[92vw] max-w-3xl max-h-[88vh] flex flex-col nc-panel border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-main)]'
        }
        onClick={(e) => e.stopPropagation()}
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-label={t('Gestor de proveedores', 'Provider manager', 'Anbieter verwalten')}
      >
        {/* Dentro de Configuración no hay cabecera propia: la sección ya se
            llama Proveedores. Solo el modal suelto conserva título y cierre. */}
        {!embedded && (
          <div className="flex items-center justify-between px-3 py-2 border-b-2 border-[var(--nc-border-light)] bg-[var(--nc-header-bg)]">
            <div className="flex items-center gap-2 min-w-0">
              <Server className="w-4 h-4 text-[var(--nc-header-text)]" />
              <span className="text-[var(--nc-header-text)] font-bold text-sm truncate">
                {t('Gestor de proveedores', 'Provider manager', 'Anbieter verwalten')}
              </span>
              <span className="text-[10px] text-[var(--nc-header-text)] font-bold">
                {configuredCount}/{providers.length}
              </span>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-[var(--nc-header-text)] font-bold p-1"
                title={t('Cerrar', 'Close', 'Schließen')}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        <div className={embedded ? 'pb-2' : 'px-3 pt-2'}>
          <div className="flex items-center gap-2 bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] px-2 py-1">
            <Search className="w-3.5 h-3.5 text-[var(--nc-text)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Buscar proveedor, id o variable…', 'Search provider, id or env var…', 'Anbieter, ID oder Variable suchen…')}
              className="flex-1 bg-transparent text-[var(--nc-text)] text-xs outline-none"
            />
            {embedded && (
              <span className="text-[9px] font-bold text-[var(--nc-text-accent)] tabular-nums shrink-0">
                {configuredCount}/{providers.length}
              </span>
            )}
          </div>
          {configPath && (
            <div className="mt-1 text-[9px] text-[var(--nc-text)] truncate" title={configPath}>
              {configPath}
            </div>
          )}
          <button
            type="button"
            onClick={() => void openAdd()}
            aria-expanded={showAdd}
            className="mt-1 flex items-center gap-1 border border-[var(--nc-text-accent)] px-2 py-1 text-[10px] font-bold text-[var(--nc-text-accent)] hover:bg-[var(--nc-bg-hover)]"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            {t('Añadir proveedor', 'Add provider', 'Anbieter hinzufügen')}
          </button>
        </div>

        <div className={embedded ? 'space-y-2' : 'flex-1 overflow-auto p-3 min-h-0 space-y-2'}>
          {error && <div className="p-2 text-red-300 text-[10px] border border-red-400/40 bg-red-400/10">{error}</div>}
          {notice && <div className="p-2 text-emerald-300 text-[10px] border border-emerald-400/40 bg-emerald-400/10">{notice}</div>}

          {showAdd && (
            <div className="space-y-2 border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-[var(--nc-text)]">
                  {t('Añadir proveedor OpenAI-compatible', 'Add OpenAI-compatible provider', 'OpenAI-kompatiblen Anbieter hinzufügen')}
                </span>
                <button type="button" onClick={() => { setShowAdd(false); setAddCheck(null); }} aria-label={t('Cerrar', 'Close', 'Schließen')}>
                  <X className="h-3.5 w-3.5 text-[var(--nc-text)]" />
                </button>
              </div>
              <p className="text-[9px] leading-snug text-[var(--nc-text)] opacity-80">
                {t(
                  'Elige uno del catálogo de models.dev o escribe la URL de cualquier endpoint compatible (Groq, DeepSeek, vLLM, llama.cpp…).',
                  'Pick one from the models.dev catalog or enter any compatible endpoint URL (Groq, DeepSeek, vLLM, llama.cpp…).',
                  'Wähle einen aus dem models.dev-Katalog oder gib die URL eines kompatiblen Endpoints ein (Groq, DeepSeek, vLLM, llama.cpp…).'
                )}
              </p>
              <input
                value={availableQuery}
                onChange={(event) => setAvailableQuery(event.target.value)}
                placeholder={t('Buscar proveedor (200+ en models.dev)…', 'Search provider (200+ on models.dev)…', 'Anbieter suchen (200+ auf models.dev)…')}
                className="w-full border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] px-2 py-1 text-[11px] text-[var(--nc-text)] outline-none"
              />
              <div className="max-h-28 overflow-auto border border-[var(--nc-border-dark)]">
                {availableLoading ? (
                  <div className="flex items-center gap-1 p-2 text-[10px] text-[var(--nc-text)]">
                    <Loader2 className="h-3 w-3 animate-spin" /> {t('Cargando catálogo…', 'Loading catalog…', 'Katalog wird geladen…')}
                  </div>
                ) : availableOptions.length === 0 ? (
                  <div className="p-2 text-[10px] text-[var(--nc-text)] opacity-70">
                    {t('Sin resultados: usa el formulario de abajo', 'No results: use the form below', 'Keine Treffer: nutze das Formular unten')}
                  </div>
                ) : (
                  availableOptions.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => useAvailable(provider)}
                      className="flex w-full items-center gap-2 px-2 py-1 text-left text-[10px] text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)]"
                    >
                      <span className="truncate font-bold">{provider.name}</span>
                      {provider.supported && (
                        <span className="shrink-0 border border-emerald-400/50 px-1 text-[8px] text-emerald-300">
                          {t('integrado', 'built-in', 'integriert')}
                        </span>
                      )}
                      {!provider.api && (
                        <span className="shrink-0 text-[8px] text-amber-300">{t('sin URL', 'no URL', 'keine URL')}</span>
                      )}
                      <span className="ml-auto shrink-0 text-[9px] opacity-70">{provider.modelCount} {t('modelos', 'models', 'Modelle')}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                <label className="flex items-center gap-1 text-[9px]">
                  <span className="w-16 shrink-0 font-bold text-[var(--nc-text)]">id</span>
                  <input
                    value={newProvider.id}
                    onChange={(event) => setNewProvider((prev) => ({ ...prev, id: event.target.value }))}
                    placeholder="groq"
                    className="w-full border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] px-1 py-0.5 font-mono text-[10px] text-[var(--nc-text)] outline-none"
                  />
                </label>
                <label className="flex items-center gap-1 text-[9px]">
                  <span className="w-16 shrink-0 font-bold text-[var(--nc-text)]">{t('nombre', 'name', 'Name')}</span>
                  <input
                    value={newProvider.name}
                    onChange={(event) => setNewProvider((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder={t('Groq', 'Groq', 'Groq')}
                    className="w-full border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] px-1 py-0.5 text-[10px] text-[var(--nc-text)] outline-none"
                  />
                </label>
                <label className="flex items-center gap-1 text-[9px] sm:col-span-2">
                  <span className="w-16 shrink-0 font-bold text-[var(--nc-text)]">URL</span>
                  <input
                    value={newProvider.baseUrl}
                    onChange={(event) => setNewProvider((prev) => ({ ...prev, baseUrl: event.target.value }))}
                    placeholder="https://api.groq.com/openai/v1"
                    className="w-full border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] px-1 py-0.5 font-mono text-[10px] text-[var(--nc-text)] outline-none"
                  />
                </label>
                <label className="flex items-center gap-1 text-[9px] sm:col-span-2">
                  <span className="w-16 shrink-0 font-bold text-[var(--nc-text)]">API key</span>
                  <input
                    type="password"
                    value={newProvider.apiKey}
                    onChange={(event) => setNewProvider((prev) => ({ ...prev, apiKey: event.target.value }))}
                    placeholder={t('(opcional en endpoints locales)', '(optional on local endpoints)', '(optional bei lokalen Endpoints)')}
                    className="w-full border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] px-1 py-0.5 font-mono text-[10px] text-[var(--nc-text)] outline-none"
                  />
                </label>
                <label className="flex items-start gap-1 text-[9px] sm:col-span-2">
                  <span className="w-16 shrink-0 pt-1 font-bold text-[var(--nc-text)]">{t('modelos', 'models', 'Modelle')}</span>
                  <textarea
                    value={newProvider.models}
                    onChange={(event) => setNewProvider((prev) => ({ ...prev, models: event.target.value }))}
                    rows={2}
                    placeholder={t('se detectan al pulsar el botón, o sepáralos por comas', 'detected with the button, or comma separated', 'werden per Button erkannt oder kommagetrennt')}
                    className="w-full resize-y border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] px-1 py-0.5 font-mono text-[10px] text-[var(--nc-text)] outline-none"
                  />
                </label>
              </div>
              {liveCheck && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`flex items-center gap-1 border px-2 py-1 text-[9px] font-bold ${
                    liveCheck === 'checking'
                      ? 'border-[var(--nc-border-light)] text-[var(--nc-text)]'
                      : 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300'
                  }`}
                >
                  {liveCheck === 'checking' ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      {t('Comprobando compatibilidad…', 'Checking compatibility…', 'Kompatibilität wird geprüft…')}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      <span>{t('Endpoint compatible', 'Compatible endpoint', 'Kompatibler Endpoint')}</span>
                      {liveCheckModelCount !== null && (
                        <span className="font-normal opacity-80">
                          · {liveCheckModelCount}{' '}
                          {liveCheckModelCount === 1
                            ? t('modelo', 'model', 'Modell')
                            : t('modelos', 'models', 'Modelle')}
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}
              {addCheck && (
                <div role="alert" className="border border-red-400/50 bg-red-400/10 p-2 text-[10px] leading-snug text-red-200">
                  <div className="flex items-start gap-1">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="font-bold">
                        {addCheck.status === 'incompatible'
                          ? t('Este endpoint no parece OpenAI-compatible', 'This endpoint does not look OpenAI-compatible', 'Dieser Endpoint scheint nicht OpenAI-kompatibel zu sein')
                          : addCheck.status === 'auth'
                            ? t('El endpoint rechaza la clave', 'The endpoint rejects the key', 'Der Endpoint lehnt den Schlüssel ab')
                            : t('No se pudo comprobar el endpoint', 'The endpoint could not be checked', 'Der Endpoint konnte nicht geprüft werden')}
                      </div>
                      <p className="mt-0.5 opacity-90">
                        {addCheck.status === 'incompatible'
                          ? t(
                              'No responde a /models con el formato de OpenAI. Solo funcionará si expone /models y /chat/completions como OpenAI.',
                              'It does not answer /models in the OpenAI format. It will only work if it exposes /models and /chat/completions like OpenAI.',
                              'Es antwortet nicht auf /models im OpenAI-Format. Es funktioniert nur, wenn es /models und /chat/completions wie OpenAI bereitstellt.'
                            )
                          : addCheck.status === 'auth'
                            ? t(
                                'El host responde, pero rechaza la clave. Revísala antes de añadirlo.',
                                'The host answers, but rejects the key. Check it before adding.',
                                'Der Host antwortet, lehnt den Schlüssel aber ab. Prüfe ihn vor dem Hinzufügen.'
                              )
                            : t(
                                'No hubo respuesta a tiempo. Comprueba la URL y que el servidor esté encendido.',
                                'No timely response. Check the URL and that the server is running.',
                                'Keine rechtzeitige Antwort. Prüfe die URL und ob der Server läuft.'
                              )}
                        {addCheck.detail ? ` (${addCheck.detail})` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveNewProvider(true)}
                    disabled={busy === 'new'}
                    className="mt-1 border border-red-400/60 px-2 py-0.5 font-bold text-red-200 hover:bg-red-400/20 disabled:opacity-50"
                  >
                    {t('Añadir de todos modos', 'Add anyway', 'Trotzdem hinzufügen')}
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void detectNewModels()}
                  disabled={detectingModels}
                  className="flex items-center gap-1 border border-[var(--nc-text-accent)] px-2 py-1 text-[10px] font-bold text-[var(--nc-text-accent)]"
                >
                  {detectingModels ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  {t('Detectar modelos', 'Detect models', 'Modelle erkennen')}
                </button>
                <button
                  type="button"
                  onClick={() => void saveNewProvider()}
                  disabled={busy === 'new'}
                  className="flex items-center gap-1 bg-[var(--nc-active-bg)] px-2 py-1 text-[10px] font-bold text-[var(--nc-active-text)]"
                >
                  {busy === 'new' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  {t('Añadir', 'Add', 'Hinzufügen')}
                </button>
              </div>
            </div>
          )}

          {filtered.map((provider) => {
            const open = openId === provider.id;
            const result = testResults[provider.id];
            const isBusy = busy === provider.id;
            const modelSearch = (modelQuery[provider.id] ?? '').trim().toLowerCase();
            const visibleModels = modelSearch
              ? provider.allModels.filter(
                  (model) =>
                    model.name.toLowerCase().includes(modelSearch) ||
                    model.id.toLowerCase().includes(modelSearch)
                )
              : provider.allModels;
            return (
              <div key={provider.id} className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)]">
                <button
                  type="button"
                  onClick={() => toggle(provider)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
                >
                  {provider.configured ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-[var(--nc-text-accent)] shrink-0" />
                  )}
                  <span className="text-[var(--nc-text)] font-bold text-xs truncate">{provider.name}</span>
                  {provider.reachable === false && (
                    <AlertTriangle
                      className="w-3.5 h-3.5 text-amber-300 shrink-0"
                      aria-label={t('sin respuesta', 'not responding', 'keine Antwort')}
                    />
                  )}
                  {provider.source !== 'none' && (
                    <span className="text-[9px] px-1 border border-[var(--nc-border-light)] text-[var(--nc-text)] shrink-0">
                      {lang === 'es'
                        ? SOURCE_LABEL[provider.source].es
                        : lang === 'de'
                          ? SOURCE_LABEL[provider.source].de
                          : SOURCE_LABEL[provider.source].en}
                    </span>
                  )}
                  {!provider.enabled && (
                    <span className="text-[9px] px-1 border border-red-400/60 text-red-300 shrink-0">
                      {t('apagado', 'off', 'aus')}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-[var(--nc-text-accent)] tabular-nums shrink-0">
                    {provider.modelCount}/{provider.totalModels} {t('modelos', 'models', 'Modelle')}
                  </span>
                  <ChevronRight className={`w-3.5 h-3.5 text-[var(--nc-text)] shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>

                {open && (
                  <div className="px-2 pb-2 space-y-2 border-t border-[var(--nc-border-dark)]">
                    {provider.host && provider.reachable === false && (
                      <div
                        role="status"
                        className="mt-2 flex items-start gap-1 border border-amber-400/40 bg-amber-400/10 px-1.5 py-1 text-[9px] leading-snug text-amber-200"
                      >
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>
                          {t(
                            `Sin respuesta en ${provider.host}.`,
                            `No response at ${provider.host}.`,
                            `Keine Antwort unter ${provider.host}.`
                          )}{' '}
                          {provider.id === 'lmstudio'
                            ? t(
                                'Comprueba que LM Studio esté abierto y sirviendo en esa IP y puerto.',
                                'Check that LM Studio is open and serving on that IP and port.',
                                'Prüfe, ob LM Studio geöffnet ist und unter dieser IP und diesem Port dient.'
                              )
                            : t(
                                'Comprueba que el servidor local esté levantado y sea accesible desde aquí.',
                                'Check that the local server is running and reachable from here.',
                                'Prüfe, ob der lokale Server läuft und von hier erreichbar ist.'
                              )}
                          {provider.probeError ? ` (${provider.probeError})` : ''}
                        </span>
                      </div>
                    )}
                    {provider.env.length > 0 && (
                      <div className="pt-2 text-[9px] text-[var(--nc-text)] break-all">
                        {t('También por entorno:', 'Also via env:', 'Auch per Umgebung:')} {provider.env.join(' / ')}
                      </div>
                    )}

                    <div className="pt-2 flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => void toggleEnabled(provider)}
                        disabled={isBusy}
                        className={`nc-button !px-2 !py-1 text-xs font-bold flex items-center gap-1 ${
                          provider.enabled
                            ? 'bg-[var(--nc-bg-panel)] text-emerald-300 border-emerald-400'
                            : 'bg-[var(--nc-bg-panel)] text-red-300 border-red-400'
                        }`}
                      >
                        {provider.enabled ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                        {provider.enabled ? t('Activo', 'Enabled', 'Aktiv') : t('Apagado', 'Disabled', 'Inaktiv')}
                      </button>
                      <span className="text-[9px] text-[var(--nc-text)]">
                        {t('Apagado no aparece en los selectores', 'Disabled providers are hidden', 'Deaktivierte Anbieter werden ausgeblendet')}
                      </span>
                    </div>

                    {provider.id === 'lmstudio' && (
                      <p className="pt-1 text-[9px] leading-snug text-[var(--nc-text)] opacity-70">
                        {t(
                          'Remoto: la IP del equipo de casa, con «Serve on Local Network» activo en su LM Studio. Local: http://localhost:1234/v1. Se usa el que responda.',
                          'Remote: the home machine IP, with “Serve on Local Network” enabled in its LM Studio. Local: http://localhost:1234/v1. Whichever answers is used.',
                          'Remote: die IP des Heimrechners, mit aktivem „Serve on Local Network“ in seinem LM Studio. Lokal: http://localhost:1234/v1. Genutzt wird, wer antwortet.'
                        )}
                      </p>
                    )}

                    {provider.id === 'custom' && (
                      <p className="pt-1 text-[9px] leading-snug text-[var(--nc-text)] opacity-70">
                        {t(
                          'Endpoint OpenAI-compatible independiente (vLLM, llama.cpp, oMLX…). LM Studio se configura aparte, con su propio host.',
                          'Standalone OpenAI-compatible endpoint (vLLM, llama.cpp, oMLX…). LM Studio is configured separately with its own host.',
                          'Eigenständiger OpenAI-kompatibler Endpoint (vLLM, llama.cpp, oMLX…). LM Studio wird getrennt mit eigenem Host konfiguriert.'
                        )}
                      </p>
                    )}

                    {provider.fields.map((field) => (
                      <label key={field.name} className="flex items-center gap-2">
                        <span className="text-[10px] text-[var(--nc-text)] w-24 shrink-0 font-bold">
                          {provider.id === 'lmstudio'
                            ? field.name === 'localHost'
                              ? t('local', 'local', 'lokal')
                              : t('remoto', 'remote', 'remote')
                            : field.name}
                        </span>
                        <input
                          type={field.kind === 'secret' ? 'password' : 'text'}
                          value={draft[field.name] ?? ''}
                          onChange={(e) => setDraft((prev) => ({ ...prev, [field.name]: e.target.value }))}
                          placeholder={
                            provider.configured && provider.source !== 'none'
                              ? t('(ya configurado)', '(already set)', '(bereits gesetzt)')
                              : field.required
                                ? t('Requerido', 'Required', 'Erforderlich')
                                : t('Opcional', 'Optional', 'Optional')
                          }
                          className="flex-1 bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-[var(--nc-text)] text-xs px-2 py-1 font-mono outline-none"
                        />
                      </label>
                    ))}

                    <div className="pt-1 space-y-1">
                      <div className="text-[9px] text-[var(--nc-text)]">
                        {t(
                          'Filtros de modelos (separados por comas; * al final casa por prefijo)',
                          'Model filters (comma separated; trailing * matches a prefix)',
                          'Modellfilter (durch Kommas getrennt; * am Ende trifft ein Präfix)'
                        )}
                      </div>
                      <label className="flex items-center gap-2">
                        <span className="text-[10px] text-[var(--nc-text)] w-24 shrink-0 font-bold">
                          {t('Solo estos', 'Only these', 'Nur diese')}
                        </span>
                        <input
                          type="text"
                          value={filterDraft[provider.id]?.whitelist ?? ''}
                          onChange={(e) =>
                            setFilterDraft((prev) => ({
                              ...prev,
                              [provider.id]: { ...(prev[provider.id] ?? { whitelist: '', blacklist: '' }), whitelist: e.target.value },
                            }))
                          }
                          placeholder={t('vacío = todos', 'empty = all', 'leer = alle')}
                          className="flex-1 bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-[var(--nc-text)] text-xs px-2 py-1 font-mono outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        <span className="text-[10px] text-[var(--nc-text)] w-24 shrink-0 font-bold">
                          {t('Ocultar', 'Hide', 'Ausblenden')}
                        </span>
                        <input
                          type="text"
                          value={filterDraft[provider.id]?.blacklist ?? ''}
                          onChange={(e) =>
                            setFilterDraft((prev) => ({
                              ...prev,
                              [provider.id]: { ...(prev[provider.id] ?? { whitelist: '', blacklist: '' }), blacklist: e.target.value },
                            }))
                          }
                          placeholder={t('p. ej. modelo-viejo*', 'e.g. old-model*', 'z. B. altes-modell*')}
                          className="flex-1 bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] text-[var(--nc-text)] text-xs px-2 py-1 font-mono outline-none"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void saveFilters(provider)}
                        disabled={isBusy}
                        className="nc-button !px-2 !py-1 text-xs font-bold bg-[var(--nc-bg-panel)] text-[var(--nc-text-accent)] border-[var(--nc-text-accent)] flex items-center gap-1"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {t('Guardar filtros', 'Save filters', 'Filter speichern')}
                      </button>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => void save(provider)}
                        disabled={isBusy}
                        className="nc-button !px-2 !py-1 text-xs font-bold bg-[var(--nc-active-bg)] text-[var(--nc-active-text)] flex items-center gap-1"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        {t('Guardar', 'Save', 'Speichern')}
                      </button>

                      <button
                        type="button"
                        onClick={() => void test(provider)}
                        disabled={testing === provider.id}
                        className="nc-button !px-2 !py-1 text-xs font-bold bg-[var(--nc-bg-panel)] text-[var(--nc-text-accent)] border-[var(--nc-text-accent)] flex items-center gap-1"
                      >
                        {testing === provider.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                        {t('Probar', 'Test', 'Testen')}
                      </button>

                      {provider.configured && provider.source !== 'env' && (
                        <button
                          type="button"
                          onClick={() => void remove(provider)}
                          disabled={isBusy}
                          className="nc-button !px-2 !py-1 text-xs font-bold bg-[var(--nc-bg-panel)] text-red-300 border-red-400 flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {t('Eliminar', 'Remove', 'Entfernen')}
                        </button>
                      )}

                      {result && (
                        <span className={`text-[10px] ${result.ok ? 'text-emerald-300' : 'text-red-300'}`}>{result.message}</span>
                      )}
                    </div>

                    {provider.allModels.length > 0 && (
                      <div className="pt-1">
                        <div className="flex items-center justify-between gap-2 text-[9px] text-[var(--nc-text)]">
                          <span>{t('Modelos en el chat: actívalos o apágalos', 'Models in chat: enable or disable them', 'Modelle im Chat: aktivieren oder deaktivieren')}</span>
                          <span className="shrink-0 tabular-nums text-[var(--nc-text-accent)]">{provider.modelCount}/{provider.allModels.length}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void setAllModelsEnabled(provider, true)}
                            disabled={isBusy || provider.modelCount >= provider.allModels.length}
                            aria-label={`${t('Activar todos los modelos de', 'Enable all models in', 'Alle Modelle aktivieren in')} ${provider.name}`}
                            title={t(
                              'Incluye los modelos ocultos por la búsqueda',
                              'Includes models hidden by the search',
                              'Schließt durch die Suche ausgeblendete Modelle ein'
                            )}
                            className="nc-button !px-1.5 !py-0.5 text-[9px] font-bold bg-[var(--nc-bg-panel)] text-emerald-300 border-emerald-400 flex items-center gap-1 disabled:opacity-40"
                          >
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            {t('Activar todos', 'Enable all', 'Alle aktivieren')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void setAllModelsEnabled(provider, false)}
                            disabled={isBusy || provider.modelCount === 0}
                            aria-label={`${t('Desactivar todos los modelos de', 'Disable all models in', 'Alle Modelle deaktivieren in')} ${provider.name}`}
                            title={t(
                              'Incluye los modelos ocultos por la búsqueda',
                              'Includes models hidden by the search',
                              'Schließt durch die Suche ausgeblendete Modelle ein'
                            )}
                            className="nc-button !px-1.5 !py-0.5 text-[9px] font-bold bg-[var(--nc-bg-panel)] text-red-300 border-red-400 flex items-center gap-1 disabled:opacity-40"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                            {t('Desactivar todos', 'Disable all', 'Alle deaktivieren')}
                          </button>
                        </div>
                        <div className="mt-1 flex items-center gap-1 border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] px-1">
                          <Search className="h-3 w-3 shrink-0 text-[var(--nc-text)]" aria-hidden="true" />
                          <input
                            value={modelQuery[provider.id] ?? ''}
                            onChange={(event) =>
                              setModelQuery((prev) => ({ ...prev, [provider.id]: event.target.value }))
                            }
                            placeholder={t('Buscar modelo…', 'Search model…', 'Modell suchen…')}
                            aria-label={`${t('Buscar modelos de', 'Search models in', 'Modelle suchen in')} ${provider.name}`}
                            className="w-full bg-transparent py-0.5 text-[10px] text-[var(--nc-text)] outline-none"
                          />
                          {(modelQuery[provider.id] ?? '') && (
                            <button
                              type="button"
                              onClick={() => setModelQuery((prev) => ({ ...prev, [provider.id]: '' }))}
                              aria-label={t('Limpiar búsqueda', 'Clear search', 'Suche löschen')}
                              className="shrink-0 p-0.5 text-[var(--nc-text)] hover:text-[var(--nc-text-accent)]"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <div className="mt-1 max-h-48 divide-y divide-[var(--nc-border-dark)] overflow-auto border border-[var(--nc-border-dark)]">
                          {visibleModels.map((model) => {
                            const enabled = !isModelDisabledByFilter(model.id, {
                              whitelist: provider.whitelist,
                              blacklist: provider.blacklist,
                            });
                            return (
                              <div key={model.id} className="flex items-center gap-2 px-1.5 py-0.5">
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={enabled}
                                  aria-label={`${enabled ? t('Desactivar', 'Disable', 'Deaktivieren') : t('Activar', 'Enable', 'Aktivieren')}: ${model.name}`}
                                  title={
                                    enabled
                                      ? t('Ocultar del selector de modelos', 'Hide from the model picker', 'Aus dem Modell-Selector ausblenden')
                                      : t('Mostrar en el selector de modelos', 'Show in the model picker', 'Im Modell-Selector anzeigen')
                                  }
                                  onClick={() => void toggleModelEnabled(provider, model)}
                                  disabled={isBusy}
                                  style={{ minHeight: 0, minWidth: 0 }}
                                  className={`shrink-0 rounded border p-0.5 transition-colors ${
                                    enabled
                                      ? 'border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/10'
                                      : 'border-red-500/60 text-red-400 hover:bg-red-500/10'
                                  }`}
                                >
                                  <Power className="h-3 w-3" aria-hidden="true" />
                                </button>
                                <span
                                  className={`min-w-0 flex-1 truncate text-[10px] ${
                                    enabled ? 'text-[var(--nc-text)]' : 'text-[var(--nc-text-dim)]'
                                  }`}
                                  title={model.id}
                                >
                                  {model.name}
                                </span>
                                {!enabled && (
                                  <span className="shrink-0 text-[8px] text-amber-300">
                                    {t('desactivado', 'disabled', 'deaktiviert')}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                          {visibleModels.length === 0 && (
                            <div className="px-1.5 py-1 text-[10px] text-[var(--nc-text-dim)]">
                              {t('Ningún modelo coincide', 'No model matches', 'Kein Modell passt')}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && !error && (
            <div className="text-[11px] text-[var(--nc-text)] p-2">
              {t('Ningún proveedor coincide con la búsqueda', 'No provider matches the search', 'Kein Anbieter passt zur Suche')}
            </div>
          )}
        </div>
      </div>
  );

  if (embedded) return content;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      {content}
    </div>
  );
};

export default ProviderManager;
