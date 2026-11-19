/**
 * Corrida real del CLI **instalado** contra el proveedor falso del repo.
 *
 * `check-cli-package.mjs` ya comprueba `--version` y `--help`, pero eso sólo
 * demuestra que el bundle arranca. Acá se ejecuta `commander agent` de verdad:
 * el binario que quedó en `node_modules` habla con `startFakeAgentServer()`
 * (health, sesión, turno del modelo y `run-tool`), hace una tool y cierra con
 * `done`. Es el mismo contrato que mide `tests/cli/e2e.test.ts`, sin modelo ni
 * red.
 *
 * Uso: `node --import tsx scripts/check-cli-agent-run.ts <ruta al commander.mjs>`
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeAgentServer } from '../tests/helpers/fakeAgentServer.js';

const FINAL = 'Listo: el faro funciona.';
const TIMEOUT_MS = 120_000;

// Absoluta: el proceso hijo corre en un cwd temporal, no en el del repo.
const cli = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!cli) {
  console.error('[check:cli-agent] falta la ruta al CLI instalado');
  process.exit(2);
}
if (!fs.existsSync(cli)) {
  console.error(`[check:cli-agent] no existe ${cli}`);
  process.exit(2);
}

const fallos: string[] = [];
const comprobar = (ok: boolean, mensaje: string) => {
  if (!ok) fallos.push(mensaje);
};

const server = await startFakeAgentServer();
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-cli-agent-'));

try {
  const resultado = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>(
    (resolve) => {
      const child = spawn(
        process.execPath,
        [cli, 'agent', 'SCENARIO:tool Lee package.json y cierra.', '--json', '--server', server.baseUrl, '--max-steps', '8'],
        {
          cwd,
          env: { ...process.env, NO_COLOR: '1', GEMINI_API_KEY: '', GOOGLE_API_KEY: '' },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        }
      );
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch { /* ya cerró */ }
      }, TIMEOUT_MS);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { stdout = `${stdout}${chunk}`.slice(-1_000_000); });
      child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-64_000); });
      child.once('error', (e) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: `${stderr}${e.message}`, timedOut });
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      });
    }
  );

  const eventos = resultado.stdout
    .split(/\r?\n/)
    .filter((linea) => linea.trim())
    .map((linea) => {
      try { return JSON.parse(linea) as { type?: string; answer?: unknown; steps?: unknown }; } catch { return null; }
    })
    .filter((evento): evento is { type?: string; answer?: unknown; steps?: unknown } => evento !== null);

  const done = [...eventos].reverse().find((evento) => evento.type === 'done');

  comprobar(!resultado.timedOut, `la corrida se colgó (>${TIMEOUT_MS} ms)`);
  comprobar(resultado.code === 0, `el CLI salió con ${resultado.code}: ${resultado.stderr.trim().slice(0, 400)}`);
  comprobar(Boolean(done), `no hubo evento done. salida: ${resultado.stdout.trim().slice(0, 400)}`);
  comprobar(done?.answer === FINAL, `la respuesta fue ${JSON.stringify(done?.answer)} y se esperaba ${JSON.stringify(FINAL)}`);
  comprobar(Number(done?.steps) >= 2, `la corrida hizo ${done?.steps} pasos: no hubo tool de por medio`);

  const peticiones = server.requests;
  comprobar(
    peticiones.some((r) => r.method === 'POST' && r.path === '/api/agent/run-tool' && r.body?.toolId === 'fs.read'),
    'el CLI no llegó a ejecutar una tool contra el servidor'
  );
  comprobar(
    peticiones.some((r) => r.path === '/api/health'),
    'el CLI no consultó /api/health'
  );

  if (fallos.length > 0) {
    for (const fallo of fallos) console.error(`[check:cli-agent] ${fallo}`);
    process.exitCode = 1;
  } else {
    console.log(`[check:cli-agent] ok · agent completó en ${done?.steps} pasos con ${peticiones.length} peticiones al servidor falso`);
  }
} finally {
  await server.close();
  fs.rmSync(cwd, { recursive: true, force: true });
}
