import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_TAIL_CHARS } from '../../src/artifacts/testEvidence';
import {
  buildVerificationArtifactFixture,
  FIXTURE_FAILED_TEST_ID,
  FIXTURE_NOT_RUN_TEST_ID,
  FIXTURE_RECORDING_ID,
  FIXTURE_RECORDING_TITLE,
  FIXTURE_SECRET,
  FIXTURE_SESSION_ID,
  FIXTURE_VERIFICATION_ID,
} from '../helpers/verificationArtifactFixture';

/**
 * F2-07: recorrido local del artifact de verificación.
 *
 * No usa modelo ni red externa: el fixture sale de un guion fijo y las
 * funciones reales de evidencia/diff/informe. IndexedDB se siembra con la
 * forma exacta del store y se recarga la app para comprobar que el artifact y
 * su informe sobreviven.
 */

const DB_NAME = 'commander-artifacts';
const STORE = 'artifacts';
const MAX_ARTIFACT_BYTES = 128 * 1024;
const MAX_RECORDING_FRAMES = 180;

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

async function readArtifacts(page: Page): Promise<Array<Record<string, any>>> {
  return page.evaluate(
    async ({ dbName, storeName }) =>
      new Promise<Array<Record<string, any>>>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onerror = () => reject(request.error ?? new Error('no se abrió IndexedDB'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(storeName, 'readonly');
          const all = tx.objectStore(storeName).getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result as Array<Record<string, any>>);
          };
          all.onerror = () => reject(all.error ?? new Error('no se leyó IndexedDB'));
        };
      }),
    { dbName: DB_NAME, storeName: STORE }
  );
}

test.describe('Artifacts de verificación · E2E local', () => {
  test.skip(
    ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
    'IndexedDB y el Workbench se cubren en Chromium de escritorio; repetirlo en Firefox/móvil no aporta señal.'
  );
  test.setTimeout(120_000);

  test('crea, enlaza, recarga y conserva el artifact y su informe', async ({
    page,
    context,
  }) => {
    const fixture = buildVerificationArtifactFixture();
    const verificationBytes = new TextEncoder().encode(
      JSON.stringify(fixture.verification)
    ).length;
    const recordingBytes = new TextEncoder().encode(
      JSON.stringify(fixture.recording)
    ).length;

    test.info().annotations.push({
      type: 'artifact-size',
      description: `verificación=${verificationBytes} B; grabación=${recordingBytes} B`,
    });

    // Límites documentados: un fixture no puede saltarse el tope de tails ni
    // convertir un test no ejecutado en aprobado.
    expect(fixture.verification.tests[0]?.stdoutTail.length).toBeLessThanOrEqual(
      DEFAULT_TAIL_CHARS
    );
    expect(fixture.verification.tests[0]?.stdoutTail).toContain('caracteres omitidos');
    expect(fixture.verification.tests[1]?.status).toBe('not-run');
    expect(fixture.recording.frames.length).toBeGreaterThan(0);
    expect(fixture.recording.frames.length).toBeLessThanOrEqual(MAX_RECORDING_FRAMES);
    expect(verificationBytes).toBeLessThan(MAX_ARTIFACT_BYTES);
    expect(fixture.verification.sessionId).toBe(FIXTURE_SESSION_ID);
    expect(fixture.recording.sessionId).toBe(FIXTURE_SESSION_ID);
    expect(fixture.verification).not.toHaveProperty('frames');
    expect(JSON.stringify(fixture.verification)).not.toContain(FIXTURE_SECRET);

    // El informe es local: no debe arrastrar secretos, .env, frames ni URLs.
    const report = fixture.verification.report?.content ?? '';
    expect(report).toContain('Referencia local: `recording-e2e-f2-07`');
    expect(report).toContain('NO EJECUTADO');
    expect(report).not.toContain(FIXTURE_SECRET);
    expect(report).not.toContain('.env');
    expect(report).not.toContain('http://');
    expect(report).not.toContain('https://');
    expect(report).not.toContain('sourceMappingURL');

    // La suite no sale de localhost; la app intenta cargar fuentes/Firebase.
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
    await seedArtifacts(page, [fixture.verification, fixture.recording]);
    await openArtifacts(page);

    await expect(
      page.getByTestId(`artifact-card-${FIXTURE_VERIFICATION_ID}`)
    ).toBeVisible();
    await expect(
      page.getByTestId(`artifact-card-${FIXTURE_RECORDING_ID}`)
    ).toBeVisible();
    await expect(page.getByTestId('verification-detail')).toBeVisible();
    await expect(page.getByText('Reproducir el fallo', { exact: true })).toBeVisible();
    await expect(page.getByTestId('verification-diff')).toContainText(
      '+export const total = 3;'
    );
    await expect(
      page.getByTestId(`verification-test-${FIXTURE_FAILED_TEST_ID}`)
    ).toContainText('FALLÓ');
    await expect(
      page.getByTestId(`verification-test-${FIXTURE_FAILED_TEST_ID}`)
    ).toContainText('exitCode: 1');
    await expect(
      page.getByTestId(`verification-test-${FIXTURE_NOT_RUN_TEST_ID}`)
    ).toContainText('NO EJECUTADO');
    await expect(
      page.getByTestId(`verification-test-${FIXTURE_NOT_RUN_TEST_ID}`)
    ).not.toContainText('PASÓ');

    await expect(page.getByTestId('verification-recording')).toContainText(
      FIXTURE_RECORDING_TITLE
    );
    await expect(page.getByTestId('verification-recording-id')).toHaveText(
      FIXTURE_RECORDING_ID
    );

    const reportPanel = page.getByTestId('verification-report');
    await expect(reportPanel).toContainText('FALLÓ');
    await expect(reportPanel).toContainText('NO EJECUTADO');
    await expect(reportPanel).toContainText(
      'Referencia local: `recording-e2e-f2-07`'
    );
    await expect(reportPanel).not.toContainText(FIXTURE_SECRET);
    await expect(reportPanel).not.toContainText('.env');
    await expect(reportPanel).not.toContainText('http://');
    await expect(reportPanel).not.toContainText('sourceMappingURL');

    // El enlace del visor abre la grabación existente, no una copia.
    await page.getByTestId('verification-open-recording').click();
    await expect(page.getByTestId('artifact-play')).toBeVisible();
    await expect(page.getByText(/FRAME 1\/1/)).toBeVisible();

    // Recarga real: el store y el informe tienen que venir de IndexedDB.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await openArtifacts(page);

    await expect(page.getByTestId('verification-detail')).toBeVisible();
    await expect(page.getByTestId('verification-report')).toContainText(
      'Referencia local: `recording-e2e-f2-07`'
    );

    const stored = await readArtifacts(page);
    expect(stored).toHaveLength(2);
    const storedVerification = stored.find(
      (artifact) => artifact.id === FIXTURE_VERIFICATION_ID
    );
    const storedRecording = stored.find(
      (artifact) => artifact.id === FIXTURE_RECORDING_ID
    );

    expect(storedVerification?.sessionId).toBe(FIXTURE_SESSION_ID);
    expect(storedRecording?.sessionId).toBe(FIXTURE_SESSION_ID);
    expect(storedVerification?.browserRecordingId).toBe(FIXTURE_RECORDING_ID);
    expect(storedVerification?.report?.content).toContain('Referencia local');
    expect(storedRecording?.frames).toHaveLength(1);
    expect(storedVerification).not.toHaveProperty('frames');
    expect(JSON.stringify(stored)).not.toContain(FIXTURE_SECRET);
    expect(JSON.stringify(stored)).not.toContain('.env');
    expect(JSON.stringify(stored)).not.toContain('sourceMappingURL');
    expect(JSON.stringify(stored)).not.toContain('http://');
    expect(JSON.stringify(stored)).not.toContain('https://');
  });
});
