/**
 * docs/parity/issues/G1-EMPTY-TURN.md, punto 3.
 *
 * El proveedor puede cortar un turno con `finish_reason: length` y `content`
 * vacío. Antes, el CLI lo convertía en la respuesta sintética
 * `(el modelo no devolvió respuesta)`, la guardaba como turno `assistant` y
 * marcaba la sesión `completed`: la reanudación siguiente leía una respuesta
 * que el modelo nunca dio y el estado mentía sobre el cierre. Este caso exige
 * que la corrida quede `failed`, con motivo, y que el turno no se persista.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../../src/cli/agentClient.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';
import type { CliEventV2 } from '../../src/agent/sessionTypes.js';

const SYNTHETIC = '(el modelo no devolvió respuesta)';

test('un turno vacío no se guarda como respuesta del modelo', async (t) => {
  const fake = await startFakeAgentServer();
  t.after(() => fake.close());
  const events: CliEventV2[] = [];

  const result = await runAgent({
    serverUrl: fake.baseUrl,
    task: 'SCENARIO:empty-turn Responde algo.',
    cwd: '/workspace/demo',
    model: 'gemini-2.5-flash',
    maxSteps: 3,
    stream: false,
    persistSession: true,
    requestApproval: async () => 'allow',
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.answer, '', 'no se inventa una respuesta final');
  assert.doesNotMatch(result.answer, /no devolvió respuesta/);
  assert.equal(
    events.some((event) => event.type === 'answer'),
    false,
    'no se anuncia una respuesta que el modelo no dio',
  );
  assert.ok(
    events.some((event) => event.type === 'error' && /Turno vacío/.test(event.text)),
    'el motivo viaja como error, no como respuesta',
  );

  const state = result.state;
  assert.ok(state, 'la sesión persistida está en el resultado');
  assert.equal(state.status, 'failed', 'la corrida no se marca completed');
  assert.match(state.error ?? '', /Turno vacío/);
  assert.match(state.answer ?? '', /Turno vacío/);
  assert.equal(
    (state.turns ?? []).some((turn) => turn.role === 'assistant' && turn.text === SYNTHETIC),
    false,
    'no persiste el texto sintético como turno assistant',
  );
  assert.equal(
    (state.turns ?? []).some((turn) => turn.role === 'assistant'),
    false,
    'no persiste ningún turno assistant en un turno vacío',
  );
  const ultimo = state.steps.at(-1);
  assert.equal(ultimo?.title, 'Turno vacío');
  assert.equal(ultimo?.status, 'failed');
  assert.ok(
    fake.requests.some((request) => request.path === '/api/agent/sessions'),
    'la sesión se creó en el servidor',
  );
});
