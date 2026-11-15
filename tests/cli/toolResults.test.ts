/**
 * Resultados de tools en el CLI: el endpoint puede responder HTTP 200 con
 * `ok:false` (G1-D1-05: `fs.edit` con un `oldString` que ya no está) y
 * `fs.propose.*` no aplica cambios porque el CLI no tiene `fs.apply`. Los dos
 * casos tienen que verse en el paso, no sólo en el cuerpo de la respuesta.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, runTool } from '../../src/cli/agentClient.js';
import type { CliEventV2, SessionStateV2 } from '../../src/agent/sessionTypes.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';

function lastPrompt(fake: Awaited<ReturnType<typeof startFakeAgentServer>>): string {
  const request = [...fake.requests]
    .reverse()
    .find((item) => typeof (item.body as { prompt?: unknown })?.prompt === 'string');
  return String((request?.body as { prompt?: string })?.prompt ?? '');
}

async function serverState(baseUrl: string, sessionId: string): Promise<SessionStateV2> {
  const res = await fetch(`${baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}`);
  const body = (await res.json()) as { state?: SessionStateV2 };
  assert.ok(body.state, 'el servidor devuelve el estado de la sesión');
  return body.state as SessionStateV2;
}

describe('resultados de tools en el CLI', () => {
  test('runTool convierte un HTTP 200 con ok:false en un fallo', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    const result = await runTool(fake.baseUrl, 'fs.edit', {
      path: 'fallo.txt',
      oldString: 'a',
      newString: 'b',
    });

    assert.equal(result.ok, false);
    assert.match(String(result.error), /oldString no encontrado en el archivo/);

    const applied = await runTool(fake.baseUrl, 'fs.edit', {
      path: 'ya.txt',
      oldString: 'viejo',
      newString: 'nuevo',
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.code, 'ALREADY_APPLIED');
    assert.match(String(applied.hint), /no hace falta releerlo/);
  });

  test('un HTTP 200 sin JSON válido es un fallo, no un éxito vacío', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    const html = await runTool(fake.baseUrl, 'fs.read', { path: 'html.txt' });
    assert.equal(html.ok, false);
    assert.match(String(html.error), /HTTP 200 con JSON inválido/);

    const empty = await runTool(fake.baseUrl, 'fs.read', { path: 'vacio.txt' });
    assert.equal(empty.ok, false);
    assert.match(String(empty.error), /HTTP 200 sin cuerpo/);
  });

  test('el error de «ya aplicado» llega al historial y al paso', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:edit-already-applied Edita ya.txt.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      persistSession: true,
      requestApproval: async () => 'allow',
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    const prompt = lastPrompt(fake);
    assert.match(prompt, /no hace falta releerlo/, 'el modelo recibe la pista en el historial');
    const emitted = events.find((event) => event.type === 'tool_result');
    assert.ok(emitted && emitted.type === 'tool_result');
    if (emitted?.type === 'tool_result') {
      assert.equal(emitted.ok, false);
      assert.match(emitted.summary, /ALREADY_APPLIED|ya aplicado/);
    }

    const state = await serverState(fake.baseUrl, result.sessionId);
    const step = state.steps.find((item) => item.type === 'tool_result' && item.toolId === 'fs.edit');
    assert.equal(step?.status, 'failed');
    assert.match(String(step?.content), /no hace falta releerlo/);
  });

  test('el paso queda failed cuando el payload trae ok:false', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:tool-payload-false Edita fallo.txt.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      persistSession: true,
      requestApproval: async () => 'allow',
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.', 'el bucle sigue tras el fallo de la tool');
    const emitted = events.find((event) => event.type === 'tool_result');
    assert.ok(emitted && emitted.type === 'tool_result');
    if (emitted?.type === 'tool_result') {
      assert.equal(emitted.ok, false);
      assert.match(emitted.summary, /ERROR: oldString no encontrado/);
    }

    const state = await serverState(fake.baseUrl, result.sessionId);
    const step = state.steps.find((item) => item.type === 'tool_result' && item.toolId === 'fs.edit');
    assert.equal(step?.status, 'failed', 'el estado no puede decir completed si la tool no hizo nada');
    assert.match(String(step?.content), /ERROR: oldString no encontrado/);
  });

  test('el historial recibe el diff completo de fs.propose, con marca si se trunca', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:propose-long-diff Propón el cambio largo.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      requestApproval: async () => 'allow',
    });
    const long = lastPrompt(fake);
    assert.match(long, /HISTORIAL/);
    assert.match(long, /\+largo linea 59/, 'el diff de 2,4 KB llega entero, no cortado a 500');
    assert.doesNotMatch(long, /\[diff truncado/);

    await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:propose-huge-diff Propón el cambio enorme.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      requestApproval: async () => 'allow',
    });
    const huge = lastPrompt(fake);
    assert.match(huge, /\+enorme linea 0/);
    assert.match(huge, /\[diff truncado: \d+ de \d+ caracteres\]/);
    assert.doesNotMatch(huge, /\+enorme linea 499/, 'el final del diff no entra: se marca el corte');
  });

  test('git.diff sigue con el resumen corto aunque traiga un diff largo', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:git-diff-long Revisa el diff.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      requestApproval: async () => 'allow',
    });

    const prompt = lastPrompt(fake);
    assert.match(prompt, /\+gitdifflarga linea 0/);
    assert.doesNotMatch(
      prompt,
      /\+gitdifflarga linea 59/,
      'git.diff no recibe el trato de propuesta: se corta a 500'
    );
    assert.match(prompt, /…/, 'el resumen marca el corte');
  });

  test('fs.propose se marca como propuesta no aplicada', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:propose-edit Propón el cambio en slug.mjs.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      persistSession: true,
      requestApproval: async () => 'allow',
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    const emitted = events.find((event) => event.type === 'tool_result');
    assert.ok(emitted && emitted.type === 'tool_result');
    if (emitted?.type === 'tool_result') {
      assert.equal(emitted.ok, true, 'la propuesta se generó bien');
      assert.match(emitted.summary, /Propuesta no aplicada/);
      assert.match(emitted.summary, /el diff queda pendiente de aplicar/);
      assert.equal(
        (emitted.summary.match(/Propuesta no aplicada/g) ?? []).length,
        1,
        'la nota viene del payload del servidor, el CLI no la duplica'
      );
    }

    const state = await serverState(fake.baseUrl, result.sessionId);
    const step = state.steps.find(
      (item) => item.type === 'tool_result' && item.toolId === 'fs.propose.edit'
    );
    assert.equal(step?.status, 'completed', 'la tool respondió; lo que falta es aplicar');
    assert.match(String(step?.content), /Propuesta no aplicada/);
    assert.match(String(step?.content), /\+nuevo/);
    const output = step?.output as
      | { data?: { applied?: boolean; proposalId?: string; hint?: string } }
      | undefined;
    assert.equal(output?.data?.applied, false, 'el estado conserva que no se aplicó');
    assert.match(String(output?.data?.proposalId), /^prop_fake/);
    assert.match(String(output?.data?.hint), /Propuesta no aplicada/);
    const stored = state.proposals?.find((item) => item.path === 'slug.mjs');
    assert.ok(stored, 'la propuesta queda en el estado de la sesión');
    assert.equal(stored?.baseHash, 'sha256:fake');
    assert.equal(stored?.afterHash, 'sha256:fake-after');
    assert.equal(stored?.applied, false);
    assert.match(String(stored?.diff), /\+nuevo/);
  });

  test('la misma propuesta repetida no duplica el estado', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:propose-duplicate Propón el mismo cambio dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      persistSession: true,
      requestApproval: async () => 'allow',
    });

    const state = await serverState(fake.baseUrl, result.sessionId);
    const stored = state.proposals?.filter((item) => item.path === 'slug.mjs') ?? [];
    assert.equal(stored.length, 1, 'dos diffs idénticos dejan una sola propuesta');
    assert.equal(state.proposalStats?.created, 2);
    assert.equal(state.proposalStats?.duplicatesDropped, 1);
  });
});
