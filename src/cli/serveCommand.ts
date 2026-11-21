import fs from 'node:fs';
import path from 'node:path';

/**
 * `serve --dev` delega en `npm run dev`, cuyo script fija `PORT`. El flag
 * `--port` no llega al hijo, pero `HOST` sí porque se hereda del entorno.
 */
export const DEV_SCRIPT_PORT = 3283;

/**
 * Candidatos a servidor que `serve` importa, en orden de preferencia.
 *
 * En el paquete instalado el bundle vive junto al del CLI
 * (`cli-dist/server.mjs`). En el repo, `bin/commander.ts` corre con `tsx` y el
 * servidor sigue siendo `server.ts` en la raíz, así que se conserva ese camino
 * para que `commander serve` funcione sin empaquetar.
 */
export function serverEntryCandidates(cliDir: string): string[] {
  const root = path.resolve(cliDir, '..');
  return [path.join(cliDir, 'server.mjs'), path.join(root, 'server.ts'), path.join(root, 'server.js')];
}

/** Primer candidato existente, o `null` si no hay ninguno. */
export function resolveServerEntry(
  cliDir: string,
  exists: (file: string) => boolean = fs.existsSync
): string | null {
  return serverEntryCandidates(cliDir).find((candidate) => exists(candidate)) ?? null;
}

/**
 * Aviso cuando se pidió un `--port` explícito que el modo dev va a ignorar.
 * Sin flag explícito no hay nada que avisar: el default del CLI no es una
 * decisión del operador.
 */
export function devPortNotice(requestedPort: unknown, explicit: boolean): string | null {
  if (!explicit) return null;
  const requested = Number(requestedPort);
  if (!Number.isFinite(requested) || requested === DEV_SCRIPT_PORT) return null;
  return `[commander] --port ${requested} no aplica con --dev: "npm run dev" fija PORT=${DEV_SCRIPT_PORT}`;
}

/** ¿El operador pasó `--port`/`-p` explícitamente? */
export function portFlagRequested(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === '--port' || arg === '-p' || arg.startsWith('--port='));
}
