/**
 * Sonda de proveedores locales: distingue «configurado y sin respuesta» de
 * «sin configurar», que es lo que confundía a LM Studio estando fuera de casa.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { localProbeUrl, probeLocalProvider, resetLocalProbeCache } from '../../src/providers/localProbe';

const respond = (status: number) =>
  (async () => ({ ok: status >= 200 && status < 300, status })) as unknown as typeof fetch;

beforeEach(() => {
  resetLocalProbeCache();
});

describe('sonda de proveedores locales', () => {
  it('usa el endpoint de modelos que corresponde a cada proveedor', () => {
    expect(localProbeUrl('ollama', 'http://192.168.178.77:11434/')).toBe('http://192.168.178.77:11434/api/tags');
    expect(localProbeUrl('lmstudio', 'http://192.168.178.77:1234/v1')).toBe('http://192.168.178.77:1234/v1/models');
    expect(localProbeUrl('custom', 'http://localhost:8000/v1/')).toBe('http://localhost:8000/v1/models');
  });

  it('marca alcanzable cuando el host responde', async () => {
    const result = await probeLocalProvider('lmstudio', 'http://ok.example:1234/v1', { fetcher: respond(200) });
    expect(result.reachable).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('marca sin respuesta y guarda el motivo cuando el host devuelve error', async () => {
    const result = await probeLocalProvider('lmstudio', 'http://error.example:1234/v1', { fetcher: respond(503) });
    expect(result.reachable).toBe(false);
    expect(result.error).toBe('HTTP 503');
  });

  it('marca sin respuesta cuando la conexión falla', async () => {
    const fetcher = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await probeLocalProvider('ollama', 'http://caido.example:11434', { fetcher });
    expect(result.reachable).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('cachea el resultado para no sondear en cada apertura del gestor', async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;

    await probeLocalProvider('lmstudio', 'http://cache.example:1234/v1', { fetcher });
    await probeLocalProvider('lmstudio', 'http://cache.example:1234/v1', { fetcher });

    expect(calls).toBe(1);
  });
});
