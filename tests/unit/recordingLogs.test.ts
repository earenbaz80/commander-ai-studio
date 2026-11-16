import { describe, expect, test } from 'vitest';
import {
  buildRecordingLogs,
  MAX_RECORDING_CONSOLE,
  MAX_RECORDING_NETWORK,
} from '../../src/artifacts/recordingLogs';

const STARTED = 1_700_000_000_000;

function consoleEntry(offset: number, text: string) {
  return { seq: offset, ts: STARTED + offset, type: 'error', text, url: '/checkout' };
}

function networkEntry(offset: number, status = 200) {
  return {
    seq: offset,
    ts: STARTED + offset,
    kind: 'http' as const,
    method: 'GET',
    url: '/api/checkout',
    status,
    durationMs: 12,
  };
}

describe('buildRecordingLogs', () => {
  test('recorta a la ventana y calcula milisegundos relativos', () => {
    const logs = buildRecordingLogs({
      startedAt: STARTED,
      endedAt: STARTED + 1_000,
      console: [
        { seq: 1, ts: STARTED - 5_000, type: 'log', text: 'antes de grabar' },
        consoleEntry(0, 'Uncaught TypeError'),
        consoleEntry(1_000, 'último'),
        { seq: 4, ts: STARTED + 5_000, type: 'log', text: 'después' },
      ],
      network: [networkEntry(120, 500)],
    });

    expect(logs.console.map((entry) => entry.text)).toEqual([
      'Uncaught TypeError',
      'último',
    ]);
    expect(logs.console.map((entry) => entry.atMs)).toEqual([0, 1_000]);
    expect(logs.network[0]).toMatchObject({ atMs: 120, status: 500, method: 'GET' });
    expect(logs.omitted).toBeUndefined();
  });

  test('deduplica por seq y ordena por tiempo', () => {
    const logs = buildRecordingLogs({
      startedAt: STARTED,
      endedAt: STARTED + 1_000,
      console: [consoleEntry(500, 'b'), consoleEntry(100, 'a'), consoleEntry(500, 'b repetido')],
    });
    expect(logs.console.map((entry) => entry.text)).toEqual(['a', 'b']);
  });

  test('aplica topes y deja constancia de lo omitido', () => {
    const many = Array.from({ length: MAX_RECORDING_CONSOLE + 5 }, (_, index) =>
      consoleEntry(index, `mensaje ${index}`)
    );
    const network = Array.from({ length: MAX_RECORDING_NETWORK + 2 }, (_, index) =>
      networkEntry(index)
    );
    const logs = buildRecordingLogs({
      startedAt: STARTED,
      endedAt: STARTED + MAX_RECORDING_CONSOLE + 500,
      console: many,
      network,
    });

    expect(logs.console).toHaveLength(MAX_RECORDING_CONSOLE);
    expect(logs.network).toHaveLength(MAX_RECORDING_NETWORK);
    expect(logs.omitted).toEqual({ console: 5, network: 2 });
    // Se conservan las más recientes, que son las del fallo.
    expect(logs.console[logs.console.length - 1].text).toBe(
      `mensaje ${MAX_RECORDING_CONSOLE + 4}`
    );
  });

  test('redacta secretos y acota textos largos', () => {
    const secret = `ghp_${'a'.repeat(30)}`;
    const logs = buildRecordingLogs({
      startedAt: STARTED,
      endedAt: STARTED + 100,
      console: [
        {
          seq: 1,
          ts: STARTED,
          type: 'error',
          text: `fetch falló con Bearer ${secret} ${'x'.repeat(5_000)}`,
          url: `/api/x?token=${secret}`,
        },
      ],
    });

    const entry = logs.console[0];
    expect(entry.text).not.toContain(secret);
    expect(entry.text.length).toBeLessThanOrEqual(2_000);
    expect(entry.url).not.toContain(secret);
  });

  test('una entrada sin timestamp válido se ignora', () => {
    const logs = buildRecordingLogs({
      startedAt: STARTED,
      endedAt: STARTED + 100,
      console: [{ seq: 1, ts: Number.NaN, text: 'sin reloj' }],
    });
    expect(logs.console).toEqual([]);
  });
});
