/**
 * Tests de integración del cliente LSP (sin Electron real).
 *
 * Montamos `window.electronAPI.lsp` con un doble controlable para verificar:
 *  • El handshake (`initialize`) y `didOpen`.
 *  • El filtrado de diagnósticos por uri (Windows `file:///c%3A/...`).
 *  • El flujo de diagnóstico → gutter de CodeMirror en `CodeEditor`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, render, waitFor } from '@testing-library/react';
import { useLSPClient, type LSPDiagnostic } from '../../src/hooks/useLSPClient';
import { CodeEditor } from '../../src/components/panel/CodeEditor';

type DiagListener = (params: { uri: string; diagnostics: LSPDiagnostic[] }) => void;

function makeLspMock() {
  const listeners: DiagListener[] = [];
  const api = {
    initialize: vi.fn(async () => ({ success: true })),
    shutdown: vi.fn(async () => ({ success: true })),
    didOpen: vi.fn(async () => ({ success: true })),
    didChange: vi.fn(async () => ({ success: true })),
    didClose: vi.fn(async () => ({ success: true })),
    hover: vi.fn(async () => ({ success: true, result: { contents: { value: 'HOVER' } } })),
    definition: vi.fn(async () => ({ success: true, result: [] })),
    completion: vi.fn(async () => ({ success: true, result: [] })),
    rename: vi.fn(async () => ({ success: true, result: { changes: {} } })),
    references: vi.fn(async () => ({ success: true, result: [] })),
    documentSymbols: vi.fn(async () => ({ success: true, result: [] })),
    onDiagnostics: (callback: DiagListener) => {
      listeners.push(callback);
      return () => {
        const i = listeners.indexOf(callback);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
  return { api, listeners };
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('useLSPClient', () => {
  test('sin Electron: no inicializa y los requests devuelven null', () => {
    delete (window as { electronAPI?: unknown }).electronAPI;
    const { result } = renderHook(() =>
      useLSPClient({
        filePath: 'C:/proj/src/a.ts',
        languageId: 'typescript',
        projectRoot: 'C:/proj',
        getText: () => 'const x = 1;',
      })
    );
    expect(result.current.initialized).toBe(false);
    return expect(result.current.requestHover(0, 6)).resolves.toBeNull();
  });

  test('en Electron: initialize + didOpen y hover delegado', async () => {
    const { api } = makeLspMock();
    (window as any).electronAPI = { lsp: api };

    const { result } = renderHook(() =>
      useLSPClient({
        filePath: 'C:/proj/src/a.ts',
        languageId: 'typescript',
        projectRoot: 'C:/proj',
        getText: () => 'const x = 1;',
      })
    );

    await waitFor(() => expect(api.initialize).toHaveBeenCalledWith('C:/proj'));
    await waitFor(() => expect(api.didOpen).toHaveBeenCalled());
    const openArgs = (api.didOpen.mock.calls[0] as unknown[])[0] as any;
    expect(openArgs.filePath).toBe('C:/proj/src/a.ts');
    expect(openArgs.languageId).toBe('typescript');

    const hover = await result.current.requestHover(0, 6);
    expect(hover).toEqual({ contents: { value: 'HOVER' } });
    expect(api.hover).toHaveBeenCalledWith({
      filePath: 'C:/proj/src/a.ts',
      line: 0,
      character: 6,
    });
  });

  test('filtra diagnósticos por uri normalizada (Windows)', async () => {
    const { api, listeners } = makeLspMock();
    (window as any).electronAPI = { lsp: api };
    const onDiagnostics = vi.fn();

    renderHook(() =>
      useLSPClient({
        filePath: 'C:/proj/src/a.ts',
        languageId: 'typescript',
        projectRoot: 'C:/proj',
        getText: () => 'const x = 1;',
        onDiagnostics,
      })
    );

    await waitFor(() => expect(api.initialize).toHaveBeenCalled());
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));

    const diag: LSPDiagnostic = {
      range: { start: { line: 0, character: 7 }, end: { line: 0, character: 13 } },
      severity: 1,
      message: 'Type mismatch',
      source: 'tsserver',
    };

    // Otro archivo: se ignora.
    act(() => {
      listeners.forEach((cb) => cb({ uri: 'file:///c%3A/proj/src/b.ts', diagnostics: [diag] }));
    });
    expect(onDiagnostics).not.toHaveBeenCalled();

    // Mismo archivo (uri codificada): pasa.
    act(() => {
      listeners.forEach((cb) => cb({ uri: 'file:///c%3A/proj/src/a.ts', diagnostics: [diag] }));
    });
    expect(onDiagnostics).toHaveBeenCalledWith([diag]);
  });
});

describe('CodeEditor ↔ LSP', () => {
  test('vuelca los diagnósticos del LSP al gutter', async () => {
    const { api, listeners } = makeLspMock();
    (window as any).electronAPI = { lsp: api };

    const { container } = render(
      <CodeEditor
        value="const x = 1;"
        onChange={vi.fn()}
        language="ts"
        filename="C:/proj/src/a.ts"
        projectPath="C:/proj"
      />
    );

    await waitFor(() => expect(api.initialize).toHaveBeenCalled());
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));

    const diag: LSPDiagnostic = {
      range: { start: { line: 0, character: 7 }, end: { line: 0, character: 13 } },
      severity: 1,
      message: 'Type mismatch',
      source: 'tsserver',
    };
    act(() => {
      listeners.forEach((cb) => cb({ uri: 'file:///c%3A/proj/src/a.ts', diagnostics: [diag] }));
    });

    await waitFor(() => {
      expect(container.querySelector('.cm-lint-marker-error')).toBeTruthy();
    });
  });
});
