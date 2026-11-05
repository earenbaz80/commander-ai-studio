import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Server,
  BookOpen,
  Puzzle,
  Search,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  FolderInput,
  Globe,
} from 'lucide-react';
import type { Language } from '../../i18n/translations';

/**
 * Sección «Extensiones» de Configuración: MCP, skills y plugins en un solo
 * sitio, con búsqueda y alta. Reutiliza los endpoints que ya existen
 * (`/api/mcp/*`, `/api/skills*`, `/api/plugins`) en vez de mantener listas
 * paralelas en localStorage, que era lo que hacía el gestor antiguo.
 */

type Tab = 'mcp' | 'skills' | 'plugins';

interface ExtensionsSettingsProps {
  lang?: Language;
  /** Abre el gestor completo (pestaña MCP con OAuth, tools y health). */
  onOpenManager?: () => void;
}

const inputClass =
  'min-w-0 flex-1 bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] px-1.5 py-0.5 text-[10px] text-[var(--nc-text)] outline-none focus:border-[var(--nc-text-accent)]';

const rowClass =
  'flex items-center gap-2 border border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] px-1.5 py-1';

/**
 * Sugerencias de servidores MCP conocidos. No hay catálogo remoto en la app:
 * esto evita que «añadir» empiece en blanco y que el usuario tenga que
 * recordar el paquete exacto de cada servidor.
 */
const MCP_SUGGESTIONS: { name: string; command: string; args: string }[] = [
  { name: 'context7', command: 'npx', args: '-y @upstash/context7-mcp' },
  { name: 'filesystem', command: 'npx', args: '-y @modelcontextprotocol/server-filesystem .' },
  { name: 'memory', command: 'npx', args: '-y @modelcontextprotocol/server-memory' },
  { name: 'sequential-thinking', command: 'npx', args: '-y @modelcontextprotocol/server-sequential-thinking' },
  { name: 'github', command: 'npx', args: '-y @modelcontextprotocol/server-github' },
  { name: 'brave-search', command: 'npx', args: '-y @modelcontextprotocol/server-brave-search' },
];

const btnClass =
  'nc-button !px-2 !py-0.5 !mx-0 text-[10px] font-bold flex items-center gap-1 shrink-0 disabled:opacity-40';

export const ExtensionsSettings: React.FC<ExtensionsSettingsProps> = ({ lang = 'es', onOpenManager }) => {
  const t = (es: string, en: string, de: string) => (lang === 'es' ? es : lang === 'de' ? de : en);

  const [tab, setTab] = useState<Tab>('mcp');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [servers, setServers] = useState<any[]>([]);
  const [mcpName, setMcpName] = useState('');
  const [mcpCommand, setMcpCommand] = useState('');
  const [mcpArgs, setMcpArgs] = useState('');

  const [skills, setSkills] = useState<any[]>([]);
  const [skillDir, setSkillDir] = useState('');

  // Catálogo público de skills (claudemarketplace.net).
  const [skillCatalog, setSkillCatalog] = useState<any[]>([]);
  const [catalogState, setCatalogState] = useState<'idle' | 'loading' | 'offline'>('idle');
  const [catalogError, setCatalogError] = useState('');
  const [installing, setInstalling] = useState<string>('');

  const [plugins, setPlugins] = useState<any[]>([]);
  const [pluginId, setPluginId] = useState('');

  // Catálogo de plugins: los marketplace de Claude (`.claude-plugin/marketplace.json`).
  const [pluginCatalog, setPluginCatalog] = useState<any[]>([]);
  const [pluginCatalogState, setPluginCatalogState] = useState<'idle' | 'loading' | 'offline'>('idle');
  const [pluginCatalogError, setPluginCatalogError] = useState('');
  const [installingPlugin, setInstallingPlugin] = useState('');

  // Registro público de MCP: sólo se consulta con 2+ caracteres.
  const [registry, setRegistry] = useState<any[]>([]);
  const [registryState, setRegistryState] = useState<'idle' | 'loading' | 'offline'>('idle');
  const [registryError, setRegistryError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'mcp') {
        const res = await fetch('/api/mcp/list', { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        setServers(Array.isArray(data.servers) ? data.servers : []);
      } else if (tab === 'skills') {
        const res = await fetch('/api/skills', { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        setSkills(Array.isArray(data.skills) ? data.skills : []);
        if (data.success === false) setError(data.error || 'Error');
      } else {
        const res = await fetch('/api/plugins', { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        setPlugins(Array.isArray(data.plugins) ? data.plugins : []);
        if (data.success === false) setError(data.error || 'Error');
      }
    } catch (e: any) {
      setError(e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const searchRegistry = useCallback(async (term: string): Promise<any[]> => {
    setRegistryState('loading');
    setRegistryError('');
    try {
      const res = await fetch(`/api/mcp/discover?q=${encodeURIComponent(term)}&limit=12`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return Array.isArray(data.results) ? data.results : [];
    } finally {
      setRegistryState('idle');
    }
  }, []);

  const searchCatalog = useCallback(async (term: string): Promise<any[]> => {
    setCatalogState('loading');
    setCatalogError('');
    try {
      const res = await fetch(`/api/skills/discover?q=${encodeURIComponent(term)}&limit=10`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return Array.isArray(data.results) ? data.results : [];
    } finally {
      setCatalogState('idle');
    }
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (tab !== 'skills') {
      setSkillCatalog([]);
      setCatalogState('idle');
      setCatalogError('');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCatalog(term)
        .then((results) => {
          if (!cancelled) setSkillCatalog(results);
        })
        .catch((e: any) => {
          if (cancelled) return;
          setCatalogError(e?.message || 'Sin conexión con el catálogo');
          setCatalogState('offline');
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, tab, searchCatalog]);

  const searchPluginCatalog = useCallback(async (term: string): Promise<any[]> => {
    setPluginCatalogState('loading');
    setPluginCatalogError('');
    try {
      const res = await fetch(`/api/plugins/discover?q=${encodeURIComponent(term)}&limit=20`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return Array.isArray(data.results) ? data.results : [];
    } finally {
      setPluginCatalogState('idle');
    }
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (tab !== 'plugins') {
      setPluginCatalog([]);
      setPluginCatalogState('idle');
      setPluginCatalogError('');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchPluginCatalog(term)
        .then((results) => {
          if (!cancelled) setPluginCatalog(results);
        })
        .catch((e: any) => {
          if (cancelled) return;
          setPluginCatalogError(e?.message || 'Sin conexión con el catálogo');
          setPluginCatalogState('offline');
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, tab, searchPluginCatalog]);

  useEffect(() => {
    const term = query.trim();
    if (tab !== 'mcp') {
      setRegistry([]);
      setRegistryState('idle');
      setRegistryError('');
      return;
    }
    let cancelled = false;
    // Sin esto cada tecla lanzaría una consulta y el registro limita el ritmo.
    const timer = setTimeout(() => {
      searchRegistry(term)
        .then((results) => {
          if (!cancelled) setRegistry(results);
        })
        .catch((e: any) => {
          if (cancelled) return;
          // Sin conexión se conserva lo último descargado; lo local sigue intacto.
          setRegistryError(e?.message || 'Sin conexión con el registro');
          setRegistryState('offline');
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, tab, searchRegistry]);

  const installFromRegistry = async (entry: any) => {
    if (!entry?.installable || !entry.command) return;
    const base = String(entry.name)
      .split('/')
      .pop()!
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const taken = new Set(servers.map((s) => s.name || s.id));
    let name = base || 'mcp-server';
    for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
    await postJson('/api/mcp/install', {
      name,
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args : [],
    });
  };

  const postJson = async (url: string, body: unknown, method = 'POST') => {
    setError('');
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false || data.error) {
        setError(data.error || `HTTP ${res.status}`);
        return false;
      }
      await load();
      return true;
    } catch (e: any) {
      setError(e?.message || 'Error');
      return false;
    }
  };

  const q = query.trim().toLowerCase();
  const match = (item: any) =>
    !q ||
    [item.name, item.id, item.command, item.description, item.title]
      .filter(Boolean)
      .some((value: string) => String(value).toLowerCase().includes(q));

  const filteredServers = useMemo(() => servers.filter(match), [servers, q]);
  const filteredSkills = useMemo(() => skills.filter(match), [skills, q]);
  const filteredPlugins = useMemo(() => plugins.filter(match), [plugins, q]);

  const addMcp = async () => {
    const name = mcpName.trim();
    const command = mcpCommand.trim();
    if (!name || !command) return;
    const ok = await postJson('/api/mcp/install', {
      name,
      command,
      args: mcpArgs.trim() ? mcpArgs.trim().split(/\s+/) : [],
    });
    if (ok) {
      setMcpName('');
      setMcpCommand('');
      setMcpArgs('');
    }
  };

  const removeMcp = async (name: string) => {
    await postJson('/api/mcp/uninstall', { name });
  };

  const installFromCatalog = async (entry: any) => {
    if (!entry?.id) return;
    setInstalling(entry.id);
    try {
      await postJson('/api/skills/install', { id: entry.id });
      await searchCatalog(query.trim())
        .then((results) => setSkillCatalog(results))
        .catch(() => undefined);
    } finally {
      setInstalling('');
    }
  };

  const importSkills = async () => {
    const sourceDir = skillDir.trim();
    if (!sourceDir) return;
    const ok = await postJson('/api/skills/import', { sourceDir, overwrite: false });
    if (ok) setSkillDir('');
  };

  const installPlugin = async () => {
    const id = pluginId.trim();
    if (!id) return;
    const ok = await postJson('/api/plugins', { id });
    if (ok) setPluginId('');
  };

  const removePlugin = async (id: string) => {
    const ok = await postJson(`/api/plugins/${encodeURIComponent(id)}`, {}, 'DELETE');
    if (!ok) return;
    // Desinstalar borra también lo copiado al proyecto: hay que releer la lista
    // y el catálogo, donde el plugin figuraba como «Instalado».
    await load();
    await searchPluginCatalog(query.trim())
      .then((results) => setPluginCatalog(results))
      .catch(() => undefined);
  };

  /** Instala desde el marketplace: el servidor lo convierte en skills/agentes/MCP. */
  const installMarketplacePlugin = async (entry: any) => {
    if (!entry?.marketplace || !entry?.name) return;
    setInstallingPlugin(entry.id || entry.name);
    try {
      const ok = await postJson('/api/plugins/install-from-marketplace', {
        marketplace: entry.marketplace,
        name: entry.name,
      });
      if (ok) {
        await searchPluginCatalog(query.trim())
          .then((results) => setPluginCatalog(results))
          .catch(() => undefined);
      }
    } finally {
      setInstallingPlugin('');
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count: number }[] = [
    {
      id: 'mcp',
      label: t('MCP', 'MCP', 'MCP'),
      icon: <Server className="w-3 h-3" />,
      count: servers.length,
    },
    {
      id: 'skills',
      label: t('Skills', 'Skills', 'Skills'),
      icon: <BookOpen className="w-3 h-3" />,
      count: skills.length,
    },
    {
      id: 'plugins',
      label: t('Plugins', 'Plugins', 'Plugins'),
      icon: <Puzzle className="w-3 h-3" />,
      count: plugins.length,
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setQuery('');
              setError('');
            }}
            aria-pressed={tab === item.id}
            className={`flex items-center gap-1 border-2 px-2 py-0.5 text-[10px] font-bold ${
              tab === item.id
                ? 'bg-[var(--nc-active-bg)] text-[var(--nc-active-text)] border-[var(--nc-border-light)]'
                : 'bg-[var(--nc-bg-main)] text-[var(--nc-text)] border-[var(--nc-border-dark)] hover:border-[var(--nc-border-light)]'
            }`}
          >
            {item.icon}
            {item.label}
            <span className="opacity-70">{item.count}</span>
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1 min-w-0">
          <div className="flex items-center gap-1 border border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] px-1.5 py-0.5">
            <Search className="w-3 h-3 text-[var(--nc-text)]/60 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Buscar…', 'Search…', 'Suchen…')}
              aria-label={t('Buscar extensiones', 'Search extensions', 'Erweiterungen suchen')}
              className="bg-transparent text-[10px] text-[var(--nc-text)] outline-none w-32"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className={btnClass}
            title={t('Recargar', 'Reload', 'Neu laden')}
            aria-label={t('Recargar', 'Reload', 'Neu laden')}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-[10px] text-[var(--nc-danger)] border border-[var(--nc-danger)]/50 px-2 py-1">
          {error}
        </p>
      )}

      {tab === 'mcp' && (
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-1">
            <input
              value={mcpName}
              onChange={(e) => setMcpName(e.target.value)}
              placeholder={t('Nombre del servidor', 'Server name', 'Servername')}
              aria-label={t('Nombre del servidor MCP', 'MCP server name', 'MCP-Servername')}
              className={inputClass}
            />
            <input
              value={mcpCommand}
              onChange={(e) => setMcpCommand(e.target.value)}
              placeholder={t('Comando (npx, node…)', 'Command (npx, node…)', 'Befehl (npx, node…)')}
              aria-label={t('Comando del servidor MCP', 'MCP server command', 'MCP-Server-Befehl')}
              className={inputClass}
            />
            <input
              value={mcpArgs}
              onChange={(e) => setMcpArgs(e.target.value)}
              placeholder={t('Argumentos', 'Arguments', 'Argumente')}
              aria-label={t('Argumentos del servidor MCP', 'MCP server arguments', 'MCP-Server-Argumente')}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void addMcp()}
              disabled={!mcpName.trim() || !mcpCommand.trim()}
              className={btnClass}
            >
              <Plus className="w-3 h-3" />
              {t('Añadir', 'Add', 'Hinzufügen')}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[9px] opacity-70">
              {t('Sugerencias:', 'Suggestions:', 'Vorschläge:')}
            </span>
            {MCP_SUGGESTIONS.filter(
              (sug) => !servers.some((s) => (s.name || s.id) === sug.name)
            ).map((sug) => (
              <button
                key={sug.name}
                type="button"
                onClick={() => {
                  setMcpName(sug.name);
                  setMcpCommand(sug.command);
                  setMcpArgs(sug.args);
                }}
                className="border border-[var(--nc-border-light)]/40 px-1 py-0.5 text-[9px] hover:bg-[var(--nc-hover-bg)]"
                title={`${sug.command} ${sug.args}`}
                aria-label={`${t('Usar', 'Use', 'Verwenden')} ${sug.name}`}
              >
                {sug.name}
              </button>
            ))}
          </div>

          {/* Aun sin consulta se listan los últimos publicados: la pestaña no
              arranca vacía y el registro se consulta una sola vez. */}
          {tab === 'mcp' && (
            <div className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] px-1.5 py-1 space-y-1">
              <div className="flex items-center gap-1 text-[9px] opacity-80">
                <Globe className="w-3 h-3 shrink-0" />
                {t('Registro público MCP', 'Public MCP registry', 'Öffentliches MCP-Register')}
                {!q && <span className="opacity-60">· {t('recientes', 'recent', 'neu')}</span>}
                {registryState === 'loading' && <Loader2 className="w-3 h-3 animate-spin" />}
              </div>

              {registryError && (
                <div className="flex items-center gap-2">
                  <p className="text-[9px] text-[var(--nc-danger)] flex-1">
                    {t('Sin conexión: ', 'Offline: ', 'Offline: ')}
                    {registryError}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void searchRegistry(query.trim()).then(setRegistry).catch(() => undefined)
                    }
                    className={btnClass}
                  >
                    <RefreshCw className="w-3 h-3" />
                    {t('Reintentar', 'Retry', 'Erneut')}
                  </button>
                </div>
              )}

              {!registryError && registryState !== 'loading' && registry.length === 0 && (
                <p className="text-[9px] opacity-60">
                  {t('Sin resultados en el registro.', 'No registry results.', 'Keine Registertreffer.')}
                </p>
              )}

              {registry.map((entry) => (
                <div key={entry.name} className="flex items-start gap-1.5 border-t border-[var(--nc-border-dark)]/60 pt-1">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold truncate">
                      {String(entry.name).split('/').pop()}
                      {entry.version && <span className="opacity-60 font-normal"> v{entry.version}</span>}
                    </div>
                    <div className="text-[9px] opacity-70 line-clamp-2">{entry.description || ''}</div>
                    <div className="text-[9px] opacity-50 font-mono truncate">
                      {entry.installable
                        ? [entry.command, ...(entry.args || [])].join(' ')
                        : entry.remoteUrl || t('sólo remoto (HTTP/SSE)', 'remote only (HTTP/SSE)', 'nur remote (HTTP/SSE)')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void installFromRegistry(entry)}
                    disabled={!entry.installable}
                    className={btnClass}
                    title={
                      entry.installable
                        ? t('Añadir este servidor', 'Add this server', 'Diesen Server hinzufügen')
                        : t(
                            'Este servidor no trae paquete npm/pypi: la app sólo lanza stdio',
                            'No npm/pypi package: the app only spawns stdio servers',
                            'Kein npm/pypi-Paket: die App startet nur stdio-Server'
                          )
                    }
                  >
                    <Plus className="w-3 h-3" />
                    {t('Añadir', 'Add', 'Hinzufügen')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="max-h-52 overflow-y-auto space-y-1" role="list">
            {filteredServers.length === 0 && (
              <p className="text-[10px] opacity-70 px-1 py-2">
                {t('Sin servidores MCP configurados.', 'No MCP servers configured.', 'Keine MCP-Server konfiguriert.')}
              </p>
            )}
            {filteredServers.map((s) => (
              <div key={s.name || s.id} className={rowClass} role="listitem">
                <Server className="w-3 h-3 text-[var(--nc-text-accent)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold truncate">{s.name || s.id}</div>
                  <div className="text-[9px] opacity-70 truncate font-mono">
                    {[s.command, ...(Array.isArray(s.args) ? s.args : [])].filter(Boolean).join(' ') || '—'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void removeMcp(s.name || s.id)}
                  className="p-0.5 text-[var(--nc-danger)] hover:text-red-300 shrink-0"
                  title={t('Quitar', 'Remove', 'Entfernen')}
                  aria-label={`${t('Quitar', 'Remove', 'Entfernen')} ${s.name || s.id}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {onOpenManager && (
            <button type="button" onClick={onOpenManager} className={btnClass}>
              <Server className="w-3 h-3" />
              {t('Gestor completo (OAuth, tools, salud)', 'Full manager (OAuth, tools, health)', 'Vollständiger Manager (OAuth, Tools, Status)')}
            </button>
          )}
        </div>
      )}

      {tab === 'skills' && (
        <div className="space-y-2">
          <div className="flex gap-1">
            <input
              value={skillDir}
              onChange={(e) => setSkillDir(e.target.value)}
              placeholder={t(
                'Carpeta con skills (.md) para importar',
                'Folder with skills (.md) to import',
                'Ordner mit Skills (.md) zum Importieren'
              )}
              aria-label={t('Carpeta de skills', 'Skills folder', 'Skills-Ordner')}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void importSkills()}
              disabled={!skillDir.trim()}
              className={btnClass}
            >
              <FolderInput className="w-3 h-3" />
              {t('Importar', 'Import', 'Importieren')}
            </button>
          </div>

          {tab === 'skills' && (
            <div className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] px-1.5 py-1 space-y-1">
              <div className="flex items-center gap-1 text-[9px] opacity-80">
                <Globe className="w-3 h-3 shrink-0" />
                {t('Catálogo público de skills', 'Public skills catalog', 'Öffentlicher Skills-Katalog')}
                {!q && <span className="opacity-60">· {t('destacadas', 'featured', 'beliebt')}</span>}
                {catalogState === 'loading' && <Loader2 className="w-3 h-3 animate-spin" />}
              </div>

              {catalogError && (
                <div className="flex items-center gap-2">
                  <p className="text-[9px] text-[var(--nc-danger)] flex-1">
                    {t('Sin conexión: ', 'Offline: ', 'Offline: ')}
                    {catalogError}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void searchCatalog(query.trim()).then(setSkillCatalog).catch(() => undefined)
                    }
                    className={btnClass}
                  >
                    <RefreshCw className="w-3 h-3" />
                    {t('Reintentar', 'Retry', 'Erneut')}
                  </button>
                </div>
              )}

              {!catalogError && catalogState !== 'loading' && skillCatalog.length === 0 && (
                <p className="text-[9px] opacity-60">
                  {t('Sin resultados en el catálogo.', 'No catalog results.', 'Keine Katalogtreffer.')}
                </p>
              )}

              {skillCatalog.map((entry) => (
                <div key={entry.id} className="flex items-start gap-1.5 border-t border-[var(--nc-border-dark)]/60 pt-1">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold truncate">{entry.name}</div>
                    <div className="text-[9px] opacity-70 line-clamp-2">{entry.summary || ''}</div>
                    <div className="text-[9px] opacity-50 font-mono truncate">
                      {entry.source} · {t('instalaciones', 'installs', 'Installationen')} {entry.installs}
                      {entry.stars ? ` · ★ ${entry.stars}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void installFromCatalog(entry)}
                    disabled={Boolean(installing) || Boolean(entry.installed)}
                    className={btnClass}
                    title={
                      entry.installed
                        ? t('Ya instalada', 'Already installed', 'Bereits installiert')
                        : t('Descargar el SKILL.md a skills/commands', 'Download SKILL.md into skills/commands', 'SKILL.md nach skills/commands laden')
                    }
                  >
                    {installing === entry.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                    {entry.installed ? t('Instalada', 'Installed', 'Installiert') : t('Instalar', 'Install', 'Installieren')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="max-h-52 overflow-y-auto space-y-1" role="list">
            {filteredSkills.length === 0 && (
              <p className="text-[10px] opacity-70 px-1 py-2">
                {t(
                  'Sin skills. Importa una carpeta con archivos .md.',
                  'No skills. Import a folder with .md files.',
                  'Keine Skills. Ordner mit .md-Dateien importieren.'
                )}
              </p>
            )}
            {filteredSkills.map((s) => (
              <div key={s.id || s.filePath} className={rowClass} role="listitem">
                <BookOpen className="w-3 h-3 text-[var(--nc-text-accent)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold truncate">{s.name || s.id}</div>
                  <div className="text-[9px] opacity-70 truncate">{s.description || ''}</div>
                </div>
                <span className="text-[9px] px-1 border border-[var(--nc-border-light)]/30 shrink-0">
                  {s.type || 'skill'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'plugins' && (
        <div className="space-y-2">
          <div className="flex gap-1">
            <input
              value={pluginId}
              onChange={(e) => setPluginId(e.target.value)}
              placeholder={t('Id del plugin a instalar', 'Plugin id to install', 'Plugin-ID zum Installieren')}
              aria-label={t('Id del plugin', 'Plugin id', 'Plugin-ID')}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void installPlugin()}
              disabled={!pluginId.trim()}
              className={btnClass}
            >
              <Plus className="w-3 h-3" />
              {t('Instalar', 'Install', 'Installieren')}
            </button>
          </div>

          {/* Catálogo de los marketplace de Claude: al instalar, el servidor
              convierte el plugin en skills, agentes y servidores MCP nativos. */}
          <div className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] px-1.5 py-1 space-y-1">
            <div className="flex items-center gap-1 text-[9px] opacity-80">
              <Globe className="w-3 h-3 shrink-0" />
              {t(
                'Catálogo de plugins (marketplace.json)',
                'Plugin catalog (marketplace.json)',
                'Plugin-Katalog (marketplace.json)'
              )}
              {pluginCatalogState === 'loading' && <Loader2 className="w-3 h-3 animate-spin" />}
            </div>

            {pluginCatalogError && (
              <div className="flex items-center gap-2">
                <p className="text-[9px] text-[var(--nc-danger)] flex-1">
                  {t('Sin conexión: ', 'Offline: ', 'Offline: ')}
                  {pluginCatalogError}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void searchPluginCatalog(query.trim())
                      .then(setPluginCatalog)
                      .catch(() => undefined)
                  }
                  className={btnClass}
                >
                  <RefreshCw className="w-3 h-3" />
                  {t('Reintentar', 'Retry', 'Erneut')}
                </button>
              </div>
            )}

            {!pluginCatalogError && pluginCatalogState !== 'loading' && pluginCatalog.length === 0 && (
              <p className="text-[9px] opacity-60">
                {t('Sin resultados en el catálogo.', 'No catalog results.', 'Keine Katalogtreffer.')}
              </p>
            )}

            {pluginCatalog.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-1.5 border-t border-[var(--nc-border-dark)]/60 pt-1"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold truncate">
                    {entry.name}
                    {entry.version && <span className="opacity-60 font-normal"> v{entry.version}</span>}
                  </div>
                  <div className="text-[9px] opacity-70 line-clamp-2">{entry.description || ''}</div>
                  <div className="text-[9px] opacity-50 font-mono truncate">
                    {entry.marketplace}
                    {entry.category ? ` · ${entry.category}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void installMarketplacePlugin(entry)}
                  disabled={!entry.installable || Boolean(installingPlugin) || Boolean(entry.installed)}
                  className={btnClass}
                  title={
                    entry.installable
                      ? t(
                          'Copia sus skills, agentes y servidores MCP al proyecto',
                          'Copies its skills, agents and MCP servers into the project',
                          'Kopiert Skills, Agenten und MCP-Server ins Projekt'
                        )
                      : entry.reason || t('No instalable', 'Not installable', 'Nicht installierbar')
                  }
                >
                  {installingPlugin === (entry.id || entry.name) ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Plus className="w-3 h-3" />
                  )}
                  {entry.installed
                    ? t('Instalado', 'Installed', 'Installiert')
                    : t('Instalar', 'Install', 'Installieren')}
                </button>
              </div>
            ))}
          </div>

          <div className="max-h-52 overflow-y-auto space-y-1" role="list">
            {filteredPlugins.length === 0 && (
              <p className="text-[10px] opacity-70 px-1 py-2">
                {t('Sin plugins instalados.', 'No plugins installed.', 'Keine Plugins installiert.')}
              </p>
            )}
            {filteredPlugins.map((p) => (
              <div key={p.id} className={rowClass} role="listitem">
                <Puzzle className="w-3 h-3 text-[var(--nc-text-accent)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold truncate">{p.name || p.id}</div>
                  <div className="text-[9px] opacity-70 truncate font-mono">
                    {p.id} · v{p.version || '—'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void removePlugin(p.id)}
                  className="p-0.5 text-[var(--nc-danger)] hover:text-red-300 shrink-0"
                  title={t('Desinstalar', 'Uninstall', 'Deinstallieren')}
                  aria-label={`${t('Desinstalar', 'Uninstall', 'Deinstallieren')} ${p.id}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <p className="flex items-center gap-1 text-[10px] opacity-70">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('Leyendo…', 'Loading…', 'Lädt…')}
        </p>
      )}
    </div>
  );
};

export default ExtensionsSettings;
