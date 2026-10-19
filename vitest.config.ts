/**
 * Configuración de Vitest para la suite de UI (React + jsdom).
 * Separada de la suite de Node (`npm run test:unit`).
 */
import { defineConfig } from 'vitest/config';

// Nota: react() requiere Vite plugin compatible. Usamos un alias directo a las funciones nativas
// para evitar conflictos entre rolldown (Vite 8) y rollup (Vitest).

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/ui/setup.ts'],
    // Tests de UI, config y MCP. Los tests puros de Node viven en tests/*.test.ts
    include: ['tests/ui/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.ts', 'tests/mcp/**/*.test.ts'],
    css: false,
    restoreMocks: true,
  },
});