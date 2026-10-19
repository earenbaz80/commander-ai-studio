import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CheckpointsView } from '../../src/components/panel/CheckpointsView';
import {
  listCheckpoints,
  restoreCheckpoint,
  createCheckpoint,
} from '../../src/utils/checkpointsApi';

vi.mock('../../src/utils/checkpointsApi', () => ({
  listCheckpoints: vi.fn(),
  restoreCheckpoint: vi.fn(),
  createCheckpoint: vi.fn(),
}));

const mockList = listCheckpoints as unknown as ReturnType<typeof vi.fn>;
const mockRestore = restoreCheckpoint as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createCheckpoint as unknown as ReturnType<typeof vi.fn>;

describe('CheckpointsView', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockRestore.mockReset();
    mockCreate.mockReset();
  });

  test('muestra la lista de checkpoints del proyecto', async () => {
    mockList.mockResolvedValue({
      checkpoints: [
        { id: 'c1', ts: Date.now(), label: 'fs.write a.txt', tool: 'fs.write', files: [{ path: 'a.txt', existed: true }] },
      ],
    });
    render(<CheckpointsView projectPath="P" />);
    expect(await screen.findByText('fs.write a.txt')).toBeTruthy();
    expect(screen.getByText(/1 archivo/)).toBeTruthy();
  });

  test('estado vacío cuando no hay checkpoints', async () => {
    mockList.mockResolvedValue({ checkpoints: [] });
    render(<CheckpointsView projectPath="P" />);
    expect(await screen.findByText(/Sin puntos de control/)).toBeTruthy();
  });

  test('restaurar pide confirmación y llama a la API', async () => {
    mockList.mockResolvedValue({
      checkpoints: [{ id: 'c1', ts: Date.now(), label: 'cp', files: [] }],
    });
    mockRestore.mockResolvedValue({ ok: true, restored: ['a.txt'], deleted: [] });
    render(<CheckpointsView projectPath="P" />);

    fireEvent.click(await screen.findByText('Restaurar'));
    fireEvent.click(screen.getByText('Sí'));

    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('c1', 'P'));
  });

  test('crear un punto de control llama a la API', async () => {
    mockList.mockResolvedValue({ checkpoints: [] });
    mockCreate.mockResolvedValue({ ok: true, checkpoint: { id: 'x', ts: Date.now(), label: 'm', files: [] } });
    render(<CheckpointsView projectPath="P" />);

    fireEvent.click(screen.getByLabelText('Crear punto de control'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(undefined, 'P'));
  });
});
