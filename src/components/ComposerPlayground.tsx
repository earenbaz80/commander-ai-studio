import { getCachedApiKey } from '../lib/apiKeys';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  FileCode,
  Plus,
  Trash2,
  Check,
  X,
  Play,
  Sparkles,
  RefreshCw,
  Download,
  Copy,
  CheckCheck,
  Eye,
  Edit3,
  Layers,
  FolderGit2,
  Code2,
  AlertCircle,
  Cloud,
  Terminal
} from 'lucide-react';
import { ParameterConfig } from '../types/studio';
import { ALL_MODELS } from '../data/models';
import { resolveChatRoute } from '../lib/aiRouting';
import { computeLineDiff } from '../utils/diffUtils';
import { MentionAutocomplete } from './MentionAutocomplete';
import { ComposerTemplateModal } from './ComposerTemplateModal';
import { ComposerCloudModal } from './ComposerCloudModal';
import { ComposerLiveSandbox } from './ComposerLiveSandbox';
import { ComposerCodeRepl } from './ComposerCodeRepl';
import { CONTEXT_MENTIONS, MentionItem, resolveContextMentions } from '../data/contextMentions';
import { Language } from '../i18n/translations';
import JSZip from 'jszip';

export interface ProjectFile {
  name: string;
  originalContent: string;
  proposedContent?: string;
  isNew?: boolean;
}

interface ComposerPlaygroundProps {
  parameters: ParameterConfig;
  setParameters: React.Dispatch<React.SetStateAction<ParameterConfig>>;
  selectedModel: string;
  lang?: Language;
}

const DEFAULT_FILES: ProjectFile[] = [
  {
    name: 'src/App.tsx',
    originalContent: `import React, { useState } from 'react';

export function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="container">
      <h1>Commander Desktop App</h1>
      <p>Contador actual: {count}</p>
      <button onClick={() => setCount(count + 1)}>Incrementar</button>
    </div>
  );
}`,
  },
  {
    name: 'src/index.css',
    originalContent: `body {
  margin: 0;
  background-color: #000080;
  color: #00ffff;
  font-family: monospace;
}

.container {
  padding: 20px;
  text-align: center;
}`,
  },
  {
    name: 'package.json',
    originalContent: `{
  "name": "commander-composer-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}`,
  },
  {
    name: 'tauri.conf.json',
    originalContent: `{
  "package": {
    "productName": "CommanderApp",
    "version": "1.0.0"
  },
  "tauri": {
    "windows": [
      {
        "title": "Commander Native Window",
        "width": 1024,
        "height": 720
      }
    ]
  }
}`,
  }
];

export const ComposerPlayground: React.FC<ComposerPlaygroundProps> = ({
  parameters,
  selectedModel,
  lang = 'es',
}) => {
  const [files, setFiles] = useState<ProjectFile[]>(() => {
    try {
      const saved = localStorage.getItem('ai_studio_composer_files');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Failed to load composer files from localStorage', e);
    }
    return DEFAULT_FILES;
  });

  useEffect(() => {
    try {
      localStorage.setItem('ai_studio_composer_files', JSON.stringify(files));
    } catch (e) {
      console.warn('Failed to save composer files to localStorage', e);
    }
  }, [files]);
  const [selectedFileName, setSelectedFileName] = useState<string>('src/App.tsx');
  const [instruction, setInstruction] = useState('');
  const [viewMode, setViewMode] = useState<'diff' | 'editor' | 'preview' | 'repl'>('diff');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isCloudModalOpen, setIsCloudModalOpen] = useState(false);

  // Mention Autocomplete State
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const instructionRef = useRef<HTMLTextAreaElement>(null);

  const selectedFile = useMemo(() => {
    return files.find((f) => f.name === selectedFileName) || files[0];
  }, [files, selectedFileName]);

  const activeModelObj = useMemo(() => {
    return ALL_MODELS.find((m) => m.id === selectedModel) || ALL_MODELS[0];
  }, [selectedModel]);

  // Compute diff for currently selected file
  const fileDiff = useMemo(() => {
    if (!selectedFile) return { lines: [], stats: { addedCount: 0, removedCount: 0, unchangedCount: 0 } };
    const oldText = selectedFile.originalContent || '';
    const newText = selectedFile.proposedContent !== undefined ? selectedFile.proposedContent : oldText;
    return computeLineDiff(oldText, newText);
  }, [selectedFile]);

  // Number of files with pending changes
  const pendingChangesCount = useMemo(() => {
    return files.filter((f) => f.proposedContent !== undefined && f.proposedContent !== f.originalContent).length;
  }, [files]);

  // Add new file
  const handleAddFile = () => {
    const name = prompt(lang === 'es' ? 'Nombre del archivo (ej: src/utils.ts):' : lang === 'de' ? 'Dateipfad (z. B. src/utils.ts):' : 'File path (e.g. src/utils.ts):');
    if (!name) return;
    if (files.some((f) => f.name === name)) {
      alert(lang === 'es' ? 'El archivo ya existe.' : lang === 'de' ? 'Die Datei existiert bereits.' : 'File already exists.');
      return;
    }
    const newFile: ProjectFile = {
      name,
      originalContent: '',
      proposedContent: `// ${name}\nexport function init() {\n  console.log('Init ${name}');\n}\n`,
      isNew: true,
    };
    setFiles((prev) => [...prev, newFile]);
    setSelectedFileName(name);
  };

  // Delete file
  const handleDeleteFile = (name: string) => {
    if (files.length <= 1) {
      alert(lang === 'es' ? 'No puedes borrar el último archivo.' : lang === 'de' ? 'Die letzte Datei kann nicht gelöscht werden.' : 'Cannot delete the last file.');
      return;
    }
    if (confirm(lang === 'es' ? `¿Borrar ${name}?` : lang === 'de' ? `${name} wirklich löschen?` : `Delete ${name}?`)) {
      setFiles((prev) => prev.filter((f) => f.name !== name));
      if (selectedFileName === name) {
        const remaining = files.filter((f) => f.name !== name);
        setSelectedFileName(remaining[0]?.name || '');
      }
    }
  };

  // Accept single file diff
  const handleAcceptFile = (name: string) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.name === name && f.proposedContent !== undefined) {
          return {
            ...f,
            originalContent: f.proposedContent,
            proposedContent: undefined,
            isNew: false,
          };
        }
        return f;
      })
    );
  };

  // Reject single file diff
  const handleRejectFile = (name: string) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.name === name) {
          if (f.isNew && !f.originalContent) {
            return null;
          }
          return {
            ...f,
            proposedContent: undefined,
          };
        }
        return f;
      }).filter(Boolean) as ProjectFile[]
    );
  };

  // Accept all diffs
  const handleAcceptAll = () => {
    setFiles((prev) =>
      prev.map((f) => ({
        ...f,
        originalContent: f.proposedContent !== undefined ? f.proposedContent : f.originalContent,
        proposedContent: undefined,
        isNew: false,
      }))
    );
    // Directly navigate to running app tab so user sees the execution immediately!
    setViewMode('preview');
  };

  // Reject all diffs
  const handleRejectAll = () => {
    setFiles((prev) =>
      prev
        .filter((f) => !(f.isNew && !f.originalContent))
        .map((f) => ({
          ...f,
          proposedContent: undefined,
        }))
    );
  };

  // Copy current file code
  const handleCopyCode = () => {
    const code = selectedFile.proposedContent !== undefined ? selectedFile.proposedContent : selectedFile.originalContent;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInstructionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart || 0;
    setInstruction(val);

    const textBeforeCursor = val.slice(0, cursor);
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_\-:/.]*)$/);
    if (match) {
      setShowMentions(true);
      setMentionQuery(match[1]);
      setMentionIndex(0);
    } else {
      setShowMentions(false);
    }
  };

  const handleSelectMention = (item: MentionItem) => {
    if (!instructionRef.current) return;
    const cursor = instructionRef.current.selectionStart || instruction.length;
    const textBeforeCursor = instruction.slice(0, cursor);
    const textAfterCursor = instruction.slice(cursor);

    const replacedBefore = textBeforeCursor.replace(/@([a-zA-Z0-9_\-:/.]*)$/, `${item.id} `);
    const newText = replacedBefore + textAfterCursor;
    setInstruction(newText);
    setShowMentions(false);

    setTimeout(() => {
      if (instructionRef.current) {
        instructionRef.current.focus();
        const newCursorPos = replacedBefore.length;
        instructionRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 10);
  };

  // Export full project as ZIP
  const handleExportZip = async () => {
    try {
      const zip = new JSZip();
      files.forEach((f) => {
        const content = f.proposedContent !== undefined ? f.proposedContent : f.originalContent;
        zip.file(f.name, content);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `commander-project-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Error al exportar ZIP: ' + (e as any).message);
    }
  };

  // Run Composer Agent
  const handleRunComposer = async (promptOverride?: string) => {
    const promptToRun = promptOverride || instruction;
    if (!promptToRun.trim() || isGenerating) return;

    setIsGenerating(true);
    setStatusMessage(lang === 'es' ? 'Analizando contexto del proyecto y planificando cambios...' : lang === 'de' ? 'Projektdateien werden analysiert und Diffs geplant...' : 'Analyzing project files and planning diffs...');

    try {
      const route = resolveChatRoute({ modelId: selectedModel, provider: activeModelObj.provider });
      const isAnthropic = route.isAnthropic;
      const isHf = route.isHf;
      const endpoint = route.endpoint;
      const anthropicApiKey = parameters.anthropicApiKey || getCachedApiKey('ANTHROPIC_API_KEY') || undefined;

      // Prepare project context
      const fileContext = files
        .map((f) => `=== FILE: ${f.name} ===\n${f.proposedContent !== undefined ? f.proposedContent : f.originalContent}`)
        .join('\n\n');

      const systemPrompt = `Eres Commander Composer, un agente de ingeniería de software experto similar a Cursor Composer.
El usuario te dará una instrucción para modificar o crear archivos en el proyecto.

REGLAS DE RESPUESTA:
Debes responder ÚNICAMENTE en bloques de código delimitados por archivos, usando el formato exacto:
FILE: ruta/del/archivo.ext
\`\`\`lenguaje
[código completo del archivo con las modificaciones aplicadas]
\`\`\`

Puedes modificar múltiples archivos o agregar nuevos archivos si la tarea lo requiere. No agregues texto conversacional fuera de los bloques de archivos.`;

      // Resolve @mentions for extra documentation or params
      const { cleanPrompt, enrichedContext } = resolveContextMentions(promptToRun, {
        parameters,
        selectedModel,
        files: files.map((f) => ({
          name: f.name,
          content: f.proposedContent !== undefined ? f.proposedContent : f.originalContent,
        })),
      });

      const userPrompt = `PROYECTO ACTUAL:
${fileContext}

INSTRUCCIÓN DEL USUARIO:
${cleanPrompt}
${enrichedContext ? `\n[CONTEXTO ADICIONAL POR MENCIONES @]:\n${enrichedContext}` : ''}

Genera los archivos modificados con el código completo para cada uno.`;

      const payload = isAnthropic
        ? {
            prompt: userPrompt,
            model: selectedModel,
            anthropicApiKey,
            systemInstruction: systemPrompt,
            temperature: 0.2,
            maxTokens: 4096,
          }
        : isHf
        ? {
            prompt: userPrompt,
            model: selectedModel,
            hfApiToken: parameters.hfApiToken,
            systemInstruction: systemPrompt,
            temperature: 0.2,
            maxTokens: 4096,
          }
        : {
            contents: userPrompt,
            systemInstruction: systemPrompt,
            model: selectedModel,
            temperature: 0.2,
            maxTokens: 4096,
            apiKey: getCachedApiKey('GEMINI_API_KEY') || undefined,
          };

      setStatusMessage(lang === 'es' ? `Generando diffs con ${activeModelObj.name}...` : lang === 'de' ? `Diffs werden mit ${activeModelObj.name} generiert...` : `Generating diffs with ${activeModelObj.name}...`);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Error al generar cambios con el modelo');
      }

      const generatedText = data.text || '';

      // Parse FILE: blocks from generatedText
      const fileRegex = /FILE:\s*([^\r\n]+)\r?\n```[\w-]*\r?\n([\s\S]*?)```/g;
      let match;
      const updatedFilesMap = new Map<string, string>();

      while ((match = fileRegex.exec(generatedText)) !== null) {
        const filePath = match[1].trim();
        const fileContent = match[2];
        updatedFilesMap.set(filePath, fileContent);
      }

      // If strict regex didn't find multiple files, fallback to standard markdown code blocks for the selected file
      if (updatedFilesMap.size === 0) {
        const singleBlock = generatedText.match(/```[\w-]*\r?\n([\s\S]*?)```/);
        if (singleBlock && selectedFile) {
          updatedFilesMap.set(selectedFile.name, singleBlock[1]);
        }
      }

      if (updatedFilesMap.size === 0) {
        alert(lang === 'es' ? 'El modelo no retornó bloques de código formateados.' : lang === 'de' ? 'Das Modell hat keine Codeblöcke zurückgegeben.' : 'Model did not return code blocks.');
      } else {
        setFiles((prev) => {
          const newFilesList = [...prev];
          updatedFilesMap.forEach((newContent, filePath) => {
            const existingIdx = newFilesList.findIndex((f) => f.name === filePath);
            if (existingIdx >= 0) {
              newFilesList[existingIdx] = {
                ...newFilesList[existingIdx],
                proposedContent: newContent,
              };
            } else {
              newFilesList.push({
                name: filePath,
                originalContent: '',
                proposedContent: newContent,
                isNew: true,
              });
            }
          });
          return newFilesList;
        });

        // Focus first changed file
        const firstChanged = Array.from(updatedFilesMap.keys())[0];
        if (firstChanged) {
          setSelectedFileName(firstChanged);
        }

        setViewMode('diff');
        setStatusMessage(
          lang === 'es'
            ? `✓ ¡${updatedFilesMap.size} archivo(s) procesado(s) con diffs listos para revisar!`
            : lang === 'de'
              ? `✓ ${updatedFilesMap.size} Datei(en) verarbeitet – Diffs bereit zur Prüfung!`
              : `✓ ${updatedFilesMap.size} file(s) updated with pending diffs!`
        );
      }
    } catch (err: any) {
      console.error(err);
      alert((lang === 'es' ? 'Error en Composer: ' : lang === 'de' ? 'Composer-Fehler: ' : 'Composer Error: ') + err.message);
      setStatusMessage('');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#000080] font-mono text-xs text-white overflow-hidden p-2 gap-2">
      {/* Top Banner Header */}
      <div className="bg-[#00aaaa] text-black font-bold px-3 py-1.5 flex items-center justify-between border-2 border-black shrink-0">
        <div className="flex items-center gap-2">
          <Code2 className="w-5 h-5 text-black" />
          <span className="text-sm">COMMANDER COMPOSER — MULTI-FILE AGENT & DIFFS</span>
          <span className="bg-[#0000aa] text-[#ffff55] px-2 py-0.5 border border-black font-bold text-[10px]">
            {activeModelObj.name} [{activeModelObj.provider.toUpperCase()}]
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsCloudModalOpen(true)}
            className="nc-button !py-0.5 !px-2 bg-[#00aaaa] text-black hover:bg-[#00ffff] font-bold flex items-center gap-1 text-[10px] border border-black"
            data-tooltip={lang === 'es' ? 'Sincronizar con Firestore Cloud' : lang === 'de' ? 'Mit Firestore-Cloud synchronisieren' : 'Sync to Firestore Cloud'}
            data-tooltip-sub={lang === 'es' ? 'Guarda tu proyecto en la nube o abre proyectos de la comunidad' : lang === 'de' ? 'Mehrdatei-Projekte in der Cloud speichern oder geteilte Projekte öffnen' : 'Save multi-file projects to cloud or open shared projects'}
          >
            <Cloud className="w-3.5 h-3.5 text-[#000080]" />
            <span>☁️ {lang === 'es' ? 'NUBE / SYNC' : lang === 'de' ? 'CLOUD-SYNC' : 'CLOUD SYNC'}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsTemplateModalOpen(true)}
            className="nc-button !py-0.5 !px-2 bg-[#ffff55] text-black hover:bg-white font-bold flex items-center gap-1 text-[10px] border border-black"
            data-tooltip={lang === 'es' ? 'Starters & Plantillas de Arquitectura' : lang === 'de' ? 'Architektur-Starter & Vorlagen' : 'Architecture Starters & Templates'}
            data-tooltip-sub={lang === 'es' ? 'Carga plantillas de Tauri v2, Electron 34, AI Agent, Mobile o CLI' : lang === 'de' ? 'Sofort einsatzbereite Vorlagen für Tauri, Electron, Agent, Mobile und CLI laden' : 'Load ready-to-run Tauri, Electron, Agent, Mobile, CLI templates'}
          >
            <Layers className="w-3.5 h-3.5 text-[#000080]" />
            <span>📦 {lang === 'es' ? 'PLANTILLAS / STARTERS' : lang === 'de' ? 'STARTER & VORLAGEN' : 'STARTERS & TEMPLATES'}</span>
          </button>
          {pendingChangesCount > 0 && (
            <span 
              className="bg-[#ffff55] text-black px-2 py-0.5 font-bold animate-pulse text-[10px] border border-black cursor-help"
              data-tooltip={lang === 'es' ? 'Diffs Pendientes de Revisión' : lang === 'de' ? 'Ausstehende Diffs zur Prüfung' : 'Pending Diffs to Review'}
              data-tooltip-sub={lang === 'es' ? 'Hay modificaciones generadas por IA listas para aceptar o descartar' : lang === 'de' ? 'Von der KI erzeugte Diffs warten auf deine Prüfung' : 'AI generated diffs awaiting your review'}
            >
              ⚡ {pendingChangesCount} {lang === 'es' ? 'DIFFS PENDIENTES' : lang === 'de' ? 'AUSSTEHENDE DIFFS' : 'PENDING DIFFS'}
            </span>
          )}
          <button
            type="button"
            onClick={() => setViewMode('preview')}
            className={`nc-button !py-0.5 !px-2 font-bold flex items-center gap-1 text-[10px] border border-black ${
              viewMode === 'preview'
                ? 'bg-[#00ff66] text-black ring-2 ring-white animate-pulse'
                : 'bg-[#00ff66] text-black hover:bg-white'
            }`}
            data-tooltip={lang === 'es' ? 'Ejecutar App en Live Sandbox' : lang === 'de' ? 'App in der Live-Sandbox ausführen' : 'Run App in Live Sandbox'}
            data-tooltip-sub={lang === 'es' ? 'Te envía directamente a la pestaña donde se ejecuta la app en tiempo real' : lang === 'de' ? 'Öffnet direkt den Tab mit der laufenden Anwendung' : 'Takes you directly to the live running application tab'}
          >
            <Play className="w-3.5 h-3.5 fill-black" />
            <span>⚡ {lang === 'es' ? 'EJECUTAR APP' : lang === 'de' ? 'APP AUSFÜHREN' : 'RUN APP'}</span>
          </button>
          <button
            type="button"
            onClick={handleExportZip}
            className="nc-button !py-0.5 !px-2 bg-[#0000aa] text-white hover:bg-[#000055] font-bold flex items-center gap-1 text-[10px]"
            data-tooltip={lang === 'es' ? 'Exportar Proyecto Completo en .ZIP' : lang === 'de' ? 'Gesamtes Projekt als .ZIP exportieren' : 'Export Full Project as .ZIP'}
            data-tooltip-sub={lang === 'es' ? 'Descarga todos los archivos del workspace empaquetados y listos para ejecutar' : lang === 'de' ? 'Alle Workspace-Dateien herunterladen, bereit zum Ausführen' : 'Download all workspace files ready to run'}
          >
            <Download className="w-3.5 h-3.5 text-[#00ffff]" />
            <span>EXPORTAR .ZIP</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Area (Dual-Panel File Tree & Diff Viewer) */}
      <div className="flex-1 flex flex-row gap-2 min-h-0 overflow-hidden">
        {/* Left Side: Workspace File Explorer */}
        <div className="w-64 bg-[#0000aa] border-2 border-[#00ffff] flex flex-col shrink-0 min-h-0">
          <div className="bg-[#00aaaa] text-black px-2 py-1 font-bold flex items-center justify-between border-b border-black">
            <span className="flex items-center gap-1 text-[11px]">
              <FolderGit2 className="w-3.5 h-3.5" /> {lang === 'es' ? 'ARCHIVOS DEL PROYECTO' : lang === 'de' ? 'PROJEKTDATEIEN' : 'PROJECT FILES'}
            </span>
            <button
              type="button"
              onClick={handleAddFile}
              className="bg-[#ffff55] text-black hover:bg-white px-1 py-0.5 text-[10px] font-bold flex items-center gap-0.5"
              title="Crear nuevo archivo"
            >
              <Plus className="w-3 h-3" />
              <span>{lang === 'es' ? 'NUEVO' : lang === 'de' ? 'NEU' : 'NEW'}</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-1 space-y-1">
            {files.map((file) => {
              const hasDiff = file.proposedContent !== undefined && file.proposedContent !== file.originalContent;
              const isSelected = file.name === selectedFileName;

              return (
                <div
                  key={file.name}
                  onClick={() => setSelectedFileName(file.name)}
                  className={`p-1.5 cursor-pointer border flex items-center justify-between text-[11px] transition-colors ${
                    isSelected
                      ? 'bg-[#00ffff] text-black font-bold border-white'
                      : 'bg-[#000080] text-[#00ffff] border-[#00aaaa] hover:bg-[#000055]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <FileCode className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-black' : 'text-[#ffff55]'}`} />
                    <span className="truncate">{file.name}</span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {hasDiff && (
                      <span className="bg-[#ffff55] text-black text-[9px] px-1 font-bold rounded-sm animate-pulse">
                        DIFF
                      </span>
                    )}
                    {file.isNew && (
                      <span className="bg-[#00ff66] text-black text-[9px] px-1 font-bold rounded-sm">
                        NEW
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(file.name);
                      }}
                      className="text-red-300 hover:text-red-500 p-0.5"
                      title="Eliminar archivo"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Batch Diff Actions Footer */}
          {pendingChangesCount > 0 && (
            <div className="p-2 border-t border-[#00ffff] bg-[#000080] space-y-1">
              <button
                type="button"
                onClick={handleAcceptAll}
                className="w-full bg-[#00ff66] text-black font-bold py-1 px-2 text-[10px] flex items-center justify-center gap-1 hover:bg-white"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>{lang === 'es' ? '✓ ACEPTAR TODOS LOS DIFFS' : lang === 'de' ? '✓ ALLE DIFFS ANNEHMEN' : '✓ ACCEPT ALL DIFFS'}</span>
              </button>
              <button
                type="button"
                onClick={handleRejectAll}
                className="w-full bg-red-700 text-white font-bold py-1 px-2 text-[10px] flex items-center justify-center gap-1 hover:bg-red-600"
              >
                <X className="w-3.5 h-3.5" />
                <span>{lang === 'es' ? '✕ DESCARTAR TODOS' : lang === 'de' ? '✕ ALLE VERWERFEN' : '✕ DISCARD ALL'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Side: Diff & Code Inspector */}
        <div className="flex-1 bg-[#0000aa] border-2 border-[#00ffff] flex flex-col min-h-0 overflow-hidden">
          {/* File Action Bar */}
          <div className="bg-[#00aaaa] text-black px-3 py-1 font-bold flex items-center justify-between border-b border-black shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs bg-[#0000aa] text-[#ffff55] px-1.5 py-0.5 border border-black">
                {selectedFile.name}
              </span>

              {/* View Mode Toggle */}
              <div className="flex gap-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('diff')}
                  className={`px-2 py-0.5 text-[10px] font-bold border ${
                    viewMode === 'diff' ? 'bg-[#ffff55] text-black border-white' : 'nc-button !py-0.5'
                  }`}
                >
                  <Eye className="w-3 h-3 inline mr-1" />
                  {lang === 'es' ? 'DIFFS' : lang === 'de' ? 'DIFFS' : 'DIFFS'}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('editor')}
                  className={`px-2 py-0.5 text-[10px] font-bold border ${
                    viewMode === 'editor' ? 'bg-[#ffff55] text-black border-white' : 'nc-button !py-0.5'
                  }`}
                >
                  <Edit3 className="w-3 h-3 inline mr-1" />
                  {lang === 'es' ? 'EDITOR' : lang === 'de' ? 'EDITOR' : 'EDITOR'}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('preview')}
                  className={`px-2 py-0.5 text-[10px] font-bold border ${
                    viewMode === 'preview' ? 'bg-[#00ff66] text-black border-white' : 'nc-button !py-0.5 text-[#00ff66]'
                  }`}
                  title="Ejecución real de la aplicación en Sandbox interactivo"
                >
                  <Play className="w-3 h-3 inline mr-1" />
                  {lang === 'es' ? '⚡ LIVE SANDBOX' : lang === 'de' ? '⚡ LIVE-SANDBOX' : '⚡ LIVE SANDBOX'}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('repl')}
                  className={`px-2 py-0.5 text-[10px] font-bold border ${
                    viewMode === 'repl' ? 'bg-[#00ffff] text-black border-white' : 'nc-button !py-0.5 text-[#00ffff]'
                  }`}
                  title="Consola de ejecución de código JavaScript/TypeScript real"
                >
                  <Terminal className="w-3 h-3 inline mr-1" />
                  {lang === 'es' ? '📟 REPL REAL' : lang === 'de' ? '📟 CODE-REPL' : '📟 CODE REPL'}
                </button>
              </div>
            </div>

            {/* Per-File Diff Actions */}
            <div className="flex items-center gap-1.5">
              {selectedFile.proposedContent !== undefined && selectedFile.proposedContent !== selectedFile.originalContent && (
                <>
                  <button
                    type="button"
                    onClick={() => handleAcceptFile(selectedFile.name)}
                    className="bg-[#00ff66] text-black hover:bg-white px-2 py-0.5 text-[10px] font-bold flex items-center gap-1 border border-black shadow"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{lang === 'es' ? 'ACEPTAR CAMBIO' : lang === 'de' ? 'ANNEHMEN' : 'ACCEPT'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRejectFile(selectedFile.name)}
                    className="bg-red-700 text-white hover:bg-red-600 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1 border border-black"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>{lang === 'es' ? 'DESCARTAR' : lang === 'de' ? 'ABLEHNEN' : 'REJECT'}</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={handleCopyCode}
                className="nc-button !py-0.5 !px-2 bg-[#000080] text-[#00ffff] hover:bg-[#000055] text-[10px] font-bold flex items-center gap-1"
              >
                {copied ? <Check className="w-3 h-3 text-[#00ff66]" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? '¡COPIADO!' : 'COPIAR'}</span>
              </button>
            </div>
          </div>

          {/* File Content / Diff Viewer / Live Sandbox / REPL Area */}
          <div className="flex-1 overflow-auto bg-[#000055] p-2 font-mono text-[11px] leading-relaxed flex flex-col min-h-0">
            {viewMode === 'preview' ? (
              <ComposerLiveSandbox files={files} lang={lang} />
            ) : viewMode === 'repl' ? (
              <ComposerCodeRepl files={files} lang={lang} />
            ) : viewMode === 'diff' ? (
              <div className="space-y-0.5 flex-1 overflow-y-auto">
                {/* Diff Stats Banner */}
                <div className="bg-[#000080] border border-[#00aaaa] p-1.5 mb-2 text-[10px] flex items-center justify-between text-[#ffff55]">
                  <span>
                    {lang === 'es' ? 'ESTADÍSTICAS DEL ARCHIVO:' : lang === 'de' ? 'DIFF-STATISTIK DER DATEI:' : 'FILE DIFF STATS:'} +{fileDiff.stats.addedCount} líneas agregadas, -{fileDiff.stats.removedCount} líneas removidas
                  </span>
                  <span className="text-[#00ffff]">
                    {selectedFile.proposedContent !== undefined ? '[CAMBIOS PROPUESTOS POR IA]' : '[SIN CAMBIOS PENDIENTES]'}
                  </span>
                </div>

                {fileDiff.lines.map((line, idx) => {
                  if (line.type === 'added') {
                    return (
                      <div key={idx} className="bg-[#003300] text-[#00ff66] border-l-4 border-[#00ff66] px-2 py-0.5 flex gap-3">
                        <span className="text-[#00aaaa] select-none w-10 text-right shrink-0">+{line.newLineNumber}</span>
                        <span className="font-bold select-none text-[#00ff66]">+</span>
                        <span className="whitespace-pre-wrap break-all flex-1">{line.content}</span>
                      </div>
                    );
                  }
                  if (line.type === 'removed') {
                    return (
                      <div key={idx} className="bg-[#440000] text-[#ff6666] border-l-4 border-red-500 px-2 py-0.5 flex gap-3 opacity-90">
                        <span className="text-[#aa5555] select-none w-10 text-right shrink-0">-{line.oldLineNumber}</span>
                        <span className="font-bold select-none text-red-400">-</span>
                        <span className="whitespace-pre-wrap break-all line-through flex-1">{line.content}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={idx} className="text-[#cccccc] px-2 py-0.5 flex gap-3 hover:bg-[#000066]">
                      <span className="text-[#5555aa] select-none w-10 text-right shrink-0">{line.oldLineNumber}</span>
                      <span className="select-none text-transparent w-2"> </span>
                      <span className="whitespace-pre-wrap break-all flex-1">{line.content}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <textarea
                value={selectedFile.proposedContent !== undefined ? selectedFile.proposedContent : selectedFile.originalContent}
                onChange={(e) => {
                  const val = e.target.value;
                  setFiles((prev) =>
                    prev.map((f) => (f.name === selectedFile.name ? { ...f, proposedContent: val } : f))
                  );
                }}
                className="w-full h-full bg-[#000055] text-[#00ffff] font-mono p-2 border-none outline-none resize-none leading-relaxed"
                spellCheck={false}
              />
            )}
          </div>
        </div>
      </div>

      {/* Bottom Composer Instruction Bar (Agent Input) */}
      <div className="bg-[#0000aa] border-2 border-[#00ffff] p-2 flex flex-col gap-2 shrink-0 relative">
        {/* Context Mentions Autocomplete Popup */}
        {showMentions && (
          <MentionAutocomplete
            query={mentionQuery}
            selectedIndex={mentionIndex}
            setSelectedIndex={setMentionIndex}
            onSelect={handleSelectMention}
            onClose={() => setShowMentions(false)}
          />
        )}

        {/* Preset Quick Task Chips */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => {
              setShowMentions((prev) => !prev);
              setMentionQuery('');
              setMentionIndex(0);
            }}
            className={`nc-button font-bold text-xs py-0.5 px-2 ${showMentions ? 'bg-[#ffff55] text-black' : 'bg-[#00aaaa] text-black hover:bg-[#00ffff]'}`}
            title="Abrir menú de contexto (@files, @docs, @model, @git)"
          >
            @ CONTEXTO
          </button>
          <span className="text-[10px] font-bold text-[#ffff55] shrink-0 ml-1">
            {lang === 'es' ? 'TAREAS RÁPIDAS:' : lang === 'de' ? 'SCHNELLAUFGABEN:' : 'QUICK TASKS:'}
          </span>
          <button
            type="button"
            onClick={() => handleRunComposer('Agrega persistencia en localStorage para guardar el contador y un botón de reinicio.')}
            className="nc-button !py-0.5 !px-1.5 text-[9px] text-[#00ffff] hover:text-white shrink-0"
          >
            + Persistencia LocalStorage
          </button>
          <button
            type="button"
            onClick={() => handleRunComposer('Crea un archivo src/theme.ts con selector de temas retro (Norton Blue, Matrix, Amber) y aplícalo a App.tsx.')}
            className="nc-button !py-0.5 !px-1.5 text-[9px] text-[#00ffff] hover:text-white shrink-0"
          >
            + Sistema de Temas Retro
          </button>
          <button
            type="button"
            onClick={() => handleRunComposer('Agrega validación de errores y logging de telemetría a la aplicación.')}
            className="nc-button !py-0.5 !px-1.5 text-[9px] text-[#00ffff] hover:text-white shrink-0"
          >
            + Telemetría & Logging
          </button>
          <button
            type="button"
            onClick={() => handleRunComposer('Agrega soporte para Tauri IPC invokes en src/tauriBridge.ts.')}
            className="nc-button !py-0.5 !px-1.5 text-[9px] text-[#00ffff] hover:text-white shrink-0"
          >
            + Soporte Tauri v2 IPC
          </button>
        </div>

        {/* Input & Action Button */}
        <div className="flex gap-2">
          <textarea
            ref={instructionRef}
            value={instruction}
            onChange={handleInstructionChange}
            onKeyDown={(e) => {
              if (showMentions) {
                const filtered = CONTEXT_MENTIONS.filter((item) => {
                  const cleanQ = mentionQuery.toLowerCase().replace(/^@/, '');
                  if (!cleanQ) return true;
                  return (
                    item.label.toLowerCase().includes(cleanQ) ||
                    item.description.toLowerCase().includes(cleanQ)
                  );
                });

                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionIndex((prev) => (prev + 1) % (filtered.length || 1));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionIndex((prev) => (prev - 1 + (filtered.length || 1)) % (filtered.length || 1));
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  if (filtered[mentionIndex]) {
                    handleSelectMention(filtered[mentionIndex]);
                  }
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
                handleRunComposer();
              }
            }}
            placeholder={
              lang === 'es'
                ? 'Describe los cambios multi-archivo que deseas realizar o escribe @ para invocar docs/archivos... (Presiona Ctrl + Enter)'
                : lang === 'de' ? 'Beschreibe die Mehrdatei-Änderungen oder gib @ ein, um Dokumente/Dateien zu erwähnen... (Strg + Enter drücken)' : 'Describe multi-file changes to apply or type @ to mention docs/files... (Press Ctrl + Enter)'
            }
            className="flex-1 bg-[#000080] border border-[#00ffff] p-2 text-xs text-white font-mono outline-none resize-none h-14"
            data-tooltip={lang === 'es' ? 'Instrucción para el Agente Composer' : lang === 'de' ? 'Anweisung für den Composer-Agenten' : 'Composer Agent Instruction'}
            data-tooltip-sub={lang === 'es' ? 'Escribe tus cambios o pulsa @ para adjuntar contexto. Ejecuta con Ctrl+Enter' : lang === 'de' ? 'Prompt eingeben oder @ für Dateien nutzen. Mit Strg+Enter ausführen' : 'Type prompt or @ to mention files. Run with Ctrl+Enter'}
          />

          <button
            type="button"
            onClick={() => handleRunComposer()}
            disabled={isGenerating || !instruction.trim()}
            className="bg-[#00ffff] text-black font-bold px-4 hover:bg-white transition-colors disabled:opacity-50 flex flex-col items-center justify-center gap-1 shrink-0 border border-black shadow"
            data-tooltip={lang === 'es' ? 'Ejecutar Agente Composer' : lang === 'de' ? 'Composer-Agenten ausführen' : 'Run Composer Agent'}
            data-tooltip-sub={lang === 'es' ? `Genera diffs multi-archivo con ${activeModelObj.name}` : `Generates multi-file diffs using ${activeModelObj.name}`}
          >
            {isGenerating ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Sparkles className="w-5 h-5" />
            )}
            <span className="text-[10px]">
              {isGenerating ? (lang === 'es' ? 'COMPONIENDO...' : lang === 'de' ? 'ERSTELLE...' : 'COMPOSING...') : (lang === 'es' ? 'EJECUTAR COMPOSER' : lang === 'de' ? 'COMPOSER AUSFÜHREN' : 'RUN COMPOSER')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('preview')}
            className={`font-bold px-3 hover:bg-white transition-colors flex flex-col items-center justify-center gap-1 shrink-0 border border-black shadow ${
              viewMode === 'preview'
                ? 'bg-[#00ff66] text-black ring-2 ring-white animate-pulse'
                : 'bg-[#00ff66] text-black hover:bg-white'
            }`}
            data-tooltip={lang === 'es' ? 'Abrir App en Live Sandbox' : lang === 'de' ? 'App in der Live-Sandbox öffnen' : 'Open App in Live Sandbox'}
            data-tooltip-sub={lang === 'es' ? 'Te envía directamente a la pestaña donde se ejecuta la app en tiempo real' : lang === 'de' ? 'Öffnet direkt den Tab mit der Live-Ausführung' : 'Takes you directly to the live execution tab'}
          >
            <Play className="w-5 h-5 fill-black" />
            <span className="text-[10px]">
              {lang === 'es' ? 'VER APP EN VIVO' : lang === 'de' ? 'LIVE-APP ANZEIGEN' : 'VIEW LIVE APP'}
            </span>
          </button>
        </div>

        {statusMessage && (
          <div className="text-[10px] text-[#00ff66] font-bold flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>

      {/* Templates Selector Modal */}
      <ComposerTemplateModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        onSelectTemplate={(newFiles, title) => {
          setFiles(newFiles);
          setSelectedFileName(newFiles[0]?.name || '');
          setStatusMessage(
            lang === 'es'
              ? `✓ Plantilla "${title}" cargada con ${newFiles.length} archivos en el espacio de trabajo.`
              : lang === 'de'
                ? `✓ Vorlage "${title}" mit ${newFiles.length} Dateien in den Arbeitsbereich geladen.`
                : `✓ Loaded "${title}" with ${newFiles.length} files into workspace.`
          );
        }}
        lang={lang}
      />

      {/* Cloud Workspace Sync Modal */}
      <ComposerCloudModal
        isOpen={isCloudModalOpen}
        onClose={() => setIsCloudModalOpen(false)}
        currentFiles={files}
        selectedModel={selectedModel}
        onLoadProject={(newFiles, title) => {
          setFiles(newFiles);
          setSelectedFileName(newFiles[0]?.name || '');
          setStatusMessage(
            lang === 'es'
              ? `✓ Proyecto "${title}" cargado desde Firestore.`
              : lang === 'de'
                ? `✓ Projekt "${title}" aus Firestore geladen.`
                : `✓ Project "${title}" loaded from Firestore.`
          );
        }}
        lang={lang}
      />
    </div>
  );
};
