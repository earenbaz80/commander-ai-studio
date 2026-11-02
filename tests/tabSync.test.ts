import test from 'node:test';
import assert from 'node:assert/strict';
import { saveTabToServer, messageRequestId } from '../src/agent/tabSync';

/** Sustituye fetch por un grabador de peticiones y devuelve lo que responda cada ruta. */
function stubFetch() {
  const calls: { url: string; method: string; body: any }[] = [];
  let thread: any = { id: 'sess-1', title: 'Charla', project_path: null };
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const u = String(url);
    calls.push({ url: u, method, body });
    if (u.includes('/messages')) return { ok: true, json: async () => ({ success: true, seq: calls.length }) };
    if (method === 'POST') return { ok: true, json: async () => ({ success: true, thread }) };
    if (method === 'PATCH') {
      thread = { ...thread, ...body };
      return { ok: true, json: async () => ({ success: true, thread }) };
    }
    return { ok: false, json: async () => ({}) };
  }) as any;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const tab = (over: Record<string, unknown> = {}) => ({
  id: 'tab-1',
  sessionId: 'sess-1',
  title: 'Charla',
  selectedModel: 'gemini-2.5-flash',
  projectPath: '',
  messages: [
    { id: 'm1', role: 'user', content: 'hola', timestamp: '10:00' },
    { id: 'm2', role: 'model', content: 'qué tal', timestamp: '10:01' },
  ],
  ...over,
}) as any;

test('saveTabToServer crea el hilo con el sessionId y vuelca los mensajes una vez', async () => {
  const { calls, restore } = stubFetch();
  try {
    assert.equal(await saveTabToServer(tab()), true);

    const created = calls.find((c) => c.method === 'POST' && c.url === '/api/threads');
    assert.ok(created, 'crea el hilo');
    assert.equal(created!.body.id, 'sess-1', 'el id del hilo es el sessionId de la pestaña');

    const msgs = calls.filter((c) => c.url.includes('/messages'));
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].body.role, 'user');
    assert.equal(msgs[0].body.parts.text, 'hola');
    assert.equal(msgs[1].body.role, 'assistant', '«model» se guarda como assistant');

    // Segundo volcado del mismo chat: mismos requestId ⇒ el servidor no duplica.
    const antes = msgs.map((m) => m.body.requestId);
    calls.length = 0;
    assert.equal(await saveTabToServer(tab()), true);
    const despues = calls.filter((c) => c.url.includes('/messages')).map((m) => m.body.requestId);
    assert.deepEqual(despues, antes, 'reenviar la charla reusa los ids de petición');
  } finally { restore(); }
});

test('saveTabToServer sigue el proyecto y el título cuando cambian en la pestaña', async () => {
  const { calls, restore } = stubFetch();
  try {
    await saveTabToServer(tab());
    calls.length = 0;
    await saveTabToServer(tab({ projectPath: 'C:/repo/uno', title: 'Renombrada' }));

    const patch = calls.find((c) => c.method === 'PATCH');
    assert.ok(patch, 'manda un PATCH al cambiar título o proyecto');
    assert.equal(patch!.body.projectPath, 'C:/repo/uno');
    assert.equal(patch!.body.title, 'Renombrada');
  } finally { restore(); }
});

test('saveTabToServer no rompe si el servidor está caído', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('sin red'); }) as any;
  try {
    await assert.rejects(() => saveTabToServer(tab()), /sin red/);
  } finally { globalThis.fetch = original; }
});

test('messageRequestId es estable por rol y texto, y distinto si cambia alguno', () => {
  const a = messageRequestId('user', 'hola');
  assert.equal(a, messageRequestId('user', 'hola'));
  assert.notEqual(a, messageRequestId('assistant', 'hola'));
  assert.notEqual(a, messageRequestId('user', 'hola!'));
});
