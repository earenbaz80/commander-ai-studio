/**
 * Armazón de los playgrounds: barra de modos, modelo activo a la vista y
 * montaje de las pantallas que ya viven dentro (chat y libre).
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Playground } from '../../src/components/Playground';
import { DEFAULT_PARAMETERS } from '../../src/hooks/useTabs';

describe('Playground', () => {
  test('cambia de modo desde la barra y muestra el modelo activo', () => {
    const setMode = vi.fn();
    render(
      <Playground mode="chat" setMode={setMode} lang="es" selectedModel="gemini-2.5-pro">
        <div>contenido</div>
      </Playground>
    );

    expect(screen.getByTestId('playground-mode-chat').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('playground-mode-compare').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('playground-model').textContent).toBe('gemini-2.5-pro');
    expect(screen.getByText('contenido')).toBeTruthy();

    fireEvent.click(screen.getByTestId('playground-mode-compare'));
    expect(setMode).toHaveBeenCalledWith('compare');
  });

  test('deja pasar los modos que no son playground', () => {
    const { container } = render(
      <Playground mode="agent" setMode={vi.fn()} lang="es">
        <div>agente</div>
      </Playground>
    );
    expect(container.textContent).toBe('');
  });

  test('monta la pantalla libre con sus props, sin children', () => {
    render(
      <Playground
        mode="freeform"
        setMode={vi.fn()}
        lang="es"
        selectedModel="gemini-2.5-pro"
        freeform={{
          parameters: { ...DEFAULT_PARAMETERS },
          setParameters: vi.fn(),
          selectedModel: 'gemini-2.5-pro',
          selectedProvider: 'google',
          isGenerating: false,
          onExecute: vi.fn(async () => undefined),
          lang: 'es',
        }}
      />
    );

    expect(screen.getByPlaceholderText('Escribe tu prompt aquí...')).toBeTruthy();
    expect(screen.getByText('[EJECUTAR PROMPT (F2)]')).toBeTruthy();
  });
});
