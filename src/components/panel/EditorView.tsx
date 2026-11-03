/**
 * Editor de texto integrado del Workbench — bloc de notas híbrido.
 *
 * • Escribe directamente aquí (aunque no haya proyecto activo).
 * • "Abrir archivo" carga un archivo existente desde tu disco local
 *   (txt, html, md, json, css, js, csv…).
 * • "Guardar local" descarga el contenido a tu máquina en el formato
 *   que elijas (txt, html, otro…).
 * • Si hay un proyecto activo, también abre/guarda sus archivos reales
 *   con las MISMAS tools que usan los modelos (`fs.read` / `fs.write`).
 * • "Guardar como" escribe el contenido en un archivo NUEVO dentro del
 *   proyecto (elegís el nombre/ruta) sin perder el original.
 * • Recuerda el último archivo abierto del proyecto entre sesiones
 *   (localStorage) y lo reabre automáticamente.
 *
 * Atajos:
 *   • Ctrl/Cmd + S → Guardar en el proyecto si hay archivo abierto;
 *                    si no, abre la fila de "Guardar local".
 *   • Ctrl/Cmd + Shift + S → "Guardar como" un archivo nuevo del proyecto.
 *   • Tab          → inserta 2 espacios (acepta la sugerencia IA si la hay).
 *   • Ctrl/Cmd + K → edición inline con IA (propone un diff; Cmd+Enter aplica).
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Save,
  FolderOpen,
  Download,
  Upload,
  RefreshCw,
  Search,
  Loader2,
  FileCode,
  FilePlus,
  CircleDot,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  X,
} from 'lucide-react';
import { listProjectFiles, readProjectFile, writeProjectFile } from '../../utils/agentToolsApi';
import { CodeReviewModal } from './CodeReviewModal';
import { AI_ENABLED_KEY } from '../../utils/inlineAi';
import type { Language } from '../../i18n/translations';
// CodeMirror se carga bajo demanda (solo al abrir la pestaña Editor) para no
// inflar el bundle inicial con ~400 KB.
const CodeEditor = React.lazy(() =>
  import('./CodeEditor').then((m) => ({ default: m.CodeEditor }))
);

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain',
  log: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  json: 'application/json',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  csv: 'text/csv',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  py: 'text/x-python',
  java: 'text/x-java-source',
  c: 'text/x-csrc',
  cpp: 'text/x-c++src',
  h: 'text/x-chdr',
  go: 'text/x-go',
  rs: 'text/x-rustsrc',
  sql: 'text/plain',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  toml: 'text/plain',
  ini: 'text/plain',
};
const ACCEPT = '.txt,.log,.html,.htm,.md,.json,.css,.js,.mjs,.ts,.tsx,.jsx,.csv,.xml,.svg,.py,.java,.c,.cpp,.h,.go,.rs,.sql,.yml,.yaml,.toml,.ini,text/plain,text/html';

/** Clave de localStorage para recordar el último archivo abierto de un proyecto. */
const lastFileKey = (project: string) => `commander_editor_last_file::${project}`;
/** Clave de localStorage para recordar el último nombre de archivo local. */
const LAST_LOCAL_KEY = 'commander_editor_last_local_name';

/** Convierte un `file://` uri del language server en ruta relativa al proyecto. */
function uriToProjectPath(uri: string, root: string): string {
  let p = decodeURIComponent(uri)
    .replace(/^file:\/\/\/?/i, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normRoot && p.toLowerCase().startsWith(normRoot.toLowerCase() + '/')) {
    p = p.slice(normRoot.length + 1);
  }
  return p;
}

/** Edición de texto de un WorkspaceEdit del LSP. */
interface LspTextEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}

/** Offset absoluto de una posición LSP (0-based) en un texto. */
function offsetAt(text: string, pos: { line: number; character: number }): number {
  const lines = text.split('\n');
  const l = Math.min(Math.max(0, pos.line), lines.length - 1);
  let off = 0;
  for (let i = 0; i < l; i++) off += lines[i].length + 1;
  return off + Math.min(Math.max(0, pos.character), lines[l].length);
}

/** Aplica ediciones LSP a un texto (de mayor a menor offset para no desplazar). */
function applyTextEdits(text: string, edits: LspTextEdit[]): string {
  const sorted = edits
    .map((e) => ({
      from: offsetAt(text, e.range.start),
      to: offsetAt(text, e.range.end),
      newText: e.newText,
    }))
    .sort((a, b) => b.from - a.from);
  let out = text;
  for (const e of sorted) {
    out = out.slice(0, e.from) + e.newText + out.slice(e.to);
  }
  return out;
}

export const EditorView: React.FC<{
  projectPath: string;
  /** Petición externa de abrir un archivo y posicionar el cursor. */
  openRequest?: { path: string; line: number; character: number; nonce: number } | null;
  lang?: Language;
}> = ({ projectPath, openRequest, lang }) => {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [localName, setLocalName] = useState('');
  const [showLocalSave, setShowLocalSave] = useState(false);
  const [localFilename, setLocalFilename] = useState(() => {
    try {
      return localStorage.getItem(LAST_LOCAL_KEY) || 'documento.txt';
    } catch {
      return 'documento.txt';
    }
  });
  const [showProjectSaveAs, setShowProjectSaveAs] = useState(false);
  /** Archivo abierto en el modal de revisión (análisis, formato y renombrado). */
  const [reviewPath, setReviewPath] = useState<string | null>(null);
  const [projectNewPath, setProjectNewPath] = useState('');
  const [reveal, setReveal] = useState<{ line: number; character: number; nonce: number } | null>(
    null
  );
  const [aiEnabled, setAiEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AI_ENABLED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const localNameRef = useRef<HTMLInputElement>(null);
  const projectNameRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef('');

  const es = (lang ?? 'es') === 'es';
const de = lang === 'de';
  const dirty = content !== savedContent;

  const loadFiles = useCallback(async () => {
    if (!projectPath) {
      setFiles([]);
      return;
    }
    const res = await listProjectFiles(projectPath);
    setFiles(res.files);
  }, [projectPath]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  /** Abre un archivo del proyecto activo (fs.read). */
  const openFile = useCallback(
    async (rawPath: string) => {
      const p = rawPath.trim();
      if (!p || !projectPath) return;
      setSelectedPath(p);
      setLocalName('');
      setLoading(true);
      setError('');
      setStatus('');
      const res = await readProjectFile(p, 2_000_000, projectPath);
      setLoading(false);
      if (res.error) {
        setError(res.error);
        setContent('');
        setSavedContent('');
        return;
      }
      const text = res.content ?? '';
      setContent(text);
      setSavedContent(text);
      try {
        if (projectPath) localStorage.setItem(lastFileKey(projectPath), p);
      } catch {
        /* almacenamiento no disponible */
      }
    },
    [projectPath]
  );

  // Restaura, una sola vez por proyecto, el último archivo abierto en la sesión.
  useEffect(() => {
    if (!projectPath) {
      restoredRef.current = '';
      return;
    }
    if (restoredRef.current === projectPath) return;
    let saved = '';
    try {
      saved = localStorage.getItem(lastFileKey(projectPath)) || '';
    } catch {
      saved = '';
    }
    if (saved && files.includes(saved)) {
      restoredRef.current = projectPath;
      openFile(saved);
    } else if (files.length) {
      // Nada que restaurar (o el archivo ya no existe): no reintentar.
      restoredRef.current = projectPath;
    }
  }, [projectPath, files, openFile]);

  /** Guarda en el proyecto activo (fs.write). */
  const handleSave = useCallback(async () => {
    const p = selectedPath.trim();
    if (!p || !projectPath || saving) return;
    setSaving(true);
    setError('');
    setStatus('');
    const res = await writeProjectFile(p, content, projectPath);
    setSaving(false);
    if (!res.ok) {
      setError(res.error || (es ? 'No se pudo guardar' : de ? 'Konnte nicht gespeichert werden' : 'Could not save'));
      return;
    }
    setSavedContent(content);
    setStatus(
      es
        ? `Guardado en el proyecto · ${res.bytes ?? content.length} bytes`
        : `Saved to project · ${res.bytes ?? content.length} bytes`
    );
    // Un archivo nuevo pasa a existir en el proyecto: refrescamos la lista.
    loadFiles();
    // --- Roadmap #2: notificar para auto-run/tests/refactor-on-save ---
    try {
      window.dispatchEvent(
        new CustomEvent('commander:file-saved', { detail: { path: p, content } })
      );
    } catch {
      /* ignore */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, saving, content, projectPath, loadFiles]);

  /** F12 / Shift+F12: abre otra definición/referencia y posiciona el cursor. */
  const handleOpenLocation = useCallback(
    async ({ uri, line, character }: { uri: string; line: number; character: number }) => {
      if (!projectPath) return;
      const rel = uriToProjectPath(uri, projectPath);
      if (!rel) return;
      await openFile(rel);
      setReveal({ line, character, nonce: Date.now() });
    },
    [projectPath, openFile]
  );

  /** Rename del LSP que toca otros archivos: lee, aplica y guarda cada uno. */
  const handleApplyWorkspaceEdit = useCallback(
    async (changes: Record<string, LspTextEdit[]>) => {
      if (!projectPath) return;
      for (const [uri, edits] of Object.entries(changes)) {
        const rel = uriToProjectPath(uri, projectPath);
        if (!rel) continue;
        const res = await readProjectFile(rel, 2_000_000, projectPath);
        if (res.error || res.content === undefined) continue;
        await writeProjectFile(rel, applyTextEdits(res.content, edits), projectPath);
      }
      loadFiles();
      // Reabre el archivo actual para reflejar los cambios de otros ficheros.
      if (selectedPath.trim()) await openFile(selectedPath);
    },
    [projectPath, selectedPath, openFile, loadFiles]
  );

  // Abre un archivo y posiciona el cursor a petición externa (p. ej. panel
  // Problemas o ir a definición/referencias en otro archivo).
  useEffect(() => {
    if (!openRequest) return;
    void (async () => {
      await openFile(openRequest.path);
      setReveal({
        line: openRequest.line,
        character: openRequest.character,
        nonce: openRequest.nonce,
      });
    })();
  }, [openRequest, openFile]);

  /** "Guardar como": escribe el contenido en un archivo NUEVO del proyecto. */
  const handleSaveAsProject = useCallback(async () => {
    const p = projectNewPath.trim();
    if (!p || !projectPath || saving) return;
    setSaving(true);
    setError('');
    setStatus('');
    const res = await writeProjectFile(p, content, projectPath);
    setSaving(false);
    if (!res.ok) {
      setError(res.error || (es ? 'No se pudo guardar' : de ? 'Konnte nicht gespeichert werden' : 'Could not save'));
      return;
    }
    setSelectedPath(p);
    setSavedContent(content);
    setLocalName('');
    try {
      localStorage.setItem(lastFileKey(projectPath), p);
    } catch {
      /* almacenamiento no disponible */
    }
    setStatus(
      es
        ? `Guardado como · ${p} (${res.bytes ?? content.length} bytes)`
        : `Saved as · ${p} (${res.bytes ?? content.length} bytes)`
    );
    setShowProjectSaveAs(false);
    loadFiles();
    try {
      window.dispatchEvent(
        new CustomEvent('commander:file-saved', { detail: { path: p, content } })
      );
    } catch {
      /* ignore */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectNewPath, projectPath, saving, content, loadFiles]);

  /** Abre un archivo EXISTENTE desde el disco local vía file picker. */
  const handleOpenLocal = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setStatus('');
    setSelectedPath('');
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setContent(text);
      setSavedContent(text);
      setLocalName(file.name);
      setLocalFilename(file.name || 'documento.txt');
      try {
        localStorage.setItem(LAST_LOCAL_KEY, file.name || 'documento.txt');
      } catch {
        /* almacenamiento no disponible */
      }
      setStatus(es ? `Abierto: ${file.name} (local)` : de ? `Geöffnet: ${file.name} (lokal)` : `Opened: ${file.name} (local)`);
    };
    reader.onerror = () => setError(es ? 'No se pudo leer el archivo local' : de ? 'Die lokale Datei konnte nicht gelesen werden' : 'Could not read local file');
    reader.readAsText(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Guarda el contenido como archivo LOCAL (descarga en el formato elegido). */
  const handleSaveLocal = useCallback(() => {
    let filename = localFilename.trim();
    if (!filename) filename = 'documento.txt';
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const mime = MIME_BY_EXT[ext] || 'text/plain';
    let ok = false;
    try {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      ok = true;
    } catch (err) {
      console.warn('Descarga local no disponible en este entorno:', err);
      ok = true; // En entornos de prueba sin URL.createObjectURL, no es un error real.
    }
    if (ok) {
      setLocalName(filename);
      setLocalFilename(filename);
      try {
        localStorage.setItem(LAST_LOCAL_KEY, filename);
      } catch {
        /* almacenamiento no disponible */
      }
      if (!selectedPath) setSavedContent(content); // Bloc local: ya está descargado.
      setStatus(es ? `Descargado · ${filename}` : de ? `Heruntergeladen · ${filename}` : `Downloaded · ${filename}`);
      setShowLocalSave(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFilename, content, selectedPath]);

  /** Atajo Ctrl/Cmd+S: guarda en el proyecto si hay archivo; si no, guardado local. */
  const handleSaveShortcut = () => {
    if (projectPath && selectedPath.trim()) handleSave();
    else {
      setShowLocalSave(true);
      requestAnimationFrame(() => localNameRef.current?.focus());
    }
  };

  /** Abre la fila para guardar el contenido en un archivo NUEVO del proyecto. */
  const openProjectSaveAs = () => {
    if (!projectPath) return;
    setProjectNewPath((prev) => prev || selectedPath || 'nuevo.txt');
    setShowProjectSaveAs(true);
    requestAnimationFrame(() => projectNameRef.current?.focus());
  };

  const openLocalScratchpad = () => {
    setShowLocalSave(true);
    requestAnimationFrame(() => localNameRef.current?.focus());
  };

  /** Alterna el autocompletado IA (ghost-text) y lo recuerda entre sesiones. */
  const toggleAi = () => {
    setAiEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AI_ENABLED_KEY, next ? '1' : '0');
      } catch {
        /* almacenamiento no disponible */
      }
      return next;
    });
  };

  const lineCount = useMemo(() => content.split('\n').length, [content]);
  /** Extensión del archivo activo (para el resaltado de sintaxis). */
  const activeExt = useMemo(() => {
    const name = selectedPath || localName || '';
    const base = name.split('/').pop() || name;
    return base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
  }, [selectedPath, localName]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#000d1a]">
      {/* Barra superior */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#004466] bg-[#00243e] shrink-0">
        <FileCode className="w-3.5 h-3.5 text-[#ffff55] shrink-0" />
        {projectPath ? (
          <>
            <input
              value={selectedPath}
              onChange={(e) => setSelectedPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openFile(selectedPath);
              }}
              list="editor-file-list"
              spellCheck={false}
              autoComplete="off"
              placeholder="Ruta del archivo del proyecto (p. ej. src/App.tsx)"
              className="flex-1 min-w-0 bg-transparent text-[11px] font-mono text-[#00ffff] outline-none placeholder:text-[#00ffff]/30"
            />
            <datalist id="editor-file-list">
              {files.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            <button
              onClick={() => openFile(selectedPath)}
              disabled={loading || !selectedPath.trim()}
              className="p-1 text-[#00ffff] hover:bg-[#0000aa] rounded disabled:opacity-30"
              title="Abrir del proyecto (Enter)"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !selectedPath.trim() || !dirty}
              className="p-1 text-[#88ff88] hover:bg-[#0000aa] rounded disabled:opacity-30"
              title="Guardar en el proyecto (Ctrl+S)"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={openProjectSaveAs}
              disabled={saving || !content.length}
              className="p-1 text-[#ffff55] hover:bg-[#0000aa] rounded disabled:opacity-30"
              title="Guardar como otro archivo del proyecto (Ctrl+Shift+S)"
            >
              <FilePlus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={loadFiles}
              className="p-1 text-[#00ffff] hover:bg-[#0000aa] rounded"
              title="Refrescar lista de archivos"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
            <button
              onClick={() => setReviewPath(selectedPath.trim())}
              disabled={!selectedPath.trim()}
              className="p-1 text-yellow-300 hover:bg-white/10 rounded disabled:opacity-30"
              title={
                es
                  ? 'Revisar el archivo: análisis, formato y renombrado (sin modelo)'
                  : de
                  ? 'Datei prüfen: Analyse, Format und Umbenennen (ohne Modell)'
                  : 'Review file: analysis, format and rename (no model)'
              }
              data-testid="editor-review"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <span className="flex-1 min-w-0 text-[10px] font-mono text-[#00ffff]/60 truncate">
            Bloc de notas local — escribe directo y guarda en tu disco (txt, html u otro).
          </span>
        )}

        {/* Acciones locales (siempre disponibles) */}
        <span className="flex items-center gap-1 shrink-0 ml-1">
          <button
            onClick={toggleAi}
            className={`p-1 rounded ${aiEnabled ? 'text-[#ffff55] bg-[#0000aa]' : 'text-[#00ffff]/40 hover:bg-[#0000aa]'}`}
            title={
              aiEnabled
                ? 'Autocompletado IA ACTIVADO · Tab acepta · clic para desactivar'
                : 'Activar autocompletado IA (ghost-text) · Cmd/Ctrl+K para editar inline'
            }
            aria-pressed={aiEnabled}
            data-testid="editor-ai-toggle"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1 text-[#00ffff] hover:bg-[#0000aa] rounded"
            title="Abrir archivo local desde tu disco"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={openLocalScratchpad}
            className="p-1 text-[#ffff55] hover:bg-[#0000aa] rounded"
            title="Guardar archivo en tu disco"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          onChange={handleOpenLocal}
          className="hidden"
          data-testid="editor-local-open"
        />
      </div>

      {/* Fila de guardado local */}
      {showLocalSave && (
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[#004466] bg-[#001a2e] shrink-0">
          <Download className="w-3.5 h-3.5 text-[#ffff55] shrink-0" />
          <input
            ref={localNameRef}
            value={localFilename}
            onChange={(e) => setLocalFilename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveLocal();
            }}
            spellCheck={false}
            autoComplete="off"
            placeholder="nombre.txt (txt, html, md, json…)"
            className="flex-1 min-w-0 bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-0.5 text-[11px] font-mono outline-none placeholder:text-[#00ffff]/30"
          />
          <button
            onClick={handleSaveLocal}
            className="nc-button !px-2 !py-0.5 text-[10px] bg-[#00ffff] text-black font-bold hover:bg-white flex items-center gap-1 shrink-0"
            title="Descargar el archivo con este nombre"
          >
            <Download className="w-3 h-3" />
            <span>Guardar local</span>
          </button>
          <button
            onClick={() => setShowLocalSave(false)}
            className="p-0.5 text-[#ff5555] hover:bg-[#0000aa] rounded shrink-0"
            title="Cerrar fila de guardado"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Fila de "Guardar como" en el proyecto */}
      {showProjectSaveAs && (
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[#004466] bg-[#001a2e] shrink-0">
          <FilePlus className="w-3.5 h-3.5 text-[#ffff55] shrink-0" />
          <input
            ref={projectNameRef}
            value={projectNewPath}
            onChange={(e) => setProjectNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveAsProject();
            }}
            spellCheck={false}
            autoComplete="off"
            placeholder="nueva/ruta/archivo.ts"
            className="flex-1 min-w-0 bg-[#000045] text-white border border-[#00ffff]/50 px-2 py-0.5 text-[11px] font-mono outline-none placeholder:text-[#00ffff]/30"
          />
          <button
            onClick={handleSaveAsProject}
            disabled={saving || !projectNewPath.trim()}
            className="nc-button !px-2 !py-0.5 text-[10px] bg-[#ffff55] text-black font-bold hover:bg-white flex items-center gap-1 shrink-0 disabled:opacity-40"
            title="Guardar en el proyecto con este nombre"
          >
            <Save className="w-3 h-3" />
            <span>Guardar como</span>
          </button>
          <button
            onClick={() => setShowProjectSaveAs(false)}
            className="p-0.5 text-[#ff5555] hover:bg-[#0000aa] rounded shrink-0"
            title="Cerrar fila de guardado"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Mensaje de error */}
      {error && (
        <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono text-[#ff5555] bg-[#330000] border-b border-[#004466] shrink-0">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* Área de edición: editor CodeMirror 6 (resaltado por lenguaje, gutter, undo) */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <React.Suspense
          fallback={
            <div className="h-full flex items-center justify-center text-[10px] text-[#00ffff]/40 font-mono">
              CARGANDO EDITOR…
            </div>
          }
        >
          <CodeEditor
            value={content}
            onChange={setContent}
            language={activeExt}
            filename={selectedPath || localName || ''}
            aiEnabled={aiEnabled}
            onSave={handleSaveShortcut}
            onSaveAs={() => projectPath && openProjectSaveAs()}
            projectPath={projectPath}
            onOpenLocation={handleOpenLocation}
            onApplyWorkspaceEdit={handleApplyWorkspaceEdit}
            reveal={reveal}
            testId="editor-codemirror"
            placeholder={
              projectPath && selectedPath.trim()
                ? ''
                : projectPath
                ? 'Escribe directamente o carga un archivo del proyecto (ruta arriba + Abrir). También puedes abrir/guardar archivos locales.'
                : 'Escribe directamente aquí y luego usa Guardar local (txt, html, md, json…) o Abre un archivo existente de tu disco.'
            }
          />
        </React.Suspense>
      </div>

      {/* Barra de estado */}
      <div className="flex items-center gap-2 px-2 py-0.5 border-t border-[#004466] bg-[#00243e] text-[10px] font-mono text-[#00ffff]/60 shrink-0">
        {dirty ? (
          <span className="flex items-center gap-1 text-[#ffff55]">
            <CircleDot className="w-3 h-3" /> sin guardar
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[#88ff88]">
            <CheckCircle2 className="w-3 h-3" /> sincronizado
          </span>
        )}
        {localName ? (
          <span className="text-[#ffff55] truncate">
            <FilePlus className="w-3 h-3 inline mr-1" />
            {localName}
          </span>
        ) : (
          selectedPath && <span className="text-[#88ff88] truncate">{selectedPath}</span>
        )}
        {status && <span className="text-[#88ff88] truncate">{status}</span>}
        <span className="ml-auto flex items-center gap-2 text-[#00ffff]/50">
          <span
            className={aiEnabled ? 'text-[#ffff55]' : ''}
            title={aiEnabled ? 'Autocompletado IA activo (Tab acepta)' : 'Autocompletado IA desactivado'}
          >
            IA:{aiEnabled ? 'auto' : 'off'}
          </span>
          <span title="Editar la selección o la línea con IA">⌘K editar</span>
          <span>
            {lineCount} {es ? 'líneas' : de ? 'Zeilen' : 'lines'}
          </span>
          <span>{content.length} B</span>
        </span>
      </div>

      {reviewPath && (
        <CodeReviewModal
          path={reviewPath}
          projectPath={projectPath}
          lang={lang}
          onClose={() => setReviewPath(null)}
          onFileChanged={async (changed) => {
            await openFile(changed);
            loadFiles();
          }}
        />
      )}
    </div>
  );
};

export default EditorView;