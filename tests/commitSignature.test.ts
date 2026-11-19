/**
 * El chequeo de firma es la guardia que mantiene «una sola firma» después de
 * haber reescrito el historial. Si sus patrones se aflojan, cualquier trailer
 * vuelve a entrar sin que nada falle; si se endurecen de más, bloquea mensajes
 * legítimos y se termina desactivando. Estos casos fijan las dos orillas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  FIRMA,
  commitsDelRango,
  desvioDeIdentidad,
  firmasEnMensaje,
  problemaDe,
} from '../scripts/check-commit-signature';

const leer = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('firma: un mensaje sin trailers pasa', () => {
  const mensaje = [
    'fix(agent): no cierra en rojo si el gate falla',
    '',
    'El cierre por maxSteps dejaba pasar corridas que el gate había marcado.',
  ].join('\n');
  assert.deepEqual(firmasEnMensaje(mensaje), []);
});

test('firma: los trailers de co-autoría fallan', () => {
  for (const linea of [
    'Co-Authored-By: Codebuff <noreply@codebuff.com>',
    'co-authored-by: Otra Persona <otra@example.com>',
    '  Co-Authored-By: Claude <noreply@anthropic.com>',
  ]) {
    const hallazgos = firmasEnMensaje(`feat(x): algo\n\n${linea}`);
    assert.equal(hallazgos.length, 1, `debería fallar: ${linea}`);
    assert.match(hallazgos[0].motivo, /co-autoría/);
  }
});

test('firma: las marcas de herramientas de IA fallan', () => {
  for (const linea of [
    '🤖 Generated with Codebuff',
    'Generated with Codebuff',
    'generated with cursor',
    'Authored by Copilot',
    'Contacto: noreply@codebuff.com',
  ]) {
    const hallazgos = firmasEnMensaje(`feat(x): algo\n\n${linea}`);
    assert.equal(hallazgos.length, 1, `debería fallar: ${linea}`);
  }
});

test('firma: la prosa que nombra co-autoría o herramientas no falla', () => {
  const mensaje = [
    'docs(parity): compara con Freebuff y su SDK',
    '',
    'El co-autor del diseño revisó la tabla; la mención a copilot en la comparación',
    'es una capacidad documentada del producto, no una firma del commit.',
  ].join('\n');
  assert.deepEqual(firmasEnMensaje(mensaje), []);
});

test('firma: autor y committer tienen que ser la única firma', () => {
  assert.equal(desvioDeIdentidad({ ...FIRMA }, { ...FIRMA }), null);

  const otroAutor = desvioDeIdentidad({ nombre: 'Otra Persona', email: FIRMA.email }, { ...FIRMA });
  assert.match(String(otroAutor), /autor/);

  const otraPersona = desvioDeIdentidad({ ...FIRMA }, { nombre: FIRMA.nombre, email: 'x@y.z' });
  assert.match(String(otraPersona), /committer/);

  // El correo se compara sin mayúsculas: `Foo@Bar` y `foo@bar` son la misma.
  assert.equal(
    desvioDeIdentidad({ ...FIRMA, email: FIRMA.email.toUpperCase() }, { ...FIRMA }),
    null
  );
});

test('firma: `.mailmap` y `AGENTS.md` coinciden con la firma del script', () => {
  const mailmap = leer('.mailmap');
  assert.ok(mailmap.includes(FIRMA.email), '.mailmap usa el correo canónico');
  assert.ok(mailmap.includes(FIRMA.nombre), '.mailmap usa el nombre canónico');
  // La regla escrita para agentes es la misma que aplica el script: si una
  // cambia sin la otra, la guardia y la instrucción se contradicen.
  assert.match(leer('AGENTS.md'), /Firma de los commits/, 'AGENTS.md documenta la regla');
});

test('firma: todo el historial del repo pasa el chequeo', (t) => {
  // Un clon superficial no tiene la historia: se omite en vez de mentir.
  const superficial =
    execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() ===
    'true';
  if (superficial) {
    t.skip('clon superficial: sin historia que revisar');
    return;
  }
  const commits = commitsDelRango('HEAD');
  assert.ok(commits.length > 100, `esperaba historia completa, hay ${commits.length} commits`);
  assert.deepEqual(
    commits.map(problemaDe).filter((p) => p !== null),
    []
  );
});

test('firma: un commit con trailer se reporta con su hash y el motivo', () => {
  const problema = problemaDe({
    hash: 'abcdef1234567890',
    autor: { ...FIRMA },
    committer: { ...FIRMA },
    mensaje: 'feat(cli): algo\n\n🤖 Generated with Codebuff',
  });
  assert.match(String(problema), /^ {2}· abcdef1 feat\(cli\): algo → /);
  assert.match(String(problema), /emoji de bot/);
});
