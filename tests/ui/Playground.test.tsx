/**
 * Armazón de los playgrounds: barra de modos, modelo activo a la vista y
 * montaje del contenido activo sin tocar su lógica.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Playground } from '../../src/components/Playground';

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
});
