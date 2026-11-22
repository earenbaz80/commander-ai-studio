/**
 * Helpers testeables del preflight CAL4H.
 *
 * El script `check-cal4h-preflight.ts` aporta los comandos y el estado del
 * entorno; acá quedan las dos decisiones que se cubren con tests: qué líneas
 * cuentan como listener del puerto exacto y cuándo un worktree está realmente
 * detached en el commit pineado.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface ListenerInfo {
  count: number;
  pids: string[];
}

/**
 * Cuenta sockets TCP en LISTEN sobre `port` a partir de la salida de `netstat`,
 * `lsof` o `ss`. El lookahead evita que `:32830` cuente como `:3283`.
 */
export function contarListeners(salida: string, port: number): ListenerInfo {
  const puertoExacto = new RegExp(`:${port}(?![0-9])`);
  const lineas = salida
    .split(/\r?\n/)
    .filter((linea) => puertoExacto.test(linea) && /\bLISTEN(?:ING)?\b/i.test(linea));

  const pids = new Set<string>();
  for (const linea of lineas) {
    const deSs = linea.match(/pid=(\d+)/)?.[1];
    const deLsof = linea.match(/^\S+\s+(\d+)\s/)?.[1];
    const deNetstat = linea.match(/\s(\d+)\s*$/)?.[1];
    const pid = deSs ?? deLsof ?? deNetstat;
    if (pid) pids.add(pid);
  }

  return { count: lineas.length, pids: [...pids] };
}

/** Ejecuta git en un worktree concreto, sin depender del cwd del proceso. */
export function gitAt(worktree: string, args: string[]): string {
  return execFileSync('git', ['-C', worktree, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Exige que `worktree` esté en `pin` y detached. `rev-parse --abbrev-ref`
 * devuelve `HEAD` sólo cuando no hay rama activa; una rama que apunte al mismo
 * commit también falla, porque el recibo declara el worktree detached.
 */
export function verificarWorktree(worktree: string, pin: string, root = worktree): string {
  if (!existsSync(worktree)) throw new Error(`no existe ${path.relative(root, worktree)}`);
  const head = gitAt(worktree, ['rev-parse', 'HEAD']);
  if (head !== pin) throw new Error(`HEAD es ${head.slice(0, 12)}, se esperaba ${pin.slice(0, 12)}`);

  const ref = gitAt(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (ref !== 'HEAD') throw new Error(`HEAD está en la rama ${ref}, no detached`);
  return `${pin.slice(0, 7)} (detached)`;
}
