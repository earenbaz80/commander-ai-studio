import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentApprovalModal } from '../../src/components/AgentApprovalModal';
import { readProjectFile } from '../../src/utils/agentToolsApi';

vi.mock('../../src/utils/agentToolsApi', () => ({
  readProjectFile: vi.fn(),
}));

const mockRead = readProjectFile as unknown as ReturnType<typeof vi.fn>;

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
  beforeEach(() => mockRead.mockReset());

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
    expect(onResolve).toHaveBeenCalledWith(true, {
      toolId: 'fs.write',
      input: { path: 'x.txt', content: 'linea1\nCAMBIADA', overwrite: true },
    });
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
    expect(onResolve).toHaveBeenCalledWith(true, {
      toolId: 'fs.write',
      input: { path: 'p.txt', content: 'a\nB\nc', overwrite: true },
    });
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
    expect(onResolve).toHaveBeenCalledWith(true, {
      toolId: 'fs.write',
      input: { path: 'nuevo.txt', content: 'hola', overwrite: true },
    });
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
