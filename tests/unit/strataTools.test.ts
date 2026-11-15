import { describe, expect, test } from 'vitest';
import {
  mergeStrataToolCallFragment,
  normalizeStrataToolCalls,
  parseStrataToolCapabilities,
} from '../../src/lib/strataTools';

const tools = [
  {
    type: 'function',
    function: {
      name: 'fs.read',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git.status',
      parameters: {
        type: 'object',
        properties: { short: { type: 'boolean' } },
      },
    },
  },
];

describe('capacidades de tool calling de Strata', () => {
  test('detecta tools y tools paralelas en las formas del catálogo', () => {
    expect(
      parseStrataToolCapabilities({
        capabilities: { tool_calls: true, parallel_tool_calls: false },
      })
    ).toMatchObject({ supportsTools: true, supportsParallelTools: false });

    expect(
      parseStrataToolCapabilities({ meta: { supported_parameters: ['temperature', 'tools'] } })
    ).toMatchObject({ supportsTools: true });

    expect(parseStrataToolCapabilities({ tool_call: false })).toMatchObject({
      supportsTools: false,
    });

    expect(parseStrataToolCapabilities({ max_parallel_tool_calls: 2 })).toMatchObject({
      supportsParallelTools: true,
    });
  });

  test('un catálogo sin metadatos deja la capacidad desconocida', () => {
    expect(parseStrataToolCapabilities({ id: 'strata-demo' })).toEqual({});
  });
});

describe('normalización de tool calls de Strata', () => {
  test('conserva varias llamadas y valida sus argumentos', () => {
    const calls = normalizeStrataToolCalls(
      [
        {
          id: 'call-read',
          function: { name: 'fs.read', arguments: '{"path":"src/index.ts","limit":20}' },
        },
        {
          id: 'call-status',
          function: { name: 'git.status', arguments: '{"short":true}' },
        },
      ],
      { tools }
    );

    expect(calls).toEqual([
      { id: 'call-read', name: 'fs.read', args: { path: 'src/index.ts', limit: 20 } },
      { id: 'call-status', name: 'git.status', args: { short: true } },
    ]);
  });

  test('rechaza JSON roto, argumentos que no son objeto y tipos incorrectos', () => {
    expect(() =>
      normalizeStrataToolCalls([{ function: { name: 'fs.read', arguments: '{"path":' } }], { tools })
    ).toThrowError(/JSON válido/);

    expect(() =>
      normalizeStrataToolCalls([{ function: { name: 'fs.read', arguments: '["src"]' } }], { tools })
    ).toThrowError(/objeto JSON/);

    expect(() =>
      normalizeStrataToolCalls([{ function: { name: 'fs.read', arguments: '{"path":3}' } }], { tools })
    ).toThrowError(/tipo string/);

    expect(() =>
      normalizeStrataToolCalls([{ function: { name: 'fs.read', arguments: '{}' } }], { tools })
    ).toThrowError(/obligatorio/);
  });

  test('rechaza herramientas que el modelo no recibió', () => {
    expect(() =>
      normalizeStrataToolCalls([{ function: { name: 'shell.run', arguments: '{}' } }], { tools })
    ).toThrowError(/desconocida/);
  });
});

describe('fragmentos de streaming', () => {
  test('ensambla nombre y argumentos partidos en varios deltas', () => {
    const first = mergeStrataToolCallFragment(undefined, {
      index: 0,
      id: 'call-read',
      function: { name: 'fs.', arguments: '{"pa' },
    });
    const second = mergeStrataToolCallFragment(first, {
      index: 0,
      function: { name: 'read', arguments: 'th":"src/index.ts"}' },
    });
    const calls = normalizeStrataToolCalls(
      [{ id: second.id, function: { name: second.name, arguments: second.arguments } }],
      { tools }
    );

    expect(second.name).toBe('fs.read');
    expect(second.arguments).toBe('{"path":"src/index.ts"}');
    expect(calls).toEqual([
      { id: 'call-read', name: 'fs.read', args: { path: 'src/index.ts' } },
    ]);
  });

  test('mantiene separadas dos llamadas fragmentadas', () => {
    const read = mergeStrataToolCallFragment(
      mergeStrataToolCallFragment(undefined, {
        index: 0,
        id: 'call-read',
        function: { name: 'fs.read', arguments: '{"path":' },
      }),
      { index: 0, function: { arguments: '"a.ts"}' } }
    );
    const status = mergeStrataToolCallFragment(undefined, {
      index: 1,
      id: 'call-status',
      function: { name: 'git.status', arguments: '{}' },
    });

    expect(read).toMatchObject({ name: 'fs.read', arguments: '{"path":"a.ts"}' });
    expect(status).toMatchObject({ name: 'git.status', arguments: '{}' });
  });

  test('un fragmento malformado no se convierte en argumentos vacíos', () => {
    const fragment = mergeStrataToolCallFragment(undefined, {
      function: { name: 'fs.read', arguments: '{"path":' },
    });
    expect(() =>
      normalizeStrataToolCalls(
        [{ id: fragment.id, function: { name: fragment.name, arguments: fragment.arguments } }],
        { tools }
      )
    ).toThrowError(/JSON válido/);
  });
});
