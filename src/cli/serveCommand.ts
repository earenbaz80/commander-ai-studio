/**
 * `serve --dev` delega en `npm run dev`, cuyo script fija `PORT`. El flag
 * `--port` no llega al hijo, pero `HOST` sí porque se hereda del entorno.
 */
export const DEV_SCRIPT_PORT = 3283;

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
