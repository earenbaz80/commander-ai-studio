/**
 * Tests de la búsqueda de símbolos del workspace (LSP `workspace/symbol`).
 *
 * Verifica el helper `searchWorkspaceSymbols` (puente IPC) y el modal
 * `SymbolSearchModal` (búsqueda + navegación vía `commander:open-location`).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SymbolSearchModal } from '../../src/components/SymbolSearchModal';
import {
  searchWorkspaceSymbols,
  type LSPWorkspaceSymbol,
} from '../../src/hooks/useLSPClient';

const SYMBOLS: LSPWorkspaceSymbol[] = [
  {
    name: 'greet',
    kind: 12,
    location: {
      uri: 'file:///C:/proj/src/a.ts',
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 5 } },
    },
  },
  {
    name: 'Greeting',
    kind: 5,
    location: {
      uri: 'file:///C:/proj/src/Greeting.tsx',
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 8 } },
    },
  },
];

function mockLsp(symbols: LSPWorkspaceSymbol[]) {
  return {
    workspaceSymbols: vi.fn(async () => ({ success: true, result: symbols })),
  };
}

afterEach(() => {
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe('searchWorkspaceSymbols', () => {
  test('sin Electron devuelve null', async () => {
    delete (window as { electronAPI?: unknown }).electronAPI;
    await expect(searchWorkspaceSymbols('x')).resolves.toBeNull();
  });

  test('delega en el puente IPC con el query', async () => {
    const api = mockLsp(SYMBOLS);
    (window as any).electronAPI = { lsp: api };

    await expect(searchWorkspaceSymbols('gr')).resolves.toEqual(SYMBOLS);
    expect(api.workspaceSymbols).toHaveBeenCalledWith({ query: 'gr' });
  });
});

describe('SymbolSearchModal', () => {
  test('busca y emite commander:open-location al elegir un símbolo', async () => {
    const api = mockLsp(SYMBOLS);
    (window as any).electronAPI = { lsp: api };

    const onClose = vi.fn();
    const listener = vi.fn();
    window.addEventListener('commander:open-location', listener);

    render(<SymbolSearchModal isOpen onClose={onClose} projectPath="C:/proj" lang="es" />);

    fireEvent.change(screen.getByLabelText('Buscar símbolo en el workspace'), {
      target: { value: 'gr' },
    });

    const item = await screen.findByText('greet');
    fireEvent.click(item);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as CustomEvent<{
      path: string;
      line: number;
      character: number;
    }>;
    expect(event.detail).toEqual({ path: 'src/a.ts', line: 4, character: 0 });

    window.removeEventListener('commander:open-location', listener);
  });
});
