/**
 * Configuración de Vitest para la suite de UI (React + jsdom) y la de lógica
 * (`tests/unit` + `tests/mcp`, node).
 * Separada de la suite de Node pura: los `tests/*.test.ts` de la raíz usan
 * `node:test` y se ejecutan con `npm run test:node`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// La config global de Commander vive bajo HOME. Los tests de config y MCP
// cambian el cwd a un temporal, pero `src/config/index.ts` sigue leyendo
// `$HOME/.config/commander`: sin aislar HOME, la config real del usuario pisa
// los defaults y los servidores MCP de los tests. El runner de node ya lo hace
// en `scripts/test-node.ts`; aquí se aplica a los workers de Vitest.
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-vitest-home-'));
process.once('exit', () => {
  try { fs.rmSync(isolatedHome, { recursive: true, force: true }); } catch { /* archivos aún abiertos */ }
});

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
  env: {
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
  },
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
