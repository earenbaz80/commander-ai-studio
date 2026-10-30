/**
 * Registro de subagentes (observabilidad).
 *
 * Lo que se prueba aquí es lo que la UI necesita para no mentir: un hijo aparece
 * en cuanto arranca, conserva su resultado al terminar, se filtra por sesión
 * padre y el registro no crece sin límite.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SUB_AGENT_RECORDS,
  clearSubAgents,
  finishSubAgent,
  listSubAgents,
  resetSubAgentsForTests,
  startSubAgent,
  subscribeSubAgents,
} from '../subAgents.js';

beforeEach(() => resetSubAgentsForTests());

test('un subagente recién lanzado cuenta como corriendo y sin resultado', () => {
  const r = startSubAgent({ id: 's1', parentSessionId: 'p1', goal: 'revisar', model: 'gemini-x' });

  assert.equal(r.status, 'running');
  assert.equal(r.goal, 'revisar');
  assert.equal(r.model, 'gemini-x');
  assert.equal(r.endedAt, undefined);
  assert.equal(r.answer, undefined);
  assert.ok(r.startedAt > 0);

  const [listado] = listSubAgents('p1');
  assert.equal(listado.id, 's1');
  assert.equal(listado.status, 'running');
});

test('al terminar guarda respuesta o error, y el primero gana', () => {
  startSubAgent({ id: 's1', parentSessionId: 'p1', goal: 'ok', model: 'm' });
  finishSubAgent('s1', { ok: true, answer: 'hecho', steps: 4 });

  const [ok] = listSubAgents('p1');
  assert.equal(ok.status, 'completed');
  assert.equal(ok.answer, 'hecho');
  assert.equal(ok.error, undefined);
  assert.equal(ok.steps, 4);
  assert.ok(ok.endedAt && ok.endedAt >= ok.startedAt);

  // Un segundo cierre no reescribe el resultado que ya se mostró.
  finishSubAgent('s1', { ok: false, error: 'tarde' });
  const [igual] = listSubAgents('p1');
  assert.equal(igual.status, 'completed');
  assert.equal(igual.answer, 'hecho');
});

test('un fallo se ve como fallo, con su motivo y sin respuesta', () => {
  startSubAgent({ id: 's2', parentSessionId: 'p1', goal: 'falla', model: 'm' });
  finishSubAgent('s2', { ok: false, error: 'sin cuota' });

  const [f] = listSubAgents('p1');
  assert.equal(f.status, 'failed');
  assert.equal(f.error, 'sin cuota');
  assert.equal(f.answer, undefined);
});

test('cada padre ve sólo sus hijos y borrar uno no toca al otro', () => {
  startSubAgent({ id: 'a', parentSessionId: 'p1', goal: 'uno', model: 'm' });
  startSubAgent({ id: 'b', parentSessionId: 'p2', goal: 'dos', model: 'm' });

  assert.deepEqual(listSubAgents('p1').map((r) => r.id), ['a']);
  assert.deepEqual(listSubAgents('p2').map((r) => r.id), ['b']);

  clearSubAgents('p1');
  assert.deepEqual(listSubAgents('p1'), []);
  assert.deepEqual(listSubAgents('p2').map((r) => r.id), ['b']);
});

test('cada cambio se empuja a quien escucha a ese padre', () => {
  const p1: string[][] = [];
  const p2: string[][] = [];
  const unsub1 = subscribeSubAgents('p1', (rows) => p1.push(rows.map((r) => `${r.id}:${r.status}`)));
  const unsub2 = subscribeSubAgents('p2', (rows) => p2.push(rows.map((r) => r.id)));

  startSubAgent({ id: 'a', parentSessionId: 'p1', goal: 'uno', model: 'm' });
  finishSubAgent('a', { ok: true, answer: 'listo' });

  assert.deepEqual(p1, [['a:running'], ['a:completed']]);
  assert.deepEqual(p2, [], 'el otro padre no recibe nada');

  unsub1();
  unsub2();
  startSubAgent({ id: 'b', parentSessionId: 'p1', goal: 'dos', model: 'm' });
  assert.equal(p1.length, 2, 'tras darse de baja no llegan más eventos');
});

test('borrar los hijos avisa con la lista vacía y marca el aviso como final', () => {
  startSubAgent({ id: 'a', parentSessionId: 'p1', goal: 'uno', model: 'm' });
  const vistos: Array<{ filas: number; final: boolean }> = [];
  const unsub = subscribeSubAgents('p1', (rows, opts) => vistos.push({ filas: rows.length, final: !!opts?.final }));

  clearSubAgents('p1');

  // `final` es lo que hace que el endpoint SSE cierre la respuesta en vez de
  // dejarla abierta y vacía para siempre.
  assert.deepEqual(vistos, [{ filas: 0, final: true }]);
  unsub();

  // La sesión padre ya no existe: sus suscriptores se sueltan.
  startSubAgent({ id: 'b', parentSessionId: 'p1', goal: 'dos', model: 'm' });
  assert.equal(vistos.length, 1, 'nadie escucha a una sesión borrada');
});

test('el registro está acotado aunque todos sigan corriendo', () => {
  for (let i = 0; i < MAX_SUB_AGENT_RECORDS + 10; i++) {
    startSubAgent({ id: `s${i}`, parentSessionId: 'p1', goal: `tarea ${i}`, model: 'm' });
  }

  const listado = listSubAgents('p1');
  assert.ok(listado.length <= MAX_SUB_AGENT_RECORDS, `no puede pasar de ${MAX_SUB_AGENT_RECORDS}`);
  assert.ok(listado.length > 0);
  // Los más nuevos son los que se conservan: el último lanzado está.
  assert.ok(listado.some((r) => r.id === `s${MAX_SUB_AGENT_RECORDS + 9}`));
});
