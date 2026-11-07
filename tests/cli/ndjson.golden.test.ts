/**
 * Golden del NDJSON de `commander agent --json` (F1-01).
 *
 * La corrida se guioniza con el proveedor falso de F1-14 y un id de sesión
 * fijo, así que la salida es determinista. El golden se actualiza **a mano**:
 * este test nunca lo reescribe con un `--update`; si cambia el contrato hay que
 * revisar el archivo y editar `tests/cli/fixtures/ndjson.golden.ndjson`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../../src/cli/agentClient.js';
import { encodeEvent, makeEventV2 } from '../../src/agent/sessionTypes.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(HERE, 'fixtures', 'ndjson.golden.ndjson');
const SESSION_ID = 'sess_golden';

describe('NDJSON golden (F1-01)', () => {
  test('la corrida guionizada produce exactamente las líneas del golden', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    const lines: string[] = [];
    const result = await runAgent({
      serverUrl: fake.baseUrl,
      // La corrida incluye una tool válida y una desconocida para que el golden
      // cubra también el evento `error` además de answer/done.
      task: 'SCENARIO:tool-error Ejecuta el caso golden.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      sessionId: SESSION_ID,
      onEvent: (event) => lines.push(encodeEvent(event)),
    });

    // La línea `done` la escribe `bin/commander.ts` con el seq siguiente.
    lines.push(
      encodeEvent(
        makeEventV2(result.sessionId, result.seq + 1, {
          type: 'done',
          answer: result.answer,
          steps: result.steps,
        })
      )
    );

    const actual = `${lines.join('\n')}\n`;
    assert.equal(
      fs.existsSync(GOLDEN_PATH),
      true,
      `falta el golden ${GOLDEN_PATH} (se escribe a mano, no con --update)`
    );
    const expected = fs.readFileSync(GOLDEN_PATH, 'utf8');
    assert.equal(
      actual,
      expected,
      'el NDJSON cambió respecto al golden: revisa el contrato y actualiza el archivo a mano'
    );

    // Cada línea tiene que ser un evento v2 con seq creciente.
    let previous = 0;
    for (const line of actual.split('\n').filter(Boolean)) {
      const event = JSON.parse(line) as { schemaVersion: number; seq: number; sessionId: string };
      assert.equal(event.schemaVersion, 2);
      assert.equal(event.sessionId, SESSION_ID);
      assert.ok(event.seq > previous, 'seq estrictamente creciente');
      previous = event.seq;
    }
  });
});
