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
  modelCount: 1,
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

  test('filtra los modelos del proveedor por nombre o id', async () => {
    render(<ProviderManager embedded lang="es" />);
    await screen.findByText('Groq');
    fireEvent.click(screen.getByText('Groq'));

    const buscador = screen.getByLabelText('Buscar modelos de Groq');
    fireEvent.change(buscador, { target: { value: 'b' } });
    expect(screen.queryByText('model-a')).toBeNull();
    expect(screen.getByText('model-b')).toBeInTheDocument();

    fireEvent.change(buscador, { target: { value: 'zzz' } });
    expect(screen.getByText('Ningún modelo coincide')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Limpiar búsqueda'));
    expect(screen.getByText('model-a')).toBeInTheDocument();
    expect(screen.getByText('model-b')).toBeInTheDocument();
  });

  test('avisa y espera confirmación antes de añadir un endpoint no compatible', async () => {
    const cuerpos: any[] = [];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/api/providers') && (!init || init.method === undefined)) {
        return json({ success: true, providers: [provider], writePath: '/tmp/config.json' });
      }
      if (target.endsWith('/api/providers/available')) {
        return json({ success: true, providers: [] });
      }
      if (target.endsWith('/api/providers/custom')) {
        const body = JSON.parse(String(init?.body || '{}'));
        cuerpos.push(body);
        if (body.force === true) return json({ success: true, id: 'nuevo' });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: false,
              incompatible: true,
              status: 'incompatible',
              httpStatus: 404,
              error: 'HTTP 404',
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      return json({ success: true });
    });

    render(<ProviderManager embedded lang="es" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir proveedor' }));
    await waitFor(() => expect(screen.getByPlaceholderText('https://api.groq.com/openai/v1')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('groq'), { target: { value: 'nuevo' } });
    fireEvent.change(screen.getByPlaceholderText('Groq'), { target: { value: 'Nuevo' } });
    fireEvent.change(screen.getByPlaceholderText('https://api.groq.com/openai/v1'), {
      target: { value: 'https://ejemplo.test/v1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir' }));

    expect(await screen.findByText('Este endpoint no parece OpenAI-compatible')).toBeInTheDocument();
    expect(cuerpos).toHaveLength(1);
    expect(cuerpos[0].force).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Añadir de todos modos' }));
    await waitFor(() => expect(cuerpos).toHaveLength(2));
    expect(cuerpos[1].force).toBe(true);
  });

  test('comprueba la compatibilidad al pegar la URL sin pulsar Añadir', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/api/providers') && (!init || init.method === undefined)) {
        return json({ success: true, providers: [provider], writePath: '/tmp/config.json' });
      }
      if (target.endsWith('/api/providers/available')) {
        return json({ success: true, providers: [] });
      }
      if (target.endsWith('/api/providers/detect')) {
        return json({ success: true, compatible: true, status: 'compatible', models: ['model-a'] });
      }
      return json({ success: true });
    });

    render(<ProviderManager embedded lang="es" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir proveedor' }));
    const url = await screen.findByPlaceholderText('https://api.groq.com/openai/v1');
    fireEvent.change(url, { target: { value: 'https://ejemplo.test/v1' } });

    expect(await screen.findByText('Endpoint compatible', undefined, { timeout: 2500 })).toBeInTheDocument();
    const detectCall = fetchMock.mock.calls.find(([target]) => String(target).endsWith('/api/providers/detect'));
    expect(detectCall).toBeTruthy();
    expect(JSON.parse(String(detectCall?.[1]?.body || '{}')).baseURL).toBe('https://ejemplo.test/v1');
  });

  test('muestra cuántos modelos detectó sin rellenar el campo automáticamente', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/api/providers') && (!init || init.method === undefined)) {
        return json({ success: true, providers: [provider], writePath: '/tmp/config.json' });
      }
      if (target.endsWith('/api/providers/available')) return json({ success: true, providers: [] });
      if (target.endsWith('/api/providers/detect')) {
        return json({
          success: true,
          compatible: true,
          status: 'compatible',
          models: ['model-a', 'model-b', 'model-c'],
        });
      }
      return json({ success: true });
    });

    render(<ProviderManager embedded lang="es" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir proveedor' }));
    const url = await screen.findByPlaceholderText('https://api.groq.com/openai/v1');
    fireEvent.change(url, { target: { value: 'https://ejemplo.test/v1' } });

    expect(await screen.findByText('Endpoint compatible', undefined, { timeout: 2500 })).toBeInTheDocument();
    expect(screen.getByText('· 3 modelos')).toBeInTheDocument();
    expect(
      (screen.getByPlaceholderText('se detectan al pulsar el botón, o sepáralos por comas') as HTMLTextAreaElement).value
    ).toBe('');
  });

  test('avisa de un endpoint incompatible al pegar la URL sin pulsar Añadir', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/api/providers') && (!init || init.method === undefined)) {
        return json({ success: true, providers: [provider], writePath: '/tmp/config.json' });
      }
      if (target.endsWith('/api/providers/available')) return json({ success: true, providers: [] });
      if (target.endsWith('/api/providers/detect')) {
        return json({ success: true, compatible: false, status: 'incompatible', httpStatus: 404, error: 'HTTP 404' });
      }
      return json({ success: true });
    });

    render(<ProviderManager embedded lang="es" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir proveedor' }));
    const url = await screen.findByPlaceholderText('https://api.groq.com/openai/v1');
    fireEvent.change(url, { target: { value: 'https://no-compatible.test/v1' } });

    expect(
      await screen.findByText('Este endpoint no parece OpenAI-compatible', undefined, { timeout: 2500 })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Añadir de todos modos' })).toBeInTheDocument();
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

  /** Simula un servidor que aplica el PATCH y devuelve el proveedor actualizado. */
  const useMutableProvider = () => {
    let currentProvider = {
      ...provider,
      models: [...provider.models],
      allModels: [...provider.allModels],
      whitelist: [...provider.whitelist] as string[],
      blacklist: [...provider.blacklist],
    };

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/api/providers') && (!init || init.method === undefined)) {
        return json({ success: true, providers: [currentProvider], writePath: '/tmp/config.json' });
      }
      if (target.endsWith('/api/providers/groq') && init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body || '{}')) as {
          whitelist: string[];
          blacklist: string[];
        };
        const enabledModels = currentProvider.allModels.filter((item) => {
          if (patch.blacklist.includes(item.id)) return false;
          return patch.whitelist.length === 0 || patch.whitelist.includes(item.id);
        });
        currentProvider = {
          ...currentProvider,
          ...patch,
          models: enabledModels,
          modelCount: enabledModels.length,
        };
        return json({ success: true });
      }
      return json({ success: true });
    });

    return () => currentProvider;
  };

  test('activa todos los modelos del proveedor de una vez', async () => {
    const getProvider = useMutableProvider();
    render(<ProviderManager embedded lang="es" />);
    await screen.findByText('Groq');
    fireEvent.click(screen.getByText('Groq'));

    const activarTodos = screen.getByRole('button', { name: 'Activar todos los modelos de Groq' });
    expect(activarTodos).toBeEnabled();
    fireEvent.click(activarTodos);

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Desactivar: model-b' })).toHaveAttribute('aria-checked', 'true');
    });
    expect(getProvider().whitelist).toEqual([]);
    expect(getProvider().blacklist).toEqual([]);
    expect(await screen.findByText('Groq: todos los modelos activados')).toBeInTheDocument();
  });

  test('desactiva todos los modelos del proveedor de una vez', async () => {
    const getProvider = useMutableProvider();
    render(<ProviderManager embedded lang="es" />);
    await screen.findByText('Groq');
    fireEvent.click(screen.getByText('Groq'));

    const desactivarTodos = screen.getByRole('button', { name: 'Desactivar todos los modelos de Groq' });
    expect(desactivarTodos).toBeEnabled();
    fireEvent.click(desactivarTodos);

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Activar: model-a' })).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByRole('switch', { name: 'Activar: model-b' })).toHaveAttribute('aria-checked', 'false');
    });
    expect(getProvider().whitelist).toEqual([]);
    expect(getProvider().blacklist).toEqual(['model-a', 'model-b']);
    expect(await screen.findByText('Groq: todos los modelos desactivados')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar todos los modelos de Groq' })).toBeDisabled();
  });
});
