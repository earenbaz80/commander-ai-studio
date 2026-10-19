import React, { useState, useEffect, useCallback } from 'react';
import { Server, Puzzle, BookOpen, Search, Plus, Trash2, Download, Globe, Loader2, RefreshCw } from 'lucide-react';
import { McpServerManager } from './McpServerManager';

interface ExtensionsManagerProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: 'es' | 'en' | 'de';
}

type Tab = 'mcp' | 'skills' | 'plugins';

const t = (lang: string, es: string, en: string, de: string) => lang === 'es' ? es : lang === 'de' ? de : en;

export const ExtensionsManager: React.FC<ExtensionsManagerProps> = ({ isOpen, onClose, lang = 'es' }) => {
  const [activeTab, setActiveTab] = useState<Tab>('mcp');
  const [mcpOpen, setMcpOpen] = useState(false);

  // Skills state
  const [skills, setSkills] = useState<any[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState('');
  const [skillSearch, setSkillSearch] = useState('');
  const [skillImportDir, setSkillImportDir] = useState('');
  const [skillImporting, setSkillImporting] = useState(false);

  // Plugins state
  const [plugins, setPlugins] = useState<any[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [pluginsError, setPluginsError] = useState('');
  const [pluginId, setPluginId] = useState('');
  const [pluginName, setPluginName] = useState('');
  const [pluginVersion, setPluginVersion] = useState('');
  const [pluginInstalling, setPluginInstalling] = useState(false);

  // Web search state
  const [webQuery, setWebQuery] = useState('');
  const [webResults, setWebResults] = useState<any[]>([]);
  const [webSearching, setWebSearching] = useState(false);

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true); setSkillsError('');
    try {
      const res = await fetch('/api/skills', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      setSkills(data.success ? data.skills || [] : []);
      if (!data.success) setSkillsError(data.error || 'Error');
    } catch (e: any) { setSkillsError(e?.message || 'Error'); }
    finally { setSkillsLoading(false); }
  }, []);

  const loadPlugins = useCallback(async () => {
    setPluginsLoading(true); setPluginsError('');
    try {
      const res = await fetch('/api/plugins', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      setPlugins(data.success ? data.plugins || [] : []);
      if (!data.success) setPluginsError(data.error || 'Error');
    } catch (e: any) { setPluginsError(e?.message || 'Error'); }
    finally { setPluginsLoading(false); }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'skills') loadSkills();
    if (activeTab === 'plugins') loadPlugins();
  }, [isOpen, activeTab, loadSkills, loadPlugins]);

  const importSkills = async () => {
    if (!skillImportDir.trim()) return;
    setSkillImporting(true);
    try {
      const res = await fetch('/api/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sourceDir: skillImportDir.trim(), overwrite: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) { loadSkills(); setSkillImportDir(''); }
      else setSkillsError(data.error || 'Error importando');
    } catch (e: any) { setSkillsError(e?.message || 'Error'); }
    finally { setSkillImporting(false); }
  };

  const installPlugin = async () => {
    if (!pluginId.trim()) return;
    setPluginInstalling(true);
    try {
      const res = await fetch('/api/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: pluginId.trim(), name: pluginName.trim() || null, version: pluginVersion.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) { loadPlugins(); setPluginId(''); setPluginName(''); setPluginVersion(''); }
      else setPluginsError(data.error || 'Error instalando');
    } catch (e: any) { setPluginsError(e?.message || 'Error'); }
    finally { setPluginInstalling(false); }
  };

  const uninstallPlugin = async (id: string) => {
    try {
      await fetch(`/api/plugins/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
      loadPlugins();
    } catch { /* ignore */ }
  };

  const searchWeb = async () => {
    if (!webQuery.trim()) return;
    setWebSearching(true);
    try {
      const res = await fetch(`/api/search/web?q=${encodeURIComponent(webQuery.trim())}`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      setWebResults(Array.isArray(data.results) ? data.results : []);
    } catch { setWebResults([]); }
    finally { setWebSearching(false); }
  };

  const filteredSkills = skills.filter((s: any) => {
    const q = skillSearch.toLowerCase();
    if (!q) return true;
    return (s.name || '').toLowerCase().includes(q) || (s.id || '').toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q);
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[90vw] max-w-3xl max-h-[85vh] flex flex-col nc-panel border-2 border-[#00ffff] bg-[#000044]">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b-2 border-[#00ffff] bg-[#00aaaa]">
          <span className="text-black font-bold text-sm">{t(lang, 'Extensiones e Integraciones', 'Extensions & Integrations', 'Erweiterungen & Integrationen')}</span>
          <button onClick={onClose} className="text-black hover:text-red-600 font-bold">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-[#00ffff]/40">
          {([
            { id: 'mcp' as Tab, icon: <Server className="w-3.5 h-3.5" />, label: t(lang, 'MCP Servers', 'MCP Servers', 'MCP-Server') },
            { id: 'skills' as Tab, icon: <BookOpen className="w-3.5 h-3.5" />, label: t(lang, 'Skills', 'Skills', 'Skills') },
            { id: 'plugins' as Tab, icon: <Puzzle className="w-3.5 h-3.5" />, label: t(lang, 'Plugins', 'Plugins', 'Plugins') },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold border-b-2 ${activeTab === tab.id ? 'border-[#00ffff] text-[#00ffff] bg-[#000080]' : 'border-transparent text-[#00aaaa] hover:text-[#00ffff]'}`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-3 min-h-0">
          {/* MCP Tab */}
          {activeTab === 'mcp' && (
            <div className="space-y-3">
              <p className="text-[10px] text-[#00ffff]/70">{t(lang, 'Gestiona servidores MCP (Model Context Protocol).', 'Manage MCP (Model Context Protocol) servers.', 'MCP-Server (Model Context Protocol) verwalten.')}</p>
              <button onClick={() => setMcpOpen(true)} className="nc-button !px-3 !py-1.5 text-xs font-bold bg-[#00ffff] text-black">
                <Server className="w-3.5 h-3.5" /> {t(lang, 'Abrir gestor MCP', 'Open MCP Manager', 'MCP-Manager öffnen')}
              </button>
            </div>
          )}

          {/* Skills Tab */}
          {activeTab === 'skills' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                  placeholder={t(lang, 'Buscar skills...', 'Search skills...', 'Skills suchen...')}
                  className="flex-1 bg-[#000080] border border-[#00ffff]/40 text-[#00ffff] text-xs px-2 py-1 font-mono"
                />
                <button onClick={loadSkills} className="nc-button !px-2 !py-1" title={t(lang, 'Refrescar', 'Refresh', 'Aktualisieren')}>
                  <RefreshCw className={`w-3.5 h-3.5 ${skillsLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  value={skillImportDir}
                  onChange={(e) => setSkillImportDir(e.target.value)}
                  placeholder={t(lang, 'Ruta de carpeta con skills (.md)', 'Path to folder with skills (.md)', 'Pfad zum Ordner mit Skills (.md)')}
                  className="flex-1 bg-[#000080] border border-[#00ffff]/40 text-[#00ffff] text-xs px-2 py-1 font-mono"
                />
                <button onClick={importSkills} disabled={skillImporting || !skillImportDir.trim()} className="nc-button !px-3 !py-1 text-xs font-bold bg-[#ffff55] text-black disabled:opacity-50">
                  {skillImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {t(lang, 'Importar', 'Import', 'Importieren')}
                </button>
              </div>
              {skillsError && <div className="text-red-400 text-[10px]">{skillsError}</div>}
              <div className="space-y-1 max-h-60 overflow-auto">
                {skillsLoading && <div className="text-[#00ffff] text-[10px]">{t(lang, 'Cargando...', 'Loading...', 'Lädt...')}</div>}
                {!skillsLoading && filteredSkills.length === 0 && (
                  <div className="text-[#aaaaaa] text-[10px] italic">{t(lang, 'Sin skills. Importa desde una carpeta.', 'No skills. Import from a folder.', 'Keine Skills. Aus Ordner importieren.')}</div>
                )}
                {filteredSkills.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-2 p-1.5 border border-[#004466] bg-[#000022]">
                    <BookOpen className="w-3.5 h-3.5 text-[#ffff55] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[#00ffff] font-bold text-[11px] truncate">{s.name || s.id}</div>
                      <div className="text-[#aaaaaa] text-[9px] truncate">{s.description || s.id}</div>
                    </div>
                    <span className="text-[9px] text-[#00ffff]/60 px-1 border border-[#00ffff]/30">{s.type || 'skill'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Plugins Tab */}
          {activeTab === 'plugins' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <button onClick={loadPlugins} className="nc-button !px-2 !py-1" title={t(lang, 'Refrescar', 'Refresh', 'Aktualisieren')}>
                  <RefreshCw className={`w-3.5 h-3.5 ${pluginsLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={pluginId}
                  onChange={(e) => setPluginId(e.target.value)}
                  placeholder={t(lang, 'ID del plugin', 'Plugin ID', 'Plugin-ID')}
                  className="bg-[#000080] border border-[#00ffff]/40 text-[#00ffff] text-xs px-2 py-1 font-mono"
                />
                <input
                  value={pluginName}
                  onChange={(e) => setPluginName(e.target.value)}
                  placeholder={t(lang, 'Nombre', 'Name', 'Name')}
                  className="bg-[#000080] border border-[#00ffff]/40 text-[#00ffff] text-xs px-2 py-1 font-mono"
                />
                <input
                  value={pluginVersion}
                  onChange={(e) => setPluginVersion(e.target.value)}
                  placeholder={t(lang, 'Versión', 'Version', 'Version')}
                  className="bg-[#000080] border border-[#00ffff]/40 text-[#00ffff] text-xs px-2 py-1 font-mono"
                />
              </div>
              <button onClick={installPlugin} disabled={pluginInstalling || !pluginId.trim()} className="nc-button !px-3 !py-1.5 text-xs font-bold bg-[#ffff55] text-black disabled:opacity-50">
                {pluginInstalling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {t(lang, 'Instalar plugin', 'Install plugin', 'Plugin installieren')}
              </button>
              {pluginsError && <div className="text-red-400 text-[10px]">{pluginsError}</div>}
              <div className="space-y-1 max-h-60 overflow-auto">
                {pluginsLoading && <div className="text-[#00ffff] text-[10px]">{t(lang, 'Cargando...', 'Loading...', 'Lädt...')}</div>}
                {!pluginsLoading && plugins.length === 0 && (
                  <div className="text-[#aaaaaa] text-[10px] italic">{t(lang, 'Sin plugins instalados.', 'No plugins installed.', 'Keine Plugins installiert.')}</div>
                )}
                {plugins.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-2 p-1.5 border border-[#004466] bg-[#000022]">
                    <Puzzle className="w-3.5 h-3.5 text-[#00ffff] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[#00ffff] font-bold text-[11px] truncate">{p.name || p.id}</div>
                      <div className="text-[#aaaaaa] text-[9px] truncate">{p.id} · v{p.version || 'unknown'}</div>
                    </div>
                    <button onClick={() => uninstallPlugin(p.id)} className="text-red-400 hover:text-red-300 p-1" title={t(lang, 'Desinstalar', 'Uninstall', 'Deinstallieren')}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Web Search */}
        <div className="border-t border-[#00ffff]/40 p-2">
          <div className="flex gap-2 mb-2">
            <Globe className="w-4 h-4 text-[#ffff55] shrink-0 mt-1" />
            <input
              value={webQuery}
              onChange={(e) => setWebQuery(e.target.value)}
              placeholder={t(lang, 'Buscar en la web (MCP, skills, plugins)...', 'Search the web (MCP, skills, plugins)...', 'Im Web suchen (MCP, Skills, Plugins)...')}
              className="flex-1 bg-[#000080] border border-[#00ffff]/40 text-[#00ffff] text-xs px-2 py-1 font-mono"
              onKeyDown={(e) => { if (e.key === 'Enter') searchWeb(); }}
            />
            <button onClick={searchWeb} disabled={webSearching || !webQuery.trim()} className="nc-button !px-3 !py-1 text-xs font-bold disabled:opacity-50">
              {webSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            </button>
          </div>
          {webResults.length > 0 && (
            <div className="max-h-32 overflow-auto space-y-1">
              {webResults.slice(0, 5).map((r: any, i: number) => (
                <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="block p-1.5 border border-[#004466] bg-[#000022] hover:bg-[#000044] text-[10px]">
                  <div className="text-[#00ffff] font-bold truncate">{r.title || r.url}</div>
                  <div className="text-[#aaaaaa] truncate">{r.snippet || r.description || ''}</div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* MCP Manager Modal */}
      <McpServerManager isOpen={mcpOpen} onClose={() => setMcpOpen(false)} lang={lang} />
    </div>
  );
};

export default ExtensionsManager;