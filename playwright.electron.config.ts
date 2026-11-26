/**
 * Configuración del e2e de escritorio (Electron empaquetado).
 *
 * Separada de `playwright.config.ts` a propósito: allí hay `webServer` (vite
 * preview) y tres proyectos de navegador, y esta prueba no necesita ninguno de
 * los dos. Lanza el ejecutable de `release/win-unpacked` con su server embebido,
 * en serie y sin reintentos: un arranque de escritorio no debe repetirse a
 * ciegas, porque el puerto del server es fijo (`3001`).
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/electron',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: [['list']],
  outputDir: 'test-results/electron',
  use: {
    trace: 'retain-on-failure',
    video: 'off',
  },
});
