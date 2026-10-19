import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodeSearchView } from '../../src/components/panel/CodeSearchView';
import { searchCode } from '../../src/utils/codeSearchApi';

vi.mock('../../src/utils/codeSearchApi', () => ({ searchCode: vi.fn() }));

const mockSearchCode = searchCode as unknown as ReturnType<typeof vi.fn>;

describe('CodeSearchView', () => {
  beforeEach(() => {
    mockSearchCode.mockReset();
  });

  test('busca y muestra los resultados agrupados por archivo', async () => {
    mockSearchCode.mockResolvedValue({
      results: [{ path: 'src/a.ts', score: 5, matches: [{ line: 3, text: 'const x = 1;' }] }],
    });
    render(<CodeSearchView projectPath="P" />);

    fireEvent.change(screen.getByLabelText('Buscar en el código'), { target: { value: 'const' } });

    expect(await screen.findByText('src/a.ts')).toBeTruthy();
    expect(screen.getByText('const x = 1;')).toBeTruthy();
    expect(mockSearchCode).toHaveBeenCalledWith('const', 'P', 40);
  });

  test('sin coincidencias muestra un aviso', async () => {
    mockSearchCode.mockResolvedValue({ results: [] });
    render(<CodeSearchView projectPath="P" />);

    fireEvent.change(screen.getByLabelText('Buscar en el código'), { target: { value: 'zzz' } });

    expect(await screen.findByText('Sin coincidencias.')).toBeTruthy();
  });

  test('propaga el error del endpoint', async () => {
    mockSearchCode.mockResolvedValue({ results: [], error: 'boom' });
    render(<CodeSearchView projectPath="P" />);

    fireEvent.change(screen.getByLabelText('Buscar en el código'), { target: { value: 'x' } });

    expect(await screen.findByText('boom')).toBeTruthy();
  });
});
