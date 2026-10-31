/**
 * Espera a que vuelva la cuota y lanza la pasada completa en cuanto un modelo
 * medible se conteste a sí mismo.
 *
 * El problema que resuelve: cuando los modelos con capacidad están agotados, la
 * única forma de registrar una línea base es volver a probar más tarde — y una
 * pasada live completa son ~15 minutos y varios miles de tokens. Sondear con una
 * llamada mínima por modelo es barato; medir a ciegas, no.
 *
 * Reglas:
 *   • Un modelo «sirve» sólo si la sonda lo atribuye a él. Se manda
 *     `fallbackModels: []`, así que una sustitución es un fallo y no un «ok»:
 *     si contestara el lite de rebote, la pasada no se registraría de todos modos.
 *   • Los modelos lite quedan fuera por defecto (`--models` los permite a mano).
 *   • Al encontrar uno se lanza `evals/run.ts --live --require-model` con la
 *     pasada COMPLETA: `--only` no registra línea base por diseño.
 *
 * Uso:
 *   npm run eval:wait                      # sondea cada 15 min, sin límite
 *   npm run eval:wait -- --interval 5      # cada 5 min
 *   npm run eval:wait -- --rounds 1        # una sola ronda
 *   npm run eval:wait -- --dry-run         # sondea y no lanza la pasada
 *   npm run eval:wait -- --models a,b      # candidatos explícitos
 *
 * Variables equivalentes: `EVAL_WAIT_INTERVAL_MIN`, `EVAL_WAIT_ROUNDS`,
 * `EVAL_WAIT_MODELS`.
 *
 * Códigos de salida: 0 la pasada corrió (con el resultado que fuera),
 * 1 se agotaron las rondas sin cuota, 2 no hay candidatos que sondear.
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureEvalServer, type EvalServer } from './server.js';
import { probeModel } from './preflight.js';
import { GEMINI_MODEL_CHAIN } from '../src/config/geminiModels.js';

const HELP = `Uso: npm run eval:wait -- [opciones]

  --interval <min>   minutos entre rondas (defecto 15)
  --rounds <n>       rondas antes de rendirse; 0 = sin límite (defecto)
  --models a,b,c     candidatos explícitos (por defecto, la cadena de Gemini
                     sin los lite, más gemini-3.8-flash)
  --dry-run          sondea y no lanza la pasada
  --help             esto

Sale con 0 si la pasada llegó a correr, 1 si no hubo cuota y 2 si no hay nada
que sondear.`;

const args = process.argv.slice(2);

/** Valor de `--x valor`; `null` si falta o si lo siguiente es otra opción. */
function valueOf(name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

/** Vocabulario del usuario: lo lite ya se midió y no es lo que se espera. */
const LITE = /lite/i;

const dryRun = args.includes('--dry-run');
const intervalMinutes = Number(valueOf('--interval') ?? process.env.EVAL_WAIT_INTERVAL_MIN ?? 15);
const rawRounds = Number(valueOf('--rounds') ?? process.env.EVAL_WAIT_ROUNDS ?? 0);
const explicitModels = (valueOf('--models') ?? process.env.EVAL_WAIT_MODELS ?? '')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);

if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
  console.error(`✖ --interval debe ser un número de minutos mayor que 0 (recibí "${intervalMinutes}")`);
  process.exit(2);
}
const rounds = Number.isFinite(rawRounds) && rawRounds > 0 ? Math.floor(rawRounds) : 0;

const candidates = (
  explicitModels.length > 0 ? explicitModels : [...GEMINI_MODEL_CHAIN, 'gemini-3.8-flash']
)
  .filter((model, index, all) => all.indexOf(model) === index)
  .filter((model) => (explicitModels.length > 0 ? true : !LITE.test(model)));

if (candidates.length === 0) {
  console.error('✖ no quedan candidatos que sondear (todo lo propuesto es lite)');
  process.exit(2);
}

/**
 * Salida ordenada.
 *
 * `process.exit()` en seco con sockets keep-alive abiertos dispara un assert de
 * libuv en Windows (`!(handle->flags & UV_HANDLE_CLOSING)`), y un script que
 * vigila cuota durante horas no puede terminar con un crash. Se deja drenar el
 * bucle y sólo se fuerza la salida si algo lo retiene: el temporizador va
 * `unref()`, así que no mantiene vivo el proceso por sí mismo.
 */
function finish(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 500).unref();
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (line: string) => console.log(`[${stamp()}] ${line}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lanza la pasada completa en un proceso hijo, con la salida en la terminal. */
function runFullPass(model: string, baseUrl: string): Promise<number> {
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const child = spawn(process.execPath, [tsxCli, 'evals/run.ts', '--live', '--require-model'], {
    stdio: 'inherit',
    env: { ...process.env, EVAL_MODEL: model, EVAL_BASE_URL: baseUrl },
  });
  return new Promise((resolve) => {
    child.on('error', (error) => {
      console.error(`✖ no se pudo lanzar la pasada: ${error.message}`);
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

let server: EvalServer | null = null;
let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    log(`recibido ${signal}: cerrando`);
    server?.stop();
    process.exit(130);
  });
}

log(`candidatos: ${candidates.join(', ')}`);
log(
  `cadencia: ${intervalMinutes} min · rondas: ${rounds === 0 ? 'sin límite' : rounds}` +
    `${dryRun ? ' · dry-run (no se lanza la pasada)' : ''}`
);

try {
  server = await ensureEvalServer({ log: (line) => log(line.trim()) });
} catch (e: any) {
  console.error(`✖ ${e?.message || e}`);
  process.exit(1);
}

let chosen = '';

for (let round = 1; rounds === 0 || round <= rounds; round++) {
  log(`ronda ${round}: ${candidates.length} sondas`);

  for (const model of candidates) {
    // `disableFallback`: la sonda responde por este modelo o falla; así un «ok»
    // no puede significar «contestó el lite».
    const probe = await probeModel({ baseUrl: server.baseUrl, model, disableFallback: true });
    if (probe.status === 'ok') {
      const answered = probe.model || model;
          if (LITE.test(answered) && !LITE.test(model)) {
        log(`  ${model}: contestó ${answered} (lite) — no cuenta`);
        continue;
      }
      log(`  ${model}: responde (${answered})`);
      chosen = model;
      break;
    }
    if (probe.status === 'substituted') {
      log(`  ${model}: sustituido → ${probe.fallback?.to ?? 'otro'}`);
    } else {
      log(`  ${model}: falló · ${probe.error ?? 'sin detalle'}`);
    }
  }

  if (chosen) break;

  const isLastRound = rounds !== 0 && round >= rounds;
  if (isLastRound) break;
  log(`sin cuota todavía; siguiente ronda en ${intervalMinutes} min`);
  await sleep(intervalMinutes * 60_000);
}

if (!chosen) {
  log('✖ ninguna ronda encontró un modelo que se conteste a sí mismo');
  server.stop();
  finish(1);
} else {
  log(`✓ ${chosen}: lanzando la pasada completa (es la que registra la línea base)`);

  if (dryRun) {
    log('dry-run: la pasada no se lanza');
    server.stop();
    finish(0);
  } else {
    const code = await runFullPass(chosen, server.baseUrl);
    server.stop();
    log(code === 0 ? 'pasada terminada sin fallos de medición (exit 0)' : `pasada terminada con exit ${code}`);
    finish(code);
  }
}
