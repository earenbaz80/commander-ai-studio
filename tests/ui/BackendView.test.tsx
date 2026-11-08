import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BackendView } from '../../src/components/panel/BackendView';

const session = {
  token: 'token-1',
  expiresAt: Date.UTC(2026, 11, 7),
  user: {
    id: 'user-1',
    email: 'ana@example.com',
    name: 'Ana',
    createdAt: '2026-11-07T10:00:00.000Z',
  },
  tenant: { id: 'tenant-1', name: 'Equipo de Ana' },
};

const record = {
  id: 'record-1',
  title: 'Primer registro',
  body: 'Contenido inicial',
  createdAt: '2026-11-07T10:00:00.000Z',
  updatedAt: '2026-11-07T10:00:00.000Z',
};

const file = {
  id: 'file-1',
  name: 'informe.pdf',
  mime: 'application/pdf',
  size: 2048,
  createdAt: '2026-11-07T10:00:00.000Z',
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function isGet(init?: RequestInit): boolean {
  return !init?.method || init.method === 'GET';
}

describe('BackendView', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  test('inicia sesión y muestra cuenta, registros y archivos', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) {
        return Promise.resolve(jsonResponse({ success: true, ...session }));
      }
      if (url.endsWith('/records') && isGet(init)) {
        return Promise.resolve(jsonResponse({ success: true, records: [record] }));
      }
      if (url.endsWith('/files') && isGet(init)) {
        return Promise.resolve(jsonResponse({ success: true, files: [file] }));
      }
      return Promise.resolve(jsonResponse({ success: false, error: 'inesperado' }, false, 500));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BackendView />);

    expect(await screen.findByText('Backend local')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await screen.findByRole('tab', { name: 'Cuentas' });
    fireEvent.click(screen.getByRole('tab', { name: 'Cuentas' }));
    expect(await screen.findByTestId('backend-account-email')).toHaveTextContent('ana@example.com');
    expect(screen.getByTestId('backend-account-tenant')).toHaveTextContent('Equipo de Ana');

    const recordsCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/records') && isGet(init as RequestInit | undefined)
    );
    expect((recordsCall?.[1]?.headers as Headers).get('Authorization')).toBe('Bearer token-1');
    expect(sessionStorage.getItem('commander_backend_token')).toBe('token-1');

    fireEvent.click(screen.getByRole('tab', { name: 'Registros' }));
    expect(await screen.findByText('Primer registro')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Archivos' }));
    expect(await screen.findByText('informe.pdf')).toBeInTheDocument();
  });

  test('crea un registro y lo añade a la lista', async () => {
    sessionStorage.setItem('commander_backend_token', 'token-1');
    const created = { ...record, id: 'record-2', title: 'Registro nuevo', body: 'Contenido' };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) {
        return Promise.resolve(jsonResponse({ success: true, user: session.user, tenant: session.tenant }));
      }
      if (url.endsWith('/records') && isGet(init)) {
        return Promise.resolve(jsonResponse({ success: true, records: [] }));
      }
      if (url.endsWith('/files') && isGet(init)) {
        return Promise.resolve(jsonResponse({ success: true, files: [] }));
      }
      if (url.endsWith('/records') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ success: true, record: created }, true, 201));
      }
      return Promise.resolve(jsonResponse({ success: false, error: 'inesperado' }, false, 500));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BackendView />);
    await screen.findByRole('tab', { name: 'Registros' });
    fireEvent.click(screen.getByRole('tab', { name: 'Registros' }));

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Registro nuevo' } });
    fireEvent.change(screen.getByLabelText('Contenido'), { target: { value: 'Contenido' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar registro' }));

    expect(await screen.findByText('Registro nuevo')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/records') && init?.method === 'POST'
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      title: 'Registro nuevo',
      body: 'Contenido',
    });
  });

  test('sube un archivo como binario con su nombre y el bearer', async () => {
    sessionStorage.setItem('commander_backend_token', 'token-1');
    const uploaded = { ...file, id: 'file-2', name: 'nota.txt', mime: 'text/plain', size: 4 };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) {
        return Promise.resolve(jsonResponse({ success: true, user: session.user, tenant: session.tenant }));
      }
      if (url.endsWith('/records') && isGet(init)) {
        return Promise.resolve(jsonResponse({ success: true, records: [] }));
      }
      if (url.endsWith('/files') && isGet(init)) {
        return Promise.resolve(jsonResponse({ success: true, files: [] }));
      }
      if (url.endsWith('/files') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ success: true, file: uploaded }, true, 201));
      }
      return Promise.resolve(jsonResponse({ success: false, error: 'inesperado' }, false, 500));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BackendView />);
    await screen.findByRole('tab', { name: 'Archivos' });
    fireEvent.click(screen.getByRole('tab', { name: 'Archivos' }));

    const input = screen.getByTestId('backend-file-input') as HTMLInputElement;
    const selected = new File(['hola'], 'nota.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [selected] } });
    fireEvent.click(screen.getByRole('button', { name: 'Subir' }));

    expect(await screen.findByText('nota.txt')).toBeInTheDocument();
    expect(screen.getByText('Archivo subido')).toBeInTheDocument();

    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/files') && init?.method === 'POST'
    );
    expect(call).toBeTruthy();
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-1');
    expect(headers['X-Commander-File-Name']).toBe('nota.txt');
    expect(headers['Content-Type']).toBe('text/plain');
    expect(call?.[1]?.body).toBe(selected);
  });
});
