import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProviderManager } from '../../src/components/panel/ProviderManager';

const model = (id: string) => ({ id, name: id });

const provider = {
  id: 'groq',
  name: 'Groq',
  env: [],
  fields: [],
  configured: true,
  missing: [],
  source: 'file',
  models: [model('model-a'), model('model-b')],
  allModels: [model('model-a'), model('model-b')],
  modelCount: 2,
  totalModels: 2,
  enabled: true,
  whitelist: [],
  blacklist: ['model-b'],
};

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('ProviderManager: modelos activables', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/providers') && (!init || init.method === undefined)) {
        return json({ success: true, providers: [provider], writePath: '/tmp/config.json' });
      }
      return json({ success: true });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('lista todos los modelos y apaga el que está en la lista negra', async () => {
    render(<ProviderManager embedded lang="es" />);
    await screen.findByText('Groq');
    fireEvent.click(screen.getByText('Groq'));

    const encendido = screen.getByRole('switch', { name: 'Desactivar: model-a' });
    const apagado = screen.getByRole('switch', { name: 'Activar: model-b' });
    expect(encendido).toHaveAttribute('aria-checked', 'true');
    expect(encendido.className).toContain('text-emerald-300');
    expect(apagado).toHaveAttribute('aria-checked', 'false');
    expect(apagado.className).toContain('text-red-400');
    expect(screen.getByText('desactivado')).toBeTruthy();
  });

  test('el switch guarda el modelo apagado en el PATCH del proveedor', async () => {
    render(<ProviderManager embedded lang="es" />);
    await screen.findByText('Groq');
    fireEvent.click(screen.getByText('Groq'));

    fireEvent.click(screen.getByRole('switch', { name: 'Desactivar: model-a' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/providers/groq'),
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('model-a'),
        })
      );
    });
  });
});
