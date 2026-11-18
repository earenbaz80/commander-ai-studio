/**
 * Guarda de racha de `spawn_agents` en el bucle del CLI.
 *
 * G1-T10-06: el padre relanzó `spawn_agents` seis veces con un hijo fallido por
 * tanda y no cerró nunca. La guarda existía sólo en el bucle del servidor
 * (`AgentSession.stepNative`); `runAgent` corre el suyo y no la tenía. Este test
 * es de punta a punta: servidor falso + `runAgent` real con la forma de
 * resultados que devolvió la corrida.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../../src/cli/agentClient.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';

describe('guarda de racha de spawn_agents en el CLI', () => {
  test('cierra a la segunda tanda seguida con un hijo fallido (G1-T10-06)', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:spawn-agents-fail Lanza dos subagentes por tanda.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 8,
      stream: false,
      persistSession: true,
      requestApproval: async () => 'allow',
    });

    assert.match(
      result.answer,
      /No completé la tarea: hubo subagentes fallidos en dos tandas seguidas/,
      `el cierre informa del fallo: ${JSON.stringify(result.answer)}`
    );
    assert.match(result.answer, /Subagente excedió tiempo límite/, 'el motivo del hijo viaja en el cierre');

    const turnos = fake.requests.filter((item) => item.path === '/api/gemini/generate').length;
    const spawns = fake.requests.filter(
      (item) => item.path === '/api/agent/run-tool' && item.body?.toolId === 'spawn_agents'
    ).length;
    assert.equal(turnos, 2, 'no pide un tercer turno al proveedor');
    assert.equal(spawns, 2, 'no lanza una tercera tanda');
    assert.equal(result.steps, 2, 'la corrida termina en la segunda tanda');

    const state = (await (
      await fetch(`${fake.baseUrl}/api/agent/sessions/${encodeURIComponent(result.sessionId)}`)
    ).json()) as { state?: { answer?: string; status?: string } };
    assert.equal(state.state?.answer, result.answer, 'el cierre queda guardado en la sesión');
    assert.equal(state.state?.status, 'completed');
  });
});
