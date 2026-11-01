/**
 * El gate de auditoría del CI sólo puede reintentar cuando npm no llegó al
 * registry. Si el reintento (o una clasificación laxa) tapara un árbol con
 * vulnerabilidades, el job quedaría verde con avisos que sí se empaquetan.
 *
 * Estos casos fijan la frontera con formas reales de la salida de `npm audit`
 * (v2, la que devuelve npm 12): el JSON de vulnerabilidades nunca es «red», y
 * el JSON de fallo de transporte nunca es «vulnerable».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificar } from '../scripts/audit-prod.js';

/** Salida real de `npm audit --json` con el árbol de desarrollo de este repo. */
const CON_VULNERABILIDADES = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    minimatch: { severity: 'moderate', via: [{ title: 'minimatch ReDoS', url: 'https://github.com/advisories/GHSA-x' }] },
    'app-builder-lib': { severity: 'moderate', via: ['minimatch'] },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 2, high: 0, critical: 0, total: 2 } },
});

/** Salida real cuando el registry no responde: `error` sin `code`, mensaje en `message`. */
const SIN_RED = JSON.stringify({
  message: 'request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9',
  error: { summary: '', detail: '' },
});

test('una auditoría con vulnerabilidades no se clasifica como error de red', () => {
  const r = clasificar(CON_VULNERABILIDADES, '');
  assert.equal(r.tipo, 'vulnerable');
  if (r.tipo !== 'vulnerable') return;
  assert.equal(r.total, 2);
  // Misma severidad: desempata por nombre, y el aviso viaja con su paquete.
  assert.deepEqual(r.paquetes.map((p) => p.nombre), ['app-builder-lib', 'minimatch']);
  assert.match(r.paquetes[1].aviso ?? '', /minimatch ReDoS/);
});

test('sin vulnerabilidades y sin error, el árbol de producción está limpio', () => {
  const limpio = JSON.stringify({
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  });
  assert.equal(clasificar(limpio, '').tipo, 'limpio');
});

test('el fallo de transporte del registry es reintentable y dice qué pasó', () => {
  const r = clasificar(SIN_RED, 'npm error audit endpoint returned an error');
  assert.equal(r.tipo, 'red');
  if (r.tipo !== 'red') return;
  assert.equal(r.codigo, 'ECONNREFUSED');
  assert.match(r.detalle, /request to .* failed/);
});

test('un error de npm que no es de red no se reintenta', () => {
  const r = clasificar(JSON.stringify({ error: { code: 'EJSONPARSE', summary: 'Invalid package-lock' } }), '');
  assert.equal(r.tipo, 'desconocido');
});

test('si npm muere sin JSON, la señal de red del stderr sigue valiendo', () => {
  assert.equal(clasificar('', 'npm error code ETIMEDOUT\nnpm error network request failed').tipo, 'red');
  assert.equal(clasificar('', 'npm error EUSAGE bad argument').tipo, 'desconocido');
});

test('una salida vacía no se da por buena', () => {
  const r = clasificar('', '');
  assert.notEqual(r.tipo, 'limpio');
});
