/**
 * Navegador integrado del Workbench.
 *
 * Dos modos:
 *  1. URL remota dentro de un iframe (con aviso cuando el sitio lo bloquea
 *     por X-Frame-Options y opción de abrir en una pestaña real).
 *  2. Previsualización de archivos HTML locales: se leen con `fs.read`
 *     (misma tool que usan los modelos) y se renderizan en un iframe
 *     aislado vía srcdoc, para ver apps generadas sin salir del estudio.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Globe, ExternalLink, RefreshCw, Play, FileCode2, Lock, Loader2 } from 'lucide-react';
import { readProjectFile } from '../../utils/agentToolsApi';

const QUICK_LINKS = [
  { label: 'Dev Server', url: 'http://localhost:3001' },
  { label: 'Vite', url: 'http://localhost:5173' },
];

export const BrowserView: React.FC<{ projectPath: string }> = ({ projectPath }) => {
  const [mode, setMode] = useState<'url' | 'local'>('url');
  const [url, setUrl] = useState('http://localhost:3001');
  const [activeUrl, setActiveUrl] = useState('');
  const [localPath, setLocalPath] = useState('index.html');
  const [srcdoc, setSrcdoc] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const navigate = useCallback((target: string) => {
    let finalUrl = target.trim();
    if (!finalUrl) return;
    if (!/^https?:\/\//i.test(finalUrl)) finalUrl = `https://${finalUrl}`;
    setActiveUrl(finalUrl);
    setMode('url');
    setBlocked(false);
    setStatus('Cargando…');
    setReloadKey((k) => k + 1);
  }, []);

  const previewLocal = useCallback(async (path: string) => {
    if (!path.trim()) return;
    setLoading(true);
    setStatus('Leyendo archivo local…');
    const res = await readProjectFile(path.trim(), 500_000, projectPath || undefined);
    setLoading(false);
    if (res.error) {
      setStatus(`⚠️ ${res.error}`);
      return;
    }
    setSrcdoc(res.content || '');
    setMode('local');
    setStatus(`Vista previa: ${path}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Estado inicial: intenta previsualizar index.html si hay proyecto
  useEffect(() => {
    if (projectPath && !srcdoc) previewLocal(localPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Barra de dirección */}
      <div className="flex items-center gap-1 p-1.5 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] shrink-0">
        <div className="flex items-center gap-1 shrink-0">
          <Globe className="w-3.5 h-3.5 text-[var(--nc-text)]" />
          <Lock className="w-2.5 h-2.5 text-[var(--nc-text)]/50" />
        </div>
        <input
          value={mode === 'url' ? url : localPath}
          onChange={(e) => (mode === 'url' ? setUrl(e.target.value) : setLocalPath(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              mode === 'url' ? navigate(url) : previewLocal(localPath);
            }
          }}
          placeholder={mode === 'url' ? 'https://…' : 'ruta/al/archivo.html'}
          spellCheck={false}
          className="flex-1 bg-[var(--nc-bg-deep)] text-[11px] font-mono text-[var(--nc-text)] px-2 py-1 rounded border border-[var(--nc-border-dark)] outline-none focus:border-[var(--nc-border-light)] placeholder:text-[var(--nc-text)]/30"
        />
        <button
          onClick={() => (mode === 'url' ? navigate(url) : previewLocal(localPath))}
          disabled={loading}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded disabled:opacity-40 shrink-0"
          title={mode === 'url' ? 'Ir' : 'Previsualizar'}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        {activeUrl && (
          <button
            onClick={() => { setReloadKey((k) => k + 1); setBlocked(false); }}
            className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded shrink-0"
            title="Recargar"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
        {activeUrl && (
          <a
            href={activeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] rounded shrink-0"
            title="Abrir en pestaña del navegador"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Accesos rápidos */}
      <div className="flex flex-wrap items-center gap-1 px-1.5 py-1 border-b border-[var(--nc-border-dark)] shrink-0">
        {QUICK_LINKS.map((link) => (
          <button
            key={link.url}
            onClick={() => { setUrl(link.url); navigate(link.url); }}
            className="text-[10px] font-mono px-1.5 py-0.5 bg-[var(--nc-bg-deep)] text-[var(--nc-text)] border border-[var(--nc-border-dark)] rounded hover:bg-[var(--nc-bg-hover)]"
          >
            {link.label}
          </button>
        ))}
        {projectPath && (
          <button
            onClick={() => { setMode('local'); previewLocal(localPath); }}
            className={`text-[10px] font-mono px-1.5 py-0.5 border rounded flex items-center gap-1 ${
              mode === 'local'
                ? 'bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)] border-[var(--nc-text-accent)]'
                : 'bg-[var(--nc-bg-deep)] text-[var(--nc-text)] border-[var(--nc-border-dark)] hover:bg-[var(--nc-bg-hover)]'
            }`}
            title="Renderiza un HTML del proyecto activo en un iframe aislado"
          >
            <FileCode2 className="w-3 h-3" /> Local HTML
          </button>
        )}
        <span className="ml-auto text-[10px] font-mono text-[var(--nc-text)]/50 truncate max-w-[50%]">{status}</span>
      </div>

      {/* Contenido */}
      <div className="flex-1 min-h-0 bg-white relative">
        {mode === 'local' && srcdoc ? (
          <iframe
            key={`local-${reloadKey}`}
            title="Vista previa local"
            srcDoc={srcdoc}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            className="w-full h-full border-0 bg-white"
          />
        ) : activeUrl ? (
          <>
            <iframe
              key={`url-${activeUrl}-${reloadKey}`}
              title="Navegador integrado"
              src={activeUrl}
              className="w-full h-full border-0 bg-white"
              onLoad={(e) => {
                // Si el iframe quedó inaccesible, avisamos (X-Frame-Options)
                try {
                  const doc = (e.target as HTMLIFrameElement).contentDocument;
                  if (!doc) setBlocked(true);
                } catch {
                  setBlocked(true);
                }
              }}
            />
            {blocked && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--nc-bg-deep)] text-center p-4">
                <Globe className="w-6 h-6 text-[var(--nc-text-accent)]" />
                <p className="text-[11px] font-mono text-[var(--nc-text)]/80 max-w-[240px]">
                  Este sitio bloquea su visualización en marcos integrados (X-Frame-Options).
                </p>
                <a
                  href={activeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nc-button text-[10px] !px-2 !py-1"
                >
                  Abrir en pestaña del navegador
                </a>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-4">
            <Globe className="w-7 h-7 text-[var(--nc-text)]/30" />
            <p className="text-[11px] font-mono text-[var(--nc-text)]/50 max-w-[220px]">
              Escribe una URL o previsualiza un archivo HTML de tu proyecto.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default BrowserView;
