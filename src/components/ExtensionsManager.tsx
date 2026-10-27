import React, { useState, useEffect, useCallback } from 'react';
import { Server, Puzzle, BookOpen, Search, Plus, Trash2, Download, Globe, Loader2, RefreshCw } from 'lucide-react';
import { McpServerManager } from './McpServerManager';

interface ExtensionsManagerProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: 'es' | 'en' | 'de';
}

type Tab = 'mcp' | 'skills' | 'plugins';

const SKILLS_STORAGE_KEY = 'commander_ai_skills';
const PLUGINS_STORAGE_KEY = 'commander_ai_plugins';
const MCP_SERVERS_STORAGE_KEY = 'commander_ai_mcp_servers';

const safeParse = (value: string | null, defaultValue: any[]): any[] => {
  try {
    const parsed = JSON.parse(value || 'null');
    return Array.isArray(parsed) ? parsed : defaultValue;
  } catch {
    return defaultValue;
  }
};

const t = (lang: string, es: string, en: string, de: string) => lang === 'es' ? es : lang === 'de' ? de : en;

export const ExtensionsManager: React.FC<ExtensionsManagerProps> = ({ isOpen, onClose, lang = 'es' }) => {
  const [activeTab, setActiveTab] = useState<Tab>('mcp');
  const [mcpOpen, setMcpOpen] = useState(false);

  const [skills, setSkills] = useState<any[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState('');
  const [skillSearch, setSkillSearch] = useState('');
  const [skillImportDir, setSkillImportDir] = useState('');
  const [skillImporting, setSkillImporting] = useState(false);

  const [plugins, setPlugins] = useState<any[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [pluginsError, setPluginsError] = useState('');
  const [pluginId, setPluginId] = useState('');
  const [pluginName, setPluginName] = useState('');
  const [pluginVersion, setPluginVersion] = useState('');
  const [pluginInstalling, setPluginInstalling] = useState(false);

  const [servers, setServers] = useState<any[]>([]);
  const [mcpServerImportDir, setMcpServerImportDir] = useState('');
  const [mcpImporting, setMcpImporting] = useState(false);
  const [mcpError, setMcpError] = useState('');

  const [webQuery, setWebQuery] = useState('');
  const [webResults, setWebResults] = useState<any[]>([]);
  const [webSearching, setWebSearching] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Catalog suggestions only; these entries do not verify a runtime integration.
    const seedSkills = [
      { id: 'skill-chained-pr', name: 'Chained PR', description: 'Chained PR workflow for stacked reviews', type: 'skill' },
      { id: 'skill-cognitive-doc-design', name: 'Cognitive Doc Design', description: 'Design docs reducing cognitive load', type: 'skill' },
      { id: 'skill-go-testing', name: 'Go Testing', description: 'Go testing patterns and coverage', type: 'skill' },
      { id: 'skill-judgment-day', name: 'Judgment Day', description: 'Judgment day and dual review workflows', type: 'skill' },
      { id: 'skill-skill-creator', name: 'Skill Creator', description: 'Create new skills and templates', type: 'skill' },
      { id: 'skill-skill-improver', name: 'Skill Improver', description: 'Improve existing skills and presets', type: 'skill' },
      { id: 'skill-skill-registry', name: 'Skill Registry', description: 'Skill registry and indexing', type: 'skill' },
      { id: 'skill-spritecook-animate-assets', name: 'SpriteCook Animate Assets', description: 'SpriteCook asset animation', type: 'skill' },
      { id: 'skill-spritecook-build-ui-kits', name: 'SpriteCook Build UI Kits', description: 'Build UI kits with SpriteCook', type: 'skill' },
      { id: 'skill-spritecook-generate-sprites', name: 'SpriteCook Generate Sprites', description: 'Generate pixel art sprites', type: 'skill' },
      { id: 'skill-spritecook-generate-tilesets', name: 'SpriteCook Generate Tilesets', description: 'Generate autotile tilesets', type: 'skill' },
      { id: 'skill-spritecook-polish-sprites', name: 'SpriteCook Polish Sprites', description: 'Polish and clean sprite edges', type: 'skill' },
      { id: 'skill-spritecook-upload-assets', name: 'SpriteCook Upload Assets', description: 'Upload assets to library', type: 'skill' },
      { id: 'skill-spritecook-use-assets-in-godot', name: 'SpriteCook Use Assets in Godot', description: 'Import SpriteCook assets into Godot', type: 'skill' },
      { id: 'skill-spritecook-use-dual-grid-tilesets', name: 'SpriteCook Use Dual Grid Tilesets', description: 'Dual-grid autotile rendering', type: 'skill' },
      { id: 'skill-spritecook-use-presets', name: 'SpriteCook Use Presets', description: 'Apply saved presets for consistency', type: 'skill' },
      { id: 'skill-spritecook-workflow-essentials', name: 'SpriteCook Workflow Essentials', description: 'Shared workflow essentials', type: 'skill' },
      { id: 'skill-work-unit-commits', name: 'Work Unit Commits', description: 'Plan commits as reviewable work units', type: 'skill' },
      { id: 'skill-shared', name: 'Shared Resources', description: 'Shared references and conventions', type: 'skill' },
    ];

    const seedPlugins = [
      { id: 'plugin-engram', name: 'Engram', version: '1.0.0', description: 'Persistent memory and session tracking' },
      { id: 'plugin-model-variants', name: 'Model Variants', version: '1.0.0', description: 'Model variant management' },
      { id: 'plugin-review-transport', name: 'Review Transport', version: '1.0.0', description: 'Review and transport artifacts' },
      { id: 'plugin-skill-registry', name: 'Skill Registry', version: '1.0.0', description: 'Skill registry plugin' },
      { id: 'plugin-telemetry-runtime', name: 'Telemetry Runtime', version: '1.0.0', description: 'Telemetry and runtime metrics' },
    ];

    const seedMCP = [
      { name: 'Core MCP', url: '/api/mcp/core', description: 'Core MCP server for plugins, hooks and transforms', id: 'mcp-core' },
      { name: 'Skills MCP', url: '/api/mcp/skills', description: 'Skills loader and folder import server', id: 'mcp-skills' },
      { name: 'Plugins MCP', url: '/api/mcp/plugins', description: 'Plugin manager and registry server', id: 'mcp-plugins' },
      { name: 'Tools MCP', url: '/api/mcp/tools', description: 'Tool registry and command execution', id: 'mcp-tools' },
      { name: 'Agents MCP', url: '/api/mcp/agents', description: 'Agent approval and autonomous mode', id: 'mcp-agents' },
      { name: 'Providers MCP', url: '/api/mcp/providers', description: 'Provider and model selection', id: 'mcp-providers' },
      { name: 'Integrations MCP', url: '/api/mcp/integrations', description: 'External integrations and APIs', id: 'mcp-integrations' },
      { name: 'VCS MCP', url: '/api/mcp/vcs', description: 'Git worktrees and version control', id: 'mcp-vcs' },
      { name: 'Websearch MCP', url: '/api/mcp/websearch', description: 'Web search and reference lookup', id: 'mcp-websearch' },
      { name: 'Permissions MCP', url: '/api/mcp/permissions', description: 'Permissions and security policies', id: 'mcp-permissions' },
      { name: 'Sessions MCP', url: '/api/mcp/sessions', description: 'Session workspace and tabs', id: 'mcp-sessions' },
      { name: 'Events MCP', url: '/api/mcp/events', description: 'Events, hooks and transform registry', id: 'mcp-events' },
    ];

    const storedSkills = localStorage.getItem(SKILLS_STORAGE_KEY);
    if (!storedSkills || JSON.parse(storedSkills).length === 0) {
      localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(seedSkills));
      setSkills(seedSkills);
    } else {
      const parsed = safeParse(storedSkills, []);
      if (Array.isArray(parsed) && parsed.length > 0) setSkills(parsed);
    }

    const storedPlugins = localStorage.getItem(PLUGINS_STORAGE_KEY);
    if (!storedPlugins || JSON.parse(storedPlugins).length === 0) {
      localStorage.setItem(PLUGINS_STORAGE_KEY, JSON.stringify(seedPlugins));
      setPlugins(seedPlugins);
    } else {
      const parsed = safeParse(storedPlugins, []);
      if (Array.isArray(parsed) && parsed.length > 0) setPlugins(parsed);
    }

    const storedMCP = localStorage.getItem(MCP_SERVERS_STORAGE_KEY);
    if (!storedMCP || JSON.parse(storedMCP).length === 0) {
      localStorage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify(seedMCP));
      setServers(seedMCP);
    } else {
      try {
        const parsed = JSON.parse(storedMCP);
        if (Array.isArray(parsed) && parsed.length > 0) setServers(parsed);
      } catch {}
    }
  }, []);

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true); setSkillsError('');
    try {
      const res = await fetch('/api/skills', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      const skillsList = data.success ? data.skills || [] : [];
      setSkills(skillsList);
      if (!data.success) setSkillsError(data.error || 'Error');
      if (typeof window !== 'undefined') {
        localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skillsList));
      }
    } catch (e: any) { setSkillsError(e?.message || 'Error'); }
    finally { setSkillsLoading(false); }
  }, []);

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

  const loadPlugins = useCallback(async () => {
    setPluginsLoading(true); setPluginsError('');
    try {
      const res = await fetch('/api/plugins', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      const pluginsList = data.success ? data.plugins || [] : [];
      setPlugins(pluginsList);
      if (!data.success) setPluginsError(data.error || 'Error');
      if (typeof window !== 'undefined') {
        localStorage.setItem(PLUGINS_STORAGE_KEY, JSON.stringify(pluginsList));
      }
    } catch (e: any) { setPluginsError(e?.message || 'Error'); }
    finally { setPluginsLoading(false); }
  }, []);

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

  const loadServers = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/list', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setServers(data.servers || []);
      }
    } catch { /* ignore */ }
  }, []);

  const removeServerFromStorage = (serverName: string) => {
    if (typeof window !== 'undefined') {
      const serversStr = localStorage.getItem(MCP_SERVERS_STORAGE_KEY);
      let stored: any[] = [];
      if (serversStr) {
        try { stored = JSON.parse(serversStr); } catch {}
      }
      const filtered = stored.filter((s: any) => s.name !== serverName);
      localStorage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify(filtered));
    }
  };

  const importMcpServer = async () => {
    if (!mcpServerImportDir.trim()) return;
    setMcpImporting(true);
    try {
      const res = await fetch('/api/mcp/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sourceDir: mcpServerImportDir.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) { loadServers(); setMcpServerImportDir(''); }
      else setMcpError(data.error || 'Error importando servidor MCP');
    } catch (e: any) { setMcpError(e?.message || 'Error'); }
    finally { setMcpImporting(false); }
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
        <div className="flex items-center justify-between px-3 py-2 border-b-2 border-[#00ffff] bg-[#00aaaa]">
          <span className="text-black font-bold text-sm">{t(lang, 'Extensiones e Integraciones', 'Extensions & Integrations', 'Erweiterungen & Integrationen')}</span>
          <button onClick={onClose} className="text-black hover:text-red-600 font-bold">X</button>
        </div>

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

        <div className="flex-1 overflow-auto p-3 min-h-0">
          <p className="mb-3 border border-[#ffff55]/40 p-2 text-xs text-[#ffff55]">
            {t(lang, 'Catálogo registrado, sin verificar. Una entrada no confirma instalación, conexión ni disponibilidad de herramientas.', 'Registered catalog, unverified. An entry does not confirm installation, connection, or tool availability.', 'Registrierter Katalog, ungeprüft. Ein Eintrag bestätigt weder Installation noch Verbindung oder Werkzeugverfügbarkeit.')}
          </p>
          {activeTab === 'mcp' && (
            <div className="space-y-3">
              <p className="text-[10px] text-[#00ffff]/70">{t(lang, 'Gestiona servidores MCP (Model Context Protocol).', 'Manage MCP (Model Context Protocol) servers.', 'MCP-Server (Model Context Protocol) verwalten.')}</p>
              <button onClick={() => setMcpOpen(true)} className="nc-button !px-3 !py-1.5 text-xs font-bold bg-[#00ffff] text-black">
                <Server className="w-3.5 h-3.5" /> {t(lang, 'Abrir gestor MCP', 'Open MCP Manager', 'MCP-Manager offnen')}
              </button>
              <div className="max-h-40 overflow-auto space-y-2">
                {servers.map((s: any) => (
                  <div key={s.name || s.id} className="flex items-center gap-2 p-1.5 border border-[#004466] bg-[#000022]">
                    <Server className="w-3 h-3 text-[#00ffff] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[#00ffff] font-bold text-[11px] truncate">{s.name || s.url}</div>
                      <div className="text-[#aaaaaa] text-[9px] truncate">{s.description || ''}</div>
                      <div className="text-xs text-[#ffff55]">{t(lang, 'Registrado · sin verificar', 'Registered · unverified', 'Registriert · ungeprüft')}</div>
                    </div>
                    <button onClick={() => { removeServerFromStorage(s.name || s.id); loadServers(); }} className="text-red-400 hover:text-red-300 p-1" title="Eliminar">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={mcpServerImportDir}
                  onChange={(e) => setMcpServerImportDir(e.target.value)}
                  placeholder={t(lang, 'Ruta o URL del servidor MCP', 'MCP Server path or URL', 'MCP-Server Pfad oder URL')}
                  className="flex-1 bg-[#000080] border border-[#00ffff]/40 text-[#00ffff] text-xs px-2 py-1 font-mono"
                />
                <button onClick={importMcpServer} className="nc-button !px-3 !py-1 text-xs font-bold bg-[#ffff55] text-black disabled:opacity-50">
                  {mcpImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {t(lang, 'Agregar', 'Add', 'Hinzufugen')}
                </button>
              </div>
              {mcpError && <div className="text-red-400 text-[10px]">{mcpError}</div>}
            </div>
          )}

          {activeTab === 'skills' && (
            <div className="space-y-3">
              <p className="text-[10px] text-[#00ffff]/70">{t(lang, 'Gestionar skills para extender las capacidades del agente.', 'Manage skills to extend the agent capabilities.', 'Skills verwalten, um die Fahigkeiten des Agents zu erweitern.')}</p>
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
                {skillsLoading && <div className="text-[#00ffff] text-[10px]">{t(lang, 'Cargando...', 'Loading...', 'Ladt...')}</div>}
                {!skillsLoading && filteredSkills.length === 0 && (
                  <div className="text-[#aaaaaa] text-[10px] italic">{t(lang, 'Sin skills. Importa desde una carpeta.', 'No skills. Import from a folder.', 'Keine Skills. Aus Ordner importieren.')}</div>
                )}
                {filteredSkills.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-2 p-1.5 border border-[#004466] bg-[#000022]">
                    <BookOpen className="w-3.5 h-3.5 text-[#ffff55] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[#00ffff] font-bold text-[11px] truncate">{s.name || s.id}</div>
                      <div className="text-[#aaaaaa] text-[9px] truncate">{s.description || s.id}</div>
                      <div className="text-xs text-[#ffff55]">{t(lang, 'Registrado · sin verificar', 'Registered · unverified', 'Registriert · ungeprüft')}</div>
                    </div>
                    <span className="text-[9px] text-[#00ffff]/60 px-1 border border-[#00ffff]/30">{s.type || 'skill'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'plugins' && (
            <div className="space-y-3">
              <p className="text-[10px] text-[#00ffff]/70">{t(lang, 'Instalar y gestionar plugins para ampliar funcionalidades.', 'Install and manage plugins to extend functionality.', 'Plugins installieren und verwalten, um Funktionalitaten zu erweitern.')}</p>
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
                  placeholder={t(lang, 'Version', 'Version', 'Version')}
                  className="bg-[#000080] border border-[#00ffff]/40 text-[#00ffff] text-xs px-2 py-1 font-mono"
                />
              </div>
              <button onClick={installPlugin} disabled={pluginInstalling || !pluginId.trim()} className="nc-button !px-3 !py-1.5 text-xs font-bold bg-[#ffff55] text-black disabled:opacity-50">
                {pluginInstalling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {t(lang, 'Instalar plugin', 'Install plugin', 'Plugin installieren')}
              </button>
              {pluginsError && <div className="text-red-400 text-[10px]">{pluginsError}</div>}
              <div className="space-y-1 max-h-60 overflow-auto">
                {pluginsLoading && <div className="text-[#00ffff] text-[10px]">{t(lang, 'Cargando...', 'Loading...', 'Ladt...')}</div>}
                {!pluginsLoading && plugins.length === 0 && (
                  <div className="text-[#aaaaaa] text-[10px] italic">{t(lang, 'Sin plugins instalados.', 'No plugins installed.', 'Keine Plugins installiert.')}</div>
                )}
                {plugins.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-2 p-1.5 border border-[#004466] bg-[#000022]">
                    <Puzzle className="w-3.5 h-3.5 text-[#00ffff] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[#00ffff] font-bold text-[11px] truncate">{p.name || p.id}</div>
                      <div className="text-[#aaaaaa] text-[9px] truncate">{p.id} v{p.version || 'unknown'}</div>
                      <div className="text-xs text-[#ffff55]">{t(lang, 'Registrado · sin verificar', 'Registered · unverified', 'Registriert · ungeprüft')}</div>
                    </div>
                    <button onClick={() => uninstallPlugin(p.id)} className="text-red-400 hover:text-red-300 p-1" title={t(lang, 'Desinstalar', 'Uninstall', 'Deinstallieren')}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

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

        <McpServerManager isOpen={mcpOpen} onClose={() => setMcpOpen(false)} lang={lang} />
      </div>
    </div>
  );
};

export default ExtensionsManager;
