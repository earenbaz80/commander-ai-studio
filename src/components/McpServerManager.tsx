import { deText } from '../i18n/de';
/**
 * Modal "Servidores MCP" (Model Context Protocol).
 *
 * Permite registrar y gestionar servidores MCP locales que exponen
 * herramientas (tools) al agente. Persiste en localStorage con la misma
 * clave que usa el backend/CLI para mantener la config sincronizada.
 *
 * Estilo retro Norton (azul #000080, cyan #00ffff, amarillo #ffff55).
 */
import React from 'react';
import { Server, Cpu, Plus, Trash2, Save, PlugZap, Boxes, CheckCircle2, KeyRound, LogOut, ShieldCheck, Loader2 } from 'lucide-react';
import { Language } from '../i18n/translations';

export interface McpAuthConfig {
  type: 'oauth2' | 'bearer';
  clientId: string;
  clientSecret?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  bearerToken?: string;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  auth?: McpAuthConfig;
}

interface McpAuthStatus {
  authenticated: boolean;
  expiresAt: number | null;
  canRefresh: boolean;
  type: string | null;
}

interface McpServerManagerProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: Language;
}

const MCP_STORAGE_KEY = 'mcp_servers';

function loadServersFromStorage(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(MCP_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveServersToStorage(servers: McpServerConfig[]): void {
  try {
    localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(servers));
  } catch {
    /* almacenamiento no disponible */
  }
}

export const McpServerManager: React.FC<McpServerManagerProps> = ({ isOpen, onClose, lang = 'es' }) => {
  const [servers, setServers] = React.useState<McpServerConfig[]>([]);
  const [name, setName] = React.useState('');
  const [command, setCommand] = React.useState('');
  const [args, setArgs] = React.useState('');
  const [savedFlash, setSavedFlash] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // Estado OAuth por servidor: solo aplica si el servidor tiene auth.type === 'oauth2'.
  const [authStatus, setAuthStatus] = React.useState<Record<string, McpAuthStatus>>({});
  const [authorizing, setAuthorizing] = React.useState<string | null>(null);

  const t = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);

  const fetchAuthStatus = React.useCallback(async (serverName: string) => {
    try {
      const res = await fetch(`/api/mcp/${encodeURIComponent(serverName)}/auth/status`);
      if (res.ok) {
        const data = await res.json();
        setAuthStatus((prev) => ({ ...prev, [serverName]: data }));
      }
    } catch {
      /* backend no disponible */
    }
  }, []);

  // Al abrir: intenta leer del backend (/api/mcp/list) y si no responde,
  // usa localStorage como respaldo (modo frontend puro / dev server Vite).
  React.useEffect(() => {
    if (!isOpen) return;
    setSavedFlash(false);
    let alive = true;

    (async () => {
      let loaded: McpServerConfig[] | null = null;
      try {
        const res = await fetch('/api/mcp/list');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.servers)) {
            loaded = data.servers.map((s: any) => ({
              name: s.name,
              command: s.command || '',
              args: s.args || [],
              env: s.env || {},
              auth: s.auth,
            }));
          }
        }
      } catch {
        /* backend no disponible: usar localStorage */
      }
      if (!alive) return;
      const final = loaded ?? loadServersFromStorage();
      setServers(final);
      // Consulta el estado OAuth de los servidores que lo requieran.
      for (const s of final) {
        if (s.auth?.type === 'oauth2') fetchAuthStatus(s.name);
      }
    })();

    return () => {
      alive = false;
    };
  }, [isOpen, fetchAuthStatus]);

  if (!isOpen) return null;

  /**
   * Inicia el flujo OAuth para un servidor: abre popup y hace poll del
   * estado hasta que se autorice (o timeout de 2 min).
   */
  const handleAuthorize = async (serverName: string) => {
    setAuthorizing(serverName);
    let popup: Window | null = null;
    try {
      const res = await fetch(`/api/mcp/${encodeURIComponent(serverName)}/auth/start`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('No se pudo iniciar OAuth:', err.error);
        setAuthorizing(null);
        return;
      }
      const data = await res.json();
      popup = window.open(data.authorizeUrl, 'mcp_oauth', 'width=600,height=700');
    } catch (e) {
      console.error('Error iniciando OAuth:', e);
      setAuthorizing(null);
      return;
    }

    // Poll del estado cada 2s hasta autenticado o 2 minutos.
    const deadline = Date.now() + 120_000;
    const poll = setInterval(async () => {
      await fetchAuthStatus(serverName);
      const done = Date.now() > deadline;
      if (done) {
        clearInterval(poll);
        setAuthorizing(null);
        popup?.close();
      }
    }, 2000);

    // Detiene el poll cuando se autentica (revisa tras cada fetch).
    const checkAuth = setInterval(async () => {
      try {
        const r = await fetch(`/api/mcp/${encodeURIComponent(serverName)}/auth/status`);
        if (r.ok) {
          const st = await r.json();
          if (st.authenticated) {
            clearInterval(checkAuth);
            clearInterval(poll);
            popup?.close();
            setAuthorizing(null);
            flashSaved();
          }
        }
      } catch {
        /* ignorar */
      }
    }, 2000);
  };

  const handleAuthLogout = async (serverName: string) => {
    try {
      await fetch(`/api/mcp/${encodeURIComponent(serverName)}/auth/logout`, { method: 'POST' });
      await fetchAuthStatus(serverName);
    } catch {
      /* ignorar */
    }
  };

  /**
   * Persiste en el backend si está disponible; si no, en localStorage.
   * `action` = 'install' | 'uninstall'.
   */
  const persist = async (action: 'install' | 'uninstall', payload: Record<string, unknown>) => {
    let backend = false;
    try {
      const res = await fetch(`/api/mcp/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      backend = res.ok;
    } catch {
      backend = false;
    }
    return backend;
  };

  const handleAdd = async () => {
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (!trimmedName || !trimmedCommand) return;

    // Parsear args: JSON array si empieza con [, si no por espacios.
    let parsedArgs: string[] = [];
    const argsTrim = args.trim();
    if (argsTrim) {
      if (argsTrim.startsWith('[')) {
        try {
          parsedArgs = JSON.parse(argsTrim);
        } catch {
          parsedArgs = argsTrim.split(/\s+/);
        }
      } else {
        parsedArgs = argsTrim.split(/\s+/);
      }
    }

    setBusy(true);
    const ok = await persist('install', { name: trimmedName, command: trimmedCommand, args: parsedArgs });
    setBusy(false);

    const existing = servers.find((s) => s.name === trimmedName);
    const newServer: McpServerConfig = {
      name: trimmedName,
      command: trimmedCommand,
      args: parsedArgs,
      env: {},
      // Preserva la config de auth al actualizar un servidor existente.
      ...(existing?.auth ? { auth: existing.auth } : {}),
    };

    let updated: McpServerConfig[];
    if (existing) {
      updated = servers.map((s) => (s.name === trimmedName ? newServer : s));
    } else {
      updated = [...servers, newServer];
    }

    setServers(updated);
    // Siempre guardamos también en localStorage como respaldo offline.
    saveServersToStorage(updated);

    // Limpia el formulario
    setName('');
    setCommand('');
    setArgs('');
    flashSaved();
    void ok;
  };

  const handleRemove = async (serverName: string) => {
    setBusy(true);
    await persist('uninstall', { name: serverName });
    setBusy(false);

    const updated = servers.filter((s) => s.name !== serverName);
    setServers(updated);
    saveServersToStorage(updated);
    flashSaved();
  };

  const flashSaved = () => {
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 font-mono select-none">
      <div className="w-full max-w-lg nc-panel border-2 border-[var(--nc-border-light)] p-5 relative shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">

        {/* Border corner accents */}
        <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[var(--nc-text-accent)] -mt-0.5 -ml-0.5" />
        <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-[var(--nc-text-accent)] -mt-0.5 -mr-0.5" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-[var(--nc-text-accent)] -mb-0.5 -ml-0.5" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-[var(--nc-text-accent)] -mb-0.5 -mr-0.5" />

        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-[var(--nc-border-light)] pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Boxes className="w-5 h-5 text-[var(--nc-text-accent)] animate-pulse" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">
              {t('── SERVIDORES MCP ──', '── MCP SERVERS ──')}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-red-400 hover:text-white border border-red-500 hover:bg-red-600 px-1.5 py-0.5 text-xs font-bold transition-all"
          >
            [X]
          </button>
        </div>

        {/* Intro */}
        <div className="bg-[var(--nc-bg-panel)] border border-[var(--nc-border-light)]/40 p-2 text-[10px] text-[var(--nc-text)] mb-3 flex items-start gap-2">
          <Cpu className="w-4 h-4 text-[var(--nc-text-accent)] shrink-0" />
          <p className="leading-tight">
            {t(
              'Registra servidores MCP (Model Context Protocol) que exponen herramientas al agente. Se guardan localmente y se sincronizan con commander.json.',
              'Register MCP (Model Context Protocol) servers that expose tools to the agent. Saved locally and synced with commander.json.'
            )}
          </p>
        </div>

        {/* Lista de servidores */}
        <div className="mb-4">
          <label className="text-[10px] text-[var(--nc-text-accent)] font-bold uppercase flex items-center gap-1 mb-2">
            <Server className="w-3 h-3" />
            {t(`Servidores registrados (${servers.length})`, `Registered servers (${servers.length})`)}
          </label>

          {servers.length === 0 ? (
            <p className="text-[10px] text-[var(--nc-text-dim)] italic">
              {t('No hay servidores MCP registrados.', 'No MCP servers registered.')}
            </p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {servers.map((srv) => {
                const status = authStatus[srv.name];
                const hasOAuth = srv.auth?.type === 'oauth2';
                const isAuth = hasOAuth && status?.authenticated;
                return (
                <div
                  key={srv.name}
                  className="bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)]/30 px-2 py-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-[var(--nc-text)]">{srv.name}</span>
                        {srv.auth && (
                          <span
                            className={`flex items-center gap-0.5 text-[8px] px-1 py-px border ${
                              isAuth
                                ? 'text-[var(--nc-success)] border-[var(--nc-success)]/50 bg-[#003300]'
                                : 'text-[#ffcc66] border-[var(--nc-text-accent)]/40 bg-[#332200]'
                            }`}
                            title={isAuth ? t('Autorizado', 'Authorized') : t('Sin autorizar', 'Not authorized')}
                          >
                            {isAuth ? <ShieldCheck className="w-2.5 h-2.5" /> : <KeyRound className="w-2.5 h-2.5" />}
                            {isAuth ? 'OAuth ✓' : 'OAuth'}
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-[var(--nc-text-dim)] truncate" title={srv.command}>
                        <PlugZap className="w-2.5 h-2.5 inline mr-1" />
                        {srv.command}
                        {srv.args.length > 0 ? ` ${srv.args.join(' ')}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {srv.auth?.type === 'oauth2' && (
                        <>
                          {isAuth ? (
                            <button
                              onClick={() => handleAuthLogout(srv.name)}
                              className="text-[#ffcc66] hover:text-white border border-[var(--nc-text-accent)]/50 hover:bg-[#665500] px-1 py-0.5 text-[9px] font-bold transition-all"
                              title={t('Cerrar sesión OAuth', 'OAuth logout')}
                            >
                              <LogOut className="w-3 h-3" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleAuthorize(srv.name)}
                              disabled={authorizing === srv.name}
                              className="text-[var(--nc-text)] hover:text-black border border-[var(--nc-border-light)] hover:bg-[var(--nc-highlight-bg)] px-1 py-0.5 text-[9px] font-bold transition-all disabled:opacity-40"
                              title={t('Autorizar (OAuth)', 'Authorize (OAuth)')}
                            >
                              {authorizing === srv.name ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <KeyRound className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </>
                      )}
                      <button
                        onClick={() => handleRemove(srv.name)}
                        className="text-red-400 hover:text-white border border-red-500/50 hover:bg-red-600 px-1 py-0.5 text-[9px] font-bold transition-all"
                        title={t('Eliminar', 'Remove')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Formulario para añadir */}
        <div className="space-y-2 pt-3 border-t border-[var(--nc-border-dark)]">
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--nc-text-accent)] font-bold uppercase mb-1">
            <Plus className="w-3 h-3" />
            {t('Añadir / actualizar servidor', 'Add / update server')}
          </div>

          <div>
            <label className="text-[9px] text-[var(--nc-text)] uppercase font-bold mb-0.5 block">
              {t('Nombre', 'Name')}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('ej: filesystem, git', 'e.g. filesystem, git')}
              spellCheck={false}
              className="w-full bg-[var(--nc-bg-deep)] text-white border border-[var(--nc-border-light)]/50 px-2 py-1.5 text-[11px] font-mono outline-none focus:border-[var(--nc-border-light)]"
            />
          </div>

          <div>
            <label className="text-[9px] text-[var(--nc-text)] uppercase font-bold mb-0.5 block">
              {t('Comando', 'Command')}
            </label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx -y @modelcontextprotocol/server-filesystem"
              spellCheck={false}
              className="w-full bg-[var(--nc-bg-deep)] text-white border border-[var(--nc-border-light)]/50 px-2 py-1.5 text-[11px] font-mono outline-none focus:border-[var(--nc-border-light)]"
            />
          </div>

          <div>
            <label className="text-[9px] text-[var(--nc-text)] uppercase font-bold mb-0.5 block">
              {t('Argumentos (separados por espacio o JSON)', 'Arguments (space-separated or JSON)')}
            </label>
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="/ruta/proyecto  o  [&quot;/ruta&quot;]"
              spellCheck={false}
              className="w-full bg-[var(--nc-bg-deep)] text-white border border-[var(--nc-border-light)]/50 px-2 py-1.5 text-[11px] font-mono outline-none focus:border-[var(--nc-border-light)]"
            />
          </div>

          <button
            onClick={handleAdd}
            disabled={!name.trim() || !command.trim() || busy}
            className="nc-button w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] bg-[var(--nc-highlight-bg)] text-black font-bold hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed mt-2"
          >
            {busy ? <Save className="w-3.5 h-3.5 animate-pulse" /> : <Save className="w-3.5 h-3.5" />}
            {t('Guardar servidor', 'Save server')}
          </button>

          <p className="text-[9px] text-[var(--nc-text-dim)] leading-tight pt-1">
            {t(
              'Nota: esto guarda la configuración. El binario/paquete npm debe estar instalado para que el servidor funcione.',
              'Note: this saves the config. The binary/npm package must be installed for the server to run.'
            )}
          </p>
        </div>

        {savedFlash && (
          <div className="mt-3 bg-[#003300] border border-[var(--nc-success)]/50 text-[var(--nc-success)] p-1.5 text-[10px] flex items-center gap-1.5 animate-in fade-in duration-150">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            {t('✓ Servidores MCP guardados.', '✓ MCP servers saved.')}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-4 text-[9px] text-[var(--nc-text-dim)] uppercase font-mono tracking-wider pt-2 border-t border-[var(--nc-border-dark)]">
          {t('COMMANDER AI STUDIO - MCP REGISTRY', 'COMMANDER AI STUDIO - MCP REGISTRY')}
        </div>
      </div>
    </div>
  );
};

export default McpServerManager;
