import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listJobs, readJobLog, startJob, stopJob } from '../shellJobs.js';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-jobs-test-'));
fs.writeFileSync(path.join(DIR, 'quick.js'), 'console.log("linea uno");\nconsole.log("listo-12345");\n', 'utf8');
fs.writeFileSync(path.join(DIR, 'long.js'), 'console.log("arrancado");\nsetTimeout(() => {}, 60000);\n', 'utf8');

const started: string[] = [];

async function waitFor(fn: () => boolean, ms = 10_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function logs(id: string) {
  const res = readJobLog(id, 20);
  assert.equal(res.ok, true, res.ok ? '' : res.error);
  return res.ok ? res.data : null;
}

after(async () => {
  for (const id of started) {
    try {
      await stopJob(id);
    } catch {
      /* ya estaba parado */
    }
  }
  try {
    fs.rmSync(DIR, { recursive: true, force: true });
  } catch {
    /* sin permiso */
  }
});

test('startJob registra id, pid y log, y el proceso termina solo', async () => {
  const res = startJob('node quick.js', ['node quick.js'], DIR);
  assert.equal(res.ok, true, res.ok ? '' : res.error);
  if (!res.ok) return;
  started.push(res.job.id);

  assert.match(res.job.id, /^job-/);
  assert.equal(res.job.status, 'running');
  assert.ok(res.job.pid && res.job.pid > 0, 'debe exponer el pid');
  assert.ok(fs.existsSync(res.job.logPath), 'el log debe existir');

  const termino = await waitFor(() => logs(res.job.id)?.status !== 'running');
  assert.equal(termino, true, 'el trabajo debe salir solo');

  const data = logs(res.job.id);
  assert.equal(data?.status, 'exited');
  assert.equal(data?.exitCode, 0);
  assert.match(String(data?.content), /listo-12345/);
});

test('listJobs incluye los trabajos arrancados', async () => {
  const res = startJob('node quick.js', ['node quick.js'], DIR);
  assert.equal(res.ok, true, res.ok ? '' : res.error);
  if (!res.ok) return;
  started.push(res.job.id);
  await waitFor(() => logs(res.job.id)?.status !== 'running');

  const ids = listJobs().map((j) => j.id);
  assert.ok(ids.includes(res.job.id));
});

test('stopJob para el proceso y lo marca como stopped', async () => {
  const res = startJob('node long.js', ['node long.js'], DIR);
  assert.equal(res.ok, true, res.ok ? '' : res.error);
  if (!res.ok) return;
  started.push(res.job.id);
  const pid = res.job.pid as number;

  const arranco = await waitFor(() => String(logs(res.job.id)?.content).includes('arrancado'));
  assert.equal(arranco, true, 'el proceso debe haber arrancado');
  assert.equal(vivo(pid), true, 'el pid debe estar vivo antes de pararlo');

  const stopped = await stopJob(res.job.id);
  assert.equal(stopped.ok, true, stopped.ok ? '' : stopped.error);
  if (stopped.ok) {
    assert.equal(stopped.data.status, 'stopped');
    assert.deepEqual(stopped.data.pids, res.job.pids);
  }

  const muerto = await waitFor(() => !vivo(pid));
  assert.equal(muerto, true, 'el proceso debe morir al pararlo');
  assert.equal(logs(res.job.id)?.status, 'stopped');

  const otraVez = await stopJob(res.job.id);
  assert.equal(otraVez.ok, false, 'parar dos veces no debe fingir éxito');
});

test('stopJob rechaza un pid que no pertenece al trabajo', async () => {
  const res = startJob('node long.js', ['node long.js'], DIR);
  assert.equal(res.ok, true, res.ok ? '' : res.error);
  if (!res.ok) return;
  started.push(res.job.id);

  const ajeno = await stopJob(res.job.id, 999_999);
  assert.equal(ajeno.ok, false);
  if (!ajeno.ok) assert.match(ajeno.error, /no pertenece/);

  // El trabajo sigue vivo: el rechazo no mató nada.
  assert.equal(logs(res.job.id)?.status, 'running');

  await stopJob(res.job.id);
});

test('stopJob y readJobLog rechazan ids desconocidos', async () => {
  const stopped = await stopJob('job-no-existe');
  assert.equal(stopped.ok, false);

  const logsRes = readJobLog('job-no-existe');
  assert.equal(logsRes.ok, false);
  if (!logsRes.ok) assert.match(logsRes.error, /Trabajo desconocido/);
});

test('readJobLog devuelve solo la cola pedida', async () => {
  const res = startJob('node quick.js', ['node quick.js'], DIR);
  assert.equal(res.ok, true, res.ok ? '' : res.error);
  if (!res.ok) return;
  started.push(res.job.id);
  await waitFor(() => logs(res.job.id)?.status !== 'running');

  const one = readJobLog(res.job.id, 1);
  assert.equal(one.ok, true);
  if (one.ok) {
    assert.match(String(one.data.content), /listo-12345/);
    assert.equal(one.data.truncated, true, 'con tail 1 y dos líneas hay recorte');
  }
});
