/**
 * Cliente CLI del stream (F1-03).
 *
 * El servidor falso corta la primera conexión después de dos eventos y en la
 * segunda repite uno: el cliente debe reconectar con `Last-Event-ID`, no
 * duplicar el `seq` ya visto y terminar con el `gone` del servidor.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { consumeSessionStream } from '../../src/cli/agentClient.js';
import { createSessionState, makeEventV2, type CliEventV2 } from '../../src/agent/sessionTypes.js';

interface SseFixture {
  baseUrl: string;
  connections: Array<{ after: string | null; lastEventId: string | null }>;
  close: () => Promise<void>;
}

function frame(event: CliEventV2): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function resyncFrame(seq: number, state: unknown): string {
  return `id: ${seq}\nevent: resync\ndata: ${JSON.stringify(state)}\n\n`;
}

function goneFrame(seq: number, reason = 'completed'): string {
  return `id: ${seq}\nevent: gone\ndata: ${JSON.stringify({ reason })}\n\n`;
}

async function startSseFixture(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, connection: number) => void
): Promise<SseFixture> {
  const connections: SseFixture['connections'] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    connections.push({
      after: url.searchParams.get('after'),
      lastEventId: typeof req.headers['last-event-id'] === 'string' ? req.headers['last-event-id'] : null,
    });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    handler(req, res, connections.length);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    connections,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

describe('reconexión del cliente de sesión', () => {
  test('corta, reconecta con Last-Event-ID y deduplica por seq', async () => {
    const fixture = await startSseFixture((_req, res, connection) => {
      if (connection === 1) {
        res.write(
          frame(
            makeEventV2('sess_reconnect', 1, {
              type: 'tool_call',
              tool: 'fs.read',
              input: { path: 'README.md' },
            })
          )
        );
        res.write(
          frame(
            makeEventV2('sess_reconnect', 2, {
              type: 'tool_call',
              tool: 'fs.read',
              input: { path: 'package.json' },
            })
          )
        );
        // Corte de red sin `gone`: el cliente tiene que reabrir.
        setTimeout(() => res.destroy(), 15);
        return;
      }
      // La segunda conexión repite el seq 2 a propósito.
      res.write(
        frame(
          makeEventV2('sess_reconnect', 2, {
            type: 'tool_call',
            tool: 'fs.read',
            input: { path: 'package.json' },
          })
        )
      );
      res.write(
        frame(
          makeEventV2('sess_reconnect', 3, {
            type: 'tool_result',
            tool: 'fs.read',
            ok: true,
            summary: 'ok',
          })
        )
      );
      res.end(goneFrame(3));
    });

    const events: CliEventV2[] = [];
    const gone: string[] = [];
    try {
      const result = await consumeSessionStream({
        serverUrl: fixture.baseUrl,
        sessionId: 'sess_reconnect',
        retryDelaysMs: [5, 5, 5],
        onEvent: (event) => events.push(event),
        onGone: (reason) => gone.push(reason),
      });

      assert.equal(result.lastSeq, 3);
      assert.equal(result.reconnects, 1);
      assert.equal(result.gone, 'completed');
      assert.deepEqual(events.map((event) => event.seq), [1, 2, 3]);
      assert.equal(events.filter((event) => event.type === 'tool_call').length, 2);
      assert.deepEqual(gone, ['completed']);
      assert.equal(fixture.connections.length, 2);
      assert.equal(fixture.connections[1].lastEventId, '2');
      assert.equal(fixture.connections[1].after, '2');
    } finally {
      await fixture.close();
    }
  });

  test('un resync reemplaza el estado y continúa desde su id', async () => {
    const state = createSessionState({
      id: 'sess_resync_cli',
      goal: 'reconstruir',
      cwd: '/workspace',
    });
    state.status = 'running';
    state.steps = [
      {
        id: 'step_old',
        type: 'thought',
        title: 'Previo',
        content: 'antes del corte',
        status: 'completed',
        ts: Date.now(),
      },
    ];

    const fixture = await startSseFixture((_req, res) => {
      res.write(resyncFrame(5, state));
      res.write(
        frame(
          makeEventV2('sess_resync_cli', 6, {
            type: 'status',
            text: 'running',
          })
        )
      );
      res.end(goneFrame(6));
    });

    const resyncs: string[] = [];
    const events: CliEventV2[] = [];
    try {
      const result = await consumeSessionStream({
        serverUrl: fixture.baseUrl,
        sessionId: 'sess_resync_cli',
        after: 99,
        retryDelaysMs: [5],
        onResync: (next) => resyncs.push(next.id),
        onEvent: (event) => events.push(event),
      });

      assert.equal(result.lastSeq, 6);
      assert.equal(result.resyncs, 1);
      assert.deepEqual(resyncs, ['sess_resync_cli']);
      assert.deepEqual(events.map((event) => event.seq), [6]);
    } finally {
      await fixture.close();
    }
  });
});
