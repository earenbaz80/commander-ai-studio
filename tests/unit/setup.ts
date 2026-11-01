/**
 * Setup de la suite `node`: `tests/unit` y `tests/mcp`.
 *
 * Deliberadamente no carga `tests/ui/setup.ts`: aquellos polyfills son de jsdom
 * (ResizeObserver, matchMedia, speechSynthesis, scrollIntoView) más
 * `@testing-library/jest-dom`, y ninguno de estos tests toca el DOM.
 *
 * Lo que sí conviene blindar aquí es el estado que comparten por correr en un
 * proceso de verdad y no en un entorno aislado por fichero:
 *
 * - `tests/mcp/client.test.ts` y `tests/mcp/oauth.test.ts` hacen
 *   `process.chdir` a un directorio temporal. Si un `after` no llega a correr
 *   porque el test falla, el siguiente fichero del mismo worker arrancaría en
 *   ese temporal y cualquier ruta relativa apuntaría a otro sitio.
 * - Un test que active fake timers y falle antes de restaurarlos los dejaría
 *   activos para el fichero siguiente.
 *
 * Los dos arreglos son idempotentes y no cuestan nada cuando no hay nada que
 * reparar.
 */
import { afterAll, afterEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz del repo: `vitest` se ejecuta desde ahí, así que es el cwd correcto. */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

afterEach(() => {
  if (vi.isFakeTimers()) vi.useRealTimers();
});

afterAll(() => {
  if (process.cwd() !== RAIZ) process.chdir(RAIZ);
});
