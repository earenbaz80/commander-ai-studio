import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  buildVerificationArtifactFixture,
  FIXTURE_FAILED_TEST_ID,
  FIXTURE_RECORDING_ID,
  FIXTURE_VERIFICATION_ID,
} from '../../helpers/verificationArtifactFixture';

/**
 * F2 — verificación visual en Electron, sin inspección manual.
 *
 * El E2E de Chromium (`tests/e2e/verificationArtifact.spec.ts`) corre contra
 * `vite preview`; éste corre contra el **ejecutable empaquetado** de
 * `release/win-unpacked`, con su `server.cjs` embebido y el renderer real de
 * Electron. Siembra los mismos fixtures en IndexedDB, abre el Workbench y falla
 * si:
 *
 *  - la ventana no es Electron o no viene del server embebido (userAgent/origen);
 *  - el artifact no aparece, o el diff, la evidencia y el botón de reproducción
 *    no se pintan;
 *  - el panel no tiene tamaño, desborda en horizontal o queda sin estilos
 *    (fondo transparente/blanco), que es lo que un `jsdom` no ve;
 *  - hay una excepción no capturada en el renderer.
 *
 * Guarda una captura en `test-results/electron/artifacts-view.png` como
 * evidencia revisable. No hay intervención humana en ningún paso.
 *
 * Por qué no se usa el lanzador de Electron de Playwright: inyecta `--inspect=0`
 * en el proceso principal y el paquete muere con `STATUS_BREAKPOINT`
 * (`0x80000003`) antes de crear la ventana. Lanzar el .exe y hablarle por CDP
 * prueba el mismo binario y el mismo renderer sin ese interruptor. Además,
 * Chromium no inicializa sandbox ni GPU en la sesión donde corre el agente, así
 * que la corrida pasa `--no-sandbox --disable-gpu`: son interruptores **del
 * test**, el paquete sigue con `sandbox: true` en su BrowserWindow.
 *
 * Procedimiento en el instalador: `npm run build:electron -- --dir` (o instalar
 * el Setup y apuntar `COMMANDER_ELECTRON_APP` al .exe instalado) y después
 * `npm run test:electron`. Sin `release/win-unpacked` la prueba se salta con el
 * motivo, no finge un pase.
 */

const APP_EXE =
  process.env.COMMANDER_ELECTRON_APP?.trim() ||
  path.join('release', 'win-unpacked', 'Commander AI Studio.exe');
const SERVER_PORT = 3001;
const DB_NAME = 'commander-artifacts';
const STORE = 'artifacts';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function waitForJson(url: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
    } catch (error: any) {
      last = error?.message ?? String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`sin respuesta de ${url} en ${timeoutMs / 1000}s (${last})`);
}

function stopApp(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // El árbol incluye los procesos de Chromium; matar sólo el .exe deja hijos.
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="app-root"], .nc-header', { timeout: 90_000 });
  const guest = page.locator('button:has-text("ENTRAR COMO INVITADO")');
  if (await guest.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await guest.click();
    await page.waitForTimeout(500);
  }
}

async function openArtifacts(page: Page): Promise<void> {
  const workbench = page.locator('aside[aria-label="Workbench"]');
  if (!(await workbench.isVisible().catch(() => false))) {
    const button = page.locator('button[data-tooltip="Workbench (Panel Derecho)"]');
    await button.waitFor({ state: 'visible', timeout: 20_000 });
    await button.click();
  }
  await expect(workbench).toBeVisible({ timeout: 20_000 });
  await workbench.getByRole('button', { name: 'Artifacts', exact: true }).click();
  await expect(page.getByTestId('artifacts-view')).toBeVisible({ timeout: 20_000 });
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
        };
      });
    },
    { dbName: DB_NAME, storeName: STORE, items: artifacts }
  );
}

test.describe('Artifacts en Electron empaquetado', () => {
  test('el artifact se pinta en el renderer real, sin desbordes ni errores', async () => {
    const exe = path.resolve(APP_EXE);
    test.skip(
      !fs.existsSync(exe),
      `no existe ${APP_EXE}: construí el paquete con \`npm run build:electron -- --dir\` ` +
        'o apuntá COMMANDER_ELECTRON_APP al .exe instalado'
    );
    test.skip(
      !(await portIsFree(SERVER_PORT)),
      `el puerto ${SERVER_PORT} está ocupado (otra instancia de Commander): cerrala y reintentá`
    );

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-electron-e2e-'));
    const cdpPort = await freePort();
    const errors: string[] = [];
    let child: ChildProcess | null = null;
    let browser: Browser | null = null;

    try {
      child = spawn(
        exe,
        [
          `--remote-debugging-port=${cdpPort}`,
          '--no-sandbox',
          '--disable-gpu',
        ],
        {
          env: {
            ...process.env,
            // Perfil y datos aislados: la prueba no toca la app real del usuario.
            // `HOME`/`USERPROFILE` se dejan como están a propósito: con ellos
            // apuntando a un temporal, el paquete muere al arrancar (Chromium no
            // inicializa sus rutas). El perfil de Electron va por APPDATA y los
            // datos del server por las rutas COMMANDER_* de abajo.
            APPDATA: profile,
            LOCALAPPDATA: profile,
            COMMANDER_DB_PATH: path.join(profile, 'studio.db'),
            COMMANDER_TENANT_DB_PATH: path.join(profile, 'tenants.db'),
            COMMANDER_TENANT_STORAGE_DIR: path.join(profile, 'tenant-storage'),
            COMMANDER_AGENT_SESSIONS_DIR: path.join(profile, 'agent-sessions'),
            COMMANDER_PUBLISH_DIR: path.join(profile, 'publish'),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      let log = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        log += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        log += chunk.toString();
      });

      const version = await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`, 90_000).catch(
        (error) => {
          throw new Error(`${error.message}\n--- app ---\n${log.slice(-1500)}`);
        }
      );
      expect(String(version['User-Agent'])).toContain('Electron/');
      await waitForJson(`http://127.0.0.1:${SERVER_PORT}/api/health`, 60_000);

      browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      const context = browser.contexts()[0];
      const page =
        context.pages().find((item) => item.url().startsWith(`http://localhost:${SERVER_PORT}`)) ??
        (await context.waitForEvent('page', { timeout: 30_000 }));
      page.on('pageerror', (error) => errors.push(error.message));
      await page.waitForLoadState('domcontentloaded');
      await waitForApp(page);

      // Es Electron de verdad y viene del server embebido del paquete.
      const env = await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        origin: location.origin,
      }));
      expect(env.userAgent).toContain('Electron/');
      expect(env.origin).toBe(`http://localhost:${SERVER_PORT}`);

      const fixture = buildVerificationArtifactFixture();
      await seedArtifacts(page, [fixture.verification, fixture.recording]);
      // Recargar el renderer antes de abrir el visor: los artifacts vienen de
      // IndexedDB, no del estado en memoria de la siembra.
      await page.reload();
      await waitForApp(page);
      await openArtifacts(page);

      await expect(page.getByTestId(`artifact-card-${FIXTURE_VERIFICATION_ID}`)).toBeVisible();
      await expect(page.getByTestId(`artifact-card-${FIXTURE_RECORDING_ID}`)).toBeVisible();
      await expect(page.getByTestId('verification-detail')).toBeVisible();
      await expect(page.getByTestId('verification-diff')).toContainText(
        '+export const total = 3;'
      );
      await expect(page.getByTestId(`verification-test-${FIXTURE_FAILED_TEST_ID}`)).toContainText(
        'FALLÓ'
      );
      await expect(page.getByText('Reproducir el fallo', { exact: true })).toBeVisible();

      // Lo que jsdom no puede ver: caja real, estilos aplicados y cero desborde.
      const layout = await page.evaluate(() => {
        const view = document.querySelector('[data-testid="artifacts-view"]');
        if (!view) throw new Error('no existe artifacts-view');
        const box = view.getBoundingClientRect();
        const styles = getComputedStyle(view);
        return {
          width: Math.round(box.width),
          height: Math.round(box.height),
          background: styles.backgroundColor,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          fonts: document.fonts.status,
        };
      });
      expect(layout.fonts).toBe('loaded');
      expect(layout.width).toBeGreaterThan(300);
      expect(layout.height).toBeGreaterThan(200);
      expect(layout.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(layout.background).not.toBe('rgb(255, 255, 255)');
      expect(layout.overflowX).toBeLessThanOrEqual(1);

      const shotDir = path.join('test-results', 'electron');
      fs.mkdirSync(shotDir, { recursive: true });
      const screenshot = await page.screenshot({
        path: path.join(shotDir, 'artifacts-view.png'),
      });
      // Una ventana vacía pesa unos pocos cientos de bytes; esto es un render.
      expect(screenshot.length).toBeGreaterThan(10_000);

      expect(errors, `excepciones del renderer:\n${errors.join('\n')}`).toEqual([]);
    } finally {
      await browser?.close().catch(() => undefined);
      if (child) stopApp(child);
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch {
        /* archivos aún abiertos */
      }
    }
  });
});
