import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';

/**
 * Aviso de carga de LM Studio contra el servidor real.
 *
 * El `webServer` de Playwright sirve solo el bundle (`vite preview`), sin
 * `/api/*`. Este caso levanta su propio `server.ts` en producción y un LM Studio
 * falso: el modelo aparece `not-loaded`, la carga se retiene a propósito y se
 * comprueba que el aviso está visible justo mientras espera. Al liberar la
 * carga, el aviso desaparece y llega la respuesta del chat.
 *
 * Se cubre solo en Chromium de escritorio: es el motor de la app de escritorio
 * y cada ejecución arranca un servidor real, así que repetirlo en Firefox y en
 * móvil no aporta cobertura a este flujo.
 */
test.describe('LM Studio · aviso de carga', () => {
  test.skip(
    ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
    'Arranca el servidor real y un LM Studio falso; se cubre en Chromium de escritorio.'
  );

  test('muestra el aviso mientras carga un modelo no cargado y lo oculta al terminar', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);

    const model = 'e2e-unloaded';
    const modelId = `lmstudio/${model}`;
    const contextLength = 32_768;
    const reply = 'Modelo cargado y respuesta del E2E.';

    const fakeLmStudio = await startFakeLmStudio({ model, contextLength, reply });
    let appServer: Awaited<ReturnType<typeof startAppServer>> | null = null;

    try {
      appServer = await startAppServer(fakeLmStudio.origin);

      const input = await openLmStudioChat(page, context, appServer.origin, modelId);

      await input.fill('Hola, carga el modelo.');
      await page.getByRole('button', { name: 'Enviar mensaje' }).click();

      const notice = page.getByTestId('lmstudio-loading');
      await expect(notice).toBeVisible({ timeout: 30_000 });
      await expect(notice).toContainText(model);
      await expect(page.getByTestId('lmstudio-loading-context')).toHaveText(/Contexto 32K/);

      // La petición de carga ya está en el LM Studio falso. Se retiene hasta
      // este punto: mientras tanto el aviso debe seguir visible.
      await Promise.race([
        fakeLmStudio.waitForLoadStarted(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('El LM Studio falso no recibió la carga')), 10_000)
        ),
      ]);
      await expect(notice).toBeVisible();

      fakeLmStudio.releaseLoad();

      await expect(notice).toBeHidden({ timeout: 30_000 });
      await expect(page.locator('[data-msg-id]').filter({ hasText: reply })).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await appServer?.stop();
      await fakeLmStudio.close();
    }
  });

  test('muestra el error de carga y abre la configuración del proveedor', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);

    const model = 'e2e-unloaded';
    const modelId = `lmstudio/${model}`;
    const loadError = 'not enough VRAM';

    const fakeLmStudio = await startFakeLmStudio({
      model,
      contextLength: 32_768,
      reply: 'La carga falló; esta respuesta no debe llegar.',
      loadError,
    });
    let appServer: Awaited<ReturnType<typeof startAppServer>> | null = null;

    try {
      appServer = await startAppServer(fakeLmStudio.origin);
      const input = await openLmStudioChat(page, context, appServer.origin, modelId);

      await input.fill('Hola, carga el modelo.');
      await page.getByRole('button', { name: 'Enviar mensaje' }).click();

      const alert = page.getByTestId('lmstudio-loading-error');
      await expect(alert).toBeVisible({ timeout: 30_000 });
      await expect(alert).toContainText('No se pudo cargar el modelo');
      await expect(page.getByTestId('lmstudio-loading-error-message')).toContainText(
        loadError
      );

      const configure = page.getByRole('button', { name: 'Configurar proveedor' });
      await expect(configure).toBeVisible();
      await configure.click();

      const providers = page.locator('[data-settings-section="proveedores"]');
      await expect(providers).toBeVisible({ timeout: 15_000 });
      await expect(providers).toContainText('LM Studio');
      await expect(
        page.getByRole('button', { name: 'Proveedores', exact: true })
      ).toHaveAttribute('aria-current', 'page');
    } finally {
      await appServer?.stop();
      await fakeLmStudio.close();
    }
  });
});

/**
 * Siembra una sesión de chat con el modelo LM Studio elegido, bloquea recursos
 * externos y devuelve el compositor cuando la app está lista.
 */
async function openLmStudioChat(
  page: Page,
  context: BrowserContext,
  appOrigin: string,
  modelId: string
): Promise<Locator> {
  // La app hidrata la pestaña activa desde localStorage. Se siembra el modelo
  // LM Studio para no depender del catálogo vivo (que también consulta al LM
  // Studio falso) ni de un selector con más de cien modelos.
  await context.addInitScript(
    ({ selected, now }) => {
      try {
        localStorage.setItem('ai_studio_default_model_v3', '1');
        localStorage.setItem('ai_studio_selected_model', selected);
        localStorage.setItem(
          'ai_studio_tabs_v1',
          JSON.stringify([
            {
              id: 'e2e-lmstudio-tab',
              title: 'E2E LM Studio',
              mode: 'chat',
              selectedModel: selected,
              parameters: {},
              messages: [],
              projectPath: '',
              sessionId: 'e2e-lmstudio-session',
              promptTitle: 'E2E LM Studio',
              createdAt: now,
              updatedAt: now,
            },
          ])
        );
        localStorage.setItem('ai_studio_active_tab', 'e2e-lmstudio-tab');
        localStorage.setItem('ai_studio_onboarding_seen', '1');
        localStorage.setItem('ai_studio_guest_name', 'Invitado E2E');
      } catch {
        // Sin localStorage la app cae a su estado inicial; el test fallará al
        // comprobar el modelo seleccionado con un error legible.
      }
    },
    { selected: modelId, now: Date.now() }
  );

  // La suite no sale de localhost: la app intenta cargar fuentes y el iframe de
  // auth de Firebase, y un host externo atascado retrasa `load`.
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (
      url.startsWith(appOrigin) ||
      url.startsWith('data:') ||
      url.startsWith('blob:')
    ) {
      return route.continue();
    }
    return route.abort();
  });

  await page.goto(appOrigin, { waitUntil: 'domcontentloaded' });
  const input = page.locator('[data-chat-input]');
  await expect(input).toBeVisible({ timeout: 45_000 });

  const guestButton = page.locator('button:has-text("ENTRAR COMO INVITADO")');
  if (await guestButton.isVisible({ timeout: 1500 }).catch(() => false)) {
    await guestButton.click();
    await expect(input).toBeVisible();
  }

  // Si el estado hidratado se perdiera, aquí se vería el modelo por defecto y
  // no tendría sentido seguir con la prueba.
  await expect(
    page.getByRole('button', { name: 'Modelo que se usará para responder' })
  ).toContainText(modelId.replace(/^lmstudio\//, ''), { timeout: 15_000 });

  return input;
}

interface FakeLmStudioOptions {
  model: string;
  contextLength: number;
  reply: string;
  /** Si se indica, `/api/v1/models/load` falla con este mensaje. */
  loadError?: string;
}

interface FakeLmStudio {
  origin: string;
  waitForLoadStarted: () => Promise<void>;
  releaseLoad: () => void;
  close: () => Promise<void>;
}

/** LM Studio mínimo: catálogo, estado nativo, carga retenida y chat. */
function startFakeLmStudio({
  model,
  contextLength,
  reply,
  loadError,
}: FakeLmStudioOptions): Promise<FakeLmStudio> {
  return new Promise((resolve, reject) => {
    let loaded = false;
    let markLoadStarted: (() => void) | null = null;
    let releasePendingLoad: (() => void) | null = null;
    const loadStarted = new Promise<void>((resolveStarted) => {
      markLoadStarted = resolveStarted;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/v1/models') {
        return sendJson(res, 200, { data: [{ id: model, object: 'model' }] });
      }

      if (req.method === 'GET' && url.pathname === '/api/v0/models') {
        return sendJson(res, 200, {
          data: [
            {
              id: model,
              type: 'llm',
              state: loaded ? 'loaded' : 'not-loaded',
              max_context_length: contextLength,
              ...(loaded
                ? { loaded_instances: [{ id: model, config: { context_length: contextLength } }] }
                : {}),
            },
          ],
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/models/load') {
        req.resume();
        markLoadStarted?.();
        markLoadStarted = null;
        if (loadError) {
          return sendJson(res, 500, { error: { message: loadError } });
        }
        releasePendingLoad = () => {
          releasePendingLoad = null;
          loaded = true;
          if (!res.writableEnded && !res.destroyed) {
            sendJson(res, 200, { type: 'llm', instance_id: model, status: 'loaded' });
          }
        };
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        req.resume();
        return sendJson(res, 200, {
          choices: [{ message: { role: 'assistant', content: reply } }],
          usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
        });
      }

      return sendJson(res, 404, { error: `Ruta no simulada: ${req.method} ${url.pathname}` });
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('El LM Studio falso no obtuvo un puerto'));
        return;
      }

      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        waitForLoadStarted: () => loadStarted,
        releaseLoad: () => {
          if (!releasePendingLoad) throw new Error('La carga no estaba esperando en el LM Studio falso');
          releasePendingLoad();
        },
        close: async () => {
          releasePendingLoad?.();
          await new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections?.();
          });
        },
      });
    });
  });
}

interface AppServer {
  origin: string;
  stop: () => Promise<void>;
}

/**
 * Arranca el servidor real en modo producción con PORT=0 para no chocar con
 * otros tests ni con un servidor de desarrollo abierto. El puerto real lo
 * anuncia el propio server; no se adivina ni se fija.
 */
async function startAppServer(lmStudioOrigin: string): Promise<AppServer> {
  if (!existsSync(path.resolve('dist/index.html'))) {
    throw new Error('Falta dist/index.html: ejecuta `npm run build` antes de este E2E.');
  }

  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '0',
      LMSTUDIO_HOST: lmStudioOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  let portSettled = false;
  let resolvePort: (port: number) => void = () => {};
  let rejectPort: (error: Error) => void = () => {};
  const portPromise = new Promise<number>((resolve, reject) => {
    resolvePort = resolve;
    rejectPort = reject;
  });

  const onStdout = (chunk: Buffer) => {
    logs += chunk.toString();
    if (portSettled) return;
    const match = logs.match(/server running on port (\d+)/);
    if (!match) return;
    portSettled = true;
    clearTimeout(timer);
    resolvePort(Number(match[1]));
  };
  const onStderr = (chunk: Buffer) => {
    logs += chunk.toString();
  };
  const onExit = (code: number | null) => {
    if (portSettled) return;
    portSettled = true;
    clearTimeout(timer);
    rejectPort(new Error(`El servidor real terminó con código ${code}.\n${logs}`));
  };
  const timer = setTimeout(() => {
    if (portSettled) return;
    portSettled = true;
    rejectPort(new Error(`El servidor real no anunció su puerto en 60 s.\n${logs}`));
  }, 60_000);

  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);
  child.once('exit', onExit);

  let port: number;
  try {
    port = await portPromise;
  } catch (error) {
    child.kill();
    throw error;
  }

  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`El servidor real terminó antes de responder /api/health.\n${logs}`);
    }
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        return { origin, stop: () => stopChild(child) };
      }
    } catch {
      // Aún está enlazando rutas o el puerto acaba de abrirse.
    }
    await delay(250);
  }

  child.kill();
  throw new Error(`El servidor real no respondió a /api/health.\n${logs}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(2000)]);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
