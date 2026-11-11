import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTestCommand, runAgent } from '../../src/cli/agentClient.js';
import type { CliEventV2 } from '../../src/agent/sessionTypes.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';

describe('política de herramientas para tests en el CLI', () => {
  test('normaliza node <test> a la forma canónica node --test', () => {
    assert.equal(normalizeTestCommand('node math.test.mjs'), 'node --test math.test.mjs');
    assert.equal(normalizeTestCommand('node "math.test.mjs"'), 'node --test "math.test.mjs"');
    assert.equal(
      normalizeTestCommand('./node_modules/.bin/x'),
      './node_modules/.bin/x'
    );
    assert.equal(
      normalizeTestCommand('node ./nested/slug.spec.ts'),
      'node --test ./nested/slug.spec.ts'
    );
    assert.equal(normalizeTestCommand('node --test math.test.mjs'), 'node --test math.test.mjs');
    assert.equal(normalizeTestCommand('node server.js'), 'node server.js');
    assert.equal(normalizeTestCommand('npm test'), 'npm test');
  });

  test('no ofrece code_run y normaliza el test antes de pedir aprobación', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    let approvalCommand: string | null = null;

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:shell-run-node-test Verifica el test.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 3,
      stream: false,
      sessionId: 'sess_tool_policy',
      requestApproval: async (approval) => {
        const input = approval.input as Record<string, unknown> | null | undefined;
        approvalCommand = typeof input?.command === 'string' ? input.command : null;
        return 'allow';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(approvalCommand, 'node --test math.test.mjs', 'la aprobación ve el comando canónico');

    const toolRequest = fake.requests.find((request) => request.path === '/api/agent/run-tool');
    assert.equal(toolRequest?.body?.toolId, 'shell.run');
    assert.equal(toolRequest?.body?.input?.command, 'node --test math.test.mjs');

    const generate = fake.requests.find((request) => request.path === '/api/gemini/generate');
    assert.match(String(generate?.body?.systemInstruction ?? ''), /POLÍTICA DE HERRAMIENTAS/);
    assert.match(String(generate?.body?.systemInstruction ?? ''), /node --test/);
    const declarations = generate?.body?.tools?.[0]?.functionDeclarations as
      | Array<{ name: string }>
      | undefined;
    assert.ok(declarations, 'el payload incluye declaraciones de tools');
    const names = declarations.map((declaration) => declaration.name);
    assert.equal(names.includes('code_run'), false, 'code.run no se ofrece en el CLI');
    assert.equal(names.includes('shell_run'), true, 'shell.run sigue disponible');

    const approval = events.find((event) => event.type === 'approval_request');
    assert.equal(approval?.type, 'approval_request');
    if (approval?.type === 'approval_request') {
      assert.equal(approval.approval.tool, 'shell.run');
      const input = approval.approval.input as Record<string, unknown>;
      assert.equal(input.command, 'node --test math.test.mjs');
    }
  });
});
