import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import {
  normalizeStrataLocalBaseUrl,
  parseStrataLocalModelEntries,
  parseStrataLocalModels,
  parseStrataLocalStatus,
  probeStrataLocal,
  strataLocalEndpointInfo,
  strataLocalModelId,
  strataLocalModelName,
  STRATA_LOCAL_DEFAULT_BASE_URL,
} from '../../src/lib/strataLocal';
import { PROVIDER_SPECS, describeProvider } from '../../src/providers/registry';
import { detectProvider, resolveEndpoint } from '../../src/lib/aiProviders';
import { resolveChatRoute } from '../../src/lib/aiRouting';

/**
 * Strata local comparte el contrato OpenAI-compatible, pero tiene su propio id
 * y su propia URL por defecto. Lo que se prueba aquí es que la detección de
 * `/v1/models` distingue «responde», «clave rechazada» y «no está levantado»,
 * y que el modelo detectado se enruta a la ruta de Strata.
 */

const servers: Array<{ close: (callback?: (err?: Error) => void) => void }> = [];

async function fakeStrata(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('sin puerto');
  return `http://127.0.0.1:${address.port}/v1`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
});

describe('helpers de Strata local', () => {
  test('normaliza la URL, completa /v1 y usa el host local por defecto', () => {
    expect(STRATA_LOCAL_DEFAULT_BASE_URL).toBe('http://127.0.0.1:8080/v1');
    expect(normalizeStrataLocalBaseUrl('')).toBe(STRATA_LOCAL_DEFAULT_BASE_URL);
    expect(normalizeStrataLocalBaseUrl('http://127.0.0.1:9000/v1/')).toBe('http://127.0.0.1:9000/v1');
    expect(normalizeStrataLocalBaseUrl('http://127.0.0.1:9000/')).toBe('http://127.0.0.1:9000/v1');
  });

  test('conserva contexto, estado y modalidades reales de /v1/models', () => {
    const entries = parseStrataLocalModelEntries({
      data: [
        {
          id: 'strata-1',
          object: 'model',
          status: { value: 'loaded' },
          meta: { n_ctx: 32768 },
          architecture: { input_modalities: ['text', 'image'] },
          aliases: ['qwen'],
          capabilities: { tool_calls: true, parallel_tool_calls: false },
        },
        { id: 'qwen', alias_of: 'strata-1' },
      ],
    });
    expect(entries).toEqual([
      {
        id: 'strata-1',
        name: 'strata-1',
        contextWindow: 32768,
        status: 'loaded',
        aliases: ['qwen'],
        supportsTools: true,
        supportsParallelTools: false,
        inputModalities: ['text', 'image'],
      },
    ]);
  });

  test('mantiene los metadatos históricos de /v1/models', () => {
    const entries = parseStrataLocalModelEntries({
      data: [
        {
          id: 'strata-1',
          meta: { context: 32768, instanceId: 'inst-1', gpuIds: ['0'], mode: 'single', label: 'Qwen local' },
        },
      ],
    });
    expect(entries[0]).toMatchObject({
      id: 'strata-1',
      name: 'Qwen local',
      contextWindow: 32768,
      instanceId: 'inst-1',
      gpuIds: ['0'],
      mode: 'single',
    });
  });

  test('reconoce /v1/status de Strata y avisa de un host remoto sin TLS', () => {
    expect(parseStrataLocalStatus({ service: 'strata', loaded: true, model: 'strata-1', context: { native: 65536 } })).toMatchObject({
      verified: true,
      loaded: true,
      model: 'strata-1',
      contextWindow: 65536,
    });
    expect(parseStrataLocalStatus({ loaded: true, model: 'otro' })?.verified).toBe(false);
    expect(
      parseStrataLocalStatus({
        service: 'strata',
        loaded: true,
        model: 'strata-1',
        context: { native: 32768, max_positions: 32768 },
        concurrency: { serving: 1, requested: 1 },
        vram: { freeMib: 580 },
        machine: { gpu: { name: 'RTX 5060 Ti', used_mib: 15945, total_mib: 16311 }, ram: { used_gib: 56.5, total_gib: 63.9 } },
      })
    ).toMatchObject({
      verified: true,
      contextWindow: 32768,
      concurrency: { serving: 1, requested: 1 },
      machine: { gpu: { name: 'RTX 5060 Ti', usedMib: 15945, totalMib: 16311 }, ram: { usedGib: 56.5 } },
    });
    expect(strataLocalEndpointInfo('http://192.168.1.10:8080/v1')).toMatchObject({
      remote: true,
      insecureRemote: true,
    });
    expect(strataLocalEndpointInfo('http://127.0.0.1:8080/v1').remote).toBe(false);
  });

  test('acepta data y models, ids sueltos y objetos, sin duplicados', () => {
    expect(parseStrataLocalModels({ data: [{ id: 'strata-1' }, { id: 'strata-2' }, 'strata-1'] })).toEqual([
      'strata-1',
      'strata-2',
    ]);
    expect(parseStrataLocalModels({ models: [{ name: 'modelo-local' }] })).toEqual(['modelo-local']);
    expect(parseStrataLocalModels({})).toEqual([]);
  });

  test('el prefijo del selector se quita antes de llamar a Strata', () => {
    expect(strataLocalModelId('modelo-local')).toBe('strata-local/modelo-local');
    expect(strataLocalModelName('strata-local/modelo-local')).toBe('modelo-local');
    expect(strataLocalModelName('otro/modelo')).toBe('otro/modelo');
  });
});

describe('sonda de Strata local', () => {
  test('detecta /v1/models, identifica Strata y manda la API key como Bearer', async () => {
    let authorization = '';
    const baseUrl = await fakeStrata((req, res) => {
      authorization = String(req.headers.authorization || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/v1/status') {
        res.end(
          JSON.stringify({
            service: 'strata',
            loaded: true,
            model: 'strata-1',
            context: { native: 32768 },
            dialects: ['openai'],
          })
        );
        return;
      }
      res.end(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'strata-1', meta: { n_ctx: 32768 }, status: { value: 'loaded' } },
            { id: 'strata-alias', alias_of: 'strata-1' },
            { id: 'strata-2' },
          ],
        })
      );
    });

    const probe = await probeStrataLocal(baseUrl, 'clave-local');
    expect(probe.ok).toBe(true);
    expect(probe.status).toBe('ok');
    expect(probe.identity).toBe('verified');
    expect(probe.loaded).toBe(true);
    expect(probe.model).toBe('strata-1');
    expect(probe.contextWindow).toBe(32768);
    expect(probe.models).toEqual(['strata-1', 'strata-2']);
    expect(probe.entries[0]).toMatchObject({ contextWindow: 32768, status: 'loaded' });
    expect(authorization).toBe('Bearer clave-local');
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('incluye el modelo cargado que no enumera /v1/models', async () => {
    const baseUrl = await fakeStrata((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/v1/status') {
        res.end(
          JSON.stringify({
            service: 'strata',
            loaded: true,
            model: 'strata-cargado',
            context: { native: 65536 },
          })
        );
        return;
      }
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'strata-otro' }] }));
    });

    const probe = await probeStrataLocal(baseUrl);
    expect(probe.ok).toBe(true);
    expect(probe.model).toBe('strata-cargado');
    expect(probe.models).toEqual(['strata-cargado', 'strata-otro']);
    expect(probe.entries[0]).toMatchObject({
      id: 'strata-cargado',
      name: 'strata-cargado',
      status: 'loaded',
      contextWindow: 65536,
    });
  });

  test('distingue una clave rechazada de un host apagado', async () => {
    const baseUrl = await fakeStrata((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
    });

    const probe = await probeStrataLocal(baseUrl, 'clave-incorrecta');
    expect(probe.ok).toBe(false);
    expect(probe.status).toBe('auth');
    expect(probe.error).toContain('API key');
  });

  test('detecta el monitor de Strata y muestra la URL real del motor', async () => {
    const baseUrl = await fakeStrata((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/health') {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            ok: true,
            uptimeSec: 10,
            backend: { kind: 'unavailable', name: 'No Strata engine', baseUrl: null },
            engine: { status: 'stopped', running: false, port: 8080 },
            clients: 1,
          })
        );
        return;
      }
      if (req.url === '/api/native') {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            instances: [
              {
                port: 18500,
                status: 'ready',
                apiModelId: 'iq2_xs',
                key: 'no-debe-salir',
                metrics: { engine: { model: 'qwen3.8-flash-next-iq2_xs' } },
              },
            ],
          })
        );
        return;
      }
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Invalid API key' }));
    });

    const probe = await probeStrataLocal(baseUrl, 'clave-incorrecta');
    expect(probe.status).toBe('auth');
    expect(probe.monitor?.engineUrls).toEqual(['http://127.0.0.1:18500/v1']);
    expect(probe.error).toContain('monitor de Strata');
    expect(probe.error).toContain('18500');
    expect(probe.error).toContain('API key');
    expect(JSON.stringify(probe)).not.toContain('no-debe-salir');
  });

  test('un host antiguo sin /v1/status sigue usando su único modelo', async () => {
    const baseUrl = await fakeStrata((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/models') {
        res.writeHead(200);
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'modelo-antiguo' }] }));
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });

    const probe = await probeStrataLocal(baseUrl);
    expect(probe.ok).toBe(true);
    expect(probe.status).toBe('ok');
    expect(probe.identity).toBe('unverified');
    expect(probe.models).toEqual(['modelo-antiguo']);
    expect(probe.model).toBe('modelo-antiguo');
    expect(probe.loaded).toBeUndefined();
  });

  test('sin /v1/status, un host antiguo marca el modelo con status loaded', async () => {
    const baseUrl = await fakeStrata((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/models') {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            data: [
              { id: 'viejo-a', status: { value: 'unloaded' } },
              { id: 'viejo-b', status: { value: 'loaded' }, meta: { n_ctx: 16384 } },
            ],
          })
        );
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });

    const probe = await probeStrataLocal(baseUrl);
    expect(probe.ok).toBe(true);
    expect(probe.models).toEqual(['viejo-a', 'viejo-b']);
    expect(probe.model).toBe('viejo-b');
    expect(probe.loaded).toBe(true);
    expect(probe.contextWindow).toBe(16384);
  });

  test('un endpoint apagado no lanza, devuelve unreachable', async () => {
    const baseUrl = await fakeStrata((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    const probe = await probeStrataLocal(baseUrl);
    expect(probe.ok).toBe(false);
    expect(probe.status).toBe('incompatible');
    expect(probe.httpStatus).toBe(503);
  });
});

describe('registro y enrutado de Strata local', () => {
  test('el proveedor está configurado de fábrica como local', () => {
    const spec = PROVIDER_SPECS.find((item) => item.id === 'strata-local');
    expect(spec).toBeTruthy();
    expect(spec!.fields.map((field) => field.name)).toEqual(['baseUrl', 'apiKey', 'defaultModel']);
    const status = describeProvider(spec!, {}, new Set());
    expect(status.configured).toBe(true);
    expect(status.source).toBe('local');
  });

  test('el modelo detectado se resuelve a la ruta de Strata, no a HuggingFace', () => {
    expect(detectProvider('strata-local/modelo-local', 'google', [])).toBe('strata-local');
    expect(resolveEndpoint('strata-local/modelo-local')).toBe('/api/strata-local/generate');
    expect(resolveChatRoute({ modelId: 'strata-local/modelo-local' }).endpoint).toBe('/api/strata-local/generate');
  });
});
