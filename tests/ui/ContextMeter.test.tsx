/**
 * Indicador de contexto: porcentaje estimado, desglose al pulsarlo y perfiles
 * de esfuerzo que salen del `thinkingLevel` vigente.
 */
import { beforeEach, describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMeter } from '../../src/components/chat/ContextMeter';
import type { AIModel, ChatMessage, ParameterConfig } from '../../src/types/studio';

const model: AIModel = {
  id: 'demo',
  name: 'Demo',
  provider: 'google',
  description: '',
  contextWindow: '4K tokens',
};

const params: ParameterConfig = {
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  maxTokens: 1000,
  thinkingLevel: 'LOW',
  responseFormat: 'text',
  systemInstruction: 'x'.repeat(400), // 100 tokens
  examples: [],
  hfQuantization: 'fp16',
};

const messages: ChatMessage[] = [
  { id: 'm1', role: 'user', content: 'y'.repeat(3600), timestamp: '' }, // 900 + 4
];

describe('ContextMeter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('muestra el porcentaje y el total estimados', () => {
    render(<ContextMeter messages={messages} parameters={params} model={model} lang="es" />);

    // 100 de sistema + 904 de conversación = 1004 de 4000 → 25 %
    expect(screen.getByTestId('context-percent').textContent).toBe('25%');
    expect(screen.getByTestId('context-meter').textContent).toContain('1K/4K');
    expect(screen.getByTestId('context-meter').textContent).toContain('1 msg');
    expect(screen.queryByTestId('context-details')).toBeNull();
  });

  test('el desglose aparece al pulsar el indicador', () => {
    render(<ContextMeter messages={messages} parameters={params} model={model} lang="es" />);

    const toggle = screen.getByRole('button', { expanded: false, name: /CTX/ });
    fireEvent.click(toggle);

    const details = screen.getByTestId('context-details');
    expect(details.textContent).toContain('Instrucciones y ejemplos');
    expect(details.textContent).toContain('Ventana del modelo');
    expect(details.textContent).toContain('Reservado a la respuesta');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  test('marca el perfil vigente y avisa del elegido', () => {
    const onChangeEffort = vi.fn();
    render(
      <ContextMeter
        messages={messages}
        parameters={params}
        model={model}
        lang="es"
        onChangeEffort={onChangeEffort}
      />
    );

    // `thinkingLevel: 'LOW'` es el perfil equilibrado.
    expect(screen.getByRole('button', { name: 'Equilibrado' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Potente' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Potente' }));
    expect(onChangeEffort).toHaveBeenCalledWith('powerful');
  });

  test('se pliega y recuerda el estado al volver a montar', () => {
    const { unmount } = render(<ContextMeter messages={messages} parameters={params} model={model} lang="es" />);

    fireEvent.click(screen.getByLabelText('Plegar barra de contexto'));
    expect(screen.queryByRole('button', { name: 'Potente' })).toBeNull();
    expect(screen.getByLabelText('Mostrar barra de contexto')).toBeInTheDocument();
    expect(screen.getByTestId('context-percent').textContent).toBe('25%');

    unmount();
    render(<ContextMeter messages={messages} parameters={params} model={model} lang="es" />);
    expect(screen.getByLabelText('Mostrar barra de contexto')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Potente' })).toBeNull();

    fireEvent.click(screen.getByLabelText('Mostrar barra de contexto'));
    expect(screen.getByRole('button', { name: 'Potente' })).toBeInTheDocument();
  });

  test('el atajo global pliega y despliega la barra', () => {
    render(<ContextMeter messages={messages} parameters={params} model={model} lang="es" />);

    fireEvent(window, new Event('commander:toggle-context-meter'));
    expect(screen.getByLabelText('Mostrar barra de contexto')).toBeInTheDocument();
    expect(localStorage.getItem('commander_context_meter_collapsed')).toBe('1');

    fireEvent(window, new Event('commander:toggle-context-meter'));
    expect(screen.getByLabelText('Plegar barra de contexto')).toBeInTheDocument();
    expect(localStorage.getItem('commander_context_meter_collapsed')).toBe('0');
  });

  test('sin callback los perfiles quedan desactivados', () => {
    render(<ContextMeter messages={[]} parameters={params} model={model} lang="es" />);
    expect((screen.getByRole('button', { name: 'Rápido' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
