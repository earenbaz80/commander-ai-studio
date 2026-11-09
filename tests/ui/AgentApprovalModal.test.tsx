import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentApprovalModal } from '../../src/components/AgentApprovalModal';
import { readProjectFile, runAgentTool } from '../../src/utils/agentToolsApi';

vi.mock('../../src/utils/agentToolsApi', () => ({
  readProjectFile: vi.fn(),
  runAgentTool: vi.fn(),
}));

const mockRead = readProjectFile as unknown as ReturnType<typeof vi.fn>;
const mockRun = runAgentTool as unknown as ReturnType<typeof vi.fn>;

function approval(toolId: string, input: Record<string, unknown>) {
  return {
    id: 'ap1',
    toolId,
    title: 'Aprobar',
    description: 'tool peligrosa',
    danger: true,
    meta: { input },
  } as any;
}

describe('AgentApprovalModal', () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockRun.mockReset();
    // Por defecto el borrador no introduce reglas: es lo que devuelve el
    // servidor cuando el cambio es limpio.
    mockRun.mockResolvedValue({ ok: true, data: { rules: [] } });
  });

  test('fs.write muestra un diff y aplica el override con el contenido fusionado', async () => {
    mockRead.mockResolvedValue({ content: 'linea1\nlinea2' });
    const onResolve = vi.fn();
    render(
      <AgentApprovalModal
        approval={approval('fs.write', { path: 'x.txt', content: 'linea1\nCAMBIADA' })}
        onResolve={onResolve}
      />
    );
    fireEvent.click(await screen.findByText('Aplicar seleccionados'));
    expect(onResolve).toHaveBeenCalledWith(
      true,
      {
        toolId: 'fs.write',
        input: { path: 'x.txt', content: 'linea1\nCAMBIADA', overwrite: true },
      },
      expect.stringContaining('+++ b/x.txt')
    );
  });

  test('fs.edit calcula la propuesta y la aplica como override', async () => {
    mockRead.mockResolvedValue({ content: 'a\nb\nc' });
    const onResolve = vi.fn();
    render(
      <AgentApprovalModal
        approval={approval('fs.edit', { path: 'p.txt', oldString: 'b', newString: 'B' })}
        onResolve={onResolve}
      />
    );
    fireEvent.click(await screen.findByText('Aplicar seleccionados'));
    expect(onResolve).toHaveBeenCalledWith(
      true,
      {
        toolId: 'fs.write',
        input: { path: 'p.txt', content: 'a\nB\nc', overwrite: true },
      },
      expect.stringContaining('+++ b/p.txt')
    );
  });

  test('fs.edit sin coincidencia cae al modo simple de aprobar/denegar', async () => {
    mockRead.mockResolvedValue({ content: 'x' });
    const onResolve = vi.fn();
    render(
      <AgentApprovalModal
        approval={approval('fs.edit', { path: 'p.txt', oldString: 'zzz', newString: 'Q' })}
        onResolve={onResolve}
      />
    );
    fireEvent.click(await screen.findByText('Aprobar'));
    expect(onResolve).toHaveBeenCalledWith(true);
  });

  test('un archivo nuevo (sin contenido previo) se muestra como diff', async () => {
    mockRead.mockResolvedValue({ error: 'El archivo no existe' });
    const onResolve = vi.fn();
    render(
      <AgentApprovalModal
        approval={approval('fs.write', { path: 'nuevo.txt', content: 'hola' })}
        onResolve={onResolve}
      />
    );
    fireEvent.click(await screen.findByText('Aplicar seleccionados'));
    expect(onResolve).toHaveBeenCalledWith(
      true,
      {
        toolId: 'fs.write',
        input: { path: 'nuevo.txt', content: 'hola', overwrite: true },
      },
      expect.stringContaining('+++ b/nuevo.txt')
    );
  });

  test('tools no-patch muestran la aprobación genérica', () => {
    const onResolve = vi.fn();
    render(
      <AgentApprovalModal
        approval={approval('shell.run', { command: 'ls' })}
        onResolve={onResolve}
      />
    );
    fireEvent.click(screen.getByText('Denegar'));
    expect(onResolve).toHaveBeenCalledWith(false);
  });

  test('muestra las reglas del repo que introduce el borrador', async () => {
    mockRead.mockResolvedValue({ content: 'a\nb' });
    mockRun.mockResolvedValue({
      ok: true,
      data: {
        rules: [
          {
            rule: 'color-token',
            file: 'X.tsx',
            line: 2,
            column: 5,
            message: 'Color literal #ff0000: usa la paleta Norton.',
            excerpt: '#ff0000',
          },
        ],
      },
    });
    const onResolve = vi.fn();
    render(
      <AgentApprovalModal
        approval={approval('fs.write', { path: 'X.tsx', content: 'a\nb' })}
        onResolve={onResolve}
      />
    );
    expect(await screen.findByText('color-token')).toBeTruthy();
    // Se piden al servidor sin typecheck: aquí sólo interesan las reglas.
    expect(mockRun).toHaveBeenCalledWith('fs.propose.write', expect.objectContaining({ path: 'X.tsx', diagnose: false }));
  });

  test('sin reglas nuevas no aparece el bloque', async () => {
    mockRead.mockResolvedValue({ content: 'a\nb' });
    const onResolve = vi.fn();
    render(
      <AgentApprovalModal
        approval={approval('fs.write', { path: 'x.txt', content: 'a\nc' })}
        onResolve={onResolve}
      />
    );
    await screen.findByText('Aplicar seleccionados');
    expect(screen.queryByText(/Reglas del repo que introduce este cambio/)).toBeNull();
  });

  test('rechazar en el diff deniega la aprobación', async () => {
    mockRead.mockResolvedValue({ content: 'a\nb' });
    const onResolve = vi.fn();
    render(
      <AgentApprovalModal
        approval={approval('fs.write', { path: 'x.txt', content: 'a\nc' })}
        onResolve={onResolve}
      />
    );
    fireEvent.click(await screen.findByText('Rechazar todo'));
    expect(onResolve).toHaveBeenCalledWith(false);
  });
});
