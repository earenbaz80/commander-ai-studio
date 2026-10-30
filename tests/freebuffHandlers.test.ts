/**
 * Contrato del proxy de Freebuff (`POST /api/freebuff/generate`).
 *
 * Es la pieza que traduce entre el agente y una API OpenAI-compatible, así que
 * lo que se fija aquí son sus cuatro bordes: qué clave usa y cuál falta, qué
 * cuerpo se manda (modelo sin prefijo, sistema, tools), cómo se traducen los
 * `tool_calls` de vuelta al formato del agente y qué se devuelve cuando el
 * proveedor falla. Todo con `fetch` stubbeado: la suite no necesita red ni
 * claves, y un tool_call mal formado se reproduce sin gastar créditos.
 *
 * Mismo molde que `tests/geminiHandlers.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FREEBUFF_DEFAULT_BASE,
  FREEBUFF_KEY_REQUIRED,
  handleFreebuffGenerate,
  resolveFreebuffKey,
} from '../freebuff.js';
import { apiKeyMiddleware } from '../apiKeys.js';
import { FREEBUFF_DEFAULT_MODEL } from '../src/config/freebuffModels.js';

/** `cookies` es lo que deja el parser de `server.ts`: así entra la clave del panel. */
function mockReq(body: any, cookies: Record<string, string> = {}) {
  return { body, ip: '127.0.0.1', headers: {}, cookies } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.body = data; return this; },
  };
  return res;
}

/** Variables que cambian lo que hace el handler; se apagan y se restauran. */
const ENTORNO = ['FREEBUFF_API_KEY', 'OPENAI_API_KEY', 'FREEBUFF_BASE_URL'] as const;

/** Ejecuta `fn` con el entorno de Freebuff vacío (clave ausente, base por defecto). */
async function sinEntorno<T>(fn: () => Promise<T> | T): Promise<T> {
  const previos = ENTORNO.map((k) => [k, process.env[k]] as const);
  for (const k of ENTORNO) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const [k, v] of previos) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

interface Llamada {
  url: string;
  init: any;
  /** Cuerpo ya parseado: es lo que ve la API de verdad. */
  body: any;
}

const fetchOriginal = globalThis.fetch;

/** `fetch` falso: guarda cada petición y responde lo que devuelva `reply`. */
function stubFetch(reply: (url: string, init: any) => any) {
  const calls: Llamada[] = [];
  const impl = (async (url: any, init: any) => {
    const raw = init?.body;
    calls.push({ url: String(url), init, body: raw ? JSON.parse(String(raw)) : null });
    return reply(String(url), init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** Respuesta 200 de la API compatible con OpenAI. */
function upstreamOk(payload: any) {
  return { ok: true, status: 200, json: async () => payload } as any;
}

async function conFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  (globalThis as any).fetch = impl;
  try {
    return await fn();
  } finally {
    (globalThis as any).fetch = fetchOriginal;
  }
}

test('sin ninguna clave responde el mensaje de FREEBUFF_API_KEY y no sale a la red', async () => {
  await sinEntorno(async () => {
    const { impl, calls } = stubFetch(() => upstreamOk({}));
    await conFetch(impl, async () => {
      const res = mockRes();
      await handleFreebuffGenerate(mockReq({ prompt: 'hola' }), res);

      assert.equal(res.body?.success, false);
      assert.equal(res.body?.error, FREEBUFF_KEY_REQUIRED);
      assert.match(FREEBUFF_KEY_REQUIRED, /FREEBUFF_API_KEY/, 'el mensaje nombra la variable que falta');
      assert.equal(calls.length, 0, 'sin clave no se llama a la API');
    });
  });
});

test('la clave del panel gana a la del entorno, y FREEBUFF_API_KEY gana a OPENAI_API_KEY', async () => {
  await sinEntorno(async () => {
    assert.equal(resolveFreebuffKey(undefined), '', 'sin nada no hay clave inventada');

    process.env.OPENAI_API_KEY = 'sk-de-openai';
    assert.equal(resolveFreebuffKey(undefined), 'sk-de-openai', 'una clave de OpenAI sirve: Freebuff es compatible');

    process.env.FREEBUFF_API_KEY = 'fb-del-entorno';
    assert.equal(resolveFreebuffKey(undefined), 'fb-del-entorno', 'la clave propia del proveedor manda');
    assert.equal(resolveFreebuffKey(undefined, 'fb-de-la-cookie'), 'fb-de-la-cookie', 'la del panel gana al entorno');
    assert.equal(resolveFreebuffKey('fb-del-cuerpo', 'fb-de-la-cookie'), 'fb-del-cuerpo', 'lo explícito del cuerpo gana al panel');
  });
});

test('la clave del panel (cookie) llega al upstream sin que el cuerpo la repita', async () => {
  await sinEntorno(async () => {
    const { impl, calls } = stubFetch(() => upstreamOk({ choices: [{ message: { content: 'vale' } }] }));
    await conFetch(impl, async () => {
      const req = mockReq({ prompt: 'hola' }, { ai_studio_FREEBUFF_API_KEY: 'fb-de-la-cookie' });
      apiKeyMiddleware(req, mockRes(), () => {});

      const res = mockRes();
      await handleFreebuffGenerate(req, res);

      assert.equal(res.body?.success, true, JSON.stringify(res.body));
      assert.equal(res.body?.text, 'vale');
      assert.equal(calls.length, 1, 'con clave del panel sí se llama al proveedor');
      assert.equal(calls[0].init.headers.Authorization, 'Bearer fb-de-la-cookie');
    });
  });
});

test('FREEBUFF_BASE_URL guardada en el panel manda la petición a esa base', async () => {
  await sinEntorno(async () => {
    const { impl, calls } = stubFetch(() => upstreamOk({ choices: [{ message: { content: 'ok' } }] }));
    await conFetch(impl, async () => {
      const req = mockReq(
        { prompt: 'hola' },
        {
          ai_studio_FREEBUFF_API_KEY: 'fb-de-la-cookie',
          ai_studio_FREEBUFF_BASE_URL: 'https://proxy.local/v1/',
        }
      );
      apiKeyMiddleware(req, mockRes(), () => {});

      await handleFreebuffGenerate(req, mockRes());

      assert.equal(calls[0].url, 'https://proxy.local/v1/chat/completions', 'la base del panel pierde las barras finales');
    });
  });
});

test('pide /chat/completions con el modelo sin prefijo, el sistema y las tools en auto', async () => {
  const tools = [{ type: 'function', function: { name: 'fs_read', parameters: { type: 'object' } } }];
  const { impl, calls } = stubFetch(() => upstreamOk({ choices: [{ message: { content: 'hola' } }] }));

  await conFetch(impl, async () => {
    const res = mockRes();
    await handleFreebuffGenerate(
      mockReq({
        prompt: 'lee a.ts',
        model: 'freebuff/gpt-6-luna',
        systemInstruction: 'sé breve',
        temperature: 0.2,
        maxTokens: 128,
        tools,
        apiKey: 'fb-del-panel',
      }),
      res
    );

    assert.equal(res.body?.success, true, JSON.stringify(res.body));
    assert.equal(calls.length, 1);

    const [call] = calls;
    assert.equal(call.url, `${FREEBUFF_DEFAULT_BASE}/chat/completions`, 'la base por defecto es la de Freebuff');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.Authorization, 'Bearer fb-del-panel');
    assert.equal(call.body.model, 'gpt-6-luna', 'el prefijo `freebuff/` del panel no viaja a la API');
    assert.deepEqual(
      call.body.messages,
      [{ role: 'system', content: 'sé breve' }, { role: 'user', content: 'lee a.ts' }],
      'el sistema va primero y sólo si existe'
    );
    assert.equal(call.body.temperature, 0.2);
    assert.equal(call.body.max_tokens, 128);
    assert.deepEqual(call.body.tools, tools, 'las tools pasan tal cual');
    assert.equal(call.body.tool_choice, 'auto');
  });
});

test('sin tools no manda los campos y sin modelo ni prompt usa los valores de siempre', async () => {
  const { impl, calls } = stubFetch(() => upstreamOk({ choices: [{ message: { content: 'ok' } }] }));

  await sinEntorno(async () => {
    await conFetch(impl, async () => {
      await handleFreebuffGenerate(mockReq({ contents: 'desde contents', apiKey: 'k' }), mockRes());
    });
  });

  const [call] = calls;
  assert.equal(call.body.model, FREEBUFF_DEFAULT_MODEL, 'el modelo del catálogo cuando nadie pide uno');
  assert.equal('tools' in call.body, false, 'sin tools no se manda el campo');
  assert.equal('tool_choice' in call.body, false, 'ni un tool_choice huérfano');
  assert.deepEqual(call.body.messages, [{ role: 'user', content: 'desde contents' }], '`contents` sirve de prompt');
});

test('la base configurada pierde las barras finales', async () => {
  await sinEntorno(async () => {
    const { impl, calls } = stubFetch(() => upstreamOk({ choices: [{ message: { content: 'ok' } }] }));

    await conFetch(impl, async () => {
      const req = mockReq({ prompt: 'hola', apiKey: 'k' }, { ai_studio_FREEBUFF_BASE_URL: 'http://127.0.0.1:9/proxy///' });
      apiKeyMiddleware(req, mockRes(), () => {});
      await handleFreebuffGenerate(req, mockRes());
    });

    assert.equal(calls[0].url, 'http://127.0.0.1:9/proxy/chat/completions');
  });
});

test('el baseURL del cuerpo se ignora: el cliente no elige el destino', async () => {
  // Antes, un `baseURL` en el cuerpo ganaba al resto y la clave del panel salía
  // hacia ese host. El destino sólo se configura en el panel o en el entorno.
  await sinEntorno(async () => {
    const { impl, calls } = stubFetch(() => upstreamOk({ choices: [{ message: { content: 'ok' } }] }));

    await conFetch(impl, async () => {
      const req = mockReq({ prompt: 'hola', apiKey: 'k', baseURL: 'http://atacante.local/v1' });
      apiKeyMiddleware(req, mockRes(), () => {});
      await handleFreebuffGenerate(req, mockRes());
    });

    assert.equal(calls[0].url, `${FREEBUFF_DEFAULT_BASE}/chat/completions`, 'sin base configurada se usa la de siempre');
  });
});

test('traduce los tool_calls y descarta los que no traen nombre', async () => {
  const { impl } = stubFetch(() =>
    upstreamOk({
      model: 'gpt-6-luna',
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'fs_read', arguments: '{"path":"a.ts"}' } },
              { id: 'c2', type: 'function', function: { name: 'shell', arguments: { command: 'ls' } } },
              { id: 'c3', type: 'function', function: { name: 'fs_glob', arguments: '{esto no es json' } },
              { id: 'c4', type: 'function', function: { arguments: '{}' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    })
  );

  await conFetch(impl, async () => {
    const res = mockRes();
    await handleFreebuffGenerate(mockReq({ prompt: 'hola', apiKey: 'k' }), res);

    assert.deepEqual(
      res.body?.toolCalls,
      [
        { id: 'c1', name: 'fs_read', args: { path: 'a.ts' } },
        { id: 'c2', name: 'shell', args: { command: 'ls' } },
        { id: 'c3', name: 'fs_glob', args: {} },
      ],
      'string JSON y objeto se normalizan; sin nombre se descarta; un JSON roto es args vacíos'
    );
    assert.equal(res.body?.text, '', '`content: null` no rompe el texto');
    assert.equal(res.body?.model, 'gpt-6-luna', 'se devuelve quién contestó de verdad');
    assert.deepEqual(res.body?.metrics, {
      promptTokens: 11,
      responseTokens: 7,
      totalTokens: 18,
      latencyMs: 0,
    });
  });
});

test('el error del proveedor llega con su mensaje y su status', async () => {
  const { impl } = stubFetch(() => ({
    ok: false,
    status: 402,
    json: async () => ({ error: { message: 'sin créditos' } }),
  }));

  await conFetch(impl, async () => {
    const res = mockRes();
    await handleFreebuffGenerate(mockReq({ prompt: 'hola', apiKey: 'k' }), res);

    assert.equal(res.body?.success, false);
    assert.equal(res.body?.error, 'sin créditos', 'se muestra el motivo del proveedor, no un mensaje genérico');
    assert.equal(res.body?.status, 402, 'el status viaja para que el panel lo pueda contar');
  });
});

test('un cuerpo de error que no es JSON cae en `Freebuff HTTP <status>`', async () => {
  const { impl } = stubFetch(() => ({
    ok: false,
    status: 502,
    json: async () => { throw new SyntaxError('no es JSON'); },
  }));

  await conFetch(impl, async () => {
    const res = mockRes();
    await handleFreebuffGenerate(mockReq({ prompt: 'hola', apiKey: 'k' }), res);

    assert.equal(res.body?.success, false);
    assert.equal(res.body?.error, 'Freebuff HTTP 502');
  });
});

test('un fallo de red devuelve el error y no deja la respuesta vacía', async () => {
  const { impl } = stubFetch(() => { throw new TypeError('fetch failed'); });

  await conFetch(impl, async () => {
    const res = mockRes();
    await handleFreebuffGenerate(mockReq({ prompt: 'hola', apiKey: 'k' }), res);

    assert.equal(res.body?.success, false);
    assert.match(String(res.body?.error), /fetch failed/);
  });
});
