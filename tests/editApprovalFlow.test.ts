import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';
import {
  cleanupDir,
  resolveApproval,
  startScriptedProvider,
  waitForApproval,
  waitForState,
  type FakeProvider,
} from './agent/approvalHarness.js';

let srv: ServerHarness;

before(async () => {
  srv = await startServer();
});

after(async () => {
  await srv?.stop();
});

test('flujo de edición: fs.read, aprobación de fs.edit y contenido verificado', { timeout: 30_000 }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-edit-flow-'));
  const file = path.join(cwd, 'task.txt');
  let provider: FakeProvider | null = null;

  try {
    fs.writeFileSync(file, 'ESTADO: PENDIENTE\nTOKEN: CAMBIAR\n', 'utf8');
    provider = await startScriptedProvider([
      { tool: 'fs.read', args: { path: 'task.txt' } },
      {
        tool: 'fs.edit',
        args: {
          path: 'task.txt',
          oldString: 'TOKEN: CAMBIAR',
          newString: 'TOKEN: NVIDIA_OK',
        },
      },
      { text: 'EDITADO' },
    ]);

    const created = await srv.request('POST', '/api/agent/sessions', {
      goal: 'Lee task.txt, reemplaza TOKEN: CAMBIAR por TOKEN: NVIDIA_OK y verifica el resultado.',
      cwd,
      model: 'custom/test',
      mode: 'build',
      allowedTools: ['fs.read', 'fs.edit'],
      maxSteps: 5,
      run: true,
      keys: {
        CUSTOM_BASE_URL: provider.baseUrl,
        CUSTOM_API_KEY: 'clave-falsa',
        CUSTOM_MODEL: 'modelo-falso',
      },
    });
    assert.equal(created.status, 200, created.raw);
    assert.equal(created.body.success, true, created.raw);
    const id = String(created.body.session.id);

    const approval = await waitForApproval(srv, id);
    assert.equal(approval.tool, 'fs.edit');
    assert.equal(approval.sessionId, id);
    assert.match(approval.diff || '', /-TOKEN: CAMBIAR/);
    assert.match(approval.diff || '', /\+TOKEN: NVIDIA_OK/);

    const allowed = await resolveApproval(srv, id, approval.id, 'allow', 'edición de prueba');
    assert.equal(allowed.status, 200, allowed.raw);
    assert.equal(allowed.body.decision, 'allow');

    const state = await waitForState(srv, id, ['completed', 'failed']);
    assert.equal(state.status, 'completed', JSON.stringify(state));
    assert.equal(state.answer, 'EDITADO');
    assert.equal(
      fs.readFileSync(file, 'utf8'),
      'ESTADO: PENDIENTE\nTOKEN: NVIDIA_OK\n',
      'el contenido final debe reflejar la edición aprobada'
    );

    const results = state.steps.filter((step: any) => step.type === 'tool_result');
    assert.deepEqual(
      results.map((step: any) => step.toolId),
      ['fs.read', 'fs.edit'],
      'la sesión debe leer antes de editar'
    );
    const editResult = results.find((step: any) => step.toolId === 'fs.edit');
    assert.equal(editResult?.approval?.decision, 'allow');
    assert.equal(editResult?.approval?.id, approval.id);
  } finally {
    await provider?.close();
    cleanupDir(cwd);
  }
});
