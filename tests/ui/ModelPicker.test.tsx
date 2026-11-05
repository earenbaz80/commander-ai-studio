import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModelPicker } from '../../src/components/chat/ModelPicker';
import type { ModelGroup } from '../../src/components/chat/modelGroups';
import type { AIModel } from '../../src/types/studio';

const model = (id: string): AIModel => ({
  id,
  name: id,
  provider: 'lmstudio',
  description: '',
  contextWindow: '32K',
});

const groups = (...models: AIModel[]): ModelGroup[] => [
  { id: 'lmstudio', label: 'LM Studio', models, status: 'saved' },
];

const renderPicker = (props: Partial<React.ComponentProps<typeof ModelPicker>> = {}) =>
  render(
    <ModelPicker
      lang="es"
      selectedModel="lmstudio/a"
      groups={groups(model('lmstudio/a'), model('lmstudio/b'))}
      onSelectModel={vi.fn()}
      {...props}
    />
  );

const open = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Modelo que se usará para responder' }));

describe('ModelPicker: modelos activados y desactivados', () => {
  test('oculta los desactivados y los muestra al pedirlo', () => {
    renderPicker({ disabledIds: new Set(['lmstudio/b']) });
    open();

    expect(screen.queryByText('lmstudio/b')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar desactivados' }));
    expect(screen.getByText('lmstudio/b')).toBeTruthy();
  });

  test('el interruptor pide desactivar un modelo activo', () => {
    const onToggleModel = vi.fn();
    renderPicker({ onToggleModel });
    open();

    fireEvent.click(screen.getByRole('switch', { name: 'Desactivar: lmstudio/a' }));
    expect(onToggleModel).toHaveBeenCalledWith('lmstudio/a', false);
  });

  test('el interruptor pide reactivar un modelo apagado', () => {
    const onToggleModel = vi.fn();
    renderPicker({ disabledIds: new Set(['lmstudio/b']), onToggleModel });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar desactivados' }));

    fireEvent.click(screen.getByRole('switch', { name: 'Activar: lmstudio/b' }));
    expect(onToggleModel).toHaveBeenCalledWith('lmstudio/b', true);
  });

  test('un proveedor configurado sin modelos sigue apareciendo', () => {
    renderPicker({ groups: [{ id: 'ollama', label: 'Ollama', models: [], status: 'offline' }] });
    open();

    expect(screen.getByRole('group', { name: 'Ollama' })).toBeTruthy();
    expect(screen.getByText('Sin modelos detectados')).toBeTruthy();
  });

  test('avisa cuando todos los modelos del grupo están desactivados', () => {
    renderPicker({ disabledIds: new Set(['lmstudio/a', 'lmstudio/b']) });
    open();

    expect(screen.getByText('Todos los modelos están desactivados')).toBeTruthy();
  });
});
