import fs from 'node:fs';
import path from 'node:path';
import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';
import { startServer, type ServerHarness } from '../helpers/serverHarness';

/**
 * E2E del productor real de artifacts (F2-07).
 *
 * A diferencia del fixture de `verificationArtifact.spec.ts`, aquí no se
 * siembra IndexedDB: el recorrido arranca una corrida del agente, ejecuta
 * `shell.run` en el servidor real, deja que `useAgent` construya el artifact
 * con la evidencia real y comprueba que sobrevive a una recarga. El segundo
 * caso ejecuta un comando que falla y verifica el estado `failed` y el informe.
 *
 * `vite preview` sirve sólo el bundle estático, así que el LLM se mockea para
 * que pida `shell.run`. El endpoint de tools NO se mockea: las peticiones a
 * `/api/agent/run-tool` se reenvían al `server.ts` real levantado por el
 * arnés, que ejecuta el comando y devuelve `testEvidence`/`environment`.
 */

const APP_ORIGIN = 'http://localhost:4173';
const DB_NAME = 'commander-artifacts';
const STORE = 'artifacts';

/**
 * Test real, barato y allowlisted. `shell.run` reconoce los comandos de test y
 * genera la evidencia; `tests/unit/testEvidence.test.ts` tarda muy poco.
 */
const TEST_COMMAND =
  'npm test -- --project node tests/unit/testEvidence.test.ts';

/**
 * Fuerza un fallo real de Vitest con un timeout de 1 ms: el primer test no
 * llega a completarse y el proceso sale con `exitCode: 1`. El comando sigue
 * siendo `npm test`, allowlisted, y no toca la suite del proyecto.
 */
const FAILING_TEST_COMMAND =
  'npm test -- --project node tests/unit/testEvidence.test.ts --testTimeout=1';

const PROJECT_ROOT = process.cwd();
const PERMISSIONS_FILE = path.join(
  PROJECT_ROOT,
  '.commander',
  'permissions.json'
);

let realServer: ServerHarness | null = null;
let permissionsBefore: Record<string, unknown> | null = null;
const permissionsFileBefore = fs.existsSync(PERMISSIONS_FILE)
  ? fs.readFileSync(PERMISSIONS_FILE, 'utf8')
  : null;

async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="app-root"], .nc-header', {
    timeout: 45_000,
  });
  const guest = page.locator('button:has-text("ENTRAR COMO INVITADO")');
  if (await guest.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await guest.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Crea el store antes de que la app lo abra. Si el lector lo creara sin
 * `onupgradeneeded`, el `saveArtifact` posterior fallaría por falta de store.
 */
async function ensureArtifactStore(page: Page): Promise<void> {
  await page.evaluate(
    async ({ dbName, storeName }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'id' });
            store.createIndex('projectPath', 'projectPath', { unique: false });
          }
        };
        request.onerror = () =>
          reject(request.error ?? new Error('no se abrió IndexedDB'));
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      }),
    { dbName: DB_NAME, storeName: STORE }
  );
}

async function readArtifacts(
  page: Page
): Promise<Array<Record<string, any>>> {
  return page.evaluate(
    async ({ dbName, storeName }) =>
      new Promise<Array<Record<string, any>>>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onerror = () =>
          reject(request.error ?? new Error('no se abrió IndexedDB'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(storeName, 'readonly');
          const all = tx.objectStore(storeName).getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result as Array<Record<string, any>>);
          };
          all.onerror = () =>
            reject(all.error ?? new Error('no se leyó IndexedDB'));
        };
      }),
    { dbName: DB_NAME, storeName: STORE }
  );
}

async function openArtifacts(page: Page): Promise<void> {
  const workbench = page.locator('aside[aria-label="Workbench"]');
  if (!(await workbench.isVisible().catch(() => false))) {
    const workbenchButton = page.locator(
      'button[data-tooltip="Workbench (Panel Derecho)"]'
    );
    await workbenchButton.waitFor({ state: 'visible', timeout: 15_000 });
    await workbenchButton.click();
  }
  await expect(workbench).toBeVisible({ timeout: 15_000 });
  await workbench
    .getByRole('button', { name: 'Artifacts', exact: true })
    .click();
  await expect(page.getByTestId('artifacts-view')).toBeVisible({
    timeout: 15_000,
  });
}

function fulfillJson(route: Route, data: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

interface RunProbe {
  llmCalls: number;
  shellRunCalls: number;
}

/**
 * El preview no tiene backend: se responde al LLM y se corta cualquier salida
 * a red, pero `/api/agent/run-tool` viaja al `server.ts` real. El comando que
 * pide el LLM se parametriza para cubrir el caso verde y el rojo.
 */
async function proxyAgentRun(
  context: BrowserContext,
  server: ServerHarness,
  command: string
): Promise<RunProbe> {
  const probe: RunProbe = { llmCalls: 0, shellRunCalls: 0 };

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const isApp =
      url.origin === APP_ORIGIN || url.origin === 'http://127.0.0.1:4173';

    if (!isApp) {
      await route.abort();
      return;
    }

    if (url.pathname === '/api/gemini/generate') {
      probe.llmCalls += 1;
      if (probe.llmCalls === 1) {
        await fulfillJson(route, {
          text: 'Ejecuto la verificación con shell.run.',
          functionCalls: [{ name: 'shell_run', args: { command } }],
        });
        return;
      }
      await fulfillJson(route, {
        text: 'La verificación terminó.',
      });
      return;
    }

    if (url.pathname === '/api/agent/run-tool') {
      let body: any = {};
      try {
        body = JSON.parse(route.request().postData() ?? '{}');
      } catch {
        body = {};
      }
      if (body.toolId === 'shell.run') probe.shellRunCalls += 1;

      // `server.request` es el cliente HTTP del arnés: ejecuta la tool en el
      // `server.ts` real y devuelve su respuesta JSON a la página.
      try {
        const result = await server.request(
          'POST',
          url.pathname + url.search,
          body
        );
        console.log(
          `[e2e-server] ${String(body.toolId)} -> ${result.status} ${result.raw.slice(0, 180)}`
        );
        await route.fulfill({
          status: result.status,
          contentType: 'application/json',
          body: result.raw,
        });
      } catch (error) {
        console.error(
          `[e2e-server] ${String(body.toolId)} falló:`,
          error,
          server.logs()
        );
        throw error;
      }
      return;
    }

    if (url.pathname === '/api/agent/prompts') {
      await fulfillJson(route, { success: true, commands: [], agents: [] });
      return;
    }
    if (url.pathname === '/api/plugins') {
      await fulfillJson(route, { success: true, plugins: [] });
      return;
    }
    if (url.pathname === '/api/skills') {
      await fulfillJson(route, { success: true, skills: [] });
      return;
    }
    if (url.pathname === '/api/threads' || url.pathname.startsWith('/api/threads/')) {
      await fulfillJson(route, {
        success: true,
        thread: { id: 'e2e-thread' },
      });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await fulfillJson(route, { success: true });
      return;
    }

    await route.continue();
  });

  return probe;
}

/** Abre la app, entra en modo agente y lanza la tarea. */
async function openAgentMode(page: Page, goalText: string): Promise<void> {
  // Nono revisa diagnósticos al arrancar (`read_diagnostics` lanza `tsc`).
  // Ese trabajo ajeno a la verificación puede durar más que el timeout del
  // cliente del arnés y cortar el socket; se desactiva sólo en este E2E.
  await page.addInitScript(() => {
    localStorage.setItem(
      'nono-memory-v1',
      JSON.stringify({ ui: { showNono: false } })
    );
    localStorage.setItem('commander_show_nono', 'false');
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await ensureArtifactStore(page);

  // Paleta → modo agente, igual que el recorrido de usuario.
  await page.keyboard.press('Control+K');
  const palette = page.locator('[data-command-palette]');
  await expect(palette).toBeVisible();
  await palette.locator('input').fill('agente');
  await palette.locator('button[role="option"]').first().click();
  await expect(page.getByText('MODO AGENTE')).toBeVisible();

  const goal = page.locator('textarea[placeholder*="tarea"]');
  await goal.fill(goalText);
  await page.getByRole('button', { name: 'INICIAR TAREA' }).click();
}

/** Espera a que la corrida cierre y devuelve el único artifact de verificación. */
async function waitForVerificationArtifact(
  page: Page
): Promise<Record<string, any>> {
  // La corrida termina cuando el segundo turno del LLM no pide más tools.
  await expect
    .poll(async () => (await readArtifacts(page)).length, {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);

  const stored = (await readArtifacts(page)).filter(
    (artifact) => artifact.kind === 'verification'
  );
  expect(stored).toHaveLength(1);
  return stored[0];
}

test.describe('Artifacts de verificación · productor real', () => {
  // Ambos casos comparten el archivo de permisos y el server real: en paralelo
  // uno podría restaurar `readonly` mientras el otro todavía ejecuta shell.run.
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const server = await startServer();
    realServer = server;

    // El repo puede estar configurado en `readonly` para el agente. `shell.run`
    // sería rechazado antes de ejecutar; se activa `build` solo durante esta
    // suite y `afterAll` devuelve el archivo a su contenido original.
    const permissions = await server.request(
      'GET',
      `/api/permissions?root=${encodeURIComponent(PROJECT_ROOT)}`
    );
    if (!permissions.body?.success) {
      throw new Error(
        `No se pudieron leer los permisos: ${permissions.raw.slice(0, 300)}`
      );
    }
    permissionsBefore = permissions.body.permissions as Record<string, unknown>;
    const enabled = await server.request('PUT', '/api/permissions', {
      root: PROJECT_ROOT,
      permissions: { mode: 'build' },
    });
    if (!enabled.body?.success) {
      throw new Error(
        `No se pudo activar el modo build: ${enabled.raw.slice(0, 300)}`
      );
    }
  });

  test.afterAll(async () => {
    const server = realServer;
    try {
      // Restaura también la caché del server si es uno compartido.
      if (server && permissionsBefore) {
        await server.request('PUT', '/api/permissions', {
          root: PROJECT_ROOT,
          permissions: permissionsBefore,
        });
      }
    } catch {
      // La limpieza del archivo de abajo sigue siendo la fuente de verdad.
    } finally {
      await server?.stop();
      realServer = null;
      permissionsBefore = null;
    }

    // `permissions.ts` escribe el archivo al cambiar el modo. Se devuelve al
    // contenido exacto (o se elimina si no existía) para no ensuciar el repo.
    if (permissionsFileBefore === null) {
      fs.rmSync(PERMISSIONS_FILE, { force: true });
    } else {
      fs.writeFileSync(PERMISSIONS_FILE, permissionsFileBefore, 'utf8');
    }
  });

  test.skip(
    ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
    'IndexedDB y el Workbench se cubren en Chromium de escritorio; repetirlo en Firefox/móvil no aporta señal.'
  );
  test.setTimeout(180_000);

  test('crea el artifact desde shell.run, lo abre y lo conserva al recargar', async ({
    page,
    context,
  }) => {
    const server = realServer;
    if (!server) throw new Error('el server real no arrancó');

    const probe = await proxyAgentRun(context, server, TEST_COMMAND);
    await openAgentMode(page, 'Verificar que shell.run genera el artifact E2E');
    const artifact = await waitForVerificationArtifact(page);

    expect(probe.llmCalls).toBeGreaterThanOrEqual(2);
    expect(probe.shellRunCalls).toBe(1);
    expect(artifact.status).toBe('passed');
    expect(artifact.sessionId).toBeTruthy();
    expect(artifact.tests).toHaveLength(1);
    expect(artifact.tests[0].command).toBe(TEST_COMMAND);
    expect(artifact.tests[0].status).toBe('passed');
    expect(artifact.tests[0].exitCode).toBe(0);
    expect(artifact.report?.content).toContain(TEST_COMMAND);
    expect(artifact.report?.content).toContain('APROBADO');

    const artifactId = String(artifact.id);
    const testId = String(artifact.tests[0].id);
    await openArtifacts(page);

    const card = page.getByTestId(`artifact-card-${artifactId}`);
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByTestId('verification-detail')).toBeVisible();
    await expect(page.getByTestId(`verification-test-${testId}`)).toContainText(
      'PASÓ'
    );
    await expect(page.getByTestId(`verification-test-${testId}`)).toContainText(
      'exitCode: 0'
    );
    await expect(page.getByTestId('verification-report')).toContainText(
      TEST_COMMAND
    );
    await expect(page.getByTestId('verification-report')).toContainText(
      'APROBADO'
    );

    // Recarga real: la vista debe volver desde IndexedDB, no desde memoria.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await openArtifacts(page);

    await expect(page.getByTestId(`artifact-card-${artifactId}`)).toBeVisible();
    await expect(page.getByTestId('verification-detail')).toBeVisible();
    await expect(page.getByTestId('verification-report')).toContainText(
      TEST_COMMAND
    );
    await expect(page.getByTestId('verification-report')).toContainText(
      'APROBADO'
    );

    const afterReload = await readArtifacts(page);
    expect(afterReload.filter((item) => item.id === artifactId)).toHaveLength(1);
  });

  test('registra un exitCode 1 como failed y lo refleja en el informe', async ({
    page,
    context,
  }) => {
    const server = realServer;
    if (!server) throw new Error('el server real no arrancó');

    const probe = await proxyAgentRun(context, server, FAILING_TEST_COMMAND);
    await openAgentMode(
      page,
      'Verificar que un test fallido genera un artifact failed'
    );
    const artifact = await waitForVerificationArtifact(page);

    expect(probe.llmCalls).toBeGreaterThanOrEqual(2);
    expect(probe.shellRunCalls).toBe(1);
    expect(artifact.status).toBe('failed');
    expect(artifact.sessionId).toBeTruthy();
    expect(artifact.tests).toHaveLength(1);
    expect(artifact.tests[0].command).toBe(FAILING_TEST_COMMAND);
    expect(artifact.tests[0].status).toBe('failed');
    expect(artifact.tests[0].exitCode).toBe(1);
    expect(artifact.report?.content).toContain(FAILING_TEST_COMMAND);
    expect(artifact.report?.content).toContain('**Estado:** **FALLÓ**');
    expect(artifact.report?.content).toContain('**exitCode:** `1`');
    expect(artifact.report?.content).not.toContain('APROBADO');

    const artifactId = String(artifact.id);
    const testId = String(artifact.tests[0].id);
    await openArtifacts(page);

    const card = page.getByTestId(`artifact-card-${artifactId}`);
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByTestId('verification-detail')).toBeVisible();

    const testRow = page.getByTestId(`verification-test-${testId}`);
    await expect(testRow).toContainText('FALLÓ');
    await expect(testRow).toContainText('exitCode: 1');
    await expect(page.getByTestId('verification-report')).toContainText(
      FAILING_TEST_COMMAND
    );
    await expect(page.getByTestId('verification-report')).toContainText('FALLÓ');
  });
});
