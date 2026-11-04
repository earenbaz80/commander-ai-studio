/**
 * Sesiones PTY del agente: proceso interactivo real, no un comando suelto.
 *
 * Lo que se prueba aquí es lo que distingue a `shell.pty` de `shell.run`: que el
 * proceso sobrevive entre llamadas, que el cursor no repite salida, que una
 * sesión del agente no puede tocar la de otro y que lo peligroso se rechaza
 * antes de spawnear nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeAllPtys,
  closePty,
  isDeniedExecutable,
  listPtys,
  openPty,
  readPty,
  resizePty,
  writePty,
} from '../ptySessions.js';

const cwd = process.cwd();
const sinAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function dormir(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Lee hasta que la salida (sin ANSI) contiene `needle`, o se agota el tiempo. */
async function leerHasta(id: string, cursor: number, needle: string, sessionId = 'sess-uno') {
  let out = '';
  for (let i = 0; i < 60; i++) {
    const r = readPty(id, cursor, sessionId);
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    if (!r.ok) return { out, cursor };
    out += r.output;
    cursor = r.cursor;
    if (sinAnsi(out).includes(needle)) break;
    await dormir(100);
  }
  return { out, cursor };
}

test('una sesión PTY sobrevive entre llamadas: escribe, responde y no repite salida', async () => {
  const abierta = openPty({ executable: process.execPath, args: ['-i'], cwd, sessionId: 'sess-uno' });
  assert.equal(abierta.ok, true, abierta.ok ? '' : abierta.error);
  if (!abierta.ok) return;
  const id = abierta.pty.id;

  try {
    assert.equal(abierta.pty.running, true);

    // El REPL de node calcula; en un tubo normal no se comportaría así.
    assert.equal(writePty(id, '6*7\r', 'sess-uno').ok, true);
    const primera = await leerHasta(id, 0, '42');
    assert.match(sinAnsi(primera.out), /42/, 'el REPL tiene que haber contestado 42');

    // Con el cursor de la llamada anterior no se repite nada de lo ya leído.
    const segunda = readPty(id, primera.cursor, 'sess-uno');
    assert.equal(segunda.ok, true);
    if (segunda.ok) assert.equal(segunda.output, '', 'no debe repetir salida ya entregada');

    // Sigue vivo: otra llamada, otra respuesta.
    assert.equal(writePty(id, '7*6\r', 'sess-uno').ok, true);
    const tercera = await leerHasta(id, primera.cursor, '42');
    assert.match(sinAnsi(tercera.out), /42/);
  } finally {
    const cerrada = closePty(id, 'sess-uno');
    assert.equal(cerrada.ok, true);
  }
});

test('el PTY acepta resize sin cortar la sesión', async () => {
  const abierta = openPty({ executable: process.execPath, args: ['-i'], cwd, sessionId: 'sess-uno', cols: 80, rows: 24 });
  assert.equal(abierta.ok, true, abierta.ok ? '' : abierta.error);
  if (!abierta.ok) return;
  const id = abierta.pty.id;
  try {
    const r = resizePty(id, 120, 40, 'sess-uno');
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    if (r.ok) {
      assert.equal(r.pty.cols, 120);
      assert.equal(r.pty.rows, 40);
      assert.equal(r.pty.running, true);
    }
  } finally {
    closePty(id, 'sess-uno');
  }
});

test('una sesión del agente no puede escribir en el PTY de otra', async () => {
  const abierta = openPty({ executable: process.execPath, args: ['-i'], cwd, sessionId: 'sess-uno' });
  assert.equal(abierta.ok, true, abierta.ok ? '' : abierta.error);
  if (!abierta.ok) return;
  const id = abierta.pty.id;
  try {
    const ajeno = writePty(id, 'console.log(1)\r', 'sess-dos');
    assert.equal(ajeno.ok, false);
    if (!ajeno.ok) assert.match(ajeno.error, /otro agente/);
    const lecturaAjena = readPty(id, 0, 'sess-dos');
    assert.equal(lecturaAjena.ok, false);
    const cierreAjeno = closePty(id, 'sess-dos');
    assert.equal(cierreAjeno.ok, false);
  } finally {
    closePty(id, 'sess-uno');
  }
});

test('rechaza ejecutables peligrosos y rutas de trabajo inexistentes', () => {
  for (const bin of ['sudo', 'cmd/format', 'taskkill.exe', 'regedit']) {
    assert.equal(isDeniedExecutable(bin), true, `${bin} debería estar bloqueado`);
  }
  assert.equal(isDeniedExecutable('node'), false);

  const negado = openPty({ executable: 'sudo', args: [], cwd });
  assert.equal(negado.ok, false);
  if (!negado.ok) assert.match(negado.error, /no se puede abrir/);

  const fantasma = openPty({ executable: process.execPath, args: [], cwd: cwd + '/no-existe-pty' });
  assert.equal(fantasma.ok, false);

  const inexistente = openPty({ executable: 'binario-que-no-existe-xyz', args: [], cwd });
  assert.equal(inexistente.ok, false);
  if (!inexistente.ok) assert.match(inexistente.error, /No se encontró/);
});

test('list y cierre masivo dejan el registro limpio', async () => {
  const abierta = openPty({ executable: process.execPath, args: ['-i'], cwd, sessionId: 'sess-tres' });
  assert.equal(abierta.ok, true, abierta.ok ? '' : abierta.error);
  if (!abierta.ok) return;
  assert.ok(listPtys().some((s) => s.id === abierta.pty.id && s.status === 'running'));
  closeAllPtys();
  assert.equal(listPtys().length, 0);
  // Un id que ya no existe se rechaza en vez de crear algo nuevo.
  assert.equal(readPty(abierta.pty.id, 0, 'sess-tres').ok, false);
});
