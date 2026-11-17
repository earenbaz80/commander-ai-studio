import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnBatchHadFailure, spawnChildrenFromResults } from '../agentSession';
import { spawnFailureClosingMessage } from '../src/agent/spawnStreak';

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

/**
 * G1-T10-06: la forma real que trajo `spawn_agents` en producción, copiada del
 * paso `tool_result` de `sess_5761df65`. El padre del CLI recibió el sobre
 * `{ ok, data: { results, spawned, capped } }`; la extracción del servidor ya lo
 * leía bien, así que el fallo de esa corrida no fue la forma: el bucle del CLI
 * (`runAgent`) no tiene guarda de racha y nadie cortó las seis tandas.
 */
test('lee el sobre real de producción: { ok, data: { results, spawned, capped } }', () => {
  const hijos = spawnChildrenFromResults([
    {
      tool: 'spawn_agents',
      ok: true,
      data: {
        ok: true,
        data: {
          results: [
            { index: 0, ok: false, error: 'Subagente excedió tiempo límite' },
            { index: 1, ok: true, answer: 'Archivos: hijo-b.txt\nDenegado: ninguna' },
          ],
          spawned: 2,
          capped: false,
        },
      },
    },
  ]);

  assert.equal(hijos.length, 2, 'la guarda no puede quedarse en cero hijos');
  assert.equal(spawnBatchHadFailure(hijos), true);
});

test('con las seis tandas de G1-T10-06 la racha llega a 2 en la tercera', () => {
  // `ok` por hijo y por tanda, tal como lo devolvió la corrida: sólo A fallaba
  // (turno vacío, tiempo límite, `max_tokens`, `Error`) y B cerraba bien.
  const tandas = [
    [true, true],
    [false, true],
    [false, true],
    [false, true],
    [true, true],
    [false, true],
  ];

  let racha = 0;
  const rachas = tandas.map((tanda) => {
    racha = spawnBatchHadFailure(tanda.map((ok) => ({ ok }))) ? racha + 1 : 0;
    return racha;
  });

  assert.deepEqual(rachas, [0, 1, 2, 3, 0, 1]);
  assert.equal(rachas.findIndex((valor) => valor >= 2) + 1, 3, 'tenía que cerrar en la tanda 3');
});
test('el mensaje de cierre es el mismo para los dos bucles, con el motivo', () => {
  // G1-D5-10 y G1-T10-06: falla un solo hijo y el otro cierra bien.
  assert.equal(
    spawnFailureClosingMessage([{ ok: false, error: 'Subagente excedió tiempo límite' }, { ok: true }]),
    'No completé la tarea: hubo subagentes fallidos en dos tandas seguidas. Motivo: Subagente excedió tiempo límite'
  );
  // Todos fallidos: cambia la primera frase, no el formato del motivo.
  assert.equal(
    spawnFailureClosingMessage([{ ok: false, error: 'tiempo límite' }, { ok: false, error: 'turno vacío' }]),
    'No completé la tarea: los subagentes fallaron en dos tandas seguidas. Motivo: tiempo límite | turno vacío'
  );
  // Sin motivo no queda un «Motivo:» vacío.
  assert.equal(
    spawnFailureClosingMessage([{ ok: false }]),
    'No completé la tarea: los subagentes fallaron en dos tandas seguidas.'
  );
});
