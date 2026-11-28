import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Tests para Commander AI Studio
 * 
 * Cubre flujos críticos:
 * - Boot de la aplicación
 * - Navegación entre modos
 * - Multi-tab
 - Paleta de comandos (Ctrl+K)
 * - Workbench panel
 * - Agent mode básico
 * - Chat flow
 */

/**
 * Por debajo de 640px (el `sm` de Tailwind) el sidebar arranca colapsado: en un
 * teléfono se lleva un tercio de la pantalla. Las pruebas que lo dan por abierto
 * tienen que abrirlo primero.
 */
const esMovil = (page: Page) => (page.viewportSize()?.width ?? 1024) < 640;

/**
 * El `navigationTimeout` global son 20 s y la primera navegación de Firefox en
 * el runner los agotaba: `page.goto` se cortaba a los 20 s y el test pasaba en
 * el reintento, que es exactamente el flaky con el que salía el job E2E. El
 * arranque real lo acota el `waitForSelector` de cada suite; al `goto` le basta
 * con traer y ejecutar el bundle, así que lleva su propio margen sin relajar el
 * resto de las acciones.
 */
const GOTO_TIMEOUT = 45000;
const gotoApp = (page: Page) =>
  page.goto('/', { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });

/**
 * La suite no sale de localhost. La app pide recursos a terceros al arrancar
 * (el iframe de auth de Firebase, fuentes) y si uno de esos hosts se atasca en
 * el runner, `page.goto` espera al evento `load` —que incluye los iframes—
 * hasta agotar el presupuesto del test. Eso salía como
 * `Tearing down "context" exceeded the test timeout` y marcaba flaky una prueba
 * que había pasado. Abortarlos no cuesta arranque (medido: 4,2 s frente a 4,5 s)
 * y deja la suite sin dependencia de red.
 */
test.beforeEach(async ({ context }) => {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://localhost:4173') || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    return route.abort();
  });
});

test.describe('Commander AI Studio - Core', () => {
  test.setTimeout(60000);
  test.beforeEach(async ({ page }) => {
    // `load` espera a todos los recursos (fuentes, imágenes, iframes) y aquí esa
    // espera se mide en 11-18 s. La señal de «app lista» ya la da el
    // waitForSelector de abajo (30 s); al goto le basta con traer y ejecutar el
    // bundle, con el margen propio de `gotoApp`.
    await gotoApp(page);
    // Esperar a que la app esté lista (retro BIOS boot)
    await page.waitForSelector('[data-testid="app-root"], .nc-header, .commander-title', { timeout: 30000 });
    const guestBtn0 = page.locator('button:has-text("ENTRAR COMO INVITADO")');
    if (await guestBtn0.isVisible({ timeout: 3000 }).catch(() => false)) {
      await guestBtn0.click();
      await page.waitForTimeout(500);
    }
  });

  test('debe cargar la aplicación y mostrar el header', async ({ page }) => {
    const header = page.locator('header');
    await expect(header).toBeVisible();
    // Se ancla a la clase y no al tag: el título del estado vacío ya no se
    // escribe a mano sino que lo pinta `EmptyState`, y ahí es un `<h2>` con la
    // misma clase. Lo que importa es que la clase está (es la que la hoja de
    // estilos usa para el efecto 3D), no qué etiqueta la lleva.
    await expect(page.locator('.commander-title')).toBeVisible();
  });

  test('debe mostrar la sidebar por defecto', async ({ page }) => {
    const sidebar = page.locator('aside[aria-label="Navegación principal"]');
    if (esMovil(page)) {
      await expect(sidebar).not.toBeVisible();
      // Y se abre desde el header, que es lo que queda a mano en un teléfono.
      await page.locator('button[data-tooltip="Alternar Barra Lateral"]').click();
    }
    await expect(sidebar).toBeVisible();
  });

  test('debe alternar la sidebar con Ctrl+B', async ({ page }) => {
    const sidebar = page.locator('aside[aria-label="Navegación principal"]');

    // En móvil arranca colapsada, así que el primer Ctrl+B abre en vez de cerrar.
    if (esMovil(page)) {
      await page.keyboard.press('Control+B');
      await expect(sidebar).toBeVisible();
    }

    // Ocultar
    await page.keyboard.press('Control+B');
    await expect(sidebar).not.toBeVisible();
    
    // Mostrar
    await page.keyboard.press('Control+B');
    await expect(sidebar).toBeVisible();
  });

  test('debe abrir la paleta de comandos con Ctrl+K', async ({ page }) => {
    await page.keyboard.press('Control+K');
    
    const palette = page.locator('[data-command-palette]');
    await expect(palette).toBeVisible();
    
    const input = palette.locator('input[aria-label="Paleta de comandos"]');
    await expect(input).toBeFocused();
    
    // Buscar "Chat"
    await input.fill('chat');
    const chatOption = palette.locator('button[role="option"]').first();
    await expect(chatOption).toBeVisible();
    
    // Cerrar con Escape
    await page.keyboard.press('Escape');
    await expect(palette).not.toBeVisible();
  });

  test('debe navegar al modo Agent desde la paleta', async ({ page }) => {
    await page.keyboard.press('Control+K');
    const palette = page.locator('[data-command-palette]');
    await expect(palette).toBeVisible();

    const input = palette.locator('input');
    await input.fill('agente');

    // La opción se elige por su texto y no por posición: el orden depende del
    // filtro, así que `.first()` sólo valía para la lista sin filtrar.
    const agentOption = palette
      .locator('button[role="option"]', { hasText: 'Agente autónomo' })
      .first();
    await expect(agentOption).toBeVisible();
    await agentOption.click();
    await expect(palette).not.toBeVisible();

    // El modo cambia en el acto, pero el panel entra por `React.lazy`: hasta
    // que llega el chunk de `AgentMode` el `main` muestra el fallback
    // «CARGANDO…». En el run #292 (firefox) el intento 1 se agotó esperando
    // `MODO AGENTE` con los 5 s por defecto de `expect` mientras la app ya
    // estaba en modo agent (en su contexto de error se leen `🔄 Modo agent` y
    // `main: CARGANDO…`); el reintento pasó con el chunk ya en caché. Lo que
    // se espera es la carga de un recurso, no una acción: lleva el mismo
    // margen que el arranque de la app.
    await expect(page.locator('text=MODO AGENTE')).toBeVisible({ timeout: 30000 });
  });

  test('debe alternar el Workbench con el botón del header', async ({ page }) => {
    const workbenchBtn = page.locator('button[data-tooltip="Workbench (Panel Derecho)"]');
    await workbenchBtn.click();
    
    const workbench = page.locator('aside[aria-label="Workbench"]');
    await expect(workbench).toBeVisible();
    
    // Cerrar
    const closeBtn = workbench.locator('button[title="Cerrar panel"]');
    await closeBtn.click();
    await expect(workbench).not.toBeVisible();
  });

  test('debe crear una nueva pestaña con Ctrl+T', async ({ page }) => {
    const initialTabs = page.locator('[title^="Sesión"], [title^="Nueva"]');
    const before = await initialTabs.count();
    
    await page.keyboard.press('Control+T');
    
    const after = await initialTabs.count();
    expect(after).toBeGreaterThan(before);
  });

  test('debe mostrar el modal de atajos con Ctrl+/', async ({ page }) => {
    await page.keyboard.press('Control+/');
    
    // El modal debe ser visible
    const modal = page.locator('div[role="dialog"], .nc-panel').filter({ hasText: 'Atajos' });
    await expect(modal).toBeVisible();
  });
});

test.describe('Commander AI Studio - Chat', () => {
  test.setTimeout(60000);
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await page.waitForSelector('[data-testid="app-root"], .nc-header', { timeout: 45000 });
    // Descartar modal de autenticación si aparece (modo invitado)
    const guestBtn = page.locator('button:has-text("ENTRAR COMO INVITADO")');
    if (await guestBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await guestBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('debe tener el modo Chat activo por defecto', async ({ page }) => {
    // Verificar que hay un área de chat visible
    const chatArea = page.locator('textarea, input[type="text"]').first();
    await expect(chatArea).toBeVisible();
  });

  test('debe enviar un mensaje y recibir respuesta del agente', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('Hola, ¿cómo estás?');
    await input.press('Enter');
    
    // El mensaje del usuario debe aparecer. `text=` resuelve a dos nodos: el
    // mismo texto encabeza la pestaña de sesión del sidebar (un <span>) y el
    // burbuja del chat es un <p>. Se ancla al burbuja para que el modo estricto
    // de Playwright siga valiendo como señal en vez de saltarlo con `.first()`.
    const userBubble = page.locator('p').filter({ hasText: 'Hola, ¿cómo estás?' });
    await expect(userBubble).toHaveCount(1);
    await expect(userBubble).toBeVisible();
    
    // Esperar respuesta (puede tardar si no hay API key)
    await page.waitForTimeout(2000);
  });

  test('debe limpiar historial desde el sidebar', async ({ page }) => {
    const clearBtn = page.locator('button[title="Borrar Historial"]');
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
      // Confirmar si hay diálogo
      page.on('dialog', dialog => dialog.accept());
    }
  });
});

test.describe('Commander AI Studio - Agent Mode', () => {
  test.setTimeout(60000);
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await page.waitForSelector('[data-testid="app-root"], .nc-header', { timeout: 45000 });
    // Descartar modal de autenticación si aparece (modo invitado)
    const guestBtn = page.locator('button:has-text("ENTRAR COMO INVITADO")');
    if (await guestBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await guestBtn.click();
      await page.waitForTimeout(500);
    }
    
    // Navegar al modo agente
    await page.keyboard.press('Control+K');
    const input = page.locator('[data-command-palette] input');
    await input.fill('agente');
    await page.locator('[data-command-palette] button[role="option"]').first().click();
  });

  test('debe mostrar la interfaz del agente', async ({ page }) => {
    await expect(page.locator('text=MODO AGENTE')).toBeVisible();
  });

  test('debe permitir escribir una tarea', async ({ page }) => {
    const goalTextarea = page.locator('textarea[placeholder*="tarea"]');
    await goalTextarea.fill('Analizar el proyecto');
    await expect(goalTextarea).toHaveValue('Analizar el proyecto');
  });

  test('debe permitir ejecutar una tool manualmente', async ({ page }) => {
    // Seleccionar fs.read
    const toolInput = page.locator('input[list="agent-tools"]');
    await toolInput.fill('fs.read');
    
    const jsonInput = page.locator('input[placeholder=\'{"path":"README.md"}\']');
    await jsonInput.fill('{"path":"package.json"}');
    
    // La etiqueta depende del idioma: el español (`Ejecutar tool`) es el de
    // fábrica. Con la cadena inglesa el locator no encontraba nada y el clic se
    // quedaba esperando hasta agotar el timeout del test.
    const runBtn = page.getByRole('button', { name: /Ejecutar tool|Run Tool/ });
    await runBtn.click();
    
    // Debe aparecer un step en el log
    await page.waitForTimeout(1000);
    const steps = page.locator('text=fs.read');
    await expect(steps.first()).toBeVisible();
  });
});

test.describe('Commander AI Studio - Workbench', () => {
  test.setTimeout(90000);
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await page.waitForSelector('[data-testid="app-root"], .nc-header', { timeout: 45000 });
    // Descartar modal de autenticación si aparece (modo invitado)
    const guestBtn = page.locator('button:has-text("ENTRAR COMO INVITADO")');
    if (await guestBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await guestBtn.click();
      await page.waitForTimeout(500);
    }
    
    // Abrir Workbench
    const wbBtn = page.locator('button[data-tooltip="Workbench (Panel Derecho)"]');
    await wbBtn.waitFor({ state: 'visible', timeout: 15000 });
    await wbBtn.click();
    await page.waitForSelector('aside[aria-label="Workbench"]', { timeout: 15000 });
  });

  test('debe mostrar el árbol de archivos por defecto', async ({ page }) => {
    const workbench = page.locator('aside[aria-label="Workbench"]');
    await expect(workbench).toBeVisible();
    // En móvil la etiqueta de la pestaña vive en un <span class="hidden sm:inline">:
    // la pestaña está, el texto no se ve. Se ancla al botón por su tooltip, que
    // se renderiza igual en cualquier ancho.
    const filesTab = workbench.locator(
      'button:is([title="Árbol de archivos del proyecto"], [title="Project file tree"], [title="Dateibaum des Projekts"])'
    );
    await expect(filesTab).toBeVisible();
  });

  test('debe cambiar a la vista Terminal', async ({ page }) => {
    const terminalBtn = page.locator('button[title*="Terminal"]');
    await terminalBtn.click();
    
    await expect(page.locator('aside[aria-label="Workbench"]')).toBeVisible();
  });

  test('debe cambiar a la vista Buscar', async ({ page }) => {
    const searchBtn = page.locator('button[title*="Buscar"]');
    await searchBtn.click();
    
    await expect(page.locator('aside[aria-label="Workbench"]')).toBeVisible();
  });
});

test.describe('Commander AI Studio - Accesibilidad', () => {
  test.setTimeout(60000);
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await page.waitForSelector('[data-testid="app-root"], .nc-header', { timeout: 45000 });
    // Descartar modal de autenticación si aparece (modo invitado)
    const guestBtn = page.locator('button:has-text("ENTRAR COMO INVITADO")');
    if (await guestBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await guestBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('debe tener botones con tooltips accesibles', async ({ page }) => {
    const buttons = page.locator('button[data-tooltip]');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
    
    for (let i = 0; i < Math.min(count, 5); i++) {
      const tooltip = await buttons.nth(i).getAttribute('data-tooltip');
      expect(tooltip).toBeTruthy();
    }
  });

  test('debe respetar prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    
    // La app debería cargar sin animaciones
    const header = page.locator('header');
    await expect(header).toBeVisible();
  });
});