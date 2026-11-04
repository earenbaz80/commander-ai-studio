import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commentOnPullRequest,
  parsePullRequest,
  pullRequestData,
} from '../github.js';

/** Respuestas encadenadas para `fetch`, sin salir a la red. */
function stubFetch(responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: any }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const next = responses.shift() ?? { ok: true, status: 200, body: {} };
    return {
      ok: next.ok !== false,
      status: next.status ?? 200,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    } as any;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const PR = {
  title: 'Arregla el parser',
  state: 'open',
  draft: false,
  user: { login: 'ana' },
  html_url: 'https://github.com/acme/app/pull/7',
  base: { ref: 'main' },
  head: { ref: 'fix/parser' },
  additions: 12,
  deletions: 3,
  changed_files: 1,
  body: 'Detalles',
};

test('parsePullRequest acepta owner/repo + número y URL', () => {
  assert.deepEqual(parsePullRequest({ repo: 'acme/app', number: 7 }), { owner: 'acme', repo: 'app', number: 7 });
  assert.deepEqual(parsePullRequest({ url: 'https://github.com/acme/app/pull/12' }), {
    owner: 'acme',
    repo: 'app',
    number: 12,
  });
  assert.equal(parsePullRequest({ repo: 'sin-barra', number: 7 }), null);
  assert.equal(parsePullRequest({ repo: 'acme/app', number: 0 }), null);
  assert.equal(parsePullRequest({ repo: 'acme/app', number: Number.NaN }), null);
  assert.equal(parsePullRequest({ url: 'https://evil.test/acme/app/pull/7' }), null);
});

test('pullRequestData lee metadatos y archivos, y recorta el patch', async () => {
  const stub = stubFetch([
    { body: PR },
    { body: [{ filename: 'src/a.ts', status: 'modified', additions: 12, deletions: 3, patch: 'x'.repeat(9000) }] },
  ]);
  process.env.GITHUB_API_BASE = 'https://api.test';
  try {
    const out = await pullRequestData({ owner: 'acme', repo: 'app', number: 7 }, 'tok');
    assert.equal(out.ok, true);
    assert.equal(out.data.title, 'Arregla el parser');
    assert.equal(out.data.author, 'ana');
    assert.equal(out.data.files.length, 1);
    assert.match(out.data.files[0].patch, /\[recortado\]$/);
    assert.ok(stub.calls[0].url.startsWith('https://api.test/repos/acme/app/pulls/7'));
    assert.equal(stub.calls[0].init.headers.Authorization, 'Bearer tok');
    assert.equal(stub.calls[1].url.includes('/files?per_page=100'), true);
  } finally {
    stub.restore();
    delete process.env.GITHUB_API_BASE;
  }
});

test('sin token no se llama a la red y el mensaje explica qué falta', async () => {
  const stub = stubFetch([]);
  try {
    const pr = await pullRequestData({ owner: 'a', repo: 'b', number: 1 }, '');
    assert.equal(pr.ok, false);
    assert.match(pr.error || '', /GITHUB_TOKEN/);
    const comment = await commentOnPullRequest({ owner: 'a', repo: 'b', number: 1 }, 'hola', '');
    assert.equal(comment.ok, false);
    assert.match(comment.error || '', /GITHUB_TOKEN/);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('el error de GitHub se reenvía con su estado', async () => {
  const stub = stubFetch([{ ok: false, status: 404, body: { message: 'Not Found' } }]);
  try {
    const out = await pullRequestData({ owner: 'a', repo: 'b', number: 99 }, 'tok');
    assert.equal(out.ok, false);
    assert.match(out.error || '', /404/);
    assert.match(out.error || '', /Not Found/);
  } finally {
    stub.restore();
  }
});

test('comentar valida el cuerpo y publica en issues/:n/comments', async () => {
  const vacio = await commentOnPullRequest({ owner: 'a', repo: 'b', number: 1 }, '   ', 'tok');
  assert.equal(vacio.ok, false);

  const stub = stubFetch([{ body: { id: 5, html_url: 'https://github.com/a/b/pull/1#c5', user: { login: 'bot' } } }]);
  try {
    const out = await commentOnPullRequest({ owner: 'a', repo: 'b', number: 1 }, 'Listo', 'tok');
    assert.equal(out.ok, true);
    assert.equal(out.data.id, 5);
    assert.equal(stub.calls[0].url.endsWith('/repos/a/b/issues/1/comments'), true);
    assert.equal(stub.calls[0].init.method, 'POST');
    assert.equal(JSON.parse(stub.calls[0].init.body).body, 'Listo');
  } finally {
    stub.restore();
  }
});
