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

  test('las pestañas de proveedor van en una línea con scroll horizontal', () => {
    renderPicker({
      groups: [
        { id: 'google', label: 'Google Gemini', models: [model('google/a')], status: 'connected' },
        { id: 'ollama', label: 'Ollama', models: [model('ollama/a')], status: 'offline' },
        { id: 'lmstudio', label: 'LM Studio', models: [model('lmstudio/a')], status: 'saved' },
      ],
    });
    open();

    const tabs = screen.getByTestId('model-provider-tabs');
    expect(tabs).toHaveClass('flex-nowrap', 'overflow-x-auto', 'nc-x-scroll');
    expect(tabs.style.touchAction).toBe('pan-x');
    expect(tabs.contains(screen.getByRole('button', { name: 'Mostrar desactivados' }))).toBe(false);
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveClass(
      'shrink-0',
      'whitespace-nowrap',
      'text-[10px]'
    );
  });

  test('la rueda vertical desplaza las pestañas en horizontal y no atrapa en el extremo', () => {
    renderPicker({
      groups: [
        { id: 'google', label: 'Google Gemini', models: [model('google/a')], status: 'connected' },
        { id: 'ollama', label: 'Ollama', models: [model('ollama/a')], status: 'offline' },
      ],
    });
    open();

    const tabs = screen.getByTestId('model-provider-tabs');
    Object.defineProperty(tabs, 'scrollWidth', { configurable: true, value: 500 });
    Object.defineProperty(tabs, 'clientWidth', { configurable: true, value: 200 });
    Object.defineProperty(tabs, 'scrollLeft', { configurable: true, writable: true, value: 0 });

    const first = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    tabs.dispatchEvent(first);
    expect(tabs.scrollLeft).toBe(120);
    expect(first.defaultPrevented).toBe(true);

    // En el extremo derecho (500 - 200) no se secuestra la rueda: la página
    // puede seguir desplazándose en vertical.
    tabs.scrollLeft = 300;
    const atEnd = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    tabs.dispatchEvent(atEnd);
    expect(tabs.scrollLeft).toBe(300);
    expect(atEnd.defaultPrevented).toBe(false);
  });

  test('las flechas recorren las pestañas de proveedor y mantienen visible la activa', () => {
    const original = Element.prototype.scrollIntoView;
    const scrolled: Element[] = [];
    (Element.prototype as any).scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };

    try {
      renderPicker({
        groups: [
          { id: 'google', label: 'Google Gemini', models: [model('google/a')], status: 'connected' },
          { id: 'ollama', label: 'Ollama', models: [model('ollama/a')], status: 'offline' },
          { id: 'lmstudio', label: 'LM Studio', models: [model('lmstudio/a')], status: 'saved' },
        ],
      });
      open();

      const all = screen.getByRole('button', { name: 'Todos' });
      const google = screen.getByRole('button', { name: 'Google Gemini' });
      const lmstudio = screen.getByRole('button', { name: 'LM Studio' });

      all.focus();
      scrolled.length = 0;
      fireEvent.keyDown(all, { key: 'ArrowRight' });
      expect(google).toHaveAttribute('aria-pressed', 'true');
      expect(document.activeElement).toBe(google);
      expect(scrolled).toContain(google);

      fireEvent.keyDown(google, { key: 'ArrowLeft' });
      expect(all).toHaveAttribute('aria-pressed', 'true');
      expect(document.activeElement).toBe(all);
      expect(scrolled).toContain(all);

      fireEvent.keyDown(all, { key: 'End' });
      expect(lmstudio).toHaveAttribute('aria-pressed', 'true');
      expect(document.activeElement).toBe(lmstudio);
      expect(scrolled).toContain(lmstudio);

      fireEvent.keyDown(lmstudio, { key: 'Home' });
      expect(all).toHaveAttribute('aria-pressed', 'true');
      expect(document.activeElement).toBe(all);
      expect(scrolled).toContain(all);

      // También envuelve de la primera a la última.
      fireEvent.keyDown(all, { key: 'ArrowLeft' });
      expect(lmstudio).toHaveAttribute('aria-pressed', 'true');
      expect(document.activeElement).toBe(lmstudio);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
