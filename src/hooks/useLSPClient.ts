/**
 * useLSPClient — Cliente LSP para `CodeEditor`.
 *
 * Habla con `typescript-language-server` a través de los handlers IPC que
 * expone el proceso principal de Electron (`window.electronAPI.lsp`). Cuando
 * no estamos en Electron (tests jsdom, web) todos los métodos degradan a
 * no-op y devuelven `null`, de modo que el editor sigue funcionando.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export interface LSPDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: 1 | 2 | 3 | 4; // Error, Warning, Info, Hint
  message: string;
  source?: string;
  code?: string | number;
}

/** Rango LSP (línea/columna 0-based). */
export interface LSPRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface LSPHover {
  contents: Array<{ value: string; language?: string }> | { value: string };
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LSPCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value: string; kind: string };
  insertText?: string;
  filterText?: string;
  sortText?: string;
  textEdit?: {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    newText: string;
  };
}

export interface LSPDefinition {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LSPRenameResult {
  changes?: Record<string, Array<{ range: any; newText: string }>>;
  documentChanges?: any[];
}

export interface LSPReference {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LSPDocumentSymbol {
  name: string;
  kind: number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  selectionRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  children?: LSPDocumentSymbol[];
}

export interface LSPWorkspaceSymbol {
  name: string;
  kind: number;
  location: {
    uri: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  containerName?: string;
}

/** Superficie expuesta por `electron/preload.cjs` → `electronAPI.lsp`. */
interface LspApi {
  initialize: (projectRoot: string) => Promise<{ success: boolean; error?: string }>;
  shutdown: () => Promise<{ success: boolean }>;
  didOpen: (params: {
    filePath: string;
    languageId: string;
    version: number;
    text: string;
  }) => Promise<unknown>;
  didChange: (params: {
    filePath: string;
    version: number;
    changes: Array<{ range: LSPDiagnostic['range']; text: string }>;
  }) => Promise<unknown>;
  didClose: (params: { filePath: string }) => Promise<unknown>;
  hover: (params: {
    filePath: string;
    line: number;
    character: number;
  }) => Promise<{ success: boolean; result: LSPHover | null; error?: string }>;
  definition: (params: {
    filePath: string;
    line: number;
    character: number;
  }) => Promise<{ success: boolean; result: LSPDefinition[] | null; error?: string }>;
  completion: (params: {
    filePath: string;
    line: number;
    character: number;
    triggerKind?: number;
  }) => Promise<{ success: boolean; result: LSPCompletionItem[] | null; error?: string }>;
  rename: (params: {
    filePath: string;
    line: number;
    character: number;
    newName: string;
  }) => Promise<{ success: boolean; result: LSPRenameResult | null; error?: string }>;
  references: (params: {
    filePath: string;
    line: number;
    character: number;
    includeDeclaration?: boolean;
  }) => Promise<{ success: boolean; result: LSPReference[] | null; error?: string }>;
  documentSymbols: (params: {
    filePath: string;
  }) => Promise<{ success: boolean; result: LSPDocumentSymbol[] | null; error?: string }>;
  workspaceSymbols: (params: {
    query: string;
  }) => Promise<{ success: boolean; result: LSPWorkspaceSymbol[] | null; error?: string }>;
  onDiagnostics: (
    callback: (params: { uri: string; diagnostics: LSPDiagnostic[] }) => void
  ) => () => void;
}

/** Devuelve la API LSP si estamos dentro de Electron; `undefined` en otro caso. */
function getLspApi(): LspApi | undefined {
  if (typeof window === 'undefined') return undefined;
  const api = (window as unknown as { electronAPI?: { lsp?: LspApi } }).electronAPI;
  return api?.lsp;
}

/**
 * Normaliza un path o uri a una forma comparable. El server devuelve cosas
 * como `file:///c%3A/Users/...` (Windows) que hay que reducir a `c:/users/...`
 * para poder cruzar con la ruta que maneja el editor.
 */
function normalizeFsPath(p: string): string {
  return decodeURIComponent(p)
    .replace(/\\/g, '/')
    .replace(/^file:\/\/\/?/i, '')
    .replace(/^\/+/, '')
    .toLowerCase();
}

interface UseLSPClientOptions {
  filePath: string;
  languageId: string;
  getText: () => string;
  /** Root del proyecto (por defecto, la carpeta del archivo). */
  projectRoot?: string;
  onDiagnostics?: (diagnostics: LSPDiagnostic[]) => void;
}

export function useLSPClient({
  filePath,
  languageId,
  getText,
  projectRoot,
  onDiagnostics,
}: UseLSPClientOptions) {
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(0);

  // La API LSP y los callbacks cambian de identidad en cada render; los
  // guardamos en refs para que el efecto de inicialización no se re-ejecute.
  const lsp = getLspApi();
  const isElectron = !!lsp;
  const getTextRef = useRef(getText);
  getTextRef.current = getText;
  const onDiagnosticsRef = useRef(onDiagnostics);
  onDiagnosticsRef.current = onDiagnostics;

  // Root del proyecto (o carpeta del archivo si no se especifica).
  const root =
    projectRoot ||
    (filePath ? filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : '');
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  // 1) Inicialización del server: una vez por proyecto (no por archivo).
  useEffect(() => {
    if (!isElectron || !root) return;
    const api = getLspApi();
    if (!api) return;

    let mounted = true;
    (async () => {
      try {
        const result = await api.initialize(root);
        if (!mounted) return;
        if (result.success) setInitialized(true);
        else setError(result.error || 'No se pudo inicializar el LSP');
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Fallo al inicializar LSP');
      }
    })();

    return () => {
      mounted = false;
      setInitialized(false);
      void api.shutdown();
    };
  }, [isElectron, root]);

  // 2) Documento abierto: didOpen al cambiar de archivo, didClose al salir.
  useEffect(() => {
    if (!initialized || !filePath) return;
    const api = getLspApi();
    if (!api) return;
    const version = versionRef.current;
    void api.didOpen({ filePath, languageId, version, text: getTextRef.current() });
    return () => {
      void api.didClose({ filePath });
    };
  }, [initialized, filePath, languageId]);

  // 3) Diagnósticos: una suscripción por webContents; se filtran por archivo.
  useEffect(() => {
    if (!isElectron) return;
    const api = getLspApi();
    if (!api) return;
    const cleanup = api.onDiagnostics((params) => {
      if (normalizeFsPath(params.uri) === normalizeFsPath(filePathRef.current)) {
        onDiagnosticsRef.current?.(params.diagnostics);
      }
    });
    return cleanup;
  }, [isElectron]);

  const notifyChange = useCallback(
    (changes: Array<{ range: LSPDiagnostic['range']; text: string }>) => {
      const api = getLspApi();
      if (!api || !initialized) return;
      versionRef.current++;
      void api.didChange({ filePath, version: versionRef.current, changes });
    },
    [filePath, initialized]
  );

  const requestHover = useCallback(
    async (line: number, character: number): Promise<LSPHover | null> => {
      const api = getLspApi();
      if (!api || !initialized) return null;
      try {
        const result = await api.hover({ filePath, line, character });
        return result.success ? result.result : null;
      } catch {
        return null;
      }
    },
    [filePath, initialized]
  );

  const requestDefinition = useCallback(
    async (line: number, character: number): Promise<LSPDefinition[] | null> => {
      const api = getLspApi();
      if (!api || !initialized) return null;
      try {
        const result = await api.definition({ filePath, line, character });
        return result.success ? result.result : null;
      } catch {
        return null;
      }
    },
    [filePath, initialized]
  );

  const requestCompletion = useCallback(
    async (
      line: number,
      character: number,
      triggerKind = 1
    ): Promise<LSPCompletionItem[] | null> => {
      const api = getLspApi();
      if (!api || !initialized) return null;
      try {
        const result = await api.completion({ filePath, line, character, triggerKind });
        return result.success ? result.result : null;
      } catch {
        return null;
      }
    },
    [filePath, initialized]
  );

  const requestRename = useCallback(
    async (
      line: number,
      character: number,
      newName: string
    ): Promise<LSPRenameResult | null> => {
      const api = getLspApi();
      if (!api || !initialized) return null;
      try {
        const result = await api.rename({ filePath, line, character, newName });
        return result.success ? result.result : null;
      } catch {
        return null;
      }
    },
    [filePath, initialized]
  );

  const requestReferences = useCallback(
    async (
      line: number,
      character: number,
      includeDeclaration = true
    ): Promise<LSPReference[] | null> => {
      const api = getLspApi();
      if (!api || !initialized) return null;
      try {
        const result = await api.references({ filePath, line, character, includeDeclaration });
        return result.success ? result.result : null;
      } catch {
        return null;
      }
    },
    [filePath, initialized]
  );

  const requestDocumentSymbols = useCallback(async (): Promise<LSPDocumentSymbol[] | null> => {
    const api = getLspApi();
    if (!api || !initialized) return null;
    try {
      const result = await api.documentSymbols({ filePath });
      return result.success ? result.result : null;
    } catch {
      return null;
    }
  }, [filePath, initialized]);

  return {
    initialized,
    error,
    notifyChange,
    requestHover,
    requestDefinition,
    requestCompletion,
    requestRename,
    requestReferences,
    requestDocumentSymbols,
  };
}

/**
 * Busca símbolos en TODO el workspace (LSP `workspace/symbol`).
 *
 * No está atado a un archivo concreto: reutiliza la sesión LSP que ya
 * inicializó `CodeEditor` (el bridge de Electron mantiene un cliente por
 * webContents). Devuelve `null` fuera de Electron o si no hay sesión activa.
 */
export async function searchWorkspaceSymbols(
  query: string
): Promise<LSPWorkspaceSymbol[] | null> {
  const api = getLspApi();
  if (!api) return null;
  try {
    const result = await api.workspaceSymbols({ query });
    return result.success ? result.result : null;
  } catch {
    return null;
  }
}

export default useLSPClient;
