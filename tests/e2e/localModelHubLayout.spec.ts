import { test, expect, type Page } from '@playwright/test';

/**
 * El panel nativo mezcla grids, flex y nombres de repo largos. Unos `truncate`
 * ocultos pueden maquillar el layout: este test mide el desbordamiento real,
 * no solo que el panel se vea.
 */

const PANEL = '[data-testid="local-model-hub-panel"]';
// En CI se usa el preview del config; el override permite correrlo en local
// cuando 4173 ya lo ocupa otro proyecto.
const APP_URL = process.env.COMMANDER_E2E_URL || 'http://localhost:4173';
const APP_ORIGIN = new URL(APP_URL).origin;
const LONG_MODEL =
  'DavidAU/Commander-Layout-Stress-Test-Uncensored-NEO-IMATRIX-MAX-MTP-Extra-Long-Repository-Name-For-Horizontal-Overflow-Check-GGUF';

test.beforeEach(async ({ context }) => {
  // La app pide recursos externos al arrancar; el layout no depende de ellos.
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(APP_ORIGIN) || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    return route.abort();
  });
});

async function abrirPanelNativo(page: Page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="app-root"], .nc-header', { timeout: 45000 });

  const invitado = page.locator('button:has-text("ENTRAR COMO INVITADO")');
  if (await invitado.isVisible({ timeout: 3000 }).catch(() => false)) {
    await invitado.click();
  }

  await page.getByRole('button', { name: 'HF local', exact: true }).click();
  await page.getByRole('button', { name: '[DESCARGA NATIVA]', exact: true }).click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 15000 });
}

test.describe('Panel nativo · layout', () => {
  // El layout es el mismo motor en toda la suite; Chromium es el que usa la app.
  test.skip(({ browserName }) => browserName !== 'chromium', 'El layout se mide sólo en Chromium');
  test.setTimeout(60000);

  for (const width of [1024, 1440]) {
    test(`no tiene scroll horizontal a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      // Resultado determinista y con un nombre largo: no depende de que
      // Hugging Face responda ni de que el runner tenga modelos descargados.
      await page.route('**/api/local-models/hub/search**', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            models: [
              { id: LONG_MODEL, downloads: 123456, likes: 0, pipelineTag: 'text-generation', tags: [] },
            ],
          }),
        })
      );
      await abrirPanelNativo(page);
      await expect(page.locator(PANEL)).toContainText('Commander-Layout-Stress');

      const metrics = await page.locator(PANEL).evaluate((panel) => {
        const el = panel as HTMLElement;
        const overflowing = [...el.querySelectorAll<HTMLElement>('*')]
          .filter((node) => node.scrollWidth > node.clientWidth + 1)
          // Los truncados son recortes deliberados con elipsis, no scroll.
          .filter((node) => !node.classList.contains('truncate'))
          .map((node) => ({
            tag: node.tagName.toLowerCase(),
            cls: String(node.className).slice(0, 100),
            text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
            overflowX: getComputedStyle(node).overflowX,
          }));

        return {
          panelClientWidth: el.clientWidth,
          panelScrollWidth: el.scrollWidth,
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          overflowing,
        };
      });

      expect(metrics.panelClientWidth, 'No se midió el panel nativo').toBeGreaterThan(0);

      const detalle = metrics.overflowing
        .map(
          (item) =>
            `${item.tag}.${item.cls} · ${item.clientWidth}→${item.scrollWidth}px · ${item.text}`
        )
        .join('\n');
      expect(detalle, `Elementos que desbordan el panel:\n${detalle}`).toBe('');

      expect(
        metrics.panelScrollWidth,
        `El panel mide ${metrics.panelScrollWidth}px dentro de ${metrics.panelClientWidth}px`
      ).toBeLessThanOrEqual(metrics.panelClientWidth + 1);

      expect(
        metrics.documentScrollWidth,
        `La página mide ${metrics.documentScrollWidth}px dentro de ${metrics.documentClientWidth}px`
      ).toBeLessThanOrEqual(metrics.documentClientWidth + 1);
    });
  }
});
