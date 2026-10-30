/**
 * Cómo trata el agente a los modelos de Freebuff.
 *
 * Dos decisiones se cruzan y ninguna se ve en el chat hasta que falla: a qué
 * endpoint se manda la petición (`resolveEndpoint`) y con qué dialecto se le
 * piden herramientas (`toolDialectForModel`, que el loop consulta vía
 * `modelSupportsTools`). Freebuff mete las dos en el mismo prefijo `freebuff/`,
 * y su catálogo tiene ids con forma de id de Gemini (`gemini-4-argon`) o de
 * Claude (`claude-haiku-5-5`): si el detector mirara el nombre sin el prefijo
 * antes que el prefijo, esos modelos acabarían en el endpoint de otro
 * proveedor. Aquí se fija que manda el prefijo.
 *
 * El resto del catálogo no declara `toolCalls`, así que cae a `json-text` y el
 * agente le pide el JSON en texto en vez de gastar un paso en un tool-call que
 * el modelo no sabe hacer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEndpoint } from '../src/lib/aiProviders.js';
import { modelSupportsTools, toolDialectForModel } from '../src/agent/providers.js';
import { callAgentLLMTools } from '../src/agent/llm.js';
import { FREEBUFF_DEFAULT_MODEL, FREEBUFF_TOOL_MODEL_IDS } from '../src/config/freebuffModels.js';

/** Id del catálogo que sí declara tool-calls. */
const CON_TOOLS = FREEBUFF_TOOL_MODEL_IDS[0];
/** Modelo de sólo chat: el catálogo no lo lista, así que no puede usar tools. */
const SIN_TOOLS = 'qwen-chat-7b';

const ctx = () => ({
  goal: 'leer package.json',
  cwd: '.',
  history: [],
  toolSchema: 'TOOLS',
  recentSteps: [],
  plan: [],
});

const fetchOriginal = globalThis.fetch;

interface Llamada {
  url: string;
  init: any;
  body: any;
}

/** `fetch` falso: guarda la petición y responde lo que devuelva `reply`. */
function stubFetch(reply: (url: string, init: any) => any) {
  const calls: Llamada[] = [];
  const impl = (async (url: any, init: any) => {
    const raw = init?.body;
    calls.push({ url: String(url), init, body: raw ? JSON.parse(String(raw)) : null });
    return reply(String(url), init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function conFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  (globalThis as any).fetch = impl;
  try {
    return await fn();
  } finally {
    (globalThis as any).fetch = fetchOriginal;
  }
}

test('todo el catálogo de Freebuff se enruta al proxy y no a otro proveedor', () => {
  const ids = [...FREEBUFF_TOOL_MODEL_IDS, FREEBUFF_DEFAULT_MODEL, SIN_TOOLS];
  for (const id of ids) {
    assert.equal(
      resolveEndpoint(`freebuff/${id}`),
      '/api/freebuff/generate',
      `${id} debe ir al proxy de Freebuff`
    );
  }
});

test('el prefijo manda aunque el id parezca de Gemini o de Claude', () => {
  for (const id of FREEBUFF_TOOL_MODEL_IDS) {
    assert.equal(toolDialectForModel(`freebuff/${id}`), 'openai', `${id} habla OpenAI`);
    assert.equal(modelSupportsTools(`freebuff/${id}`), true, `${id} sí admite tool-calling`);
  }
  // Los dos casos que antes se habrían ido al detector de otro proveedor.
  assert.equal(toolDialectForModel('freebuff/gemini-4-argon'), 'openai', 'no es un id de Google');
  assert.equal(toolDialectForModel('freebuff/claude-haiku-5-5'), 'openai', 'no es un id de Anthropic');
});

test('un id de Freebuff sin tool-calls cae a json-text', () => {
  assert.equal(toolDialectForModel(`freebuff/${SIN_TOOLS}`), 'json-text');
  assert.equal(modelSupportsTools(`freebuff/${SIN_TOOLS}`), false);
});

test('con tool-calls, el agente llama al proxy con las tools en formato OpenAI', async () => {
  const { impl, calls } = stubFetch(() => ({
    ok: true,
    status: 200,
    json: async () => ({
      text: 'leo el archivo',
      toolCalls: [{ id: 'c1', name: 'fs_read', args: { path: 'package.json' } }],
    }),
  }));

  await conFetch(impl, async () => {
    const res = await callAgentLLMTools(ctx(), { model: `freebuff/${CON_TOOLS}` });

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.url, '/api/freebuff/generate', 'la petición va al proxy, no a Gemini');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.body.model, `freebuff/${CON_TOOLS}`, 'el id viaja entero: el proxy quita el prefijo');
    assert.ok(Array.isArray(call.body.tools) && call.body.tools.length > 0, 'manda las tools del agente');
    for (const tool of call.body.tools) {
      assert.equal(tool.type, 'function', 'formato Chat Completions, no functionDeclarations');
      assert.equal(typeof tool.function?.name, 'string');
    }
    assert.deepEqual(res.calls, [{ name: 'fs_read', args: { path: 'package.json' } }]);
    assert.equal(res.thought, 'leo el archivo');
  });
});

/**
 * Simula un usuario con Custom configurado: los valores quedan en la caché de
 * claves del proceso, así que este archivo tiene que usarlos tal cual después.
 */
async function conCustomConfigurado<T>(fn: () => Promise<T>): Promise<T> {
  const previo = (globalThis as any).localStorage;
  const valores: Record<string, string> = {
    CUSTOM_BASE_URL: 'https://custom.invalid/v1',
    CUSTOM_API_KEY: 'clave-de-custom',
  };
  (globalThis as any).localStorage = { getItem: (k: string) => valores[k] ?? null };
  try {
    return await fn();
  } finally {
    (globalThis as any).localStorage = previo;
  }
}

test('la base y la clave de Custom no viajan al proxy de Freebuff', async () => {
  const { impl, calls } = stubFetch(() => ({
    ok: true,
    status: 200,
    json: async () => ({ text: 'ok', toolCalls: [] }),
  }));

  await conCustomConfigurado(() =>
    conFetch(impl, async () => {
      await callAgentLLMTools(ctx(), { model: `freebuff/${CON_TOOLS}` });

      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].body.baseURL,
        undefined,
        'la base la pone el servidor: mandarle la de Custom desviaba la petición a otro host'
      );
      assert.equal(
        calls[0].body.apiKey,
        undefined,
        'la clave la resuelve el proxy (FREEBUFF_API_KEY); la de Custom no le sirve'
      );
    })
  );
});

test('con custom/ sí viajan: son las que entiende /api/custom/generate', async () => {
  const { impl, calls } = stubFetch(() => ({
    ok: true,
    status: 200,
    json: async () => ({ text: 'ok', toolCalls: [] }),
  }));

  await conCustomConfigurado(() =>
    conFetch(impl, async () => {
      await callAgentLLMTools(ctx(), { model: 'custom/llama' });

      assert.equal(calls[0].url, '/api/custom/generate');
      assert.equal(calls[0].body.baseURL, 'https://custom.invalid/v1');
      assert.equal(calls[0].body.apiKey, 'clave-de-custom');
    })
  );
});

test('sin tool-calls no se llama a la red: el loop usa el camino json-text', async () => {
  const { impl, calls } = stubFetch(() => {
    throw new Error('no debería salir ninguna petición');
  });

  await conFetch(impl, async () => {
    const res = await callAgentLLMTools(ctx(), { model: `freebuff/${SIN_TOOLS}` });

    assert.deepEqual(res, { thought: '', calls: [] }, 'sin llamadas: el loop pide JSON en texto');
    assert.equal(calls.length, 0, 'no se gasta una petición en la vía nativa');
  });
});
