/**
 * Tests del modal "Servidor LLM local":
 * cambio de servidor (Ollama / LM Studio / OpenAI-compatible), probar conexión y guardado.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocalLlmModal } from '../../src/components/LocalLlmModal';

const mockApi = () => {
  const fn = vi.fn().mockImplementation((url: string, init?: any) => {
    const u = String(url);
    if (u.startsWith('/api/lmstudio/models')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, models: ['lmstudio-model-a'] }),
      });
    }
    if (u.startsWith('/api/custom/models')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, models: ['local-model-a', 'local-model-b'] }),
      });
    }
    if (u.startsWith('/api/ollama/models')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, models: [{ name: 'llama3.2' }, { name: 'qwen2.5' }] }),
      });
    }
    if (u.startsWith('/api/keys')) {
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, value: '' }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
  global.fetch = fn as any;
  return fn;
};

describe('LocalLlmModal', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('cerrado no renderiza nada', () => {
    render(<LocalLlmModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText(/SERVIDOR LLM LOCAL/)).toBeNull();
  });

  test('probar conexión con Ollama lista los modelos del servidor', async () => {
    const fetchMock = mockApi();
    render(<LocalLlmModal isOpen onClose={() => {}} />);

    // Cambiar el host del servidor
    const hostInput = screen.getByDisplayValue('http://localhost:11434');
    fireEvent.change(hostInput, { target: { value: 'http://192.168.1.50:11434' } });

    fireEvent.click(screen.getByText('Probar conexión'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/ollama/models?host=http%3A%2F%2F192.168.1.50%3A11434');
    });
    expect(screen.getByText(/Conexión exitosa/)).toBeInTheDocument();
    expect(screen.getByText(/llama3\.2 · qwen2\.5/)).toBeInTheDocument();
  });

  test('cambiar a OpenAI-compatible prueba el endpoint y lista modelos', async () => {
    const fetchMock = mockApi();
    render(<LocalLlmModal isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByText('OpenAI-compatible'));
    expect(screen.getByDisplayValue('http://localhost:8000/v1')).toBeInTheDocument();

    const baseUrl = screen.getByDisplayValue('http://localhost:8000/v1');
    fireEvent.change(baseUrl, { target: { value: 'http://localhost:8080/v1' } });

    fireEvent.click(screen.getByText('Probar conexión'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/custom/models',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ baseURL: 'http://localhost:8080/v1' }),
        })
      );
    });
    expect(screen.getByText(/local-model-a · local-model-b/)).toBeInTheDocument();
  });

  test('LM Studio usa su propio endpoint y guarda LMSTUDIO_HOST', async () => {
    const fetchMock = mockApi();
    render(<LocalLlmModal isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByText('LM Studio'));
    const host = screen.getByDisplayValue('http://localhost:1234/v1');
    fireEvent.change(host, { target: { value: 'http://192.168.1.20:1234' } });

    fireEvent.click(screen.getByText('Probar conexión'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/lmstudio/models',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ host: 'http://192.168.1.20:1234' }),
        })
      );
    });
    expect(screen.getByText(/lmstudio-model-a/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Guardar'));
    await waitFor(() => {
      const posts = fetchMock.mock.calls
        .filter((c: any) => c[0] === '/api/keys' && c[1]?.method === 'POST')
        .map((c: any) => JSON.parse(c[1].body));
      expect(posts).toContainEqual({ key: 'LMSTUDIO_HOST', value: 'http://192.168.1.20:1234' });
    });
  });

  test('guardar persiste el servidor en cookies y en localStorage', async () => {
    const fetchMock = mockApi();
    render(<LocalLlmModal isOpen onClose={() => {}} />);

    const hostInput = screen.getByDisplayValue('http://localhost:11434');
    fireEvent.change(hostInput, { target: { value: 'http://localhost:11435' } });
    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c: any) => c[0] === '/api/keys' && c[1]?.method === 'POST'
      );
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1].body)).toMatchObject({
        key: 'OLLAMA_HOST',
        value: 'http://localhost:11435',
      });
    });
    expect(localStorage.getItem('OLLAMA_HOST')).toBe('http://localhost:11435');
    expect(screen.getByText(/Configuración guardada/)).toBeInTheDocument();
  });

  test('en modo OpenAI-compatible guarda baseURL, modelo y api key', async () => {
    const fetchMock = mockApi();
    render(<LocalLlmModal isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByText('OpenAI-compatible'));
    fireEvent.change(screen.getByDisplayValue('http://localhost:8000/v1'), {
      target: { value: 'http://localhost:5000/v1' },
    });
    const modelInput = screen.getByPlaceholderText('llama-3.1-8b');
    fireEvent.change(modelInput, { target: { value: 'mi-modelo-8b' } });
    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => {
      const posts = fetchMock.mock.calls
        .filter((c: any) => c[0] === '/api/keys' && c[1]?.method === 'POST')
        .map((c: any) => JSON.parse(c[1].body));
      expect(posts).toContainEqual({ key: 'CUSTOM_BASE_URL', value: 'http://localhost:5000/v1' });
      expect(localStorage.getItem('CUSTOM_MODEL')).toBe('mi-modelo-8b');
    });
  });
});