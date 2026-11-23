/**
 * Panel de bindings del backend gestionado (PL3) dentro de Publicar.
 *
 * Cubre lo que el usuario ve y puede hacer sin que un secreto llegue al
 * cliente: deshabilitado mientras no hay proveedor (G3), bindings y
 * migraciones con el doble encendido, y aprovisionar llamando a la ruta y
 * reflejando el estado nuevo. Los valores de las credenciales no se muestran
 * nunca; sólo sus nombres.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BackendBindingsPanel } from '../../src/components/panel/BackendBindingsPanel';
import type { BackendStatus } from '../../deploy/backend/types';

const projectId = 'proj-pl3';

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

function fakeStatus(overrides: Partial<BackendStatus> = {}): BackendStatus {
  return {
    provider: 'fake',
    projectId,
    bindings: [],
    migrations: { applied: [], pending: [] },
    secretNames: [],
    ready: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BackendBindingsPanel', () => {
  test('sin proveedor queda deshabilitado y no ofrece aprovisionar', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      jsonResponse({
        success: true,
        provider: 'none',
        configured: false,
        enabled: false,
        status: null,
        missingConfig: ['COMMANDER_BACKEND_FAKE'],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<BackendBindingsPanel projectId={projectId} lang="es" />);

    await waitFor(() => expect(screen.getByText('sin proveedor')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `/api/backend/manage/status?projectId=${projectId}`
    );
    // La ruta responde «deshabilitado» y el panel lo dice tal cual: no inventa
    // provider ni deja pedir bindings que nadie puede aprovisionar.
    expect(screen.getByText(/COMMANDER_BACKEND_FAKE=1/)).toBeTruthy();
    expect(screen.queryByTestId('backend-provision')).toBeNull();
    expect(screen.queryByTestId('backend-binding-database')).toBeNull();
  });

  test('con el doble encendido muestra bindings, migraciones y nombres de credenciales', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse({
          success: true,
          provider: 'fake',
          configured: true,
          enabled: true,
          status: fakeStatus({
            bindings: [
              { kind: 'database', resourceId: 'res-database-1', state: 'ready' },
              { kind: 'storage', resourceId: 'res-storage-2', state: 'ready' },
              { kind: 'auth', resourceId: 'res-auth-3', state: 'pending' },
            ],
            migrations: { applied: ['001_init'], pending: ['002_indexes'] },
            secretNames: ['DATABASE_URL'],
            ready: false,
          }),
        })
      )
    );

    render(<BackendBindingsPanel projectId={projectId} lang="es" />);

    await waitFor(() => expect(screen.getByText('fake')).toBeTruthy());

    const database = await screen.findByTestId('backend-binding-database');
    expect(database.getAttribute('data-state')).toBe('ready');
    expect(screen.getByTestId('backend-binding-storage').getAttribute('data-state')).toBe('ready');
    expect(screen.getByTestId('backend-binding-auth').getAttribute('data-state')).toBe('pending');

    const summary = screen.getByTestId('backend-bindings');
    expect(summary.textContent).toContain('1 aplicadas');
    expect(summary.textContent).toContain('1 pendientes');
    expect(summary.textContent).toContain('DATABASE_URL');

    // `ready` es false: hay un binding pendiente, así que no se anuncia LISTO.
    expect(screen.queryByText('LISTO')).toBeNull();
    expect(screen.getByTestId('backend-provision')).toBeTruthy();
  });

  test('aprovisionar llama a la ruta y refleja el estado sin valores de credenciales', async () => {
    const secretValue = 'fake-database-url-deadbeef';
    const provisioned = fakeStatus({
      bindings: [
        { kind: 'database', resourceId: 'res-database-1', state: 'ready' },
        { kind: 'storage', resourceId: 'res-storage-2', state: 'ready' },
        { kind: 'auth', resourceId: 'res-auth-3', state: 'ready' },
      ],
      migrations: { applied: ['001_init', '002_indexes'], pending: [] },
      secretNames: ['DATABASE_URL', 'STORAGE_SECRET', 'AUTH_SECRET'],
      ready: true,
    });

    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (String(url).includes('/api/backend/manage/provision')) {
        return jsonResponse({
          success: true,
          provider: 'fake',
          status: provisioned,
          // Un adaptador no devuelve valores; si alguno se colara en la
          // respuesta, el panel no debe pintarlo.
          secrets: { DATABASE_URL: secretValue },
        });
      }
      return jsonResponse({
        success: true,
        provider: 'fake',
        configured: true,
        enabled: true,
        status: fakeStatus(),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BackendBindingsPanel projectId={projectId} lang="es" />);

    const button = await screen.findByTestId('backend-provision');
    fireEvent.click(button);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/api/backend/manage/provision')
      );
      expect(call).toBeTruthy();
      expect(call![1]).toMatchObject({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(JSON.parse(String(call![1]?.body))).toEqual({
        projectId,
        bindings: ['database', 'storage', 'auth'],
      });
    });

    // El estado nuevo se refleja sin recargar a mano.
    await waitFor(() =>
      expect(
        screen.getByTestId('backend-binding-database').getAttribute('data-state')
      ).toBe('ready')
    );
    const summary = screen.getByTestId('backend-bindings');
    expect(summary.textContent).toContain('2 aplicadas');
    expect(summary.textContent).toContain('AUTH_SECRET');
    expect(screen.getByText('LISTO')).toBeTruthy();

    // Nombres sí, valores no: el secreto no aparece en ningún nodo del panel.
    expect(summary.textContent).not.toContain(secretValue);
    expect(document.body.textContent).not.toContain(secretValue);
  });
});
