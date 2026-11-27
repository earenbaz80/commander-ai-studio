/**
 * C8 del recibo G2 (`docs/parity/receipts/G2-REVIEW-2026-11-25.md` §7): la
 * evidencia de F3-1 (escritorio → móvil, aprobando un diff) y de F3-7 (vista a
 * 390×844 con el diff visible y las decisiones habilitadas).
 *
 * Qué fija, en una sola corrida:
 * - **Dos dispositivos reales sobre la misma sesión.** Un contexto de escritorio
 *   a 1280×800 y otro de móvil a 390×844 abren `/pair/session?sessionId=…`
 *   contra el `server.ts` del arnés; los dos muestran el mismo `sessionId`.
 *   El móvil no es un navegador suelto: canjea un enlace real emitido por
 *   `/api/pair/issue` y queda con su cookie de dispositivo.
 * - **La aprobación viaja del móvil al escritorio.** El turno lo inicia el host
 *   y se detiene en `fs.write`; el escritorio ve la tarjeta con el diff en sólo
 *   lectura, el móvil reclama el control, pulsa «Aprobar» y el servidor aplica
 *   la escritura. Después el escritorio ve los mismos turnos y los mismos pasos.
 * - **Ni un paso duplicado.** El `steps` del servidor, del escritorio y del
 *   móvil son iguales y hay exactamente un `tool_result` de `fs.write`.
 * - **Captura del ancho.** La pantalla del móvil, con el diff y las tres
 *   decisiones, se captura a 390×844 y se comprueba leyendo la cabecera IHDR del
 *   PNG, no el viewport declarado. Además se exige `scrollWidth ≤ 390`.
 *
 * La sesión no se siembra: se crea con `createApprovalSession` y el proveedor
 * guionado, y el turno corre de verdad en el servidor. El escritorio no aprueba:
 * su papel es iniciar el turno y reflejar lo que decidió el móvil.
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
  waitForApproval,
  waitForState,
  type FakeProvider,
} from '../agent/approvalHarness';

/** Los dos tamaños de C8, explícitos y no tomados de un proyecto de Playwright. */
const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

/** Contenido que el móvil aprueba; se comprueba en disco al final. */
const APPROVED_CONTENT = 'aprobado desde el móvil\n';

interface SessionView {
  id?: string;
  status?: string;
  steps?: unknown[];
  turns?: Array<{ role: string; text: string }>;
  plan?: unknown[];
}

/** Abre `/pair/session` en una página ya existente y espera a que monte. */
async function gotoPairSession(
  page: Page,
  baseUrl: string,
  sessionId: string
): Promise<void> {
  await page.goto(
    `${baseUrl}/pair/session?sessionId=${encodeURIComponent(sessionId)}`,
    { waitUntil: 'domcontentloaded' }
  );
  await expect(page.getByTestId('pair-session-screen')).toBeVisible({
    timeout: 30_000,
  });
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
  await gotoPairSession(page, baseUrl, sessionId);
  return { context, page };
}

/**
 * Empareja un contexto canjeando un enlace emitido por el host, igual que la
 * PWA: `POST /api/pair/redeem` con el `Origin` del pair, que deja la cookie
 * `HttpOnly` del dispositivo en ese contexto.
 */
async function pairDevice(
  context: BrowserContext,
  srv: ServerHarness,
  sessionId: string
): Promise<string> {
  const issued = await srv.request('POST', '/api/pair/issue', { sessionId });
  expect(issued.status, issued.raw).toBe(200);
  const token = String(issued.body?.token ?? '');
  expect(token).not.toBe('');

  const redeemed = await context.request.post(`${srv.baseUrl}/api/pair/redeem`, {
    data: { token },
    headers: { Origin: srv.baseUrl },
  });
  const body = await redeemed.json().catch(() => null);
  expect(redeemed.status(), JSON.stringify(body)).toBe(200);
  const deviceId = String((body as any)?.device?.id ?? '');
  expect(deviceId).not.toBe('');
  return deviceId;
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
  test('el móvil a 390×844 aprueba el diff y el escritorio lo refleja', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
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
        { tool: 'fs.write', args: { path: 'nota.txt', content: APPROVED_CONTENT } },
        { text: 'Escribí nota.txt después de la aprobación del móvil.' },
      ]);
      // `run: false` para escribir el archivo antes del primer turno: la lectura
      // tiene que devolver contenido, no un ENOENT que también daría pasos.
      const created = await createApprovalSession(srv, provider, {
        run: false,
        maxSteps: 8,
        goal: 'C8: el móvil aprueba un diff y el escritorio lo refleja',
      });
      cwd = created.cwd;
      fs.writeFileSync(path.join(cwd, 'sesion.txt'), 'hola desde el escritorio\n');

      // --- El móvil se empareja antes de abrir la pantalla -----------------
      const mobileContext = await browser.newContext({
        viewport: { ...MOBILE_VIEWPORT },
        deviceScaleFactor: 1,
      });
      contexts.push(mobileContext);
      const mobilePage = await mobileContext.newPage();
      const deviceId = await pairDevice(mobileContext, srv, created.id);

      // --- El turno lo inicia el host y se detiene en la escritura ---------
      const started = await srv.request(
        'POST',
        `/api/agent/sessions/${created.id}/message`,
        { text: 'empezá' }
      );
      expect(started.status, started.raw).toBe(202);

      const pending = await waitForApproval(srv, created.id, { timeoutMs: 60_000 });
      expect(pending.tool).toBe('fs.write');
      expect(pending.diff ?? '').toContain('nota.txt');

      // --- Los dos dispositivos -------------------------------------------
      const desktop = await openPairSession(
        browser,
        DESKTOP_VIEWPORT,
        srv.baseUrl,
        created.id
      );
      contexts.push(desktop.context);
      await gotoPairSession(mobilePage, srv.baseUrl, created.id);

      expect(desktop.page.viewportSize()).toEqual({ ...DESKTOP_VIEWPORT });
      expect(mobilePage.viewportSize()).toEqual({ ...MOBILE_VIEWPORT });

      // Los dos `sessionId`: el que muestra cada pantalla es el mismo.
      const desktopId = await desktop.page.getByTestId('pair-session-id').inputValue();
      const mobileId = await mobilePage.getByTestId('pair-session-id').inputValue();
      expect(desktopId).toBe(created.id);
      expect(mobileId).toBe(created.id);
      expect(desktopId).toBe(mobileId);
      await expect(desktop.page.getByTestId('pair-session-status')).toContainText(
        created.id
      );
      await expect(mobilePage.getByTestId('pair-session-status')).toContainText(
        created.id
      );

      // El móvil canjeó su enlace: no aparece la nota de «no emparejado».
      await expect(mobilePage.getByTestId('pair-session-device-note')).toHaveCount(0);
      const deviceFromPage = await mobilePage.evaluate(async () => {
        const response = await fetch('/api/pair/device', { credentials: 'same-origin' });
        return (await response.json().catch(() => null)) as any;
      });
      expect(String(deviceFromPage?.device?.id ?? '')).toBe(deviceId);

      // --- F3-1: el escritorio ve la pendiente, pero no puede decidirla -----
      const diffId = `pair-session-approval-diff-${pending.id}`;
      await expect(desktop.page.getByTestId(diffId)).toBeVisible({ timeout: 30_000 });
      const desktopDiff = await desktop.page.getByTestId(diffId).textContent();
      expect(desktopDiff).toContain('nota.txt');
      expect(desktopDiff).toContain(`+${APPROVED_CONTENT.trim()}`);
      await expect(desktop.page.getByTestId(`pair-session-allow-${pending.id}`)).toBeDisabled();

      // Sin control, el móvil tampoco escribe: el botón arranca deshabilitado.
      await expect(mobilePage.getByTestId(`pair-session-allow-${pending.id}`)).toBeDisabled();

      // --- El móvil reclama el control ------------------------------------
      await mobilePage.getByTestId('pair-session-claim').click();
      await expect(mobilePage.getByTestId('pair-session-lease')).toContainText(
        'Escribís esta sesión',
        { timeout: 30_000 }
      );
      const allow = mobilePage.getByTestId(`pair-session-allow-${pending.id}`);
      await expect(allow).toBeEnabled();
      await expect(
        mobilePage.getByTestId(`pair-session-deny-${pending.id}`)
      ).toBeEnabled();
      await expect(
        mobilePage.getByTestId(`pair-session-allow-session-${pending.id}`)
      ).toBeEnabled();
      await expect(mobilePage.getByTestId(`pair-session-approval-diff-${pending.id}`)).toContainText(
        `+${APPROVED_CONTENT.trim()}`
      );

      // --- F3-7: 390 de ancho, sin desborde, con el diff a la vista --------
      await mobilePage
        .getByTestId(`pair-session-approval-${pending.id}`)
        .scrollIntoViewIfNeeded();
      const metrics = await mobilePage.evaluate(() => ({
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
      await mobilePage.screenshot({ path: shot });

      // --- La aprobación la da el móvil -----------------------------------
      await allow.click();
      await expect(mobilePage.getByTestId('pair-session-note')).toContainText(
        'Aprobaste fs.write',
        { timeout: 30_000 }
      );

      const finished = await waitForState(
        srv,
        created.id,
        ['completed', 'failed'],
        60_000
      );
      expect(finished.status, JSON.stringify(finished).slice(0, 400)).toBe('completed');

      // La escritura se aplicó: sin esto la aprobación sería decorativa.
      expect(fs.readFileSync(path.join(cwd, 'nota.txt'), 'utf8')).toBe(APPROVED_CONTENT);

      // --- El escritorio refleja la aprobación, sin pasos duplicados -------
      const serverState = await getState(srv, created.id);
      const serverSteps = serverState.steps as unknown[];
      expect(Array.isArray(serverSteps)).toBe(true);
      expect((serverState.turns as unknown[]).length).toBeGreaterThan(0);

      await desktop.page.getByTestId('pair-session-refresh').click();
      await expect(desktop.page.getByTestId('pair-session-approvals-empty')).toBeVisible({
        timeout: 30_000,
      });

      const desktopState = await readSessionFromPage(desktop.page, created.id);
      const mobileState = await readSessionFromPage(mobilePage, created.id);
      expect(mobileState.id).toBe(desktopState.id);
      expect(desktopState.steps).toEqual(serverSteps);
      expect(mobileState.steps).toEqual(serverSteps);
      expect(mobileState.steps).toHaveLength(serverSteps.length);

      const writeResults = (
        serverSteps as Array<{ type?: string; toolId?: string }>
      ).filter((step) => step.type === 'tool_result' && step.toolId === 'fs.write');
      expect(writeResults).toHaveLength(1);

      // Y lo que pinta cada pantalla coincide con esos turnos.
      const desktopTurns = await renderedTurns(desktop.page);
      const mobileTurns = await renderedTurns(mobilePage);
      expect(desktopTurns).toHaveLength((serverState.turns as unknown[]).length);
      expect(mobileTurns).toEqual(desktopTurns);
      expect(desktopTurns.join(' ')).toContain('nota.txt');

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
          { desktopId, mobileId, approvedBy: deviceId, steps: stepSummary },
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
          `aprobó=${deviceId} steps=${serverSteps.length} [${stepSummary.join(' > ')}] ` +
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
