/**
 * Configuración de Vitest para la suite de UI (React + jsdom) y la de lógica
 * (`tests/unit` + `tests/mcp`, node).
 * Separada de la suite de Node pura: los `tests/*.test.ts` de la raíz usan
 * `node:test` y se ejecutan con `npm run test:node`.
 */
import { defineConfig } from 'vitest/config';

// Nota: react() requiere Vite plugin compatible. Usamos un alias directo a las funciones nativas
// para evitar conflictos entre rolldown (Vite 8) y rollup (Vitest).

/**
 * Opciones comunes a los dos proyectos.
 *
 * `vmForks` instancia el entorno una vez por worker en vez de una por fichero y
 * sigue aislándolos: cada fichero corre en su propio contexto de VM, así que
 * `localStorage`, los mocks y el registro de módulos no se comparten. Se usa
 * `vmForks` y no `vmThreads` porque los tests de MCP hacen `process.chdir`, que
 * no existe dentro de un worker thread.
 */
const comun = {
  globals: false,
  restoreMocks: true,
  pool: 'vmForks' as const,
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...comun,
          name: 'ui',
          environment: 'jsdom',
          setupFiles: ['./tests/ui/setup.ts'],
          include: ['tests/ui/**/*.test.{ts,tsx}'],
          css: false,
        },
      },
      {
        // `tests/unit`, `tests/mcp` y `tests/agent` son lógica pura: no tocan el
        // DOM, así que no necesitan jsdom ni sus polyfills (ver `tests/unit/setup.ts`).
        test: {
          ...comun,
          name: 'node',
          environment: 'node',
          setupFiles: ['./tests/unit/setup.ts'],
          include: [
            'tests/unit/**/*.test.ts',
            'tests/mcp/**/*.test.ts',
            'tests/agent/**/*.test.ts',
          ],
        },
      },
    ],
  },
});
