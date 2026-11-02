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
import { execFileSync } from 'node:child_process';
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

/** PIDs de `ping` vivos: si el kill no alcanza al nieto, queda uno aquí. */
function pings(): string[] {
  try {
    if (process.platform === 'win32') {
      const ps = "Get-CimInstance Win32_Process -Filter \"Name='ping.exe'\" | ForEach-Object { Write-Output $_.ProcessId }";
      return execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).split(/\s+/).filter(Boolean);
    }
    return execFileSync('pgrep', ['-x', 'ping'], { encoding: 'utf8' }).split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

// El bug original: el `cmd /c` moría y el `node`/`ping` nieto seguía vivo. Que el
// pipeline resuelva rápido no basta; tiene que no quedar nadie corriendo.
test('cancelar no deja el proceso huérfano', async () => {
  const antes = new Set(pings());
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 400);

  await runPipeline([LENTO], process.cwd(), 60_000, ctrl.signal);
  await new Promise((r) => setTimeout(r, 1500));

  const huerfanos = pings().filter((p) => !antes.has(p));
  assert.deepEqual(huerfanos, [], `quedaron procesos vivos: ${huerfanos.join(', ')}`);
});

test('el timeout también mata el árbol antes de resolver', async () => {
  const antes = new Set(pings());

  const out = await runPipeline([LENTO], process.cwd(), 600);

  assert.equal(out.timedOut, true, 'es el corte por timeout');
  assert.equal(out.exitCode, 124, 'código de corte por timeout');
  // Sin la espera al kill, el proceso sobrevivía al resultado de la tool.
  const huerfanos = pings().filter((p) => !antes.has(p));
  assert.deepEqual(huerfanos, [], `quedaron procesos vivos: ${huerfanos.join(', ')}`);
});