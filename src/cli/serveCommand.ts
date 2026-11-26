import fs from 'node:fs';
import path from 'node:path';
import { isStudioCheckout } from './buildCommand.js';

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
  return [path.join(cliDir, 'server.mjs'), path.join(root, 'server.ts')];
}

/** Primer candidato existente, o `null` si no hay ninguno. */
export function resolveServerEntry(
  cliDir: string,
  exists: (file: string) => boolean = fs.existsSync
): string | null {
  return serverEntryCandidates(cliDir).find((candidate) => exists(candidate)) ?? null;
}

/**
 * Directorio de la UI que sirve `serve`.
 *
 * La raíz manda: en un checkout, `npm run build` actualiza `dist/` y no debe
 * quedar tapado por una copia vieja junto al CLI (`cli-dist/dist`). En el
 * paquete instalado no hay `dist/` en la raíz, así que se usa la copia que
 * viaja con los bundles. Si no hay `index.html` en ninguno, se devuelve `null`
 * y el servidor conserva su propio fallback.
 */
export function resolveDistDir(options: {
  cliDir: string;
  exists?: (file: string) => boolean;
}): string | null {
  const exists = options.exists ?? fs.existsSync;
  const root = path.resolve(options.cliDir, '..');
  const candidates = [path.join(root, 'dist'), path.join(options.cliDir, 'dist')];
  return candidates.find((dir) => exists(path.join(dir, 'index.html'))) ?? null;
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

export type DevServePlan =
  | { ok: true; cwd: string; script: 'dev'; port: number }
  | { ok: false; reason: string };

/** Motivo único de la guarda, para que el CLI y el guardián digan lo mismo. */
export const DEV_REQUIRES_CHECKOUT =
  '`commander serve --dev` arranca el Studio desde un checkout del repo; este paquete instalado no trae fuentes ni vite. Para servir la UI empaquetada usá `commander serve`.';

/**
 * `--dev` levanta Vite y el servidor desde las fuentes. Sólo se permite en un
 * checkout del Studio, con el mismo criterio que `build`: antes se lanzaba
 * `npm run dev` en el cwd y arrancaba el proyecto del usuario.
 */
export function planDevServe(options: {
  packageRoot: string;
  exists?: (file: string) => boolean;
  readJson?: (file: string) => unknown;
}): DevServePlan {
  if (!isStudioCheckout(options)) return { ok: false, reason: DEV_REQUIRES_CHECKOUT };
  return { ok: true, cwd: options.packageRoot, script: 'dev', port: DEV_SCRIPT_PORT };
}
