import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ExtensionsSettings } from '../../src/components/settings/ExtensionsSettings';

const CHECKSUM = `sha256:${'a'.repeat(64)}`;

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExtensionsSettings · plugins instalados', () => {
  test('la fila muestra API, permisos y checksum', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === '/api/plugins') {
          return jsonResponse({
            success: true,
            plugins: [
              {
                id: 'demo',
                name: 'Demo Plugin',
                version: '1.2.3',
                apiVersion: 1,
                permissions: ['lifecycle', 'tools'],
                checksum: CHECKSUM,
                source: 'local',
              },
            ],
          });
        }
        if (url.startsWith('/api/plugins/discover')) {
          return jsonResponse({ success: true, results: [] });
        }
        return jsonResponse({ success: true });
      }),
    );

    render(<ExtensionsSettings initialTab="plugins" lang="es" />);

    const row = await screen.findByTestId('plugin-row-demo');
    expect(within(row).getByText('Demo Plugin')).toBeInTheDocument();
    expect(row).toHaveTextContent('v1.2.3');
    expect(row).toHaveTextContent('API 1');
    expect(row).toHaveTextContent('permisos: lifecycle, tools');
    expect(row).toHaveTextContent(`checksum: ${CHECKSUM}`);
  });
});
