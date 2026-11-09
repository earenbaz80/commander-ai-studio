/**
 * `ask_user` en el CLI (F1-06).
 *
 * El prompt se conduce con stdin/stdout falsos, igual que el menú de
 * aprobaciones, para probar opciones, texto libre, reintento y timeout sin una
 * TTY real. Los dos últimos casos ejercitan el bucle `runAgent` contra el
 * proveedor falso: con callback la pregunta espera respuesta; sin callback
 * (`--json` o sin terminal) se emite como evento y la tool se cancela.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runAgent } from '../../src/cli/agentClient.js';
import {
  promptQuestionAnswer,
  Tui,
  type ApprovalPromptInput,
  type ApprovalPromptOutput,
} from '../../src/cli/tui.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';
import type {
  CliEventV2,
  QuestionV2,
  SessionStateV2,
} from '../../src/agent/sessionTypes.js';

class FakeInput extends EventEmitter {
  isTTY = true;
  rawModes: boolean[] = [];

  setRawMode(mode: boolean): this {
    this.rawModes.push(mode);
    return this;
  }

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }
}

class FakeOutput implements ApprovalPromptOutput {
  isTTY = true;
  text = '';

  write(text: string): boolean {
    this.text += text;
    return true;
  }
}

function question(overrides: Partial<QuestionV2> = {}): QuestionV2 {
  return {
    id: 'q_1',
    header: 'Alcance',
    text: '¿Qué alcance uso?',
    options: ['mínimo', 'completo'],
    allowFreeText: true,
    ...overrides,
  };
}

function ask(
  input: FakeInput,
  output: FakeOutput,
  extra: { timeoutMs?: number; signal?: AbortSignal; question?: QuestionV2 } = {}
) {
  return promptQuestionAnswer(extra.question ?? question(), {
    tui: new Tui({ interactive: true, color: false }),
    input: input as ApprovalPromptInput,
    output,
    timeoutMs: extra.timeoutMs,
    signal: extra.signal,
  });
}

describe('prompt de ask_user', () => {
  test('una opción numerada responde y restaura el modo raw', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = ask(input, output);

    input.emit('data', '2');

    assert.deepEqual(await pending, { answer: 'completo' });
    assert.deepEqual(input.rawModes, [true, false]);
    assert.equal(input.listenerCount('data'), 0, 'no deja listeners colgados');
    assert.match(output.text, /Alcance/);
    assert.match(output.text, /1\) mínimo/);
    assert.match(output.text, /2\) completo/);
  });

  test('el texto libre se envía al pulsar Enter', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = ask(input, output);

    input.emit('data', 'usa ');
    input.emit('data', 'el faro');
    input.emit('data', '\r');

    assert.deepEqual(await pending, { answer: 'usa el faro' });
    assert.match(output.text, /usa el faro/);
    assert.deepEqual(input.rawModes, [true, false]);
  });

  test('una opción inválida reintenta sin resolver la pregunta', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = ask(input, output, {
      question: question({ allowFreeText: false }),
    });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    input.emit('data', '9');
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(settled, false, 'la opción inválida no cierra el prompt');
    assert.match(output.text, /opción inválida/);
    assert.match(output.text, /no hay opción 9/);

    input.emit('data', '1');
    assert.deepEqual(await pending, { answer: 'mínimo' });
  });

  test('q cancela la pregunta y la corrida puede seguir', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = ask(input, output);

    input.emit('data', 'q');

    assert.deepEqual(await pending, { answer: null, reason: 'cancelled' });
    assert.match(output.text, /pregunta cancelada/);
    assert.deepEqual(input.rawModes, [true, false]);
  });

  test('el timeout devuelve el motivo timeout y limpia la terminal', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();

    const result = await ask(input, output, { timeoutMs: 20 });

    assert.deepEqual(result, { answer: null, reason: 'timeout' });
    assert.match(output.text, /tiempo agotado/);
    assert.deepEqual(input.rawModes, [true, false]);
    assert.equal(input.listenerCount('data'), 0);
  });
});

describe('ask_user en el bucle del CLI', () => {
  test('espera la respuesta, emite question y la guarda en turns', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const asked: QuestionV2[] = [];
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:ask-user Elige el alcance.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      persistSession: true,
      askUser: async (item) => {
        asked.push(item);
        return { answer: 'completo' };
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: alcance elegido.');
    const generate = fake.requests.find(
      (request) => request.path === '/api/gemini/generate'
    );
    assert.ok(generate, 'el bucle consultó al proveedor');
    const declarations = generate.body?.tools?.[0]?.functionDeclarations as
      | Array<{ name?: string }>
      | undefined;
    assert.ok(
      declarations?.some((declaration) => declaration.name === 'ask_user'),
      'ask_user se ofrece al modelo'
    );
    assert.equal(
      fake.requests.some((request) => request.path === '/api/agent/run-tool'),
      false,
      'ask_user no se envía al endpoint de ejecución de tools'
    );
    assert.equal(asked.length, 1, 'la corrida se bloquea hasta que hay respuesta');
    assert.equal(asked[0].header, 'Alcance');
    assert.equal(asked[0].text, '¿Qué alcance uso?');
    assert.deepEqual(asked[0].options, ['mínimo', 'completo']);
    assert.equal(asked[0].allowFreeText, true);

    const questionEvent = events.find((event) => event.type === 'question');
    if (!questionEvent || questionEvent.type !== 'question') {
      assert.fail('falta el evento question');
    }
    assert.equal(questionEvent.question.text, '¿Qué alcance uso?');
    assert.deepEqual(questionEvent.question.options, ['mínimo', 'completo']);

    const toolResult = events.find(
      (event) => event.type === 'tool_result' && event.tool === 'ask_user'
    );
    if (!toolResult || toolResult.type !== 'tool_result') {
      assert.fail('falta el resultado de ask_user');
    }
    assert.equal(toolResult.ok, true);
    assert.equal(toolResult.summary, 'respuesta: completo');

    const statePut = fake.requests
      .filter((request) => request.method === 'PUT' && request.path.endsWith('/state'))
      .at(-1);
    assert.ok(statePut, 'la sesión se sincronizó al menos una vez');
    const state = statePut.body.state as SessionStateV2;
    const questionTurn = state.turns.find(
      (turn) => turn.role === 'tool' && turn.text.includes('PREGUNTA:')
    );
    assert.ok(questionTurn, 'la pregunta queda en turns');
    assert.match(questionTurn.text, /RESPUESTA: completo/);

    const resultStep = state.steps.find(
      (step) => step.type === 'tool_result' && step.toolId === 'ask_user'
    );
    assert.equal(resultStep?.status, 'completed');
    assert.deepEqual(resultStep?.output, { answer: 'completo' });
  });

  test('sin callback (--json) emite question y cancela sin prompt', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:ask-user Elige el alcance.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      sessionId: 'sess_ask_json',
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: alcance elegido.');
    const questionEvent = events.find((event) => event.type === 'question');
    if (!questionEvent || questionEvent.type !== 'question') {
      assert.fail('--json debe emitir la pregunta como evento');
    }
    assert.equal(questionEvent.question.text, '¿Qué alcance uso?');

    const toolResult = events.find(
      (event) => event.type === 'tool_result' && event.tool === 'ask_user'
    );
    if (!toolResult || toolResult.type !== 'tool_result') {
      assert.fail('falta el resultado cancelado de ask_user');
    }
    assert.equal(toolResult.ok, false);
    assert.match(toolResult.summary, /sin terminal interactiva/);
    assert.equal(
      events.some((event) => event.type === 'question'),
      true,
      'la pregunta no abre un prompt en modo máquina'
    );
  });
});
