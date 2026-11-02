import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Serial a propósito, y medido: con 76 ejecuciones en serie el job tarda
  // 8,7 min; con 2 workers pasó de 15 min sin terminar, porque los 4 vCPU del
  // runner sostienen además el preview server y cada test arranca la app en
  // 11-18 s. Para paralelizar hay que bajar antes ese arranque.
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:4173',
    // Un recurso atascado no puede comerse el presupuesto del test: con límites
    // explícitos el atasco falla nombrando el paso (goto, clic) en vez de
    // aparecer como `Tearing down "context" exceeded the test timeout`, que es
    // lo que disfrazaba de flaky una prueba que había pasado.
    navigationTimeout: 20000,
    actionTimeout: 15000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});