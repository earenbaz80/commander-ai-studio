/**
 * Composer multi-archivo.
 *
 * La pantalla tenía tres bandas compitiendo (banner, barra de archivo, barra
 * inferior), acciones duplicadas y `prompt`/`confirm`/`alert` para lo cotidiano.
 * Ahora manda el cuerpo: una cabecera fina con lo global en un menú, el visor
 * con sus pestañas y el resumen del cambio, y abajo la instrucción como único
 * primario. El modelo se llama desde `lib/composerRun`, no desde aquí.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  CircleDot,
  Cloud,
  Code2,
  Copy,
  Download,
  Edit3,
  Eye,
  Layers,
  Loader2,
  MoreHorizontal,
  Play,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import type { ParameterConfig } from '../types/studio';
import { ALL_MODELS } from '../data/models';
import { computeLineDiff } from '../utils/diffUtils';
import { MentionAutocomplete } from './MentionAutocomplete';
import { CodeEditor } from './panel/CodeEditor';
import { ComposerFileList } from './composer/ComposerFileList';
import { ComposerDiff } from './composer/ComposerDiff';
import { ComposerTemplateModal } from './ComposerTemplateModal';
import { ComposerCloudModal } from './ComposerCloudModal';
import { ComposerLiveSandbox } from './ComposerLiveSandbox';
import { ComposerCodeRepl } from './ComposerCodeRepl';
import { CONTEXT_MENTIONS, type MentionItem } from '../data/contextMentions';
import type { Language } from '../i18n/translations';
import { deText } from '../i18n/de';
import JSZip from 'jszip';
import { ComposerError, runComposer, type ComposerFile } from '../lib/composerRun';

export type { ComposerFile };
/** Alias histórico: los modales importan `ProjectFile` de aquí. */
export type ProjectFile = ComposerFile;

export interface ComposerPlaygroundProps {
  parameters: ParameterConfig;
  setParameters: React.Dispatch<React.SetStateAction<ParameterConfig>>;
  selectedModel: string;
  lang?: Language;
}

const STORAGE_KEY = 'ai_studio_composer_files';

const DEFAULT_FILES: ComposerFile[] = [
  {
    name: 'src/App.tsx',
    originalContent: `import React, { useState } from 'react';\n\nexport function App() {\n  const [count, setCount] = useState(0);\n\n  return (\n    <div className="container">\n      <h1>Commander Desktop App</h1>\n      <p>Contador actual: {count}</p>\n      <button onClick={() => setCount(count + 1)}>Incrementar</button>\n    </div>\n  );\n}`,
  },
  {
    name: 'src/index.css',
    originalContent: `body {\n  margin: 0;\n  background-color: #000080;\n  color: #00ffff;\n  font-family: monospace;\n}\n\n.container {\n  padding: 20px;\n  text-align: center;\n}`,
  },
  {
    name: 'package.json',
    originalContent: `{\n  "name": "commander-composer-app",\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc && vite build"\n  },\n  "dependencies": {\n    "react": "^19.0.0",\n    "react-dom": "^19.0.0"\n  }\n}`,
  },
  {
    name: 'tauri.conf.json',
    originalContent: `{\n  "package": {\n    "productName": "CommanderApp",\n    "version": "1.0.0"\n  },\n  "tauri": {\n    "windows": [\n      {\n        "title": "Commander Native Window",\n        "width": 1024,\n        "height": 720\n      }\n    ]\n  }\n}`,
  },
];

type ViewMode = 'diff' | 'editor' | 'preview' | 'repl';

interface Status {
  kind: 'idle' | 'busy' | 'ok' | 'error';
  text: string;
}

const QUICK_TASKS: { es: string; en: string; prompt: string }[] = [
  {
    es: 'Persistencia en localStorage',
    en: 'localStorage persistence',
    prompt: 'Agrega persistencia en localStorage para guardar el contador y un botón de reinicio.',
  },
  {
    es: 'Sistema de temas retro',
    en: 'Retro theme system',
    prompt: 'Crea un archivo src/theme.ts con selector de temas retro (Norton Blue, Matrix, Amber) y aplícalo a App.tsx.',
  },
  {
    es: 'Validación y telemetría',
    en: 'Validation and telemetry',
    prompt: 'Agrega validación de errores y logging de telemetría a la aplicación.',
  },
  {
    es: 'Puente Tauri IPC',
    en: 'Tauri IPC bridge',
    prompt: 'Agrega soporte para Tauri IPC invokes en src/tauriBridge.ts.',
  },
];

function loadFiles(): ComposerFile[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as ComposerFile[];
    }
  } catch (e) {
    console.warn('No se pudieron leer los archivos del Composer', e);
  }
  return DEFAULT_FILES;
}

function extensionOf(name: string): string {
  const base = name.split('/').pop() || name;
  return base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
}

export const ComposerPlayground: React.FC<ComposerPlaygroundProps> = ({ parameters, selectedModel, lang = 'es' }) => {
  const t = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);

  const [files, setFiles] = useState<ComposerFile[]>(loadFiles);
  const [selectedFileName, setSelectedFileName] = useState<string>(() => loadFiles()[0]?.name ?? '');
  const [instruction, setInstruction] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('diff');
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);

  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const instructionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
    } catch (e) {
      console.warn('No se pudieron guardar los archivos del Composer', e);
    }
  }, [files]);

  const selectedFile = useMemo(
    () => files.find((f) => f.name === selectedFileName) || files[0],
    [files, selectedFileName]
  );

  const model = useMemo(
    () => ALL_MODELS.find((m) => m.id === selectedModel) || ALL_MODELS[0],
    [selectedModel]
  );

  const fileDiff = useMemo(() => {
    const original = selectedFile?.originalContent ?? '';
    const proposed = selectedFile?.proposedContent !== undefined ? selectedFile.proposedContent : original;
    return computeLineDiff(original, proposed);
  }, [selectedFile]);

  const pendingFiles = useMemo(
    () => files.filter((f) => f.proposedContent !== undefined && f.proposedContent !== f.originalContent),
    [files]
  );
  const pendingCount = pendingFiles.length;
  const selectedPending = selectedFile
    ? selectedFile.proposedContent !== undefined && selectedFile.proposedContent !== selectedFile.originalContent
    : false;

  // ── Archivos ────────────────────────────────────────────────────────────
  const createFile = (name: string): string | null => {
    if (files.some((f) => f.name === name)) return t('Ese archivo ya existe.', 'That file already exists.');
    setFiles((prev) => [
      ...prev,
      {
        name,
        originalContent: '',
        proposedContent: `// ${name}\nexport function init() {\n  console.log('Init ${name}');\n}\n`,
        isNew: true,
      },
    ]);
    setSelectedFileName(name);
    return null;
  };

  const deleteFile = (name: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => f.name !== name);
      if (selectedFileName === name) setSelectedFileName(next[0]?.name ?? '');
      return next;
    });
  };

  const acceptFile = (name: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.name === name && f.proposedContent !== undefined
          ? { ...f, originalContent: f.proposedContent, proposedContent: undefined, isNew: false }
          : f
      )
    );
  };

  const rejectFile = (name: string) => {
    setFiles((prev) =>
      prev
        .filter((f) => !(f.name === name && f.isNew && !f.originalContent))
        .map((f) => (f.name === name ? { ...f, proposedContent: undefined } : f))
    );
    if (files.length <= 1) setSelectedFileName(files[0]?.name ?? '');
  };

  const acceptAll = () => {
    setFiles((prev) =>
      prev.map((f) => ({
        ...f,
        originalContent: f.proposedContent !== undefined ? f.proposedContent : f.originalContent,
        proposedContent: undefined,
        isNew: false,
      }))
    );
    setViewMode('preview');
  };

  const rejectAll = () => {
    setFiles((prev) =>
      prev.filter((f) => !(f.isNew && !f.originalContent)).map((f) => ({ ...f, proposedContent: undefined }))
    );
  };

  const jumpToPending = () => {
    if (pendingFiles[0]) {
      setSelectedFileName(pendingFiles[0].name);
      setViewMode('diff');
    }
  };

  // ── Portapapeles y exportación ──────────────────────────────────────────
  const copyCode = async () => {
    if (!selectedFile) return;
    const code = selectedFile.proposedContent !== undefined ? selectedFile.proposedContent : selectedFile.originalContent;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setStatus({ kind: 'error', text: t('No se pudo copiar al portapapeles.', 'Could not copy to clipboard.') });
    }
  };

  const exportZip = async () => {
    try {
      const zip = new JSZip();
      files.forEach((f) => zip.file(f.name, f.proposedContent !== undefined ? f.proposedContent : f.originalContent));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `commander-project-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMenuOpen(false);
      setStatus({ kind: 'ok', text: t('Proyecto exportado en .ZIP.', 'Project exported as .ZIP.') });
    } catch (e: any) {
      setStatus({
        kind: 'error',
        text: `${t('No se pudo exportar:', 'Could not export:')} ${e?.message || String(e)}`,
      });
    }
  };

  // ── Ejecución del modelo ────────────────────────────────────────────────
  const run = async (promptOverride?: string) => {
    const text = (promptOverride ?? instruction).trim();
    if (!text || generating) return;
    setGenerating(true);
    setSuggestionsOpen(false);
    setStatus({ kind: 'busy', text: t(`Componiendo con ${model.name}…`, `Composing with ${model.name}…`) });
    try {
      const proposed = await runComposer({
        files,
        instruction: text,
        selectedFileName: selectedFile?.name ?? '',
        selectedModel,
        parameters,
      });
      setFiles((prev) => {
        const next = [...prev];
        proposed.forEach((content, filePath) => {
          const at = next.findIndex((f) => f.name === filePath);
          if (at >= 0) next[at] = { ...next[at], proposedContent: content };
          else next.push({ name: filePath, originalContent: '', proposedContent: content, isNew: true });
        });
        return next;
      });
      const first = Array.from(proposed.keys())[0];
      if (first) setSelectedFileName(first);
      setViewMode('diff');
      setStatus({
        kind: 'ok',
        text:
          lang === 'es'
            ? `${proposed.size} archivo(s) con diffs listos para revisar.`
            : lang === 'de'
              ? `${proposed.size} Datei(en) mit Diffs zur Prüfung bereit.`
              : `${proposed.size} file(s) with diffs ready to review.`,
      });
    } catch (e: any) {
      const sinBloques = e instanceof ComposerError && e.code === 'no-blocks';
      setStatus({
        kind: 'error',
        text: sinBloques
          ? t('El modelo no devolvió bloques FILE: revisa la instrucción.', 'The model returned no FILE blocks: refine the prompt.')
          : `${t('Error del proveedor:', 'Provider error:')} ${e?.message || String(e)}`,
      });
    } finally {
      setGenerating(false);
    }
  };

  // ── Menciones @ ─────────────────────────────────────────────────────────
  const instructionChanged = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursor = e.target.selectionStart || 0;
    setInstruction(value);
    const before = value.slice(0, cursor);
    const match = before.match(/@([a-zA-Z0-9_\-:/.]*)$/);
    if (match) {
      setShowMentions(true);
      setMentionQuery(match[1]);
      setMentionIndex(0);
    } else {
      setShowMentions(false);
    }
  };

  const selectMention = (item: MentionItem) => {
    if (!instructionRef.current) return;
    const cursor = instructionRef.current.selectionStart || instruction.length;
    const before = instruction.slice(0, cursor).replace(/@([a-zA-Z0-9_\-:/.]*)$/, `${item.id} `);
    const next = before + instruction.slice(cursor);
    setInstruction(next);
    setShowMentions(false);
    setTimeout(() => {
      instructionRef.current?.focus();
      instructionRef.current?.setSelectionRange(before.length, before.length);
    }, 10);
  };

  const filteredMentions = CONTEXT_MENTIONS.filter((item) => {
    const q = mentionQuery.toLowerCase().replace(/^@/, '');
    if (!q) return true;
    return item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
  });

  const onPromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % (filteredMentions.length || 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + (filteredMentions.length || 1)) % (filteredMentions.length || 1));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const item = filteredMentions[mentionIndex];
        if (item) selectMention(item);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentions(false);
        return;
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void run();
    }
  };

  const tabs: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
    { id: 'diff', label: t('Diff', 'Diff'), icon: <Eye className="w-3 h-3" /> },
    { id: 'editor', label: t('Editor', 'Editor'), icon: <Edit3 className="w-3 h-3" /> },
    { id: 'preview', label: t('Preview', 'Preview'), icon: <Play className="w-3 h-3" /> },
    { id: 'repl', label: t('REPL', 'REPL'), icon: <Terminal className="w-3 h-3" /> },
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--nc-bg-main)] font-mono text-[11px] text-[var(--nc-text)] overflow-hidden">
      {/* Cabecera: una sola fila, lo global en un menú */}
      <header className="relative flex items-center gap-2 px-3 h-9 shrink-0 bg-[var(--nc-bg-panel)] border-b-2 border-[var(--nc-border-light)]">
        <Code2 className="w-4 h-4 text-[var(--nc-text-accent)] shrink-0" />
        <span className="text-[10px] font-bold tracking-wide">{t('COMPOSER', 'COMPOSER')}</span>
        <span className="text-[10px] text-[var(--nc-text)]/50 truncate">
          {files.length} {t('archivos', 'files')}
        </span>
        <span className="ml-auto px-1.5 py-0.5 border border-[var(--nc-border-dark)] text-[10px] truncate max-w-[220px]">
          {model.name}
        </span>
        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-expanded={menuOpen}
          className="p-1 hover:text-white"
          title={t('Acciones del proyecto', 'Project actions')}
          data-testid="composer-menu"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>

        {menuOpen && (
          <div className="absolute right-2 top-9 z-30 w-52 bg-[var(--nc-bg-panel)] border border-[var(--nc-border-light)] shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setTemplateOpen(true);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[10px] hover:bg-[var(--nc-bg-main)]"
              data-testid="composer-menu-templates"
            >
              <Layers className="w-3.5 h-3.5" />
              {t('Plantillas y starters', 'Templates and starters')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setCloudOpen(true);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[10px] hover:bg-[var(--nc-bg-main)]"
            >
              <Cloud className="w-3.5 h-3.5" />
              {t('Nube / sincronizar', 'Cloud / sync')}
            </button>
            <button
              type="button"
              onClick={() => void exportZip()}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[10px] hover:bg-[var(--nc-bg-main)]"
              data-testid="composer-menu-export"
            >
              <Download className="w-3.5 h-3.5" />
              {t('Exportar .ZIP', 'Export .ZIP')}
            </button>
          </div>
        )}
      </header>

      {/* Cuerpo: la lista acompaña, el visor manda */}
      <div className="flex-1 flex min-h-0">
        <ComposerFileList
          files={files}
          selected={selectedFile?.name ?? ''}
          onSelect={setSelectedFileName}
          onCreate={createFile}
          onDelete={deleteFile}
          lang={lang}
        />

        <section className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="flex items-center gap-1 px-2 h-8 shrink-0 bg-[var(--nc-bg-panel)] border-b border-[var(--nc-border-dark)]">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setViewMode(tab.id)}
                aria-pressed={viewMode === tab.id}
                data-testid={`composer-tab-${tab.id}`}
                className={`flex items-center gap-1 px-2 py-0.5 text-[10px] border ${
                  viewMode === tab.id
                    ? 'bg-[var(--nc-active-bg)] text-[var(--nc-active-text)] border-[var(--nc-border-light)] font-bold'
                    : 'border-transparent text-[var(--nc-text)]/70 hover:text-[var(--nc-text)]'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}

            <div className="ml-auto flex items-center gap-2 shrink-0">
              <span className="text-[10px] tabular-nums">
                <span className="text-emerald-300">+{fileDiff.stats.addedCount}</span>{' '}
                <span className="text-red-300">−{fileDiff.stats.removedCount}</span>
              </span>
              {pendingCount > 1 && (
                <button
                  type="button"
                  onClick={acceptAll}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-emerald-400 text-black hover:bg-white border border-black"
                  data-testid="composer-accept-all"
                >
                  <CheckCheck className="w-3 h-3" />
                  {t('ACEPTAR TODO', 'ACCEPT ALL')}
                </button>
              )}
              {pendingCount > 1 && (
                <button
                  type="button"
                  onClick={rejectAll}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-red-500 text-black hover:bg-white border border-black"
                  data-testid="composer-reject-all"
                >
                  <X className="w-3 h-3" />
                  {t('DESCARTAR TODO', 'DISCARD ALL')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void copyCode()}
                className="p-1 text-[var(--nc-text)]/70 hover:text-[var(--nc-text)]"
                title={t('Copiar el archivo', 'Copy the file')}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto bg-[var(--nc-bg-panel)]">
            {!selectedFile ? null : viewMode === 'preview' ? (
              <ComposerLiveSandbox files={files} lang={lang} />
            ) : viewMode === 'repl' ? (
              <ComposerCodeRepl files={files} lang={lang} />
            ) : viewMode === 'editor' ? (
              <CodeEditor
                value={selectedFile.proposedContent !== undefined ? selectedFile.proposedContent : selectedFile.originalContent}
                onChange={(value) =>
                  setFiles((prev) =>
                    prev.map((f) => (f.name === selectedFile.name ? { ...f, proposedContent: value } : f))
                  )
                }
                language={extensionOf(selectedFile.name)}
                filename={selectedFile.name}
                testId="composer-editor"
              />
            ) : (
              <ComposerDiff
                path={selectedFile.name}
                lines={fileDiff.lines}
                stats={fileDiff.stats}
                pending={selectedPending}
                onAccept={() => acceptFile(selectedFile.name)}
                onReject={() => rejectFile(selectedFile.name)}
                lang={lang}
              />
            )}
          </div>
        </section>
      </div>

      {/* Instrucción: el único primario de la pantalla */}
      <footer className="relative shrink-0 bg-[var(--nc-bg-panel)] border-t-2 border-[var(--nc-border-light)] p-2">
        {showMentions && (
          <MentionAutocomplete
            query={mentionQuery}
            selectedIndex={mentionIndex}
            setSelectedIndex={setMentionIndex}
            onSelect={selectMention}
            onClose={() => setShowMentions(false)}
          />
        )}

        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => {
              setShowMentions((prev) => !prev);
              setMentionQuery('');
              setMentionIndex(0);
            }}
            className={`px-2 py-1 text-[10px] font-bold border border-[var(--nc-border-dark)] shrink-0 ${
              showMentions ? 'bg-[var(--nc-active-bg)] text-[var(--nc-active-text)]' : 'text-[var(--nc-text)]/80'
            }`}
            title={t('Adjuntar contexto (@archivos, @docs, @git)', 'Attach context (@files, @docs, @git)')}
          >
            @
          </button>

          <textarea
            ref={instructionRef}
            value={instruction}
            onChange={instructionChanged}
            onKeyDown={onPromptKeyDown}
            rows={3}
            spellCheck={false}
            placeholder={t(
              'Describe los cambios multi-archivo. @ adjunta contexto · Ctrl+Enter ejecuta',
              'Describe the multi-file changes. @ attaches context · Ctrl+Enter runs'
            )}
            className="flex-1 min-w-0 bg-[var(--nc-bg-main)] border border-[var(--nc-border-light)] px-2 py-1 text-[11px] text-[var(--nc-text)] outline-none resize-none"
            data-testid="composer-prompt"
          />

          <div className="flex flex-col gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void run()}
              disabled={generating || !instruction.trim()}
              className="flex items-center gap-1 px-3 py-1 text-[10px] font-bold bg-[var(--nc-text)] text-black border border-black hover:bg-white disabled:opacity-40"
              data-testid="composer-run"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {t('COMPONER', 'COMPOSE')}
            </button>
            <button
              type="button"
              onClick={() => setSuggestionsOpen((prev) => !prev)}
              aria-expanded={suggestionsOpen}
              className="px-2 py-0.5 text-[10px] border border-[var(--nc-border-dark)] text-[var(--nc-text)]/70 hover:text-[var(--nc-text)]"
              data-testid="composer-suggestions"
            >
              {t('Sugerencias', 'Suggestions')}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--nc-text)]/50">
          <span>Ctrl+Enter</span>
          <span>{instruction.length}/4000</span>
          <span className="ml-auto">
            {pendingCount > 0
              ? t(`${pendingCount} archivo(s) con cambios`, `${pendingCount} file(s) with changes`)
              : t('Sin cambios pendientes', 'No pending changes')}
          </span>
        </div>

        {suggestionsOpen && (
          <div className="absolute bottom-full left-2 z-30 w-64 bg-[var(--nc-bg-panel)] border border-[var(--nc-border-light)] shadow-lg">
            {QUICK_TASKS.map((task, index) => (
              <button
                key={task.es}
                type="button"
                onClick={() => {
                  setInstruction(task.prompt);
                  setSuggestionsOpen(false);
                  instructionRef.current?.focus();
                }}
                className="w-full text-left px-2 py-1.5 text-[10px] hover:bg-[var(--nc-bg-main)]"
                data-testid={`composer-suggestion-${index}`}
              >
                {lang === 'es' ? task.es : task.en}
              </button>
            ))}
          </div>
        )}
      </footer>

      {/* Estado: una línea, con el pulso solo cuando trabaja */}
      <div className="h-6 shrink-0 flex items-center gap-2 px-2 bg-[var(--nc-bg-main)] border-t border-[var(--nc-border-dark)] text-[10px]">
        {generating ? (
          <Loader2 className="w-3 h-3 animate-spin text-[var(--nc-text-accent)] shrink-0" />
        ) : status.kind === 'error' ? (
          <AlertTriangle className="w-3 h-3 text-red-300 shrink-0" />
        ) : status.kind === 'ok' ? (
          <Check className="w-3 h-3 text-emerald-300 shrink-0" />
        ) : (
          <CircleDot className="w-3 h-3 text-[var(--nc-text)]/40 shrink-0" />
        )}
        <span
          className={`truncate ${status.kind === 'error' ? 'text-red-300' : status.kind === 'ok' ? 'text-emerald-300' : 'text-[var(--nc-text)]/70'}`}
        >
          {status.text || t('Listo.', 'Ready.')}
        </span>
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={jumpToPending}
            className="ml-auto shrink-0 px-1.5 py-0.5 border border-[var(--nc-text-accent)] text-[var(--nc-text-accent)]"
            data-testid="composer-pending"
          >
            {pendingCount} {t('diffs pendientes', 'pending diffs')}
          </button>
        )}
      </div>

      <ComposerTemplateModal
        isOpen={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onSelectTemplate={(newFiles, title) => {
          setFiles(newFiles);
          setSelectedFileName(newFiles[0]?.name || '');
          setStatus({
            kind: 'ok',
            text: t(`Plantilla «${title}» cargada con ${newFiles.length} archivos.`, `Template “${title}” loaded with ${newFiles.length} files.`),
          });
        }}
        lang={lang}
      />

      <ComposerCloudModal
        isOpen={cloudOpen}
        onClose={() => setCloudOpen(false)}
        currentFiles={files}
        selectedModel={selectedModel}
        onLoadProject={(newFiles, title) => {
          setFiles(newFiles);
          setSelectedFileName(newFiles[0]?.name || '');
          setStatus({
            kind: 'ok',
            text: t(`Proyecto «${title}» cargado desde la nube.`, `Project “${title}” loaded from the cloud.`),
          });
        }}
        lang={lang}
      />
    </div>
  );
};

export default ComposerPlayground;
