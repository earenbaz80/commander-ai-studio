/**
 * Modelo por defecto de la línea base.
 *
 * Los modelos locales de 27B son demasiado lentos para el presupuesto live de
 * 300 s por tarea. El valor vive fuera de `baseline.ts` para poder probarlo sin
 * arrancar el servidor ni ejecutar una corrida.
 */
export const DEFAULT_BASELINE_MODEL = 'lmstudio/qwen/qwen3.5-9b';

/** `BASELINE_MODEL` manda; vacío o ausente usa el default. */
export function resolveBaselineModel(env: NodeJS.ProcessEnv = process.env): string {
  const requested = env.BASELINE_MODEL?.trim();
  return requested || DEFAULT_BASELINE_MODEL;
}
