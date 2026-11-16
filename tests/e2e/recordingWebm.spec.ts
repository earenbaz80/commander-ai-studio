import { promises as fs } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { buildVerificationArtifactFixture } from '../helpers/verificationArtifactFixture';

/**
 * F2-09: la grabación se exporta a un WebM real con MediaRecorder.
 *
 * Se usa un fixture corto (tres frames en 600 ms) para no gastar el tiempo del
 * job; la duración de 30 s se cubre en `tests/unit/webm.test.ts` verificando la
 * línea de tiempo, y a 1× la exportación reproduce esa misma línea de tiempo.
 */

const DB_NAME = 'commander-artifacts';
const STORE = 'artifacts';

async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="app-root"], .nc-header', { timeout: 45_000 });
  const guest = page.locator('button:has-text("ENTRAR COMO INVITADO")');
  if (await guest.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await guest.click();
    await page.waitForTimeout(500);
  }
}

async function openArtifacts(page: Page): Promise<void> {
  const workbench = page.locator('aside[aria-label="Workbench"]');
  if (!(await workbench.isVisible().catch(() => false))) {
    const workbenchButton = page.locator('button[data-tooltip="Workbench (Panel Derecho)"]');
    await workbenchButton.waitFor({ state: 'visible', timeout: 15_000 });
    await workbenchButton.click();
  }
  await expect(workbench).toBeVisible({ timeout: 15_000 });
  await workbench.getByRole('button', { name: 'Artifacts', exact: true }).click();
  await expect(page.getByTestId('artifacts-view')).toBeVisible({ timeout: 15_000 });
}

async function seedArtifacts(page: Page, artifacts: unknown[]): Promise<void> {
  await page.evaluate(
    async ({ dbName, storeName, items }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'id' });
            store.createIndex('projectPath', 'projectPath', { unique: false });
          } else {
            const store = request.transaction?.objectStore(storeName);
            if (store && !store.indexNames.contains('projectPath')) {
              store.createIndex('projectPath', 'projectPath', { unique: false });
            }
          }
        };
        request.onerror = () => reject(request.error ?? new Error('no se abrió IndexedDB'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          for (const item of items) store.put(item);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error ?? new Error('falló la siembra de IndexedDB'));
          tx.onabort = () => reject(tx.error ?? new Error('se abortó la siembra de IndexedDB'));
        };
      });
    },
    { dbName: DB_NAME, storeName: STORE, items: artifacts }
  );
}

test.describe('Grabación · export WebM', () => {
  test.skip(
    ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
    'MediaRecorder y canvas.captureStream se verifican en Chromium de escritorio.'
  );
  test.setTimeout(120_000);

  test('exporta un WebM real desde los frames guardados', async ({ page, context }) => {
    const fixture = buildVerificationArtifactFixture();
    const base = fixture.recording.frames[0];
    const recording = {
      ...fixture.recording,
      id: 'recording-webm-e2e',
      title: 'Export E2E',
      durationMs: 600,
      frames: [0, 300, 600].map((atMs, index) => ({
        ...base,
        seq: index + 1,
        ts: base.ts + atMs,
        atMs,
      })),
    };

    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (
        url.startsWith('http://localhost:4173') ||
        url.startsWith('data:') ||
        url.startsWith('blob:')
      ) {
        return route.continue();
      }
      return route.abort();
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await seedArtifacts(page, [recording]);
    await openArtifacts(page);
    await page.getByTestId(`artifact-card-${recording.id}`).click();
    await expect(page.getByTestId('artifact-export-webm')).toBeEnabled();

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('artifact-export-webm').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('grabacion-export-e2e.webm');
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const bytes = await fs.readFile(filePath as string);
    expect(bytes.byteLength).toBeGreaterThan(200);

    await expect(page.getByTestId('artifact-export-status')).toContainText('WebM listo');
  });

  test('una grabación de 30 s se reproduce offline con consola y red', async ({ page, context }) => {
    const fixture = buildVerificationArtifactFixture();
    const base = fixture.recording.frames[0];
    const recording = {
      ...fixture.recording,
      id: 'recording-30s-e2e',
      title: 'Sesión de 30 s',
      durationMs: 30_000,
      frames: [0, 10_000, 20_000, 30_000].map((atMs, index) => ({
        ...base,
        seq: index + 1,
        ts: base.ts + atMs,
        atMs,
      })),
      logs: {
        console: [
          {
            atMs: 15_000,
            ts: base.ts + 15_000,
            type: 'error',
            text: 'fetch falló en el checkout',
            url: '/checkout',
          },
        ],
        network: [
          {
            atMs: 15_200,
            ts: base.ts + 15_200,
            kind: 'http' as const,
            method: 'POST',
            url: '/api/pay',
            status: 502,
            durationMs: 210,
          },
        ],
      },
    };

    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (
        url.startsWith('http://localhost:4173') ||
        url.startsWith('data:') ||
        url.startsWith('blob:')
      ) {
        return route.continue();
      }
      return route.abort();
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await seedArtifacts(page, [recording]);
    await openArtifacts(page);
    await page.getByTestId(`artifact-card-${recording.id}`).click();

    // Offline: la vista no sale de localhost y la consola/red vienen del artifact.
    await expect(page.getByTestId('artifact-console')).toContainText('fetch falló en el checkout');
    await expect(page.getByTestId('artifact-console')).toContainText('0:15');
    await expect(page.getByTestId('artifact-network')).toContainText('/api/pay');
    await expect(page.getByTestId('artifact-network')).toContainText('502');
    await expect(page.getByText('/ 0:30')).toBeVisible();

    // Reproducción real de los 30 s: la línea de tiempo avanza sola.
    const timeline = page.getByLabel('Línea de tiempo de la grabación');
    await page.getByTestId('artifact-play').click();
    await expect(page.getByText('PLAY', { exact: true })).toBeVisible();
    await expect
      .poll(async () => Number(await timeline.inputValue()), { timeout: 10_000 })
      .toBeGreaterThan(0);
  });
});
