/**
 * Menú de aprobaciones del CLI (F1-04): allow, deny y allow-session.
 *
 * Se conduce con un stdin falso para no depender de una TTY real: el proceso
 * del test emite las mismas secuencias ANSI que un terminal.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ApprovalQueue } from '../../src/cli/approvals.js';
import { canPromptApprovals, promptApprovalDecision, Tui } from '../../src/cli/tui.js';
import type { ApprovalPromptInput, ApprovalPromptOutput } from '../../src/cli/tui.js';
import type { ApprovalRequestV2 } from '../../src/agent/sessionTypes.js';

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

function approval(id = 'apr_1'): ApprovalRequestV2 {
  return {
    id,
    sessionId: 'sess_1',
    tool: 'fs.write',
    input: { path: 'nota.txt', content: 'hola' },
    diff: '--- a/nota.txt\n+++ b/nota.txt\n@@ -0,0 +1 @@\n+hola',
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

function ask(input: FakeInput, output: FakeOutput, signal?: AbortSignal) {
  return promptApprovalDecision(approval(), {
    tui: new Tui({ interactive: true, color: false }),
    input: input as ApprovalPromptInput,
    output,
    signal,
  });
}

describe('menú interactivo de aprobaciones', () => {
  test('flechas + Enter eligen deny y restauran el modo raw', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = ask(input, output);

    input.emit('data', '\x1b[B');
    input.emit('data', '\r');

    assert.equal(await pending, 'deny');
    assert.deepEqual(input.rawModes, [true, false]);
    assert.equal(input.listenerCount('data'), 0, 'no deja listeners colgados');
    assert.match(output.text, /Permitir una vez/);
    assert.match(output.text, /Denegar/);
    assert.match(output.text, /nota\.txt/);
  });

  test('los números eligen directo allow y allow-session', async () => {
    const allowInput = new FakeInput();
    const allow = ask(allowInput, new FakeOutput());
    allowInput.emit('data', '1');
    assert.equal(await allow, 'allow');

    const sessionInput = new FakeInput();
    const session = ask(sessionInput, new FakeOutput());
    sessionInput.emit('data', '3');
    assert.equal(await session, 'allow-session');
  });

  test('Esc deja la decisión al escritorio y avisa', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = ask(input, output);
    input.emit('data', '\x1b');

    assert.equal(await pending, null);
    assert.match(output.text, /escritorio/);
    assert.deepEqual(input.rawModes, [true, false]);
  });

  test('abortar el prompt lo cierra sin decisión', async () => {
    const input = new FakeInput();
    const controller = new AbortController();
    const pending = ask(input, new FakeOutput(), controller.signal);
    controller.abort();

    assert.equal(await pending, null);
    assert.deepEqual(input.rawModes, [true, false]);
  });

  test('sin dos TTY no se pregunta', () => {
    assert.equal(canPromptApprovals({ isTTY: true }, { isTTY: true }), true);
    assert.equal(canPromptApprovals({ isTTY: false }, { isTTY: true }), false);
    assert.equal(canPromptApprovals({ isTTY: true }, { isTTY: false }), false);
  });
});

describe('cola de aprobaciones', () => {
  test('serializa varias pendientes en orden', async () => {
    const seen: string[] = [];
    const queue = new ApprovalQueue(async (item) => {
      seen.push(item.id);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 'allow';
    });

    queue.push(approval('apr_1'));
    queue.push(approval('apr_2'));
    await queue.idle();

    assert.deepEqual(seen, ['apr_1', 'apr_2']);
    assert.equal(queue.pending, 0);
  });

  test('un error no bloquea las siguientes aprobaciones', async () => {
    const seen: string[] = [];
    const errors: string[] = [];
    const queue = new ApprovalQueue(
      async (item) => {
        if (item.id === 'apr_1') throw new Error('falló el POST');
        seen.push(item.id);
        return null;
      },
      (error) => errors.push(String(error))
    );

    queue.push(approval('apr_1'));
    queue.push(approval('apr_2'));
    await queue.idle();

    assert.deepEqual(seen, ['apr_2']);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /falló el POST/);
  });

  test('close descarta lo pendiente', () => {
    const queue = new ApprovalQueue(async () => null);
    queue.close();
    queue.push(approval());
    assert.equal(queue.pending, 0);
  });
});
