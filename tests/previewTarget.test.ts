import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREVIEW_PORTS,
  DEFAULT_READY_TIMEOUT_MS,
  MAX_READY_TIMEOUT_MS,
  localUrl,
  parsePort,
  previewCandidates,
  readyTimeout,
} from '../src/agent/previewTarget.js';

test('localUrl: siempre http en loopback', () => {
  assert.equal(localUrl(5173), 'http://localhost:5173');
});

test('parsePort: solo puertos válidos', () => {
  assert.equal(parsePort(3000), 3000);
  assert.equal(parsePort('5173'), 5173);
  assert.equal(parsePort(0), null);
  assert.equal(parsePort(-1), null);
  assert.equal(parsePort(70000), null);
  assert.equal(parsePort('abc'), null);
  assert.equal(parsePort(''), null);
  assert.equal(parsePort(undefined), null);
});

test('previewCandidates: la url manda sobre el puerto', () => {
  const pick = previewCandidates({ url: 'localhost:4321/app', port: 9999 });
  assert.equal(pick.ok, true);
  assert.deepEqual(pick.urls, ['http://localhost:4321/app']);
});

test('previewCandidates: con puerto construye la url local', () => {
  const pick = previewCandidates({ port: 4321 });
  assert.equal(pick.ok, true);
  assert.deepEqual(pick.urls, ['http://localhost:4321']);
});

test('previewCandidates: sin datos prueba los puertos de siempre', () => {
  const pick = previewCandidates({});
  assert.equal(pick.ok, true);
  assert.equal(pick.urls.length, DEFAULT_PREVIEW_PORTS.length);
  assert.equal(pick.urls[0], 'http://localhost:3000');
  assert.ok(pick.urls.includes('http://localhost:5173'));
});

test('previewCandidates: rechaza url y puerto inválidos', () => {
  const badUrl = previewCandidates({ url: 'file:///etc/passwd' });
  assert.equal(badUrl.ok, false);
  assert.deepEqual(badUrl.urls, []);

  const badPort = previewCandidates({ port: 99999 });
  assert.equal(badPort.ok, false);
  assert.match(String(badPort.error), /Puerto inválido/);
});

test('readyTimeout: acota la espera y usa el valor por defecto cuando no hay', () => {
  assert.equal(readyTimeout(undefined), DEFAULT_READY_TIMEOUT_MS);
  assert.equal(readyTimeout(0), DEFAULT_READY_TIMEOUT_MS);
  assert.equal(readyTimeout('abc'), DEFAULT_READY_TIMEOUT_MS);
  assert.equal(readyTimeout(50), 1000, 'un mínimo, para no fallar por impaciencia');
  assert.equal(readyTimeout(5000), 5000);
  assert.equal(readyTimeout(10 ** 9), MAX_READY_TIMEOUT_MS);
});
