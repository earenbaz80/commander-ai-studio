/**
 * Editor de código basado en CodeMirror 6 (P0 #5) con IA integrada (P0 #2).
 *
 * Wrapper React fino y controlado: recibe `value`/`onChange` como un textarea,
 * resuelve el lenguaje por extensión y aplica un tema retro Norton.
 *
 * IA:
 *   • Ghost-text de autocompletado (opcional, apagado por defecto): tras una
 *     pausa pide una sugerencia y la dibuja tras el cursor; `Tab` la acepta,
 *     `Esc` la descarta.
 *   • Edición inline `Cmd/Ctrl+K`: abre una barra, propone un diff y se aplica
 *     con `Cmd/Ctrl+Enter` o se rechaza con `Esc` (siempre deshacible con Cmd+Z).
 */
/* eslint-disable react-refresh/only-export-components */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  placeholder as cmPlaceholder,
  hoverTooltip,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
  foldGutter,
  foldKeymap,
} from '@codemirror/language';
import { tags as hl } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { lintGutter, setDiagnostics, type Diagnostic as CMDiagnostic } from '@codemirror/lint';
import {
  autocompletion,
  completionKeymap,
  type Completion,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { ghostExtension, ghostFieldValue, setGhostSuggestion } from './aiGhost';
import { InlineEditBar, type InlineEditPhase } from './InlineEditBar';
import { GHOST_DEBOUNCE_MS, getActiveModel, requestInlineCompletion, requestInlineEdit } from '../../utils/inlineAi';
import {
  useLSPClient,
  type LSPDiagnostic,
  type LSPDocumentSymbol,
  type LSPRange,
} from '../../hooks/useLSPClient';

/** Devuelve las extensiones de lenguaje para una extensión de archivo. */
export function languageForFile(ext: string) {
  switch ((ext || '').toLowerCase()) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return javascript({ jsx: true });
    case 'ts':
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'html':
    case 'htm':
    case 'vue':
      return html();
    case 'css':
    case 'scss':
    case 'less':
      return css();
    case 'json':
      return json();
    case 'md':
    case 'markdown':
      return markdown();
    case 'xml':
      return xml();
    default:
      return [];
  }
}

/** Resaltado de sintaxis con la paleta retro Norton (cyan/amarillo/verde). */
const nortonHighlight = HighlightStyle.define([
  { tag: [hl.comment, hl.lineComment, hl.blockComment], color: 'rgba(0,255,255,0.45)', fontStyle: 'italic' },
  { tag: [hl.keyword, hl.moduleKeyword, hl.controlKeyword, hl.operatorKeyword], color: '#ffff55' },
  { tag: [hl.string, hl.special(hl.string), hl.regexp], color: '#7dff9e' },
  { tag: [hl.number, hl.bool, hl.null, hl.atom], color: '#ff9d5c' },
  { tag: [hl.function(hl.variableName), hl.function(hl.propertyName)], color: '#00ffff' },
  { tag: [hl.typeName, hl.className, hl.namespace], color: '#7fd7ff' },
  { tag: [hl.operator, hl.punctuation, hl.separator, hl.bracket], color: '#9fe8ff' },
  { tag: [hl.propertyName, hl.attributeName], color: '#bfe9ff' },
  { tag: [hl.variableName, hl.definition(hl.variableName)], color: '#e6f7ff' },
  { tag: [hl.tagName, hl.heading], color: '#ffff55' },
  { tag: [hl.link, hl.url], color: '#00ffff', textDecoration: 'underline' },
  { tag: hl.emphasis, fontStyle: 'italic' },
  { tag: hl.strong, fontWeight: 'bold' },
  { tag: hl.invalid, color: '#ff5555' },
]);

/** Tema retro Norton para CodeMirror. */
const nortonTheme = EditorView.theme(
  {
    '&': {
      color: '#9fe8ff',
      backgroundColor: 'transparent',
      height: '100%',
      fontSize: '11px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.5' },
    '.cm-content': { caretColor: '#ffff55', padding: '8px 0' },
    '.cm-gutters': {
      backgroundColor: '#00060f',
      color: 'rgba(0,255,255,0.3)',
      border: 'none',
      borderRight: '1px solid #004466',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(0,255,255,0.06)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(0,255,255,0.08)', color: '#00ffff' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#ffff55' },
    '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(0,255,255,0.25)' },
    '.cm-foldPlaceholder': { backgroundColor: '#00243e', border: '1px solid #004466', color: '#00ffff' },
    // Sugerencia de IA (ghost-text).
    '.cm-ai-ghost': {
      color: 'rgba(136,255,136,0.5)',
      fontStyle: 'italic',
      pointerEvents: 'none',
      whiteSpace: 'pre',
    },
  },
  { dark: true }
);

/** Último segmento (nombre de archivo) de un uri LSP. */
function shortUri(uri: string): string {
  const clean = decodeURIComponent(uri.replace(/^file:\/\/\/?/i, '').replace(/\\/g, '/'));
  return clean.split('/').filter(Boolean).pop() || uri;
}

/** Nombre legible del `SymbolKind` de LSP. */
function symbolKind(kind: number): string {
  const kinds = [
    'Archivo', 'Módulo', 'Namespace', 'Paquete', 'Clase', 'Método', 'Propiedad', 'Campo',
    'Constructor', 'Enum', 'Interfaz', 'Función', 'Variable', 'Constante', 'String', 'Número',
    'Booleano', 'Array', 'Objeto', 'Clave', 'Null', 'EnumMember', 'Struct', 'Evento',
    'Operador', 'TypeParameter',
  ];
  return kinds[kind] || 'Símbolo';
}

/** Mapea el `CompletionItemKind` de LSP a un `type` de CodeMirror. */
function completionType(kind?: number): string | undefined {
  switch (kind) {
    case 2:
      return 'method';
    case 3:
    case 4:
      return 'function';
    case 5:
    case 10:
      return 'property';
    case 6:
      return 'variable';
    case 7:
      return 'class';
    case 8:
      return 'interface';
    case 9:
      return 'namespace';
    case 13:
    case 20:
      return 'enum';
    case 14:
      return 'keyword';
    case 21:
      return 'constant';
    case 22:
      return 'class';
    case 25:
      return 'type';
    default:
      return undefined;
  }
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Extensión de archivo sin punto (ts, tsx, json…). */
  language?: string;
  readOnly?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** Ctrl/Cmd+S */
  onSave?: () => void;
  /** Ctrl/Cmd+Shift+S */
  onSaveAs?: () => void;
  /** Ruta o nombre del archivo (contexto para la IA). */
  filename?: string;
  /** Activa el ghost-text de autocompletado (apagado por defecto). */
  aiEnabled?: boolean;
  /** Modelo a usar; por defecto, el activo de la app. */
  aiModel?: string;
  testId?: string;
  /** Ref opcional a la instancia de CodeMirror (tests). */
  viewRef?: React.MutableRefObject<EditorView | null>;
  /** Root del proyecto activo (para resolver rutas absolutas del LSP). */
  projectPath?: string;
  /** Navegar a un símbolo en otro archivo (definición/referencias). */
  onOpenLocation?: (target: { uri: string; line: number; character: number }) => void;
  /** Aplicar el WorkspaceEdit de un rename en OTROS archivos. */
  onApplyWorkspaceEdit?: (changes: Record<string, Array<{ range: LSPRange; newText: string }>>) => void;
  /** Petición de mover el cursor (p. ej. tras abrir otra definición). */
  reveal?: { line: number; character: number; nonce: number } | null;
}

/** Elemento mostrado en el panel de resultados LSP. */
interface LspPanelItem {
  label: string;
  detail?: string;
  uri?: string;
  line?: number;
  character?: number;
}

interface InlineEditState {
  phase: InlineEditPhase;
  instruction: string;
  from: number;
  to: number;
  original: string;
  prefix: string;
  suffix: string;
  proposed: string;
  error: string;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  language = '',
  readOnly = false,
  placeholder = '',
  ariaLabel,
  onSave,
  onSaveAs,
  filename,
  aiEnabled = false,
  aiModel,
  testId,
  viewRef,
  projectPath,
  onOpenLocation,
  onApplyWorkspaceEdit,
  reveal,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const readOnlyComp = useRef(new Compartment());
  const lspComp = useRef(new Compartment());

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onSaveAsRef = useRef(onSaveAs);
  onSaveAsRef.current = onSaveAs;

  // ---- LSP: cliente, diagnósticos y acciones ----
  const [lspDiagnostics, setLspDiagnostics] = useState<LSPDiagnostic[]>([]);
  const [lspPanel, setLspPanel] = useState<{ title: string; items: LspPanelItem[] } | null>(null);
  const [rename, setRename] = useState<{ line: number; character: number; current: string } | null>(
    null
  );
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef(rename);
  renameRef.current = rename;

  const onOpenLocationRef = useRef(onOpenLocation);
  onOpenLocationRef.current = onOpenLocation;
  const onApplyWorkspaceEditRef = useRef(onApplyWorkspaceEdit);
  onApplyWorkspaceEditRef.current = onApplyWorkspaceEdit;

  // El editor trabaja con rutas relativas al proyecto; el server necesita
  // rutas absolutas del sistema de archivos.
  const absFilePath = useMemo(() => {
    if (!filename) return '';
    if (/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(filename)) return filename;
    if (!projectPath) return filename;
    return `${projectPath.replace(/[\\/]+$/, '')}/${filename}`;
  }, [filename, projectPath]);
  const absFilePathRef = useRef(absFilePath);
  absFilePathRef.current = absFilePath;

  const lsp = useLSPClient({
    filePath: absFilePath || 'untitled.ts',
    languageId: language || 'typescript',
    projectRoot: projectPath,
    getText: () => view.current?.state.doc.toString() || value,
    onDiagnostics: setLspDiagnostics,
  });

  // Ref al cliente LSP para que las extensiones (creadas una sola vez) lean
  // siempre el estado más reciente (inicialización asíncrona).
  const lspRef = useRef(lsp);
  lspRef.current = lsp;

  // Fuente de autocompletado: delega en el language server.
  const lspCompletionSource = useCallback<CompletionSource>(async (context) => {
    const client = lspRef.current;
    if (!client.initialized) return null;
    const word = context.matchBefore(/[\w$.\u00A1-\uFFFF]+/);
    if (!context.explicit && (!word || word.from === word.to)) return null;
    const line = context.state.doc.lineAt(context.pos);
    const items = await client.requestCompletion(
      line.number - 1,
      context.pos - line.from,
      context.explicit ? 2 : 1
    );
    if (!items || items.length === 0) return null;
    const options: Completion[] = items.map((it) => ({
      label: it.label,
      detail: it.detail,
      type: completionType(it.kind),
      info: typeof it.documentation === 'string' ? it.documentation : it.documentation?.value,
      apply: it.insertText ?? it.label,
    }));
    return { from: word ? word.from : context.pos, options };
  }, []);

  /** ¿El uri que devuelve el server corresponde al archivo abierto? */
  const isCurrentUri = useCallback((uri: string) => {
    const norm = (p: string) =>
      decodeURIComponent(p)
        .replace(/\\/g, '/')
        .replace(/^file:\/\/\/?/i, '')
        .replace(/^\/+/, '')
        .toLowerCase();
    return norm(uri) === norm(absFilePathRef.current);
  }, []);

  /** Mueve el cursor a una posición 0-based del documento actual. */
  const jumpTo = useCallback((line: number, character: number) => {
    const instance = view.current;
    if (!instance) return;
    const lineNo = Math.min(Math.max(1, line + 1), instance.state.doc.lines);
    const info = instance.state.doc.line(lineNo);
    const pos = Math.min(info.from + Math.max(0, character), info.to);
    instance.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    instance.focus();
  }, []);

  /** Abre una ubicación: mismo archivo → mueve el cursor; otro → delega. */
  const openLocation = useCallback(
    (uri: string, line: number, character: number) => {
      if (isCurrentUri(uri)) jumpTo(line, character);
      else onOpenLocationRef.current?.({ uri, line, character });
    },
    [isCurrentUri, jumpTo]
  );

  /** Aplica las ediciones de un rename al documento actual. */
  const applyCurrentFileEdits = useCallback(
    (edits: Array<{ range: LSPRange; newText: string }>) => {
      const instance = view.current;
      if (!instance) return;
      const doc = instance.state.doc;
      const changes = edits
        .map((e) => {
          const sLine = doc.line(Math.min(Math.max(1, e.range.start.line + 1), doc.lines));
          const eLine = doc.line(Math.min(Math.max(1, e.range.end.line + 1), doc.lines));
          const from = Math.min(sLine.from + Math.max(0, e.range.start.character), sLine.to);
          const to = Math.min(eLine.from + Math.max(0, e.range.end.character), eLine.to);
          return { from, to, insert: e.newText };
        })
        .sort((a, b) => a.from - b.from);
      instance.dispatch({ changes });
      instance.focus();
    },
    []
  );

  /** Ejecuta el rename pendiente (overlay propio, sin window.prompt). */
  const submitRename = useCallback(
    async (newName: string) => {
      const st = renameRef.current;
      setRename(null);
      if (!st || !newName || newName === st.current) return;
      const result = await lspRef.current.requestRename(st.line, st.character, newName);
      if (!result?.changes) return;
      const other: Record<string, Array<{ range: LSPRange; newText: string }>> = {};
      for (const [uri, edits] of Object.entries(result.changes)) {
        if (isCurrentUri(uri)) applyCurrentFileEdits(edits);
        else other[uri] = edits;
      }
      if (Object.keys(other).length) onApplyWorkspaceEditRef.current?.(other);
    },
    [applyCurrentFileEdits, isCurrentUri]
  );

  // Extensiones LSP (hover + atajos). Se reconfiguran a través de `lspComp`.
  const buildLspExtensions = useCallback((): Extension[] => {
    const client = lspRef.current;
    if (!client.initialized) return [];
    const currentPos = (v: EditorView) => {
      const pos = v.state.selection.main.head;
      const line = v.state.doc.lineAt(pos);
      return { line: line.number - 1, character: pos - line.from };
    };
    return [
      hoverTooltip((v, pos) => {
        const line = v.state.doc.lineAt(pos);
        return client
          .requestHover(line.number - 1, pos - line.from)
          .then((hover) => {
            if (!hover) return null;
            const contents = Array.isArray(hover.contents)
              ? hover.contents.map((c) => c.value).join('\n\n')
              : hover.contents.value;
            return {
              pos,
              end: pos,
              above: true,
              create: () => {
                const dom = document.createElement('div');
                dom.className = 'cm-lsp-hover';
                dom.style.cssText =
                  'padding: 8px 12px; max-width: 400px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.5; background: #001122; border: 1px solid #00ffff; border-radius: 4px; color: #e6f7ff; box-shadow: 0 4px 12px rgba(0,0,0,0.4);';
                dom.textContent = contents;
                return { dom };
              },
            };
          })
          .catch(() => null);
      }),
      keymap.of([
        // F12 → ir a la definición.
        {
          key: 'F12',
          preventDefault: true,
          run: (v) => {
            const { line, character } = currentPos(v);
            void client.requestDefinition(line, character).then((defs) => {
              if (!defs || defs.length === 0) return;
              if (defs.length === 1) {
                openLocation(defs[0].uri, defs[0].range.start.line, defs[0].range.start.character);
              } else {
                setLspPanel({
                  title: 'Definiciones',
                  items: defs.map((d) => ({
                    label: shortUri(d.uri),
                    detail: `${d.range.start.line + 1}:${d.range.start.character + 1}`,
                    uri: d.uri,
                    line: d.range.start.line,
                    character: d.range.start.character,
                  })),
                });
              }
            });
            return true;
          },
        },
        // Ctrl/Cmd+Shift+R → renombrar símbolo (overlay propio).
        {
          key: 'Mod-Shift-r',
          preventDefault: true,
          run: (v) => {
            const selPos = v.state.selection.main.head;
            const ln = v.state.doc.lineAt(selPos);
            const col = selPos - ln.from;
            const text = ln.text;
            const isWordChar = (ch: string) => /[\w$]/.test(ch);
            let s = col;
            let e = col;
            while (s > 0 && isWordChar(text[s - 1])) s--;
            while (e < text.length && isWordChar(text[e])) e++;
            const word = text.slice(s, e);
            if (!word) return true;
            setRename({ line: ln.number - 1, character: s, current: word });
            requestAnimationFrame(() => renameInputRef.current?.select());
            return true;
          },
        },
        // Shift+F12 → buscar referencias.
        {
          key: 'Shift-F12',
          preventDefault: true,
          run: (v) => {
            const { line, character } = currentPos(v);
            void client.requestReferences(line, character).then((refs) => {
              if (!refs) return;
              setLspPanel({
                title: 'Referencias',
                items: refs.map((r) => ({
                  label: shortUri(r.uri),
                  detail: `${r.range.start.line + 1}:${r.range.start.character + 1}`,
                  uri: r.uri,
                  line: r.range.start.line,
                  character: r.range.start.character,
                })),
              });
            });
            return true;
          },
        },
        // Ctrl/Cmd+Shift+O → símbolos del documento.
        {
          key: 'Mod-Shift-o',
          preventDefault: true,
          run: () => {
            void client.requestDocumentSymbols().then((symbols) => {
              if (!symbols) return;
              const items: LspPanelItem[] = [];
              const walk = (syms: LSPDocumentSymbol[], depth: number) => {
                for (const s of syms) {
                  items.push({
                    label: `${'  '.repeat(depth)}${s.name}`,
                    detail: symbolKind(s.kind),
                    line: s.range.start.line,
                    character: s.range.start.character,
                  });
                  if (s.children?.length) walk(s.children, depth + 1);
                }
              };
              walk(symbols, 0);
              setLspPanel({ title: 'Símbolos', items });
            });
            return true;
          },
        },
      ]),
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo, openLocation]);

  // Config de IA leída en el momento de la petición (evita reciclar el estado).
  const aiEnabledRef = useRef(!!aiEnabled);
  aiEnabledRef.current = !!aiEnabled;
  const filenameRef = useRef(filename);
  filenameRef.current = filename;
  const aiModelRef = useRef(aiModel);
  aiModelRef.current = aiModel;
  const languageRef = useRef(language);
  languageRef.current = language;

  // API que el editor expone al efecto de `aiEnabled`.
  const ghostApiRef = useRef<{ schedule: (v: EditorView) => void; clear: (v: EditorView) => void } | null>(null);

  // Edición inline (Cmd+K).
  const [inline, setInline] = useState<InlineEditState | null>(null);
  const inlineRef = useRef<InlineEditState | null>(null);
  inlineRef.current = inline;
  const inlineInputRef = useRef<HTMLInputElement>(null);

  const openInlineEdit = useCallback(() => {
    const inst = view.current;
    if (!inst) return;
    const sel = inst.state.selection.main;
    let from = sel.from;
    let to = sel.to;
    if (from === to) {
      const line = inst.state.doc.lineAt(from);
      from = line.from;
      to = line.to;
    }
    const original = inst.state.doc.sliceString(from, to);
    if (!original.trim()) return;
    setInline({
      phase: 'prompt',
      instruction: '',
      from,
      to,
      original,
      prefix: inst.state.doc.sliceString(Math.max(0, from - 1500), from),
      suffix: inst.state.doc.sliceString(to, Math.min(inst.state.doc.length, to + 400)),
      proposed: '',
      error: '',
    });
    requestAnimationFrame(() => inlineInputRef.current?.focus());
  }, []);
  const openInlineRef = useRef(openInlineEdit);
  openInlineRef.current = openInlineEdit;

  const submitInline = useCallback(async () => {
    const cur = inlineRef.current;
    if (!cur || cur.phase === 'loading' || !cur.instruction.trim()) return;
    setInline({ ...cur, phase: 'loading', error: '' });
    const result = await requestInlineEdit({
      instruction: cur.instruction,
      code: cur.original,
      prefix: cur.prefix,
      suffix: cur.suffix,
      filename: filenameRef.current,
      language: languageRef.current,
      model: aiModelRef.current,
    });
    const latest = inlineRef.current;
    if (!latest) return; // se cerró durante la petición
    if (!result.ok) {
      setInline({ ...latest, phase: 'error', error: result.error || 'Error al generar la edición' });
      return;
    }
    if (!result.text || result.text === cur.original) {
      setInline({ ...latest, phase: 'error', error: 'El modelo no propuso cambios' });
      return;
    }
    setInline({ ...latest, phase: 'preview', proposed: result.text });
  }, []);

  const acceptInline = useCallback(() => {
    const inst = view.current;
    const cur = inlineRef.current;
    setInline(null);
    if (!inst || !cur || cur.phase !== 'preview') return;
    const proposed = cur.proposed;
    inst.dispatch({
      changes: { from: cur.from, to: cur.to, insert: proposed },
      selection: { anchor: cur.from + proposed.length },
      effects: setGhostSuggestion.of(null),
    });
    inst.focus();
  }, []);

  const rejectInline = useCallback(() => {
    setInline(null);
    view.current?.focus();
  }, []);

  // Montaje único.
  useEffect(() => {
    if (!hostRef.current) return;
    let alive = true;
    let ghostTimer: ReturnType<typeof setTimeout> | null = null;
    let ghostAbort: AbortController | null = null;
    let ghostSeq = 0;

    const clearGhost = (v: EditorView) => {
      if (ghostTimer) {
        clearTimeout(ghostTimer);
        ghostTimer = null;
      }
      ghostAbort?.abort();
      ghostAbort = null;
      ghostSeq += 1;
      if (ghostFieldValue(v.state)) v.dispatch({ effects: setGhostSuggestion.of(null) });
    };

    const runGhost = async (v: EditorView) => {
      const sel = v.state.selection.main;
      if (!sel.empty) return;
      const pos = sel.head;
      const prefix = v.state.doc.sliceString(Math.max(0, pos - 4000), pos);
      if (!prefix.trim()) return; // nada de contexto: no molestamos al proveedor
      const suffix = v.state.doc.sliceString(pos, Math.min(v.state.doc.length, pos + 800));
      const seq = ++ghostSeq;
      ghostAbort?.abort();
      const controller = new AbortController();
      ghostAbort = controller;
      const result = await requestInlineCompletion({
        prefix,
        suffix,
        filename: filenameRef.current,
        language: languageRef.current,
        model: aiModelRef.current,
        signal: controller.signal,
      });
      if (!alive || seq !== ghostSeq || !result.ok || !result.text) return;
      const now = v.state.selection.main;
      if (!now.empty || now.head !== pos) return; // el cursor se movió
      v.dispatch({ effects: setGhostSuggestion.of({ from: pos, text: result.text }) });
    };

    const scheduleGhost = (v: EditorView) => {
      if (ghostTimer) clearTimeout(ghostTimer);
      if (!aiEnabledRef.current) {
        clearGhost(v);
        return;
      }
      ghostTimer = setTimeout(() => {
        if (alive) void runGhost(v);
      }, GHOST_DEBOUNCE_MS);
    };

    ghostApiRef.current = { schedule: scheduleGhost, clear: clearGhost };

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        lintGutter(),
        autocompletion({ override: [lspCompletionSource] }),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        syntaxHighlighting(nortonHighlight, { fallback: true }),
        langComp.current.of(languageForFile(language)),
        readOnlyComp.current.of(EditorView.editable.of(!readOnly)),
        cmPlaceholder(placeholder),
        ghostExtension,
        lspComp.current.of(buildLspExtensions()),
        nortonTheme,
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => (onSaveRef.current?.(), true) },
          { key: 'Mod-Shift-s', preventDefault: true, run: () => (onSaveAsRef.current?.(), true) },
          { key: 'Mod-k', preventDefault: true, run: () => (openInlineRef.current(), true) },
          ...completionKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            onChangeRef.current(u.state.doc.toString());
            const client = lspRef.current;
            if (client.initialized && filenameRef.current) {
              const changes: Array<{
                range: {
                  start: { line: number; character: number };
                  end: { line: number; character: number };
                };
                text: string;
              }> = [];
              u.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
                const startLine = u.state.doc.lineAt(fromB);
                const endLine = u.state.doc.lineAt(toB);
                changes.push({
                  range: {
                    start: { line: startLine.number - 1, character: fromB - startLine.from },
                    end: { line: endLine.number - 1, character: toB - endLine.from },
                  },
                  text: inserted.toString(),
                });
              });
              client.notifyChange(changes);
            }
          }
          const userTyped = u.transactions.some(
            (tr) => tr.isUserEvent('input') || tr.isUserEvent('delete')
          );
          if (u.docChanged && userTyped) scheduleGhost(u.view);
        }),
        EditorView.contentAttributes.of(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      ],
    });
    const instance = new EditorView({ state, parent: hostRef.current });
    view.current = instance;
    if (viewRef) viewRef.current = instance;
    if (aiEnabledRef.current) scheduleGhost(instance);
    return () => {
      alive = false;
      clearGhost(instance);
      view.current = null;
      if (viewRef) viewRef.current = null;
      instance.destroy();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (value !== current) {
      instance.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  // Reconfigura el lenguaje al cambiar de archivo.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: langComp.current.reconfigure(languageForFile(language)) });
  }, [language]);

  // Reconfigura las extensiones LSP (hover + atajos) cuando el servidor pasa
  // a estar listo o cuando cambia el archivo abierto.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: lspComp.current.reconfigure(buildLspExtensions()) });
  }, [lsp.initialized, filename, buildLspExtensions]);

  // Al cambiar de archivo, limpia los diagnósticos del anterior.
  useEffect(() => {
    setLspDiagnostics([]);
  }, [absFilePath]);

  // Vuelca los diagnósticos (publishDiagnostics) al gutter del editor.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const doc = instance.state.doc;
    const diags: CMDiagnostic[] = lspDiagnostics.map((d) => {
      const sLine = doc.line(Math.min(Math.max(1, d.range.start.line + 1), doc.lines));
      const eLine = doc.line(Math.min(Math.max(1, d.range.end.line + 1), doc.lines));
      const from = Math.min(sLine.from + Math.max(0, d.range.start.character), sLine.to);
      const to = Math.min(eLine.from + Math.max(0, d.range.end.character), eLine.to);
      return {
        from,
        to: Math.max(from, to),
        severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
        message: d.message,
        source: d.source || 'tsserver',
      };
    });
    instance.dispatch(setDiagnostics(instance.state, diags));
  }, [lspDiagnostics]);

  // Petición externa de mover el cursor (p. ej. "ir a definición" en otro
  // archivo, que se abre primero). Se difiere para que el documento nuevo ya
  // esté aplicado por el efecto de `value`.
  useEffect(() => {
    if (!reveal) return;
    const id = requestAnimationFrame(() => jumpTo(reveal.line, reveal.character));
    return () => cancelAnimationFrame(id);
  }, [reveal, jumpTo]);

  // Reconfigura sólo-lectura.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: readOnlyComp.current.reconfigure(EditorView.editable.of(!readOnly)) });
  }, [readOnly]);

  // Enciende/apaga el autocompletado (y limpia la sugerencia al apagarlo).
  useEffect(() => {
    const api = ghostApiRef.current;
    const instance = view.current;
    if (!api || !instance) return;
    if (aiEnabled) api.schedule(instance);
    else api.clear(instance);
  }, [aiEnabled]);

  return (
    <div className="relative h-full min-h-0">
      <div ref={hostRef} data-testid={testId} className="h-full min-h-0 overflow-auto" />

      {/* Indicador de estado del language server (TS/JS). */}
      {(lsp.initialized || lsp.error) && (
        <div
          className="absolute left-2 bottom-2 z-10 px-1.5 py-0.5 bg-[var(--nc-bg-panel)]/85 border border-[var(--nc-border-light)]/40 font-mono text-[9px] pointer-events-none"
          data-testid="lsp-status"
          title={lsp.error ? lsp.error : `Language server activo (${language})`}
        >
          <span className={lsp.error ? 'text-[var(--nc-danger)]' : 'text-[var(--nc-success)]'}>
            {lsp.error ? '● LSP error' : `● LSP ${language}`}
          </span>
        </div>
      )}

      {inline && (
        <InlineEditBar
          phase={inline.phase}
          instruction={inline.instruction}
          original={inline.original}
          proposed={inline.proposed}
          error={inline.error}
          model={aiModel || getActiveModel()}
          onInstructionChange={(v) => setInline((s) => (s ? { ...s, instruction: v } : s))}
          onSubmit={submitInline}
          onAccept={acceptInline}
          onReject={rejectInline}
          inputRef={inlineInputRef}
        />
      )}

      {/* Panel de resultados LSP (definiciones / referencias / símbolos). */}
      {lspPanel && (
        <div
          className="absolute right-2 bottom-2 z-20 w-80 max-h-64 overflow-auto bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)]/60 shadow-lg font-mono text-[10px]"
          data-testid="lsp-panel"
        >
          <div className="flex items-center justify-between px-2 py-1 bg-[var(--nc-bg-panel)] border-b border-[var(--nc-border-light)]/40 sticky top-0">
            <span className="text-[var(--nc-text-accent)] font-bold">
              {lspPanel.title} ({lspPanel.items.length})
            </span>
            <button
              type="button"
              onClick={() => setLspPanel(null)}
              className="text-[var(--nc-text)] hover:text-[var(--nc-text-accent)] px-1"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
          {lspPanel.items.length === 0 ? (
            <div className="px-2 py-1.5 text-[var(--nc-text)]/60">Sin resultados</div>
          ) : (
            <ul>
              {lspPanel.items.map((item, i) => (
                <li key={`${item.label}-${i}`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (item.uri) openLocation(item.uri, item.line ?? 0, item.character ?? 0);
                      else jumpTo(item.line ?? 0, item.character ?? 0);
                      setLspPanel(null);
                    }}
                    className="w-full text-left px-2 py-1 hover:bg-[var(--nc-highlight-bg)]/10 border-b border-[var(--nc-border-light)]/10"
                  >
                    <span className="text-[var(--nc-success)] whitespace-pre">{item.label}</span>
                    {item.detail && (
                      <span className="text-[var(--nc-text)]/50 ml-2">{item.detail}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Overlay de renombrado (reemplaza a window.prompt). */}
      {rename && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-2 z-20 bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)]/60 shadow-lg px-2 py-1.5 font-mono text-[10px] flex items-center gap-2"
          data-testid="lsp-rename"
        >
          <span className="text-[var(--nc-text-accent)]">Renombrar símbolo:</span>
          <input
            ref={renameInputRef}
            defaultValue={rename.current}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitRename(e.currentTarget.value.trim());
              else if (e.key === 'Escape') {
                setRename(null);
                view.current?.focus();
              }
            }}
            className="bg-[#00060f] border border-[var(--nc-border-dark)] text-[var(--nc-text)] px-1 py-0.5 outline-none focus:border-[var(--nc-text-accent)] min-w-[10rem]"
          />
          <button
            type="button"
            onClick={() => {
              const el = renameInputRef.current;
              if (el) void submitRename(el.value.trim());
            }}
            className="text-[var(--nc-text)] hover:text-[var(--nc-text-accent)]"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
};
export default CodeEditor;
