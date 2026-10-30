import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedHostsFromEnv, hostnameFromHostHeader, isAllowedHost } from '../hostGuard.js';

test('acepta loopback, IP literales y nombres reservados de la máquina', () => {
  for (const host of [
    'localhost',
    'localhost:3280',
    'app.localhost:3000',
    '127.0.0.1',
    '127.0.0.1:3280',
    '[::1]:3280',
    '::1',
    '192.168.1.10:3280',
    '0.0.0.0:3280',
  ]) {
    assert.equal(isAllowedHost(host), true, `debe aceptar ${host}`);
  }
});

test('rechaza un dominio ajeno, que es la firma del rebinding', () => {
  for (const host of ['evil.example', 'evil.example:3280', 'commander.local:3280', 'attacker.test.']) {
    assert.equal(isAllowedHost(host), false, `no debe aceptar ${host}`);
  }
});

test('falla cerrado sin Host o con uno malformado', () => {
  for (const host of [undefined, null, '', '   ', '[::1', ']:3280', ':3280']) {
    assert.equal(isAllowedHost(host as unknown), false, `no debe aceptar ${String(host)}`);
  }
});

test('ALLOWED_HOSTS abre la puerta a un nombre propio y a nada más', () => {
  const allow = allowedHostsFromEnv(' commander.local , mi-pc.lan ');

  assert.deepEqual(allow, ['commander.local', 'mi-pc.lan']);
  assert.equal(isAllowedHost('commander.local:3280', allow), true);
  assert.equal(isAllowedHost('mi-pc.lan', allow), true);
  assert.equal(isAllowedHost('commander.local', allow), true);
  assert.equal(isAllowedHost('otro.local:3280', allow), false, 'la lista no es comodín');

  assert.deepEqual(allowedHostsFromEnv(''), [], 'vacío no inventa entradas');
  assert.deepEqual(allowedHostsFromEnv(null), []);
});

test('hostnameFromHostHeader quita el puerto y los corchetes de IPv6', () => {
  assert.equal(hostnameFromHostHeader('LocalHost:3280'), 'localhost');
  assert.equal(hostnameFromHostHeader('[::1]:3280'), '::1');
  assert.equal(hostnameFromHostHeader('127.0.0.1'), '127.0.0.1');
  assert.equal(hostnameFromHostHeader('evil.example:3280'), 'evil.example');
  assert.equal(hostnameFromHostHeader('   '), null);
});
