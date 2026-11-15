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
import {
  APPROVAL_EXPIRY_WARNING_MS,
  approvalAlertText,
  approvalExpiryText,
  approvalExpiryWarningText,
  approvalTitleRestoreText,
  canPromptApprovals,
  promptApprovalDecision,
  Tui,
} from '../../src/cli/tui.js';
import { createInputGate, type InputGate } from '../../src/cli/stdinGate.js';
import type { ApprovalPromptInput, ApprovalPromptOutput } from '../../src/cli/tui.js';
import { APPROVAL_VISIBILITY_BUDGET_MS, type ApprovalRequestV2 } from '../../src/agent/sessionTypes.js';
import { DIFF_MAX_LINES } from '../../src/cli/diff.js';

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

function approval(id = 'apr_1', overrides: Partial<ApprovalRequestV2> = {}): ApprovalRequestV2 {
  return {
    id,
    sessionId: 'sess_1',
    tool: 'fs.write',
    input: { path: 'nota.txt', content: 'hola' },
    diff: '--- a/nota.txt\n+++ b/nota.txt\n@@ -0,0 +1 @@\n+hola',
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ...overrides,
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

/** Igual que `ask`, pero deja el pedido a la vista: el prompt graba ahí lo que pintó. */
function askTracked(
  request: ApprovalRequestV2,
  input: FakeInput,
  output: FakeOutput,
  extra: { quarantineMs?: number; gate?: InputGate } = {}
) {
  const pending = promptApprovalDecision(request, {
    tui: new Tui({ interactive: true, color: false }),
    input: input as ApprovalPromptInput,
    output,
    ...extra,
  });
  return { pending, request };
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

  test('graba en la aprobación que el diff se pintó antes de decidir', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const { pending, request } = askTracked(approval(), input, output);
    input.emit('data', 'a');

    assert.equal(await pending, 'allow');
    assert.deepEqual(request.render, { diffShown: true, diffTruncated: false, detailOpened: false });
    assert.match(output.text, /@@/);
  });

  test('shell.run muestra el comando completo, cwd, timeout y riesgo', async () => {
    const command = `node --test math.test.mjs --filter "${'argumento-critico-'.repeat(8)}final"`;
    const input = new FakeInput();
    const output = new FakeOutput();
    const { pending } = askTracked(
      approval('apr_shell', {
        tool: 'shell.run',
        input: {
          command,
          cwd: '/workspace/demo',
          timeoutMs: 120_000,
          allowUnlisted: true,
        },
        diff: undefined,
        repeatOf: 'apr_anterior',
      }),
      input,
      output
    );

    input.emit('data', 'a');
    assert.equal(await pending, 'allow');

    assert.ok(output.text.includes(command), 'el comando no se trunca ni se colapsa');
    assert.match(output.text, /comando:/);
    assert.match(output.text, /cwd: \/workspace\/demo/);
    assert.match(output.text, /timeout: 60000 ms \(solicitado 120000 ms; máximo\)/);
    assert.match(output.text, /riesgo: fuera de la allowlist; revisá el comando completo antes de permitir/);
    assert.match(
      output.text,
      /repetición: comando idéntico al anterior; confirmá explícitamente para volver a ejecutarlo/,
      'una repetición se anuncia antes de pedir la confirmación'
    );
  });

  test('la primera tecla deja la marca para medir la latencia de lectura', async () => {
    const input = new FakeInput();
    const { pending, request } = askTracked(approval('apr_primera_tecla'), input, new FakeOutput());
    const antes = Date.now();

    input.emit('data', '\x1b[B');
    await new Promise((resolve) => setTimeout(resolve, 25));
    input.emit('data', 'a');

    assert.equal(await pending, 'allow');
    assert.equal(typeof request.promptStartedAt, 'number', 'el prompt marca cuándo empezó a prepararse');
    assert.equal(typeof request.promptPaintedAt, 'number', 'el menú se pintó antes de escuchar');
    assert.ok(
      (request.promptPaintedAt ?? 0) >= (request.promptStartedAt ?? 0),
      'el pintado ocurre después del inicio del prompt'
    );
    assert.equal(typeof request.firstKeyAt, 'number', 'una flecha también cuenta: había alguien delante');
    assert.equal(typeof request.firstInputAt, 'number', 'el nombre nuevo también queda grabado');
    assert.equal(request.firstInputAt, request.firstKeyAt, 'firstInputAt y firstKeyAt son la misma marca');
    assert.equal(
      typeof request.firstNonDecisionKeyAt,
      'number',
      'la flecha es la primera tecla de lectura'
    );
    assert.ok((request.firstKeyAt ?? 0) >= antes, 'la marca lleva la hora de la tecla');
    assert.ok((request.firstInputAt ?? 0) >= antes, 'firstInputAt lleva la hora de la tecla');
    assert.ok(
      (request.firstNonDecisionKeyAt ?? 0) >= antes,
      'la lectura se marca en la primera tecla no decisoria'
    );
    assert.equal(request.directDecision, undefined, 'hubo lectura antes de decidir');
    assert.ok(
      Date.now() - (request.firstKeyAt ?? 0) >= 20,
      'la marca es la primera tecla, no el momento de decidir'
    );
  });

  test('una decisión directa no fabrica una lectura previa', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const { pending, request } = askTracked(approval('apr_directa'), input, output);

    input.emit('data', '2');

    assert.equal(await pending, 'deny');
    assert.equal(typeof request.firstKeyAt, 'number');
    assert.equal(typeof request.firstInputAt, 'number');
    assert.equal(request.firstInputAt, request.firstKeyAt);
    assert.equal(request.firstNonDecisionKeyAt, undefined, 'no hubo tecla de lectura');
    assert.equal(request.directDecision, true, 'la decisión directa queda marcada');
    assert.match(output.text, /esperando hace \d+s/, 'el aviso persistente muestra la edad');
    assert.match(output.text, /expira en \d+s/, 'el aviso persistente muestra la cuenta regresiva');
  });

  test('Esc cierra sin marcar una decisión directa', async () => {
    const input = new FakeInput();
    const { pending, request } = askTracked(approval('apr_esc'), input, new FakeOutput());

    input.emit('data', '\x1b');

    assert.equal(await pending, null);
    assert.equal(typeof request.firstKeyAt, 'number');
    assert.equal(request.firstNonDecisionKeyAt, undefined, 'Esc no abre lectura');
    assert.equal(request.directDecision, undefined, 'Esc no es una decisión de aprobación');
  });

  test('la cuarentena marca la tecla decisoria que descarta', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const { pending, request } = askTracked(
      approval('apr_cuarentena'),
      input,
      output,
      { quarantineMs: 40 }
    );

    input.emit('data', '\r');
    assert.equal(request.quarantinedKeys, 1, 'el Enter heredado no decide');
    assert.equal(request.quarantinedDecision, true, 'la tecla descartada era una decisión');
    assert.match(output.text, /tecla de decisión descartada/);
    assert.equal(request.firstKeyAt, undefined, 'tampoco cuenta como lectura');
    assert.equal(request.firstInputAt, undefined, 'la cuarentena no registra un input aceptado');

    await new Promise((resolve) => setTimeout(resolve, 60));
    input.emit('data', 'a');

    assert.equal(await pending, 'allow');
    assert.equal(request.quarantinedKeys, 1);
    assert.equal(request.quarantinedDecision, true);
    assert.equal(request.directDecision, true);
  });

  test('la cuarentena de una tecla de lectura no se marca como decisión', async () => {
    const input = new FakeInput();
    const { pending, request } = askTracked(
      approval('apr_cuarentena_lectura'),
      input,
      new FakeOutput(),
      { quarantineMs: 40 }
    );

    input.emit('data', '\x1b[B');
    assert.equal(request.quarantinedKeys, 1);
    assert.equal(request.quarantinedDecision, undefined, 'una flecha no decide');

    await new Promise((resolve) => setTimeout(resolve, 60));
    input.emit('data', 'a');
    assert.equal(await pending, 'allow');
  });

  test('con InputGate no se suma una segunda ventana de cuarentena', async () => {
    const input = new FakeInput();
    const gate = createInputGate(input);
    const { pending, request } = askTracked(
      approval('apr_cuarentena_gate'),
      input,
      new FakeOutput(),
      { quarantineMs: 120, gate }
    );

    input.emit('data', '2');

    assert.equal(await pending, 'deny', 'la compuerta ya descartó lo previo; la tecla nueva decide');
    assert.equal(request.quarantinedKeys, undefined);
    assert.equal(request.quarantinedDecision, undefined);
    gate.close();
  });

  test('el aviso pendiente deja campana y título', () => {
    const alert = approvalAlertText(approval('apr_aviso'));
    assert.match(alert, /^\x07\x1b\]0;⚠ aprobación pendiente: fs\.write\x07$/);
    assert.equal(approvalTitleRestoreText(), '\x1b]0;commander\x07');
  });

  test('el aviso muestra la cola y fecha el primer anuncio sin reescribirlo', async () => {
    const item = approval('apr_cola', { queueDepth: 2 });
    assert.match(approvalAlertText(item), /cola: 2/);

    const chunks: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      const tui = new Tui({ interactive: false, color: false });
      const before = Date.now();
      tui.approvalAlert(item);
      const firstNotice = item.noticeAt;
      assert.ok(firstNotice !== undefined, 'el primer aviso deja su instante');
      assert.ok(firstNotice >= before, 'el instante no es anterior al anuncio');
      assert.ok(
        firstNotice - item.createdAt <= APPROVAL_VISIBILITY_BUDGET_MS,
        'el aviso no supera el presupuesto de 250 ms'
      );

      // Un resync no reescribe el aviso ni su instante.
      const linesBefore = chunks.filter((text) => text.includes('espera aprobación')).length;
      tui.approvalAlert(item);
      assert.equal(item.noticeAt, firstNotice);
      assert.equal(
        chunks.filter((text) => text.includes('espera aprobación')).length,
        linesBefore,
        'el aviso duplicado no pinta otro renglón'
      );
      assert.ok(
        chunks.some((text) => text.includes('espera aprobación') && text.includes('cola: 2')),
        'el renglón visible incluye la profundidad de cola'
      );
    } finally {
      process.stdout.write = original;
    }

    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = promptApprovalDecision(item, {
      tui: new Tui({ interactive: true, color: false }),
      input: input as ApprovalPromptInput,
      output,
      repaintMs: 0,
      quarantineMs: 0,
    });
    input.emit('data', '2');
    assert.equal(await pending, 'deny');
    assert.match(output.text, /cola: 2/, 'el pie del prompt conserva la profundidad de cola');
  });

  test('la cuenta regresiva se calcula en segundos y no inventa expiración', () => {
    const now = 1_700_000_000_000;
    assert.equal(approvalExpiryText(now + 65_000, now), ' · expira en 65s');
    assert.equal(approvalExpiryText(now + 500, now), ' · expira en 1s');
    assert.equal(approvalExpiryText(now - 1, now), ' · expira en 0s');
    assert.equal(approvalExpiryText(0, now), '');
  });

  test('el aviso de expiración cubre el umbral de 30 s y se emite una sola vez', async () => {
    const now = 1_700_000_000_000;
    assert.equal(
      approvalExpiryWarningText(now + APPROVAL_EXPIRY_WARNING_MS, now),
      'la aprobación caduca en 30s',
      'el borde exacto de 30 s avisa'
    );
    assert.equal(
      approvalExpiryWarningText(now + APPROVAL_EXPIRY_WARNING_MS + 1, now),
      '',
      'un milisegundo antes del umbral todavía no avisa'
    );
    assert.equal(approvalExpiryWarningText(now + 1_000, now), 'la aprobación caduca en 1s');
    assert.equal(approvalExpiryWarningText(now, now), '');

    const input = new FakeInput();
    const output = new FakeOutput();
    const { pending } = askTracked(
      approval('apr_aviso30', { expiresAt: Date.now() + APPROVAL_EXPIRY_WARNING_MS + 60 }),
      input,
      output
    );

    // El aviso se programa para dentro de 60 ms; se espera también un latido de
    // la cuenta regresiva para comprobar que no vuelve a sonar en cada segundo.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.equal(
      (output.text.match(/la aprobación caduca en/g) ?? []).length,
      1,
      'el aviso es puntual, no una repetición por segundo'
    );

    // Un repintado borra desde el estado y vuelve a pintar el aviso una sola
    // vez. El `7A` confirma que también cuenta la línea del aviso bajo el pie.
    input.emit('data', '\x1b[B');
    assert.match(output.text, /\x1b\[7A\x1b\[J/, 'el repintado sube por el aviso');
    const lastClear = output.text.lastIndexOf('\x1b[J');
    const repainted = output.text.slice(lastClear);
    assert.equal(
      (repainted.match(/la aprobación caduca en/g) ?? []).length,
      1,
      'el aviso no se duplica al repintar'
    );

    input.emit('data', 'a');
    assert.equal(await pending, 'allow');
  });

  test('el timer del aviso no dispara después de decidir', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const { pending } = askTracked(
      approval('apr_aviso_timer', { expiresAt: Date.now() + APPROVAL_EXPIRY_WARNING_MS + 60 }),
      input,
      output
    );

    input.emit('data', 'a');
    assert.equal(await pending, 'allow');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      output.text.includes('la aprobación caduca'),
      false,
      'cleanup cancela el timer del aviso'
    );
  });

  test('la cuenta regresiva se refresca aunque el menú no se repinte', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = promptApprovalDecision(approval('apr_tick', { expiresAt: Date.now() + 60_000 }), {
      tui: new Tui({ interactive: true, color: false }),
      input: input as ApprovalPromptInput,
      output,
      repaintMs: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    input.emit('data', 'a');

    assert.equal(await pending, 'allow');
    assert.ok(
      (output.text.match(/expira en/g) ?? []).length >= 2,
      'el estado se vuelve a pintar sin esperar al latido'
    );
  });

  test('un resync no vuelve a sonar y el título se restaura al resolver la última', () => {
    const chunks: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      const tui = new Tui({ interactive: true, color: false });
      const first = approval('apr_resync');
      const second = approval('apr_resync_2');

      tui.approvalAlert(first);
      tui.approvalAlert(first); // el mismo pedido reenviado tras reconectar
      tui.approvalAlert(second);

      assert.equal(
        chunks.filter((text) => text.includes('⚠ aprobación pendiente')).length,
        2,
        'cada aprobación suena una sola vez'
      );
      assert.equal(
        chunks.filter((text) => text.includes('espera aprobación')).length,
        2,
        'el resync no repite el renglón'
      );

      // El resultado de la primera no puede borrar el título de la segunda.
      tui.approvalResolved(first.id);
      assert.equal(chunks.some((text) => text.includes('commander')), false);

      tui.approvalResolved(second.id);
      assert.equal(
        chunks.filter((text) => text.includes('commander')).length,
        1,
        'al resolver la última vuelve el título de la app'
      );

      tui.approvalResolved(second.id);
      assert.equal(
        chunks.filter((text) => text.includes('commander')).length,
        1,
        'una resolución repetida no vuelve a escribir el título'
      );
    } finally {
      process.stdout.write = original;
    }
  });

  test('marca truncado cuando el render avisa, y el hunk cuando se abre', async () => {
    const lineas = Array.from({ length: DIFF_MAX_LINES + 20 }, (_, i) => `+linea ${i}`).join('\n');
    const grande = approval('apr_grande', {
      diff: `--- a/f.txt\n+++ b/f.txt\n@@ -1 +1,${DIFF_MAX_LINES + 20} @@\n${lineas}`,
    });
    const input = new FakeInput();
    const output = new FakeOutput();
    const { pending, request } = askTracked(grande, input, output);

    input.emit('data', 'h');
    input.emit('data', 'a');

    assert.equal(await pending, 'allow');
    assert.deepEqual(request.render, { diffShown: true, diffTruncated: true, detailOpened: true });
    assert.match(output.text, /diff truncado/);
    assert.match(output.text, /hunk 1\/1/);
  });

  test('sin diff en el pedido no afirma que se haya pintado uno', async () => {
    const sinDiff = approval('apr_sin_diff', { diff: undefined });
    const input = new FakeInput();
    const { pending, request } = askTracked(sinDiff, input, new FakeOutput());
    input.emit('data', 'a');

    assert.equal(await pending, 'allow');
    assert.deepEqual(request.render, { diffShown: false, diffTruncated: false, detailOpened: false });
  });

  test('un prompt que caduca se resuelve como deny y lo deja grabado', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const { pending, request } = askTracked(
      approval('apr_caducada', { expiresAt: Date.now() + 40 }),
      input,
      output
    );

    assert.equal(await pending, 'deny', 'no se queda esperando a un operador que no está');
    assert.equal(request.firstKeyAt, undefined, 'sin teclas no hay latencia de lectura que publicar');
    assert.equal(request.firstInputAt, undefined, 'sin teclas no hay input que registrar');
    assert.deepEqual(request.render, {
      diffShown: true,
      diffTruncated: false,
      detailOpened: false,
      expired: true,
    });
    assert.match(output.text, /caducada/);
    assert.deepEqual(input.rawModes, [true, false], 'restaura el modo raw');
    assert.equal(input.listenerCount('data'), 0, 'no deja listeners colgados');

    // Una tecla tardía no puede aprobar lo que ya caducó: el prompt ya no escucha.
    input.emit('data', 'a');
    assert.equal(request.render?.expired, true, 'sigue caducada, no aprobada horas después');
    assert.equal(await pending, 'deny');
  });

  // CAL2-R16: con el prompt abierto el panel se quedó en blanco y no había forma
  // de saber si el menú seguía escuchando. Un ↓/↑ tiene que repintar el bloque de
  // opciones y dejar la selección otra vez en la primera (§11.2 punto 9).
  test('↓ y ↑ repintan el menú y devuelven la selección a la primera', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = ask(input, output);

    input.emit('data', '\x1b[B');
    input.emit('data', '\x1b[A');

    // Tres bloques escritos (apertura, ↓ y ↑), con la selección bajando y volviendo.
    assert.deepEqual(output.text.match(/❯ \d\)/g), ['❯ 1)', '❯ 2)', '❯ 1)']);
    // Y reescritos en el sitio: una secuencia de borrado por movimiento (menú + pie),
    // no una copia hacia abajo, que es lo que deja el panel legible tras un repintado.
    assert.equal((output.text.match(/\x1b\[6A\x1b\[J/g) ?? []).length, 2);

    // El menú sigue escuchando y Enter decide con la primera opción.
    input.emit('data', '\r');
    assert.equal(await pending, 'allow');
  });

  // CAL2-R16: el panel se quedó en blanco con el prompt abierto y nadie repintó a
  // mano. El menú tiene que recuperarse solo, sin decidir nada.
  test('se repinta solo con SIGWINCH y con un latido, sin mover la selección', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const resizes = new EventEmitter();
    const pending = promptApprovalDecision(approval('apr_repintado'), {
      tui: new Tui({ interactive: true, color: false }),
      input: input as ApprovalPromptInput,
      output,
      resizeSource: resizes,
      repaintMs: 20,
    });
    const bloques = (): number => (output.text.match(/Permitir una vez/g) ?? []).length;

    assert.equal(bloques(), 1, 'al abrir pinta una vez');
    resizes.emit('SIGWINCH');
    assert.equal(bloques(), 2, 'un cambio de tamaño repinta el menú');

    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.ok(bloques() >= 3, 'el latido repinta mientras el prompt espera');
    const marcas = output.text.match(/❯ \d\)/g) ?? [];
    assert.equal(marcas[marcas.length - 1], '❯ 1)', 'repintar no mueve la selección');
    assert.equal(resizes.listenerCount('SIGWINCH'), 1, 'un solo listener de resize');

    input.emit('data', 'a');
    assert.equal(await pending, 'allow');
    const trasDecidir = bloques();
    resizes.emit('SIGWINCH');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(bloques(), trasDecidir, 'cerrado el prompt ya no repinta');
    assert.equal(resizes.listenerCount('SIGWINCH'), 0, 'suelta el listener al cerrar');
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

  test('a, d y s deciden directo y muestran el diff por hunk', async () => {
    const diff = [
      '--- a/nota.txt',
      '+++ b/nota.txt',
      '@@ -1,1 +1,1 @@',
      '-uno',
      '+UNO',
      '@@ -10,1 +10,1 @@',
      '-diez',
      '+DIEZ',
    ].join('\n');

    for (const [tecla, esperada] of [
      ['a', 'allow'],
      ['d', 'deny'],
      ['s', 'allow-session'],
    ] as const) {
      const input = new FakeInput();
      const output = new FakeOutput();
      const pending = promptApprovalDecision(approval('apr_diff', { diff }), {
        tui: new Tui({ interactive: true, color: false }),
        input: input as ApprovalPromptInput,
        output,
      });
      input.emit('data', tecla);
      assert.equal(await pending, esperada, `la tecla ${tecla} decide ${esperada}`);
      assert.match(output.text, /@@ -1,1 \+1,1 @@/);
      assert.match(output.text, /@@ -10,1 \+10,1 @@/);
      assert.match(output.text, /\+DIEZ/);
      assert.equal(output.text.includes('\x1b['), false, 'sin ANSI con color desactivado');
    }
  });

  test('? recorre los hunks y q deniega y detiene', async () => {
    const diff = '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-uno\n+UNO\n@@ -9,1 +9,1 @@\n-nueve\n+NUEVE';
    const input = new FakeInput();
    const output = new FakeOutput();
    let interrupted = false;
    const pending = promptApprovalDecision(approval('apr_q', { diff }), {
      tui: new Tui({ interactive: true, color: false }),
      input: input as ApprovalPromptInput,
      output,
      onInterrupt: () => {
        interrupted = true;
      },
    });

    input.emit('data', '?');
    assert.match(output.text, /hunk 1\/2/);
    input.emit('data', '?');
    assert.match(output.text, /hunk 2\/2/);
    assert.match(output.text, /NUEVE/);

    input.emit('data', 'q');
    assert.equal(await pending, 'deny');
    assert.equal(interrupted, true, 'q detiene la corrida');
    assert.deepEqual(input.rawModes, [true, false]);
  });

  // CAL2: el operador no podía escribir `?` en su teclado (layout español), así
  // que dos corridas cayeron sin abrir el hunk. Las tres teclas abren el detalle.
  test('? , ¿ y h abren el detalle del hunk', async () => {
    const diff = '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-uno\n+UNO\n@@ -9,1 +9,1 @@\n-nueve\n+NUEVE';

    for (const tecla of ['?', '¿', 'h']) {
      const input = new FakeInput();
      const output = new FakeOutput();
      const pending = promptApprovalDecision(approval(`apr_detail_${tecla}`, { diff }), {
        tui: new Tui({ interactive: true, color: false }),
        input: input as ApprovalPromptInput,
        output,
      });

      input.emit('data', tecla);
      assert.match(output.text, /hunk 1\/2/, `la tecla «${tecla}» abre el detalle del hunk`);

      input.emit('data', 'a');
      assert.equal(await pending, 'allow', `tras el detalle, «${tecla}» + a permite la tool`);
    }
  });

  test('una tecla tecleada antes de abrir la aprobación no decide', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const gate = createInputGate(input);

    // El operador envió de más un Enter al responder la pregunta anterior: queda
    // en stdin mientras el modelo piensa y la compuerta lo descarta.
    input.emit('data', '\r');
    assert.equal(gate.discarded, 1, 'la tecla previa se descarta');

    const pending = promptApprovalDecision(approval('apr_gate'), {
      tui: new Tui({ interactive: true, color: false }),
      input: input as ApprovalPromptInput,
      output,
      gate,
    });

    // Sólo cuenta lo que llega con el menú abierto.
    input.emit('data', 'd');
    assert.equal(await pending, 'deny');

    gate.close();
    assert.equal(input.listenerCount('data'), 0, 'la compuerta suelta stdin');
  });

  test('con compuerta, el Enter previo ya no aprueba por defecto', async () => {
    const input = new FakeInput();
    const gate = createInputGate(input);
    input.emit('data', '\r');

    const pending = promptApprovalDecision(approval('apr_gate2'), {
      tui: new Tui({ interactive: true, color: false }),
      input: input as ApprovalPromptInput,
      output: new FakeOutput(),
      gate,
    });
    input.emit('data', '2');

    assert.equal(await pending, 'deny', 'el prompt sólo obedece a su propia tecla');
    gate.close();
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

  test('registra cuántas aprobaciones esperaban al entrar a la cola', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    const queue = new ApprovalQueue(async (item) => {
      started.push(item.id);
      if (item.id === 'apr_1') await blocked;
      return 'allow';
    });

    const first = approval('apr_1');
    const second = approval('apr_2');
    const third = approval('apr_3');
    queue.push(first);
    queue.push(second);
    queue.push(third);

    assert.deepEqual(started, ['apr_1'], 'el primero ya está siendo atendido');
    assert.equal(first.queueDepth, 0, 'no había nadie delante del primero');
    assert.equal(second.queueDepth, 1, 'el primero está en curso');
    assert.equal(third.queueDepth, 2, 'el primero y el segundo esperan delante');

    release();
    await queue.idle();
  });

  test('no pisa una profundidad de cola que venga del servidor', async () => {
    const queue = new ApprovalQueue(async () => 'allow');
    const item = approval('apr_con_profundidad', { queueDepth: 3 });
    queue.push(item);
    await queue.idle();
    assert.equal(item.queueDepth, 3);
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
