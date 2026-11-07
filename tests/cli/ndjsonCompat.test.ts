/**
 * Compatibilidad del consumidor NDJSON (F1-11).
 *
 * Este test actúa como el consumidor externo de `commander agent --json`
 * (extensión de VS Code, `scripts/github-agent.ts`): recorre el golden línea a
 * línea y falla si una línea no es JSON, si el `type` no está documentado o si
 * desaparece un campo obligatorio. Un campo nuevo sí se tolera.
 *
 * El golden se escribe a mano (ver `ndjson.golden.test.ts`); este archivo no lo
 * actualiza.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLI_EVENT_TYPES,
  SESSION_SCHEMA_VERSION,
  encodeEvent,
  isCliEventType,
  makeEventV2,
  type CliEventPayload,
  type CliEventType,
} from '../../src/agent/sessionTypes.js';
import { extractAgentResult } from '../../src/github/agentCommand.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(HERE, 'fixtures', 'ndjson.golden.ndjson');

/** Campos que el consumidor necesita para cada `type` del contrato. */
const REQUIRED_FIELDS: Record<CliEventType, readonly string[]> = {
  session: ['session'],
  status: ['text'],
  chunk: ['text'],
  thought: ['text'],
  tool_call: ['tool', 'input'],
  tool_result: ['tool', 'ok', 'summary'],
  plan: ['plan'],
  approval_request: ['approval'],
  approval_result: ['approvalId', 'decision'],
  question: ['question'],
  answer: ['text'],
  error: ['text'],
  done: ['answer', 'steps'],
};

interface ConsumerEvent {
  schemaVersion: number;
  seq: number;
  sessionId: string;
  type: CliEventType;
  [field: string]: unknown;
}

function parseLine(line: string, lineNumber: number): ConsumerEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`línea ${lineNumber}: no es JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`línea ${lineNumber}: el evento no es un objeto JSON`);
  }

  const event = parsed as Record<string, unknown>;
  if (!isCliEventType(event.type)) {
    throw new Error(`línea ${lineNumber}: type desconocido ${JSON.stringify(event.type)}`);
  }
  if (event.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new Error(
      `línea ${lineNumber}: schemaVersion ${JSON.stringify(event.schemaVersion)} no soportada`
    );
  }
  if (typeof event.seq !== 'number' || !Number.isInteger(event.seq) || event.seq < 1) {
    throw new Error(`línea ${lineNumber}: seq inválido`);
  }
  if (typeof event.sessionId !== 'string' || !event.sessionId) {
    throw new Error(`línea ${lineNumber}: sessionId vacío`);
  }
  for (const field of REQUIRED_FIELDS[event.type]) {
    if (!(field in event)) {
      throw new Error(`línea ${lineNumber}: ${event.type} sin campo obligatorio ${field}`);
    }
  }
  return event as ConsumerEvent;
}

function consumeNdjson(ndjson: string): ConsumerEvent[] {
  const events: ConsumerEvent[] = [];
  let previousSeq = 0;
  const lines = ndjson.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    const event = parseLine(line, index + 1);
    if (event.seq <= previousSeq) {
      throw new Error(`línea ${index + 1}: seq ${event.seq} no es mayor que ${previousSeq}`);
    }
    previousSeq = event.seq;
    events.push(event);
  }
  return events;
}

function baseEvent(payload: CliEventPayload): Record<string, unknown> {
  return JSON.parse(encodeEvent(makeEventV2('sess_compat', 1, payload))) as Record<string, unknown>;
}

const GOLDEN = fs.readFileSync(GOLDEN_PATH, 'utf8');

describe('consumidor NDJSON (F1-11)', () => {
  test('todos los type documentados tienen campos obligatorios declarados', () => {
    assert.deepEqual(Object.keys(REQUIRED_FIELDS).sort(), [...CLI_EVENT_TYPES].sort());
  });

  test('consume el golden completo y termina en done', () => {
    const events = consumeNdjson(GOLDEN);
    assert.ok(events.length > 0, 'el golden no puede estar vacío');
    assert.equal(events[0].type, 'session');
    assert.equal(events.at(-1)?.type, 'done');

    const types = new Set(events.map((event) => event.type));
    for (const type of ['status', 'thought', 'tool_call', 'tool_result', 'answer', 'error'] as const) {
      assert.ok(types.has(type), `el golden debe incluir ${type}`);
    }
    assert.equal(events.filter((event) => event.type === 'done').length, 1, 'done aparece una vez');
    assert.equal(new Set(events.map((event) => event.sessionId)).size, 1, 'una sola sesión');
  });

  test('scripts/github-agent.ts extrae la respuesta final del mismo stream', () => {
    const done = consumeNdjson(GOLDEN).at(-1);
    assert.equal(done?.type, 'done');

    const result = extractAgentResult(GOLDEN);
    assert.equal(result.answer, done?.answer);
    assert.equal(result.steps, done?.steps);
    assert.equal(result.tools, 1);
    assert.deepEqual(result.errors, ['Tool desconocida devuelta por el modelo: no_existe']);
  });

  test('un type desconocido falla el consumidor', () => {
    const valid = baseEvent({ type: 'answer', text: 'ok' });
    const unknown = JSON.stringify({ ...valid, type: 'evento_futuro' });
    assert.throws(() => consumeNdjson(unknown), /type desconocido/);
  });

  test('una línea no-JSON falla el consumidor', () => {
    assert.throws(() => consumeNdjson('aviso: esto no es NDJSON'), /no es JSON/);
    assert.throws(() => consumeNdjson('{"type":'), /no es JSON/);
    assert.throws(() => consumeNdjson('[]'), /no es un objeto JSON/);
  });

  test('quitar un campo obligatorio falla, pero añadir uno desconocido no', () => {
    const valid = baseEvent({ type: 'answer', text: 'ok' });
    const missing = { ...valid };
    delete missing.text;
    assert.throws(() => consumeNdjson(JSON.stringify(missing)), /sin campo obligatorio text/);

    const extended = { ...valid, futuro: { traza: ['a'] } };
    const [event] = consumeNdjson(JSON.stringify(extended));
    assert.deepEqual(event.futuro, { traza: ['a'] });
  });
});
