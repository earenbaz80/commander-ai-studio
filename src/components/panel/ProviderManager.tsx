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
  RefreshCw,
  Search,
  Trash2,
  Save,
  X,
  ChevronRight,
  KeyRound,
  Server,
} from 'lucide-react';
import { Language } from '../../i18n/translations';

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
  modelCount: number;
  defaultModel?: string;
}

interface ProviderManagerProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: Language;
}

const SOURCE_LABEL: Record<ProviderEntry['source'], { es: string; en: string; de: string }> = {
  env: { es: 'entorno', en: 'env', de: 'Umgebung' },
  file: { es: 'guardado', en: 'saved', de: 'gespeichert' },
  local: { es: 'local', en: 'local', de: 'lokal' },
  none: { es: 'sin configurar', en: 'not configured', de: 'nicht konfiguriert' },
};

export const ProviderManager: React.FC<ProviderManagerProps> = ({ isOpen, onClose, lang = 'es' }) => {
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
        setConfigPath(typeof data.configPath === 'string' ? data.configPath : '');
      } else {
        setError(data.error || t('No se pudo cargar la lista de proveedores', 'Could not load providers', 'Anbieter konnten nicht geladen werden'));
      }
    } catch (e: any) {
      setError(e?.message || t('Error de red', 'Network error', 'Netzwerkfehler'));
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      void load();
      setNotice('');
      setOpenId(null);
      setDraft({});
    }
  }, [isOpen, load]);

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
        body: JSON.stringify({ id: provider.id, config, target: 'project' }),
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
        message = ok ? t('Clave válida', 'Key valid', 'Schlüssel gültig') : data.error || t('Clave rechazada', 'Key rejected', 'Schlüssel abgelehnt');
      }

      setTestResults((prev) => ({ ...prev, [provider.id]: { ok, message } }));
    } catch (e: any) {
      setTestResults((prev) => ({ ...prev, [provider.id]: { ok: false, message: e?.message || 'Error' } }));
    } finally {
      setTesting(null);
    }
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[92vw] max-w-3xl max-h-[88vh] flex flex-col nc-panel border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-main)]">
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
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              className="text-[var(--nc-header-text)] p-1"
              title={t('Recargar', 'Reload', 'Neu laden')}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--nc-header-text)] font-bold p-1"
              title={t('Cerrar', 'Close', 'Schließen')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-3 pt-2">
          <div className="flex items-center gap-2 bg-[var(--nc-bg-panel)] border border-[var(--nc-border-light)] px-2 py-1">
            <Search className="w-3.5 h-3.5 text-[var(--nc-text)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Buscar proveedor, id o variable…', 'Search provider, id or env var…', 'Anbieter, ID oder Variable suchen…')}
              className="flex-1 bg-transparent text-[var(--nc-text)] text-xs outline-none"
            />
          </div>
          {configPath && (
            <div className="mt-1 text-[9px] text-[var(--nc-text)] truncate" title={configPath}>
              {configPath}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-3 min-h-0 space-y-2">
          {error && <div className="p-2 text-red-300 text-[10px] border border-red-400/40 bg-red-400/10">{error}</div>}
          {notice && <div className="p-2 text-emerald-300 text-[10px] border border-emerald-400/40 bg-emerald-400/10">{notice}</div>}

          {filtered.map((provider) => {
            const open = openId === provider.id;
            const result = testResults[provider.id];
            const isBusy = busy === provider.id;
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
                  {provider.source !== 'none' && (
                    <span className="text-[9px] px-1 border border-[var(--nc-border-light)] text-[var(--nc-text)] shrink-0">
                      {lang === 'es'
                        ? SOURCE_LABEL[provider.source].es
                        : lang === 'de'
                          ? SOURCE_LABEL[provider.source].de
                          : SOURCE_LABEL[provider.source].en}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-[var(--nc-text-accent)] tabular-nums shrink-0">
                    {provider.modelCount} {t('modelos', 'models', 'Modelle')}
                  </span>
                  <ChevronRight className={`w-3.5 h-3.5 text-[var(--nc-text)] shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>

                {open && (
                  <div className="px-2 pb-2 space-y-2 border-t border-[var(--nc-border-dark)]">
                    {provider.env.length > 0 && (
                      <div className="pt-2 text-[9px] text-[var(--nc-text)] break-all">
                        {t('También por entorno:', 'Also via env:', 'Auch per Umgebung:')} {provider.env.join(' / ')}
                      </div>
                    )}

                    {provider.fields.map((field) => (
                      <label key={field.name} className="flex items-center gap-2">
                        <span className="text-[10px] text-[var(--nc-text)] w-24 shrink-0 font-bold">{field.name}</span>
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

                    {provider.models.length > 0 && (
                      <div className="pt-1">
                        <div className="text-[9px] text-[var(--nc-text)] mb-1">
                          {t('Modelos disponibles', 'Available models', 'Verfügbare Modelle')}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {provider.models.slice(0, 12).map((m) => (
                            <span key={m.id} className="text-[9px] px-1 border border-[var(--nc-border-dark)] text-[var(--nc-text)]" title={m.contextWindow || m.id}>
                              {m.name}
                            </span>
                          ))}
                          {provider.modelCount > 12 && (
                            <span className="text-[9px] px-1 text-[var(--nc-text-accent)]">+{provider.modelCount - 12}</span>
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
    </div>
  );
};

export default ProviderManager;
