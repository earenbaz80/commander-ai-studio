/**
 * `/proposals`: agrupa por archivo, marca las obsoletas contra el `baseHash`
 * actual, revisa el diff y avisa al terminar si quedan pendientes.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReplSession } from '../../src/cli/repl.js';
import { Tui } from '../../src/cli/tui.js';
import { createSessionState, type SessionProposalV2 } from '../../src/agent/sessionTypes.js';
import { hashContent } from '../../src/agent/proposalHash.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';

function captureTui(): { tui: Tui; lines: string[] } {
  const tui = new Tui({ interactive: false, color: false });
  const lines: string[] = [];
  tui.line = (text = '') => lines.push(text);
  tui.rule = () => {};
  return { tui, lines };
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'commander-proposals-cli-'));
}

function editProposal(
  proposalId: string,
  file: string,
  base: string,
  after: string,
  over: Partial<SessionProposalV2> = {}
): SessionProposalV2 {
  return {
    proposalId,
    path: file,
    diff: `--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-${base.trim()}\n+${after.trim()}\n`,
    baseHash: hashContent(base),
    afterHash: hashContent(after),
    applied: false,
    tool: 'fs.propose.edit',
    createdAt: Date.now(),
    ...over,
  };
}

describe('/proposals', () => {
  test('agrupa por archivo, marca obsoletas y revisa el diff', async (t) => {
    const root = tempRoot();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'aplicable.txt'), 'base\n', 'utf8');
    fs.writeFileSync(path.join(root, 'obsoleta.txt'), 'otro contenido\n', 'utf8');

    const state = createSessionState({
      id: 'sess_proposals',
      goal: 'revisar propuestas',
      cwd: root,
      model: 'gemini-2.5-flash',
    });
    state.proposals = [
      editProposal('prop_aplicable', 'aplicable.txt', 'base\n', 'nuevo\n'),
      editProposal('prop_obsoleta', 'obsoleta.txt', 'base\n', 'nuevo\n'),
      editProposal('prop_aplicada', 'aplicable.txt', 'base\n', 'nuevo\n', { applied: true }),
    ];

    const { tui, lines } = captureTui();
    let saved: typeof state | undefined;
    const session = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: root,
      state,
      preferences: {},
      tui,
      deps: {
        saveState: async (_serverUrl, next) => {
          saved = next;
        },
      },
    });

    await session.handleLine('/proposals');

    const listing = lines.join('\n');
    assert.match(listing, /propuestas 2 pendiente/);
    assert.match(listing, /aplicable\.txt/);
    assert.match(listing, /obsoleta\.txt/);
    assert.match(listing, /prop_obsoleta.*obsoleta/);
    assert.match(listing, /embudo: 3 creadas/);
    assert.doesNotMatch(listing, /prop_aplicada/, 'las aplicadas no se listan');
    assert.match(listing, /\/proposals <n> para revisar el diff/);

    await session.handleLine('/proposals 1');
    const review = lines.join('\n');
    assert.match(review, /propuesta prop_aplicable/);
    assert.match(review, /aplicable/);
    assert.match(review, /-base/);
    assert.match(review, /\+nuevo/);
    assert.equal(state.proposals?.find((p) => p.proposalId === 'prop_aplicable')?.reviewedAt !== undefined, true);
    assert.equal(state.proposalStats?.reviewed, 1);
    assert.equal(saved, state, 'la revisión se persiste');

    await session.handleLine('/proposals discard prop_aplicable');
    assert.equal(saved?.proposals?.find((p) => p.proposalId === 'prop_aplicable')?.discardedAt !== undefined, true);
    assert.equal(state.proposalStats?.discarded, 1);
    await session.handleLine('/proposals');
    assert.match(lines.join('\n'), /propuestas 1 pendiente/);
  });

  test('exporta un .patch sólo si git apply --check lo acepta', async (t) => {
    const root = tempRoot();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    fs.writeFileSync(path.join(root, 'aplicable.txt'), 'base\n', 'utf8');
    fs.writeFileSync(path.join(root, 'obsoleta.txt'), 'otro contenido\n', 'utf8');

    const state = createSessionState({
      id: 'sess_export',
      goal: 'exportar propuestas',
      cwd: root,
      model: 'gemini-2.5-flash',
    });
    state.proposals = [
      editProposal('prop_aplicable', 'aplicable.txt', 'base\n', 'nuevo\n'),
      editProposal('prop_obsoleta', 'obsoleta.txt', 'base\n', 'nuevo\n'),
    ];

    const { tui, lines } = captureTui();
    const session = new ReplSession({
      serverUrl: 'http://127.0.0.1:1',
      cwd: root,
      state,
      preferences: {},
      tui,
      deps: { saveState: async () => {} },
    });

    await session.handleLine('/proposals export prop_aplicable');

    const patchPath = path.join(root, '.commander', 'patches', 'prop_aplicable.patch');
    assert.equal(fs.existsSync(patchPath), true, 'el parche válido se escribe');
    assert.match(fs.readFileSync(patchPath, 'utf8'), /\+nuevo/);
    assert.match(lines.join('\n'), /parche validado con git apply --check/);
    execFileSync('git', ['apply', '--check', patchPath], { cwd: root });

    await session.handleLine('/proposals export prop_obsoleta');

    const stalePath = path.join(root, '.commander', 'patches', 'prop_obsoleta.patch');
    assert.equal(fs.existsSync(stalePath), false, 'un diff obsoleto no se exporta');
    assert.match(lines.join('\n'), /git apply --check falló/);
  });

  test('avisa al terminar si el turno deja propuestas pendientes', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const root = tempRoot();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const { tui, lines } = captureTui();
    const session = new ReplSession({
      serverUrl: fake.baseUrl,
      cwd: root,
      model: 'gemini-2.5-flash',
      preferences: {},
      tui,
    });

    await session.handleLine('SCENARIO:propose-edit Propón el cambio en slug.mjs.');

    const output = lines.join('\n');
    assert.match(output, /1 propuesta pendiente/);
    assert.match(output, /\/proposals para revisarlas/);
  });
});
