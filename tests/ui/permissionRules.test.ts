import { describe, expect, it } from 'vitest';
import { syncRulesWithServer } from '../../src/agent/permissionRules';

/**
 * `syncRulesWithServer` lee y escribe en localStorage, así que su prueba vive
 * en el proyecto `ui` (jsdom). La suite de lógica (`tests/unit`) debe seguir sin
 * DOM; el guard de `noDom.test.ts` lo comprueba.
 */
describe('syncRulesWithServer', () => {
  it('importa localStorage una sola vez, sin duplicar', async () => {
    localStorage.setItem(
      'commander.agent.permissionRules',
      JSON.stringify([{ tool: 'fs.write', pattern: '.env', decision: 'deny' }])
    );

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ rules: body.rules, migrated: true }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          rules: [{ tool: 'fs.write', pattern: '.env', decision: 'ask' }],
          migrated: false,
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const rules = await syncRulesWithServer('/proj', fetcher);
    // La regla local (deny) corrige a la del servidor; no quedan duplicados.
    expect(rules).toEqual([{ tool: 'fs.write', pattern: '.env', decision: 'deny' }]);
    expect(calls.map((c) => c.init?.method ?? 'GET')).toEqual(['GET', 'PUT']);
    expect(JSON.parse(String(calls[1].init?.body)).migrate).toBe(true);

    // Segunda vuelta: el servidor ya migró y devuelve las reglas guardadas.
    calls.length = 0;
    const again = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ rules, migrated: true }), { status: 200 });
    }) as typeof fetch;
    expect(await syncRulesWithServer('/proj', again)).toEqual(rules);
    expect(calls.map((c) => c.init?.method ?? 'GET')).toEqual(['GET']);
  });
});
