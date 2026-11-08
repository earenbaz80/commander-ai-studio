import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PublishView } from '../../src/components/panel/PublishView';

const release = {
  id: '20261105213000-abc123',
  createdAt: '2026-11-05T21:30:00.000Z',
  fileCount: 3,
  bytes: 2048,
  outputDir: 'dist',
  built: false,
  url: '/published/mi-app/preview/',
  isPreview: true,
  isProduction: false,
};

const status = {
  project: {
    root: 'C:/tmp/mi-app',
    name: 'mi-app',
    slug: 'mi-app-1234abcd',
    buildScript: true,
    detectedOutputDir: 'dist',
  },
  preview: release,
  production: null,
  canRollback: false,
  releases: [release],
};

const remotePreview = {
  id: 'dep-preview-1',
  releaseId: release.id,
  environment: 'preview',
  url: 'https://mi-app.vercel.app',
  createdAt: '2026-11-05T21:30:00.000Z',
  status: 'ready',
  provider: 'vercel',
};

const remoteStatus = {
  provider: 'vercel',
  projectId: 'mi-app-1234abcd',
  preview: remotePreview,
  production: null,
  canRollback: false,
  deployments: [remotePreview],
};

const preflightOk = {
  ok: true,
  fileCount: 3,
  bytes: 2048,
  issues: [],
};

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body } as Response);
}

describe('PublishView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('muestra preview y publica una nueva release', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/publish/status')) {
        return jsonResponse({ success: true, status });
      }
      if (String(url).includes('/api/deploy/preflight')) {
        return jsonResponse({ success: true, preflight: preflightOk });
      }
      return jsonResponse({ success: true, status, buildLog: '' });
    });
    global.fetch = fetchMock as any;

    render(<PublishView projectPath="C:/tmp/mi-app" />);

    await waitFor(() => expect(screen.getByText('mi-app')).toBeInTheDocument());
    expect(screen.getAllByText(release.id).length).toBeGreaterThan(0);
    expect(screen.getByText('/published/mi-app/preview/')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Publicar en preview'));

    await waitFor(() => {
      const publishCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/api/publish/preview')
      );
      expect(publishCall).toBeTruthy();
      const body = JSON.parse(publishCall![1].body);
      expect(body).toMatchObject({ root: 'C:/tmp/mi-app', outputDir: 'dist', build: true });
    });
  });

  test('promueve la release de preview a producción', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/publish/status')) {
        return jsonResponse({ success: true, status });
      }
      if (String(url).includes('/api/deploy/preflight')) {
        return jsonResponse({ success: true, preflight: preflightOk });
      }
      return jsonResponse({ success: true, status: { ...status, production: release } });
    });
    global.fetch = fetchMock as any;

    render(<PublishView projectPath="C:/tmp/mi-app" />);
    await waitFor(() => expect(screen.getByText('Promover a producción')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Promover a producción'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/publish/production'));
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1].body)).toMatchObject({
        root: 'C:/tmp/mi-app',
        releaseId: release.id,
      });
    });
  });

  test('despliega, promueve y hace rollback en Vercel', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/publish/status')) {
        return jsonResponse({ success: true, status });
      }
      if (String(url).includes('/api/deploy/status')) {
        return jsonResponse({ success: true, configured: true, status: remoteStatus });
      }
      if (String(url).includes('/api/deploy/preflight')) {
        return jsonResponse({ success: true, preflight: preflightOk });
      }
      if (String(url).includes('/api/deploy/preview')) {
        return jsonResponse({ success: true, status: remoteStatus });
      }
      if (String(url).includes('/api/deploy/production')) {
        return jsonResponse({
          success: true,
          status: {
            ...remoteStatus,
            production: { ...remotePreview, environment: 'production', url: 'https://mi-app.vercel.app' },
            canRollback: true,
          },
        });
      }
      if (String(url).includes('/api/deploy/rollback')) {
        return jsonResponse({ success: true, status: remoteStatus });
      }
      if (String(url).includes('/api/deploy/logs')) {
        return jsonResponse({ success: true, log: 'vercel dep-preview-1 ready' });
      }
      return jsonResponse({ success: true });
    });
    global.fetch = fetchMock as any;

    render(<PublishView projectPath="C:/tmp/mi-app" />);
    await waitFor(() => expect(screen.getByText('Release lista para desplegar')).toBeInTheDocument());
    expect(screen.getByText('Promover remoto')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Desplegar preview'));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/deploy/preview'));
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1].body)).toMatchObject({
        root: 'C:/tmp/mi-app',
        releaseId: release.id,
      });
    });

    fireEvent.click(screen.getByText('Promover remoto'));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/deploy/production'));
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1].body)).toMatchObject({
        root: 'C:/tmp/mi-app',
        deploymentId: remotePreview.id,
      });
    });

    fireEvent.click(screen.getAllByText('Log')[0]);
    await waitFor(() => expect(screen.getByText('vercel dep-preview-1 ready')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Rollback remoto'));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/deploy/rollback'));
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1].body)).toMatchObject({ root: 'C:/tmp/mi-app' });
    });
  });

  test('sin Vercel configurado explica qué falta y no permite desplegar', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/publish/status')) {
        return jsonResponse({ success: true, status });
      }
      if (String(url).includes('/api/deploy/status')) {
        return jsonResponse({
          success: true,
          provider: 'vercel',
          configured: false,
          status: null,
          missingConfig: ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID'],
        });
      }
      if (String(url).includes('/api/deploy/preflight')) {
        return jsonResponse({ success: true, preflight: preflightOk });
      }
      return jsonResponse({ success: true });
    });
    global.fetch = fetchMock as any;

    render(<PublishView projectPath="C:/tmp/mi-app" />);

    await waitFor(() =>
      expect(screen.getByText(/Vercel no está configurado/)).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: /Desplegar preview/ })).toBeDisabled();
    expect(screen.queryByText(/fake/i)).not.toBeInTheDocument();
  });

  test('muestra los problemas del preflight y bloquea el despliegue', async () => {
    const unsafe = {
      ok: false,
      fileCount: 4,
      bytes: 4096,
      issues: [
        {
          file: 'assets/app.js.map',
          code: 'source-map',
          message: 'La release contiene un source map no permitido: assets/app.js.map',
        },
      ],
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/publish/status')) {
        return jsonResponse({ success: true, status });
      }
      if (String(url).includes('/api/deploy/status')) {
        return jsonResponse({ success: true, configured: true, status: remoteStatus });
      }
      if (String(url).includes('/api/deploy/preflight')) {
        return jsonResponse({ success: true, preflight: unsafe });
      }
      return jsonResponse({ success: true });
    });
    global.fetch = fetchMock as any;

    render(<PublishView projectPath="C:/tmp/mi-app" />);

    await waitFor(() =>
      expect(screen.getByText(unsafe.issues[0].message)).toBeInTheDocument()
    );
    expect(screen.getByText('La release tiene problemas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Desplegar preview/ })).toBeDisabled();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/deploy/preview'))
    ).toBe(false);
  });

  test('muestra el error del servidor', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: 'La carpeta de salida no existe' }),
    }) as any;

    render(<PublishView projectPath="C:/tmp/mi-app" />);

    await waitFor(() => {
      expect(screen.getByText('La carpeta de salida no existe')).toBeInTheDocument();
    });
  });

  test('sin proyecto no intenta publicar', () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    render(<PublishView projectPath="" />);

    expect(screen.getByText('Sin proyecto activo')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
