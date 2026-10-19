import { describe, test, expect, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { CodeEditor, languageForFile } from '../../src/components/panel/CodeEditor';
import { setGhostSuggestion } from '../../src/components/panel/aiGhost';

/** Reproduce la detección de plataforma de CodeMirror para elegir Mod (Cmd vs Ctrl). */
const MOD = /Mac|iP(hone|ad|od)/.test(navigator.platform || '') ? { metaKey: true } : { ctrlKey: true };

/** Respuesta fetch simulada (evita depender de `Response` en jsdom). */
function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('languageForFile', () => {
  test('mapea extensiones conocidas', () => {
    expect(languageForFile('ts')).toBeTruthy();
    expect(languageForFile('tsx')).toBeTruthy();
    expect(languageForFile('json')).toBeTruthy();
    expect(languageForFile('py')).toBeTruthy();
    expect(languageForFile('nginx')).toEqual([]);
  });
});

describe('CodeEditor', () => {
  test('monta CodeMirror con el valor inicial', () => {
    const ref = { current: null as EditorView | null };
    const { container } = render(
      <CodeEditor value="const x = 1;" onChange={vi.fn()} language="ts" viewRef={ref as any} />
    );
    expect(container.querySelector('.cm-content')).toBeTruthy();
    expect(ref.current).toBeTruthy();
    expect(ref.current!.state.doc.toString()).toBe('const x = 1;');
  });

  test('notifica los cambios del documento', () => {
    const onChange = vi.fn();
    const ref = { current: null as EditorView | null };
    render(<CodeEditor value="uno" onChange={onChange} language="ts" viewRef={ref as any} />);

    ref.current!.dispatch({ changes: { from: 0, to: 3, insert: 'dos' } });

    expect(onChange).toHaveBeenCalledWith('dos');
  });

  test('sincroniza un valor externo', () => {
    const ref = { current: null as EditorView | null };
    const { rerender } = render(
      <CodeEditor value="a" onChange={vi.fn()} language="ts" viewRef={ref as any} />
    );
    rerender(<CodeEditor value="b" onChange={vi.fn()} language="ts" viewRef={ref as any} />);
    expect(ref.current!.state.doc.toString()).toBe('b');
  });

  test('dibuja el ghost-text y Tab lo acepta', async () => {
    const ref = { current: null as EditorView | null };
    const { container } = render(
      <CodeEditor value="const x = " onChange={vi.fn()} language="ts" viewRef={ref as any} />
    );
    const view = ref.current!;

    await act(async () => {
      view.dispatch({ effects: setGhostSuggestion.of({ from: view.state.doc.length, text: '1;' }) });
    });
    expect(container.querySelector('.cm-ai-ghost')?.textContent).toBe('1;');

    await act(async () => {
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(view.state.doc.toString()).toBe('const x = 1;');
    expect(container.querySelector('.cm-ai-ghost')).toBeNull();
  });

  test('Cmd/Ctrl+K abre la barra de edición IA', async () => {
    const ref = { current: null as EditorView | null };
    const { container } = render(
      <CodeEditor value="const x = 1;" onChange={vi.fn()} language="ts" viewRef={ref as any} />
    );
    await act(async () => {
      ref.current!.dispatch({ selection: { anchor: 5 } });
      ref.current!.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true, ...MOD })
      );
    });
    expect(container.querySelector('[data-testid="editor-inline-ai"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="editor-inline-input"]')).toBeTruthy();
  });

  test('la edición IA propone un diff y lo aplica al aceptar', async () => {
    const onChange = vi.fn();
    const ref = { current: null as EditorView | null };
    const { container, getByTestId } = render(
      <CodeEditor value="const x = 1;" onChange={onChange} language="ts" viewRef={ref as any} />
    );
    const view = ref.current!;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ success: true, text: 'const x = 2;' })
    ) as unknown as typeof fetch;

    try {
      await act(async () => {
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        view.contentDOM.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true, ...MOD })
        );
      });

      const input = getByTestId('editor-inline-input');
      fireEvent.change(input, { target: { value: 'cambia a 2' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });

      await waitFor(() => expect(getByTestId('editor-inline-diff')).toBeTruthy());

      const bar = getByTestId('editor-inline-ai');
      await act(async () => {
        fireEvent.keyDown(bar, { key: 'Enter', ctrlKey: true });
      });

      expect(view.state.doc.toString()).toBe('const x = 2;');
      expect(container.querySelector('[data-testid="editor-inline-ai"]')).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('la edición IA muestra el error del proveedor (p. ej. falta API key)', async () => {
    const ref = { current: null as EditorView | null };
    const { getByTestId } = render(
      <CodeEditor value="hola" onChange={vi.fn()} language="ts" viewRef={ref as any} />
    );
    const view = ref.current!;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ success: false, error: 'GEMINI_API_KEY requerida', code: 'MISSING_API_KEY' }, 400)
    ) as unknown as typeof fetch;

    try {
      await act(async () => {
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        view.contentDOM.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true, ...MOD })
        );
      });
      const input = getByTestId('editor-inline-input');
      fireEvent.change(input, { target: { value: 'mejora' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      await waitFor(() => expect(getByTestId('editor-inline-error')).toBeTruthy());
      expect(getByTestId('editor-inline-error').textContent).toContain('GEMINI_API_KEY');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
