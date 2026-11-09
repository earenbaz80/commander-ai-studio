/**
 * Contrato v2 de estado y eventos (F1-01).
 *
 * Lo que se fija aquí es la forma, no el transporte: el CLI (`--json`), el SSE
 * y la TUI comparten `CliEventV2`; el servidor persiste `SessionStateV2`.
 * Cualquier issue posterior (approvals, plan con estados, `--resume`) tiene que
 * caber en este contrato sin romper a los consumidores actuales.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLI_EVENT_TYPES,
  EventSequencer,
  SESSION_SCHEMA_VERSION,
  createSessionState,
  decodeEvent,
  decodeSessionState,
  encodeEvent,
  encodeSessionState,
  makeEventV2,
  normalizeSessionStatus,
  type CliEventPayload,
  type CliEventType,
  type SessionStateV2,
} from '../../src/agent/sessionTypes.js';

/** Un evento válido de cada `type` documentado. */
const SAMPLES: Record<CliEventType, CliEventPayload> = {
  session: {
    type: 'session',
    session: {
      id: 'sess_demo',
      goal: 'arreglar el faro',
      cwd: '/workspace',
      model: 'gemini-2.5-flash',
      mode: 'build',
      status: 'running',
    },
  },
  status: { type: 'status', text: 'Paso 1/5: pensando…' },
  chunk: { type: 'chunk', text: 'Hola ' },
  thought: { type: 'thought', text: 'Voy a leer el README.' },
  tool_call: { type: 'tool_call', tool: 'fs.read', input: { path: 'README.md' } },
  tool_result: { type: 'tool_result', tool: 'fs.read', ok: true, summary: '{"ok":true}' },
  plan: {
    type: 'plan',
    plan: [
      { id: 'p1', text: 'leer el repo', status: 'done', done: true },
      { id: 'p2', text: 'escribir el fix', status: 'pending', done: false },
    ],
  },
  approval_request: {
    type: 'approval_request',
    approval: {
      id: 'apr_1',
      sessionId: 'sess_demo',
      tool: 'fs.write',
      input: { path: 'a.ts' },
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_000_300_000,
    },
  },
  approval_result: {
    type: 'approval_result',
    approvalId: 'apr_1',
    decision: 'allow',
    reason: 'revisado',
  },
  question: {
    type: 'question',
    question: { id: 'q1', header: 'Sigo', text: '¿Continuo?', options: ['sí', 'no'] },
  },
  answer: { type: 'answer', text: 'Listo: el faro funciona.' },
  error: { type: 'error', text: 'LLM HTTP 500' },
  done: { type: 'done', answer: 'Listo: el faro funciona.', steps: 2 },
};

function fullState(): SessionStateV2 {
  const state = createSessionState({
    id: 'sess_roundtrip',
    goal: 'dejar el contrato fijo',
    cwd: '/workspace/demo',
    model: 'custom/fake',
    mode: 'plan',
  });
  state.status = 'completed';
  state.createdAt = 1_700_000_000_000;
  state.updatedAt = 1_700_000_001_000;
  state.turns = [
    { role: 'user', text: 'objetivo', ts: 1_700_000_000_000 },
    { role: 'assistant', text: 'hecho', ts: 1_700_000_001_000 },
  ];
  state.steps = [
    {
      id: 'step_1',
      type: 'tool_call',
      toolId: 'fs.read',
      title: 'fs.read',
      content: '{"path":"README.md"}',
      input: { path: 'README.md' },
      status: 'completed',
      durationMs: 12,
      ts: 1_700_000_000_500,
    },
    {
      id: 'step_2',
      type: 'tool_result',
      toolId: 'fs.read',
      title: 'fs.read',
      content: 'contenido',
      output: { content: 'x' },
      status: 'completed',
      ts: 1_700_000_000_600,
    },
  ];
  state.plan = [
    { id: 'p1', text: 'leer', status: 'done', done: true },
    { id: 'p2', text: 'escribir', status: 'pending', done: false },
  ];
  state.pendingApproval = {
    id: 'apr_1',
    sessionId: 'sess_roundtrip',
    tool: 'fs.write',
    input: { path: 'a.ts', content: 'x' },
    diff: '+x',
    createdAt: 1_700_000_000_700,
    expiresAt: 1_700_000_300_700,
  };
  state.answer = 'dejado';
  return state;
}

describe('contrato de eventos v2', () => {
  test('todos los type documentados sobreviven al round-trip con sobre v2', () => {
    assert.deepEqual(
      [...CLI_EVENT_TYPES].sort(),
      Object.keys(SAMPLES).sort(),
      'la lista pública y los ejemplos tienen que cubrir los mismos tipos'
    );

    const sequencer = new EventSequencer('sess_demo');
    for (const type of CLI_EVENT_TYPES) {
      const event = sequencer.next(SAMPLES[type]);
      assert.equal(event.schemaVersion, SESSION_SCHEMA_VERSION);
      assert.equal(event.sessionId, 'sess_demo');
      assert.equal(event.type, type);

      const line = encodeEvent(event);
      assert.equal(line.includes('\n'), false, `${type}: encodeEvent devuelve una sola línea`);
      assert.deepEqual(decodeEvent(line), event, `${type}: round-trip sin pérdida`);
    }
  });

  test('el seq es estrictamente creciente por sesión y cada sesión empieza en 1', () => {
    const a = new EventSequencer('sess_a');
    const b = new EventSequencer('sess_b');
    const seqs: number[] = [];
    for (let i = 0; i < 5; i++) {
      seqs.push(a.next({ type: 'status', text: `paso ${i}` }).seq);
      assert.equal(b.next({ type: 'status', text: `paso ${i}` }).seq, i + 1);
    }
    assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
    assert.equal(a.lastSeq, 5);
    assert.equal(b.lastSeq, 5);
    for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] > seqs[i - 1]);
  });

  test('makeEventV2 respeta el seq que le da el llamador', () => {
    const event = makeEventV2('sess_x', 42, { type: 'answer', text: 'ok' });
    assert.equal(event.seq, 42);
    assert.equal(event.schemaVersion, 2);
    assert.equal(event.sessionId, 'sess_x');
  });

  test('un campo desconocido no rompe al consumidor y se conserva', () => {
    const base = makeEventV2('sess_demo', 3, { type: 'answer', text: 'ok' });
    const line = JSON.stringify({ ...base, futuro: { trazas: ['a'] }, otroCampo: 7 });
    const decoded = decodeEvent(line);
    assert.ok(decoded);
    assert.equal(decoded.type, 'answer');
    assert.equal(decoded.text, 'ok');
    assert.deepEqual((decoded as unknown as Record<string, unknown>).futuro, { trazas: ['a'] });
    assert.equal((decoded as unknown as Record<string, unknown>).otroCampo, 7);
  });

  test('un type desconocido o una línea rota devuelven null en vez de lanzar', () => {
    assert.equal(decodeEvent('{"type":"futuro","seq":1}'), null);
    assert.equal(decodeEvent('{ esto no es json'), null);
    assert.equal(decodeEvent('[]'), null);
    assert.equal(decodeEvent('null'), null);
    assert.equal(decodeEvent(JSON.stringify({ seq: 1 })), null);
    // Sin sobre: se completa con valores neutros para que el consumidor no
    // tenga que comprobar cada campo.
    const sinSobre = decodeEvent(JSON.stringify({ type: 'answer', text: 'ok' }));
    assert.equal(sinSobre?.seq, 0);
    assert.equal(sinSobre?.sessionId, '');
    assert.equal(sinSobre?.schemaVersion, 2);
  });
});

describe('SessionStateV2', () => {
  test('round-trip completo del estado (turnos, pasos, plan y aprobación)', () => {
    const state = fullState();
    const decoded = decodeSessionState(encodeSessionState(state));
    assert.deepEqual(decoded, state);
  });

  test('los campos desconocidos se conservan y los ausentes toman valores por defecto', () => {
    const raw = {
      ...fullState(),
      campoFuturo: { version: 3 },
    };
    const decoded = decodeSessionState(JSON.stringify(raw));
    assert.ok(decoded);
    assert.deepEqual((decoded as unknown as Record<string, unknown>).campoFuturo, { version: 3 });
    assert.equal(decoded.id, 'sess_roundtrip');

    const minimal = decodeSessionState(JSON.stringify({ id: 'sess_min' }));
    assert.ok(minimal);
    assert.equal(minimal.schemaVersion, 2);
    assert.equal(minimal.status, 'idle');
    assert.deepEqual(minimal.turns, []);
    assert.deepEqual(minimal.steps, []);
    assert.deepEqual(minimal.plan, []);
    assert.equal(minimal.pendingApproval, null);
  });

  test('migra los estados legados del servidor', () => {
    assert.equal(normalizeSessionStatus('done'), 'completed');
    assert.equal(normalizeSessionStatus('error'), 'failed');
    assert.equal(normalizeSessionStatus('stopped'), 'cancelled');
    assert.equal(normalizeSessionStatus('running'), 'running');
    assert.equal(normalizeSessionStatus('cualquier-cosa'), 'idle');

    const legacy = decodeSessionState(JSON.stringify({ id: 'sess_legacy', status: 'done' }));
    assert.equal(legacy?.status, 'completed');
  });

  test('un estado corrupto o sin id no se carga', () => {
    assert.equal(decodeSessionState('{ roto'), null);
    assert.equal(decodeSessionState(JSON.stringify({ goal: 'sin id' })), null);
    assert.equal(decodeSessionState(JSON.stringify({ id: '' })), null);
  });
});
