import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnBatchHadFailure, spawnChildrenFromResults } from '../agentSession';

/**
 * G1-D5-09: en la corrida real los resultados de `spawn_agents` llegaron
 * envueltos (`{ ok, data: { results } }`), no planos, y la guarda de tandas
 * leyó cero hijos: el padre relanzó el spawn cuatro veces seguidas.
 *
 * Usa `node:test`, así que vive en `tests/` y corre con `npm run test:node`.
 * `agentSession` arrastra `browserSession`/`mcp`, que tocan el DOM: dentro de
 * `tests/unit` este archivo rompía `noDom.test.ts` sin ejecutar nada para Vitest.
 */
test('lee los hijos de la forma plana que devuelve la tool en proceso', () => {
  const hijos = spawnChildrenFromResults([
    { tool: 'spawn_agents', ok: true, data: { results: [{ ok: false }, { ok: true }], spawned: 2 } },
  ]);

  assert.equal(hijos.length, 2);
  assert.equal(hijos[0].ok, false);
  assert.equal(hijos[1].ok, true);
});

test('lee los hijos cuando el resultado llega envuelto en { ok, data }', () => {
  const hijos = spawnChildrenFromResults([
    {
      tool: 'spawn_agents',
      ok: true,
      data: {
        ok: true,
        data: { results: [{ ok: false, error: 'sin respuesta final' }, { ok: false, error: 'tiempo límite' }], spawned: 2 },
      },
    },
  ]);

  assert.equal(hijos.length, 2, 'la guarda no puede quedarse en cero hijos');
  assert.equal(hijos[0].error, 'sin respuesta final');
  assert.equal(hijos[1].error, 'tiempo límite');
});

test('una tanda con un solo hijo fallido también cuenta para la racha', () => {
  // G1-D5-10: A fallaba y B cerraba bien; el padre relanzó la tanda porque la
  // guarda sólo miraba «todos fallidos».
  assert.equal(spawnBatchHadFailure([{ ok: true }, { ok: false, error: 'sin respuesta final' }]), true);
  assert.equal(spawnBatchHadFailure([{ ok: false }, { ok: false }]), true);
  assert.equal(spawnBatchHadFailure([{ ok: true }, { ok: true }]), false);
  assert.equal(spawnBatchHadFailure([]), false);
});

test('suma los hijos de varios spawns de la misma tanda y tolera resultados vacíos', () => {
  const hijos = spawnChildrenFromResults([
    { tool: 'spawn_agents', ok: true, data: { results: [{ ok: true }] } },
    { tool: 'fs.write', ok: true, data: { written: true } },
    { tool: 'spawn_agents', ok: true, data: { ok: true, data: { results: [{ ok: false }] } } },
    { tool: 'spawn_agents', ok: true, data: {} },
  ]);

  assert.deepEqual(hijos.map((h) => h.ok), [true, false]);
});
