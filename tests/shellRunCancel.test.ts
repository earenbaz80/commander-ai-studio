/**
 * Cancelación de una tool en vuelo.
 *
 * La prueba en vivo dejó medido el hueco: `POST /cancel` marcaba a los hijos
 * como cancelados en 324 ms y, dos segundos después, el `vite build` en curso
 * seguía escribiendo `dist/`. `stop()` abortaba la petición al proveedor, no el
 * proceso que la tool ya había lanzado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../shellJobs.js';
import { executeAgentTool } from '../agentTools.js';

/** Válido en los dos sistemas y que no termina solo en varios segundos. */
const LENTO = process.platform === 'win32' ? 'ping -n 30 127.0.0.1' : 'ping -c 30 127.0.0.1';

test('cancelar corta un pipeline en vuelo en vez de esperar a que termine', async () => {
  const ctrl = new AbortController();
  const inicio = Date.now();
  setTimeout(() => ctrl.abort(), 300);

  const out = await runPipeline([LENTO], process.cwd(), 60_000, ctrl.signal);

  assert.equal(out.aborted, true, 'debe informar que lo cortó la señal');
  assert.equal(out.timedOut, false, 'no es el timeout del propio pipeline');
  assert.equal(out.exitCode, 130, 'código de corte por cancelación');
  assert.ok(Date.now() - inicio < 10_000, `debe resolver al abortar, tardó ${Date.now() - inicio} ms`);
});

test('una señal ya abortada no arranca el proceso', async () => {
  const out = await runPipeline(['echo hola'], process.cwd(), 10_000, AbortSignal.abort());

  assert.equal(out.aborted, true);
  assert.equal(out.stdout, '', 'no llegó a ejecutar nada');
});

test('shell.run propaga la señal de la sesión hasta el proceso', async () => {
  const res = await executeAgentTool('shell.run', { command: 'echo hola' }, { signal: AbortSignal.abort() });

  assert.equal(res.ok, false);
  assert.match(String(res.error), /Cancelado/);
});