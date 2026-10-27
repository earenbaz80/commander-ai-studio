import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SNAPSHOT_NODES,
  formatSnapshot,
  isLoopbackHost,
  isLoopbackUrl,
  normalizeBrowserUrl,
  resolveUid,
  toSnapshotNodes,
} from '../src/agent/browserTarget.js';

// ── normalizeBrowserUrl ─────────────────────────────────────────────────────

test('normalizeBrowserUrl: añade http:// cuando falta el esquema', () => {
  const check = normalizeBrowserUrl('localhost:5173');
  assert.equal(check.ok, true);
  if (!check.ok) return;
  assert.equal(check.url, 'http://localhost:5173/');

  const proto = normalizeBrowserUrl('//127.0.0.1:8080/x');
  assert.equal(proto.ok, true);
  if (proto.ok) assert.equal(proto.url, 'http://127.0.0.1:8080/x');
});

test('normalizeBrowserUrl: conserva las URL http(s) completas', () => {
  const check = normalizeBrowserUrl('  https://example.com/a?b=1#top  ');
  assert.equal(check.ok, true);
  if (check.ok) assert.equal(check.url, 'https://example.com/a?b=1#top');
});

test('normalizeBrowserUrl: rechaza esquemas que no son http(s)', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'chrome://settings']) {
    const check = normalizeBrowserUrl(url);
    assert.equal(check.ok, false, `debe rechazar ${url}`);
    if (!check.ok) assert.match(check.error, /Esquema no permitido/);
  }
});

test('normalizeBrowserUrl: rechaza vacío, espacios, credenciales y exceso de longitud', () => {
  assert.equal(normalizeBrowserUrl('').ok, false);
  assert.equal(normalizeBrowserUrl('   ').ok, false);
  assert.equal(normalizeBrowserUrl('http://a b/c').ok, false);
  assert.equal(normalizeBrowserUrl('http://user:pass@localhost:3000/').ok, false);
  assert.equal(normalizeBrowserUrl(`http://localhost/${'x'.repeat(2100)}`).ok, false);
});

// ── loopback ───────────────────────────────────────────────────────────────

test('isLoopbackHost: reconoce la propia máquina', () => {
  for (const host of ['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.9.9.9', '::1', '[::1]']) {
    assert.equal(isLoopbackHost(host), true, `${host} es loopback`);
  }
});

test('isLoopbackHost: no confunde un dominio ajeno', () => {
  for (const host of ['example.com', 'localhost.evil.com', '192.168.1.5', '10.0.0.1', '0.0.0.0', '']) {
    assert.equal(isLoopbackHost(host), false, `${host} no es loopback`);
  }
});

test('isLoopbackUrl: decide sobre la URL ya normalizada', () => {
  assert.equal(isLoopbackUrl('localhost:3001'), true);
  assert.equal(isLoopbackUrl('http://127.0.0.1:5173/preview'), true);
  assert.equal(isLoopbackUrl('https://example.com'), false);
  // Una URL inválida nunca es "local": ante la duda, pide aprobación.
  assert.equal(isLoopbackUrl('javascript:alert(1)'), false);
});

// ── nodos y uid ────────────────────────────────────────────────────────────

test('toSnapshotNodes: asigna uid secuenciales y normaliza', () => {
  const nodes = toSnapshotNodes([
    { role: 'button', name: '  Guardar   ya ', depth: 1 },
    { role: '', name: '', depth: 99 },
    { role: 'textbox', name: 'Email', value: 'a@b.c', depth: 2 },
  ]);

  assert.deepEqual(nodes.map((n) => n.uid), ['e1', 'e2', 'e3']);
  assert.equal(nodes[0].name, 'Guardar ya');
  assert.equal(nodes[0].role, 'button');
  // Sin rol ni nombre accesible: queda un nodo genérico, no un hueco.
  assert.equal(nodes[1].role, 'generic');
  assert.equal(nodes[1].name, '(sin nombre)');
  assert.equal(nodes[1].depth, 8, 'la profundidad se acota');
  assert.equal(nodes[2].value, 'a@b.c');
  assert.equal(nodes[0].value, undefined, 'sin valor no se inventa la clave');
});

test('toSnapshotNodes: respeta el tope de elementos', () => {
  const raw = Array.from({ length: MAX_SNAPSHOT_NODES + 40 }, () => ({ role: 'link', name: 'x' }));
  assert.equal(toSnapshotNodes(raw).length, MAX_SNAPSHOT_NODES);
  assert.equal(toSnapshotNodes(raw, 3).length, 3);
  assert.deepEqual(toSnapshotNodes(null as any), []);
});

test('resolveUid: devuelve la posición y lo que decía el elemento', () => {
  const nodes = toSnapshotNodes([
    { role: 'button', name: 'Borrar' },
    { role: 'link', name: 'Inicio' },
    { role: 'button', name: 'Borrar' },
  ]);

  assert.deepEqual(resolveUid(nodes, 'e3'), { index: 2, role: 'button', name: 'Borrar' });
  assert.deepEqual(resolveUid(nodes, 'e1'), { index: 0, role: 'button', name: 'Borrar' });
  // Un uid de otro snapshot (o inventado) no resuelve a nada.
  assert.equal(resolveUid(nodes, 'e9'), null);
  assert.equal(resolveUid([], 'e1'), null);
  assert.equal(resolveUid(nodes, ''), null);
});

// ── formatSnapshot ─────────────────────────────────────────────────────────

test('formatSnapshot: una línea por elemento, con uid y valor', () => {
  const nodes = toSnapshotNodes([
    { role: 'heading', name: 'Título', depth: 0 },
    { role: 'textbox', name: 'Email', value: 'a@b.c', depth: 1 },
  ]);
  const snapshot = formatSnapshot(nodes, { title: 'Demo', url: 'http://localhost:3000/' });

  assert.match(snapshot.text, /^# Demo — http:\/\/localhost:3000\/$/m);
  assert.match(snapshot.text, /^- e1 heading "Título"$/m);
  assert.match(snapshot.text, /^ {2}- e2 textbox "Email" value="a@b.c"$/m);
  assert.equal(snapshot.nodes, 2);
  assert.equal(snapshot.truncated, false);
});

test('formatSnapshot: avisa cuando la página no tiene nada que usar', () => {
  const empty = formatSnapshot([]);
  assert.match(empty.text, /sin elementos interactivos/);
  assert.equal(empty.nodes, 0);

  const full = formatSnapshot(toSnapshotNodes(Array.from({ length: MAX_SNAPSHOT_NODES }, () => ({ role: 'link', name: 'x' }))));
  assert.equal(full.truncated, true, 'al tope de nodos se marca truncado');
});
