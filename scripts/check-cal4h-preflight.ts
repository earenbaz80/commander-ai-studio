/**
 * Preflight read-only para el bloque CAL4H.
 *
 * Comprueba que el entorno medido está listo **sin ejecutar ninguna corrida**:
 * health 200 con `status: "ok"` en `:3283`, exactamente un listener en ese
 * puerto, worktree limpio en `360f8c2` y store humano vacío.
 *
 * No escribe archivos, no arranca servidores, no importa muestras y no llama a
 * `g1-cal4.ts`. El PID del listener se imprime como dato observado: no es una
 * condición de la puerta. La métrica (15 151 ms, piso I3 de 1 500 ms, n ≥ 40,
 * ≤ 2 de 40 y exclusiones ≤ 20 %) no se lee, no se recalcula y no se modifica.
 *
 * Uso: `npx tsx scripts/check-cal4h-preflight.ts`
 * Sale 0 si los cuatro checks pasan; 1 si alguno falla.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contarListeners, gitAt, verificarWorktree } from './cal4h-preflight';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIN = '360f8c2ac6ecf4ec0459f204be66099354930ae9';
const WORKTREE = path.join(ROOT, 'tests', 'tmp-g1', 'cal4-repo');
const HUMAN_STORE = path.join(
  ROOT,
  'tests',
  'tmp-g1',
  'cal4-human',
  '.commander',
  'g1',
  'cal4',
  'samples.jsonl'
);
const HEALTH_URL = 'http://127.0.0.1:3283/api/health';
const PORT = 3283;

let fallos = 0;

function passa(nombre: string, detalle: string): void {
  console.log(`✓ ${nombre}: ${detalle}`);
}

function falla(nombre: string, detalle: string): void {
  fallos++;
  console.error(`✗ ${nombre}: ${detalle}`);
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function intentar(nombre: string, fn: () => string): void {
  try {
    passa(nombre, fn());
  } catch (error) {
    falla(nombre, mensaje(error));
  }
}

function git(args: string[]): string {
  return gitAt(WORKTREE, args);
}

interface ListenerInfo {
  count: number;
  pids: string[];
}

/**
 * Cuenta las líneas que representan sockets TCP en LISTEN sobre `:3283`.
 *
 * En Windows se usa `netstat -ano -p tcp`; en POSIX, `lsof` y, si no está, `ss`
 * o `netstat`. Se cuentan líneas de socket, no procesos: un servidor escuchando
 * en IPv4 e IPv6 son dos listeners y el preflight debe avisarlo.
 */
function listeners(): ListenerInfo {
  const intentos =
    process.platform === 'win32'
      ? [{ cmd: 'netstat', args: ['-ano', '-p', 'tcp'] }]
      : [
          { cmd: 'lsof', args: ['-nP', '-iTCP:3283', '-sTCP:LISTEN'] },
          { cmd: 'ss', args: ['-ltnp', 'sport = :3283'] },
          { cmd: 'netstat', args: ['-an', '-p', 'tcp'] },
        ];

  let salida = '';
  for (const intento of intentos) {
    try {
      salida = execFileSync(intento.cmd, intento.args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      break;
    } catch (error) {
      const err = error as { code?: string; status?: number; stdout?: string | Buffer };
      // lsof sale 1 cuando no hay coincidencias: es una salida válida (cero).
      if (err.status === 1) {
        salida = String(err.stdout ?? '');
        break;
      }
      if (err.code === 'ENOENT') continue;
      throw error;
    }
  }

  return contarListeners(salida, PORT);
}

function checkWorktreePin(): string {
  return verificarWorktree(WORKTREE, PIN, ROOT);
}

function checkWorktreeClean(): string {
  if (!existsSync(WORKTREE)) throw new Error(`no existe ${path.relative(ROOT, WORKTREE)}`);
  const sucio = git(['status', '--porcelain']);
  if (sucio !== '') throw new Error(`worktree sucio:\n${sucio}`);
  return 'sin cambios ni archivos sin seguimiento';
}

function checkStore(): string {
  if (!existsSync(HUMAN_STORE)) return 'ausente (0 muestras)';
  const stat = statSync(HUMAN_STORE);
  if (!stat.isFile()) throw new Error('la ruta del store no es un archivo');
  if (stat.size > 0) throw new Error(`${stat.size} bytes; debe estar vacío`);
  return 'vacío (0 muestras)';
}

async function checkHealth(): Promise<void> {
  try {
    const response = await fetch(HEALTH_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3_000),
    });
    const texto = await response.text();
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}${texto === '' ? '' : ` · ${texto.slice(0, 160)}`}`);
    }

    let body: unknown;
    try {
      body = JSON.parse(texto);
    } catch {
      throw new Error(`respuesta no JSON: ${texto.slice(0, 160)}`);
    }
    if (typeof body !== 'object' || body === null || (body as { status?: unknown }).status !== 'ok') {
      throw new Error(`status distinto de "ok": ${texto.slice(0, 160)}`);
    }

    const server = (body as { server?: unknown }).server;
    passa('health', `HTTP 200 · status ok${typeof server === 'string' ? ` · ${server}` : ''}`);
  } catch (error) {
    falla('health', mensaje(error));
  }
}

function checkListener(): void {
  intentar('listener', () => {
    const { count, pids } = listeners();
    if (count === 0) throw new Error(`no hay ningún listener en :${PORT}`);
    if (count > 1) throw new Error(`hay ${count} listeners en :${PORT}; se esperaba uno`);
    return `un solo listener en :${PORT}${pids.length > 0 ? ` · PID observado ${pids.join(', ')}` : ''}`;
  });
}

async function main(): Promise<void> {
  console.log('[cal4h:preflight] validación read-only · sin corridas ni escrituras');
  intentar('worktree pin', checkWorktreePin);
  intentar('worktree limpio', checkWorktreeClean);
  await checkHealth();
  checkListener();
  intentar('store humano', checkStore);

  console.log(
    '\n[cal4h:preflight] métrica no evaluada ni modificada: 15 151 ms · piso I3 1 500 ms · n ≥ 40 · ≤ 2 de 40 · exclusiones ≤ 20 %.'
  );

  if (fallos > 0) {
    console.error(`[cal4h:preflight] FALLA: ${fallos} check(s) en rojo.`);
    process.exit(1);
  }
  console.log('[cal4h:preflight] OK: entorno listo para el operador humano.');
}

await main();
