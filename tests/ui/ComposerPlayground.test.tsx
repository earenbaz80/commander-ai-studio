import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComposerPlayground } from '../../src/components/ComposerPlayground';
import { runComposer } from '../../src/lib/composerRun';

/**
 * El composer, por lo que el usuario hace: escribir, componer, revisar y
 * aceptar; crear un archivo sin diálogos del sistema y borrar con confirmación
 * en la fila. Nada de esto usa ya `prompt`/`confirm`/`alert`.
 */

vi.mock('../../src/lib/composerRun', () => {
  class ComposerError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    runComposer: vi.fn(),
    ComposerError,
  };
});

const mockRun = runComposer as unknown as ReturnType<typeof vi.fn>;

function renderComposer() {
  return render(
    <ComposerPlayground
      parameters={{ temperature: 0.7 } as any}
      setParameters={vi.fn() as any}
      selectedModel="gemini-2.5-pro"
    />
  );
}

describe('ComposerPlayground', () => {
  beforeEach(() => {
    localStorage.clear();
    mockRun.mockReset();
  });

  test('muestra la cabecera fina y los archivos, sin acciones duplicadas', () => {
    renderComposer();
    expect(screen.getByText('COMPOSER')).toBeTruthy();
    expect(screen.getByTestId('composer-file-src/App.tsx')).toBeTruthy();
    expect(screen.getByTestId('composer-run')).toBeTruthy();
    // Lo global vive en el menú, no en una banda de botones.
    expect(screen.queryByTestId('composer-menu-templates')).toBeNull();
    fireEvent.click(screen.getByTestId('composer-menu'));
    expect(screen.getByTestId('composer-menu-templates')).toBeTruthy();
  });

  test('componer trae diffs, los marca como pendientes y aceptar los limpia', async () => {
    mockRun.mockResolvedValue(new Map([['src/App.tsx', 'export const x = 1;']]));
    renderComposer();

    fireEvent.change(screen.getByTestId('composer-prompt'), { target: { value: 'añade una constante' } });
    fireEvent.click(screen.getByTestId('composer-run'));

    await waitFor(() => expect(screen.getByTestId('composer-pending')).toBeTruthy());
    expect(screen.getByTestId('composer-pending').textContent).toContain('1');
    expect(screen.getByText('PENDIENTE')).toBeTruthy();

    fireEvent.click(screen.getByTestId('composer-accept'));
    await waitFor(() => expect(screen.queryByTestId('composer-pending')).toBeNull());
  });

  test('un error del proveedor se cuenta en la barra de estado, no en un alert', async () => {
    mockRun.mockRejectedValue(new Error('cuota agotada'));
    renderComposer();

    fireEvent.change(screen.getByTestId('composer-prompt'), { target: { value: 'cambia el título' } });
    fireEvent.click(screen.getByTestId('composer-run'));

    expect(await screen.findByText(/cuota agotada/)).toBeTruthy();
  });

  test('crear un archivo es un input en la lista, no un prompt del sistema', async () => {
    renderComposer();
    fireEvent.click(screen.getByTestId('composer-add-file'));
    const input = screen.getByTestId('composer-new-file-input');
    fireEvent.change(input, { target: { value: 'src/nuevo.ts' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByTestId('composer-file-src/nuevo.ts')).toBeTruthy();
  });

  test('borrar pide confirmación en la fila', async () => {
    renderComposer();
    fireEvent.click(screen.getByTestId('composer-delete-src/index.css'));
    expect(screen.getByTestId('composer-confirm-delete-src/index.css')).toBeTruthy();
    fireEvent.click(screen.getByTestId('composer-confirm-delete-src/index.css'));

    await waitFor(() => expect(screen.queryByTestId('composer-file-src/index.css')).toBeNull());
  });

  test('las sugerencias rellenan la instrucción en vez de ocupar una fila de chips', async () => {
    renderComposer();
    fireEvent.click(screen.getByTestId('composer-suggestions'));
    fireEvent.click(screen.getByTestId('composer-suggestion-0'));

    const prompt = screen.getByTestId('composer-prompt') as HTMLTextAreaElement;
    expect(prompt.value).toMatch(/localStorage/);
  });
});
