import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompletePrompt,
  buildEditPrompt,
  cleanCompletion,
  cleanEdit,
  getActiveModel,
  routeForModel,
  stripCodeFences,
  stripPrefixOverlap,
  requestInlineCompletion,
  requestInlineEdit,
  DEFAULT_INLINE_MODEL,
} from '../src/utils/inlineAi.js';

test('routeForModel enruta cada familia al endpoint del agente', () => {
  assert.equal(routeForModel('custom/foo'), '/api/custom/generate');
  assert.equal(routeForModel('openrouter/openai/gpt-4o-mini'), '/api/openrouter/generate');
  assert.equal(routeForModel('pollinations/openai'), '/api/pollinations/generate');
  assert.equal(routeForModel('ollama/llama3.2'), '/api/ollama/generate');
  assert.equal(routeForModel('gemini-2.5-flash'), '/api/gemini/generate');
  // El id parece de Gemini, pero el prefijo manda: va al proxy de Freebuff.
  assert.equal(routeForModel('freebuff/gemini-4-argon'), '/api/freebuff/generate');
});

test('getActiveModel cae al default gratuito sin localStorage', () => {
  assert.equal(getActiveModel(), DEFAULT_INLINE_MODEL);
});

test('stripCodeFences quita la valla envolvente', () => {
  assert.equal(stripCodeFences('```ts\nconst a = 1;\n```'), 'const a = 1;');
  assert.equal(stripCodeFences('```\nhola\n```'), 'hola');
  assert.equal(stripCodeFences('sin valla'), 'sin valla');
});

test('stripPrefixOverlap recorta el eco del prefijo', () => {
  assert.equal(stripPrefixOverlap('const x = ', 'const x = 1;'), '1;');
  assert.equal(stripPrefixOverlap('abc', 'def'), 'def');
  assert.equal(stripPrefixOverlap('', 'nuevo'), 'nuevo');
});

test('cleanCompletion devuelve UNA sola línea ya depurada', () => {
  assert.equal(cleanCompletion('', '```ts\nreturn 42;\n```'), 'return 42;');
  assert.equal(cleanCompletion('let n = ', 'let n = 7;\nconsole.log(n)'), '7;');
  assert.equal(cleanCompletion('', '   \n  '), '');
  assert.equal(cleanCompletion('', 'primera\nsegunda'), 'primera');
});

test('cleanEdit conserva la indentación y elimina la valla', () => {
  assert.equal(cleanEdit('```py\ndef f():\n    return 1\n```'), 'def f():\n    return 1');
  assert.equal(cleanEdit('    const a = 1;   '), '    const a = 1;');
});

test('buildCompletePrompt incluye archivo, lenguaje y el marcador de cursor', () => {
  const { system, user } = buildCompletePrompt({
    prefix: 'const a = 1;\ncon',
    suffix: 'sole.log(a);',
    filename: 'src/a.ts',
    language: 'ts',
  });
  assert.match(system, /autocompletador/i);
  assert.match(user, /ARCHIVO: src\/a\.ts/);
  assert.match(user, /LENGUAJE: ts/);
  assert.match(user, /<<CURSOR>>/);
});

test('buildEditPrompt incluye la instrucción y el fragmento', () => {
  const { user } = buildEditPrompt({
    instruction: 'añade try/catch',
    code: 'const a = JSON.parse(x);',
    filename: 'a.ts',
  });
  assert.match(user, /añade try\/catch/);
  assert.match(user, /FRAGMENTO A REEMPLAZAR:\nconst a = JSON\.parse\(x\);/);
});

/** Simula ajustes guardados por el usuario (aquí, Custom configurado). */
function withLocalSettings<T>(settings: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previo = (globalThis as any).localStorage;
  (globalThis as any).localStorage = { getItem: (k: string) => settings[k] ?? null };
  return fn().finally(() => {
    (globalThis as any).localStorage = previo;
  });
}

function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: any, init: any) => Promise.resolve(impl(String(url), init))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test('requestInlineCompletion normaliza el texto del proveedor', async () => {
  let seenUrl = '';
  let seenBody: any = null;
  const restore = mockFetch((url, init) => {
    seenUrl = url;
    seenBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ success: true, text: '```ts\nreturn 1;\n```' }), { status: 200 });
  });
  try {
    const res = await requestInlineCompletion({
      prefix: 'function f() { ',
      language: 'ts',
      model: 'pollinations/openai',
    });
    assert.equal(res.ok, true);
    assert.equal(res.text, 'return 1;');
    assert.equal(seenUrl, '/api/pollinations/generate');
    // Prompt separado: el sistema va aparte y el usuario en `contents`/`prompt`.
    assert.equal(typeof seenBody.systemInstruction, 'string');
    assert.equal(seenBody.contents, seenBody.prompt);
  } finally {
    restore();
  }
});

test('requestInlineEdit propaga el error del proveedor (p. ej. falta API key)', async () => {
  const restore = mockFetch(
    () =>
      new Response(JSON.stringify({ success: false, error: 'GEMINI_API_KEY requerida', code: 'MISSING_API_KEY' }), {
        status: 400,
      })
  );
  try {
    const res = await requestInlineEdit({ instruction: 'mejora', code: 'x', model: 'gemini-2.5-flash' });
    assert.equal(res.ok, false);
    assert.match(res.error || '', /GEMINI_API_KEY/);
  } finally {
    restore();
  }
});

test('requestInlineEdit va al proxy de Freebuff y deja el prefijo al servidor', async () => {
  let seenUrl = '';
  let seenBody: any = null;
  const restore = mockFetch((url, init) => {
    seenUrl = url;
    seenBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ text: 'const b = 2;' }), { status: 200 });
  });
  try {
    // Con Custom configurado: es cuando la base y la clave ajenas se colaban.
    const res = await withLocalSettings(
      { CUSTOM_BASE_URL: 'https://custom.invalid/v1', CUSTOM_API_KEY: 'clave-de-custom' },
      () => requestInlineEdit({ instruction: 'renombra', code: 'const a = 1;', model: 'freebuff/gpt-6-luna' })
    );
    assert.equal(seenUrl, '/api/freebuff/generate');
    assert.equal(res.ok, true);
    assert.equal(res.text, 'const b = 2;');
    // El prefijo lo quita el proxy (es quien conoce el catálogo), no el editor.
    assert.equal(seenBody.model, 'freebuff/gpt-6-luna');
    // Y la base y la clave de Custom no viajan: el proxy usa las suyas.
    assert.equal(seenBody.baseURL, undefined, 'la base la pone el servidor');
    assert.equal(seenBody.apiKey, undefined, 'la clave la resuelve el proxy');
  } finally {
    restore();
  }
});

test('requestInlineEdit con custom/ sí manda su base y su clave', async () => {
  let seenBody: any = null;
  const restore = mockFetch((_url, init) => {
    seenBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ text: 'ok' }), { status: 200 });
  });
  try {
    await withLocalSettings(
      { CUSTOM_BASE_URL: 'https://custom.invalid/v1', CUSTOM_API_KEY: 'clave-de-custom' },
      () => requestInlineEdit({ instruction: 'x', code: 'y', model: 'custom/llama' })
    );
    // Este endpoint sí las lee del cuerpo: quitarlas en todos lados lo rompería.
    assert.equal(seenBody.baseURL, 'https://custom.invalid/v1');
    assert.equal(seenBody.apiKey, 'clave-de-custom');
  } finally {
    restore();
  }
});

test('requestInlineEdit usa el endpoint custom y su CRUD de claves', async () => {
  let seenUrl = '';
  const restore = mockFetch((url) => {
    seenUrl = url;
    return new Response(JSON.stringify({ ok: false, error: 'CUSTOM_BASE_URL requerido' }), { status: 200 });
  });
  try {
    const res = await requestInlineEdit({ instruction: 'x', code: 'y', model: 'custom/llama' });
    assert.equal(seenUrl, '/api/custom/generate');
    assert.equal(res.ok, false);
    assert.match(res.error || '', /CUSTOM_BASE_URL/);
  } finally {
    restore();
  }
});
