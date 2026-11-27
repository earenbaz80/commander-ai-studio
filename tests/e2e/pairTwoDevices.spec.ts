/**
 * C8 del recibo G2 (`docs/parity/receipts/G2-REVIEW-2026-11-25.md` §7): la
 * evidencia que falta para F3-1 (escritorio → móvil) y F3-7 (vista a 390×844).
 *
 * Qué fija, en una sola corrida:
 * - **Dos dispositivos reales sobre la misma sesión.** Un contexto de escritorio
 *   a 1280×800 y otro de móvil a 390×844 abren `/pair/session?sessionId=…`
 *   contra el `server.ts` del arnés; los dos muestran el mismo `sessionId`.
 * - **`steps` comparados.** Cada página pide el estado con su propio `fetch`
 *   (mismo origen, sin proxy) y los `steps` que ve cada dispositivo se comparan
 *   con los del servidor y entre sí: misma longitud, mismo contenido y mismo
 *   orden. Un móvil que viera una sesión recortada fallaría acá.
 * - **Captura del ancho.** La pantalla del móvil se captura a 390×844 y se
 *   comprueba leyendo la cabecera IHDR del PNG, no el viewport declarado.
 *   Además se exige que la página no desborde a ese ancho (`scrollWidth`), que
 *   es lo que el criterio mide.
 *
 * La sesión no se siembra: se crea con `createApprovalSession` y el proveedor
 * guionado, y el turno corre de verdad en el servidor (una lectura allowlisted,
 * sin aprobaciones). El escritorio no interviene con su UI: lo que se prueba es
 * que el móvil ve la misma sesión y los mismos pasos, que es el objeto de C8.
 *
 * No cubre el túnel ni `--remote`: el pair sólo funciona en loopback, y C8 no
 * pide LAN (eso es C2/G3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { startServer, type ServerHarness } from '../helpers/serverHarness';
import {
  cleanupDir,
  createApprovalSession,
  getState,
  startScriptedProvider,
  waitForState,
  type FakeProvider,
} from '../agent/approvalHarness';

/** Los dos tamaños de C8, explícitos y no tomados de un proyecto de Playwright. */
const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

interface SessionView {
  id?: string;
  status?: string;
  steps?: unknown[];
  turns?: Array<{ role: string; text: string }>;
  plan?: unknown[];
}

/** Abre `/pair/session` en un contexto nuevo y espera a que la pantalla monte. */
async function openPairSession(
  browser: import('@playwright/test').Browser,
  viewport: { width: number; height: number },
  baseUrl: string,
  sessionId: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { ...viewport },
    // La captura tiene que medir el ancho CSS, no el doble por retina.
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(
    `${baseUrl}/pair/session?sessionId=${encodeURIComponent(sessionId)}`,
    { waitUntil: 'domcontentloaded' }
  );
  await expect(page.getByTestId('pair-session-screen')).toBeVisible({
    timeout: 30_000,
  });
  return { context, page };
}

/** Estado de la sesión tal como lo ve esa página, con su propio `fetch`. */
async function readSessionFromPage(
  page: Page,
  sessionId: string
): Promise<SessionView> {
  const body = await page.evaluate(async (id) => {
    const response = await fetch(`/api/agent/sessions/${encodeURIComponent(id)}`);
    return response.json();
  }, sessionId);
  const state = (body as any)?.state ?? body;
  if (!state || typeof state !== 'object') {
    throw new Error(`la página no pudo leer la sesión: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return state as SessionView;
}

/** Texto de los turnos pintados, en orden. */
async function renderedTurns(page: Page): Promise<string[]> {
  return page.locator('[data-testid^="pair-session-turn-"]').allTextContents();
}

test.describe('C8 · dos dispositivos sobre la misma sesión', () => {
  test('el móvil a 390×844 ve la misma sesión y los mismos steps que el escritorio', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    // Los dos viewports son explícitos, así que el proyecto sólo aporta el
    // motor: correrlo en `firefox` y en `mobile-chrome` repetiría la misma
    // medición (y un arranque de `server.ts` por proyecto) sin agregar evidencia
    // de C8, que habla de dos anchos y no de dos motores.
    test.skip(
      testInfo.project.name !== 'chromium',
      'C8 mide dos viewports explícitos: se corre una sola vez, en chromium'
    );

    let srv: ServerHarness | null = null;
    let provider: FakeProvider | null = null;
    let cwd = '';
    const contexts: BrowserContext[] = [];

    try {
      // --- La sesión, creada y ejecutada de verdad -------------------------
      srv = await startServer();
      provider = await startScriptedProvider([
        { tool: 'fs.read', args: { path: 'sesion.txt' } },
        { text: 'Leí sesion.txt: la sesión es la misma en los dos dispositivos.' },
      ]);
      // `run: false` para escribir el archivo antes del primer turno: la lectura
      // tiene que devolver contenido, no un ENOENT que también daría pasos.
      const created = await createApprovalSession(srv, provider, {
        run: false,
        maxSteps: 8,
        goal: 'C8: el móvil sigue la sesión del escritorio',
      });
      cwd = created.cwd;
      fs.writeFileSync(path.join(cwd, 'sesion.txt'), 'hola desde el escritorio\n');

      const started = await srv.request(
        'POST',
        `/api/agent/sessions/${created.id}/message`,
        { text: 'empezá' }
      );
      expect(started.status, started.raw).toBe(202);

      const finished = await waitForState(
        srv,
        created.id,
        ['completed', 'failed'],
        30_000
      );
      expect(finished.status, JSON.stringify(finished).slice(0, 400)).toBe('completed');

      const serverState = await getState(srv, created.id);
      const serverSteps = serverState.steps as unknown[];
      expect(Array.isArray(serverSteps)).toBe(true);
      expect(serverSteps.length).toBeGreaterThan(0);
      expect((serverState.turns as unknown[]).length).toBeGreaterThan(0);

      // --- Los dos dispositivos -------------------------------------------
      const desktop = await openPairSession(
        browser,
        DESKTOP_VIEWPORT,
        srv.baseUrl,
        created.id
      );
      contexts.push(desktop.context);
      const mobile = await openPairSession(
        browser,
        MOBILE_VIEWPORT,
        srv.baseUrl,
        created.id
      );
      contexts.push(mobile.context);

      expect(desktop.page.viewportSize()).toEqual({ ...DESKTOP_VIEWPORT });
      expect(mobile.page.viewportSize()).toEqual({ ...MOBILE_VIEWPORT });

      // Los dos `sessionId`: el que muestra cada pantalla es el mismo.
      const desktopId = await desktop.page.getByTestId('pair-session-id').inputValue();
      const mobileId = await mobile.page.getByTestId('pair-session-id').inputValue();
      expect(desktopId).toBe(created.id);
      expect(mobileId).toBe(created.id);
      expect(desktopId).toBe(mobileId);
      await expect(desktop.page.getByTestId('pair-session-status')).toContainText(
        created.id
      );
      await expect(mobile.page.getByTestId('pair-session-status')).toContainText(
        created.id
      );

      // `steps` comparados: servidor ↔ escritorio ↔ móvil.
      const desktopState = await readSessionFromPage(desktop.page, created.id);
      const mobileState = await readSessionFromPage(mobile.page, created.id);
      expect(mobileState.id).toBe(desktopState.id);
      expect(desktopState.steps).toEqual(serverSteps);
      expect(mobileState.steps).toEqual(serverSteps);
      expect(mobileState.steps).toHaveLength(serverSteps.length);

      // Y lo que pinta cada pantalla coincide con esos turnos.
      const desktopTurns = await renderedTurns(desktop.page);
      const mobileTurns = await renderedTurns(mobile.page);
      expect(desktopTurns).toHaveLength((serverState.turns as unknown[]).length);
      expect(mobileTurns).toEqual(desktopTurns);

      // --- F3-7: 390 de ancho, sin desborde --------------------------------
      const metrics = await mobile.page.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(metrics.innerWidth).toBe(MOBILE_VIEWPORT.width);
      expect(
        metrics.scrollWidth,
        `la vista desborda a ${MOBILE_VIEWPORT.width}px (scrollWidth ${metrics.scrollWidth})`
      ).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

      // --- La captura del ancho -------------------------------------------
      const shotDir = path.join(process.cwd(), 'test-results', 'c8');
      fs.mkdirSync(shotDir, { recursive: true });
      const shot = path.join(shotDir, 'pair-session-390x844.png');
      await mobile.page.screenshot({ path: shot });

      // La secuencia se imprime y se adjunta al reporte: así el `sessionId`
      // archivado y los `steps` documentados salen de esta misma corrida y no
      // hay que reconstruirla después con otra sesión.
      const stepSummary = (
        serverSteps as Array<{ type?: string; title?: string; toolId?: string }>
      ).map((step) =>
        `${step.type}:${step.title}${step.toolId ? `(${step.toolId})` : ''}`
      );
      await testInfo.attach('c8-steps', {
        body: JSON.stringify(
          { desktopId, mobileId, steps: stepSummary },
          null,
          2
        ),
        contentType: 'application/json',
      });

      const png = fs.readFileSync(shot);
      // Cabecera PNG: ancho y alto en big-endian a partir del byte 16.
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      expect({ width, height }).toEqual({ ...MOBILE_VIEWPORT });
      await testInfo.attach('pair-session-390x844', {
        path: shot,
        contentType: 'image/png',
      });
      console.log(
        `[c8] sessionId(escritorio)=${desktopId} sessionId(móvil)=${mobileId} ` +
          `steps=${serverSteps.length} [${stepSummary.join(' > ')}] ` +
          `captura=${shot} (${width}×${height})`
      );
    } finally {
      for (const context of contexts) {
        await context.close().catch(() => { /* ya cerrado */ });
      }
      await provider?.close().catch(() => { /* ya cerrado */ });
      if (cwd) cleanupDir(cwd);
      await srv?.stop();
    }
  });
});
