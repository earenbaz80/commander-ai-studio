/**
 * Las rutas que estaban en `PENDIENTES` y se cablearon: contrato real.
 *
 * Cada una tenía un llamador del cliente y ningún handler, así que la pantalla
 * recibía el `index.html` de la SPA y el `res.json()` del cliente reventaba con
 * un error que no nombraba la ruta. Aquí se pide cada endpoint al server real
 * —el compartido de `npm run test:node`— y se comprueba la forma que el cliente
 * ya esperaba:
 *   • `/api/search/files` y `/api/search/code` (panel Search, Workbench, `@`),
 *     delegando en `fs.glob`/`fs.grep`: por eso valen también las garantías del
 *     walker (nada de `node_modules`, nada de ficheros de secretos).
 *   • `/api/permissions` GET/PUT (PermissionsModal y el toggle de modo), con la
 *     fusión por campo: cada llamador manda sólo su trozo.
 *   • `/api/ollama/models` y `/api/custom/models`: los catálogos de los modales
 *     de LLM local. Se prueban contra un puerto cerrado a propósito: lo que
 *     importa es que contesten JSON con `success:false` en vez de HTML, no que
 *     haya un Ollama corriendo en la máquina.
 *   • `/api/xai/generate`, que no puede caer en la SPA.
 *
 * Todo ocurre en un directorio temporal registrado como proyecto: las cosas que
 * se escriben (`.commander/permissions.json`) no tocan el repo, y el root se
 * quita al terminar para no dejar el registro del usuario con basura.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;
let root = '';

/** Marcador único de la corrida: la base y el server se comparten entre archivos. */
const NEEDLE = `needle-wired-${Date.now()}`;

const ROOT_Q = () => `root=${encodeURIComponent(root)}`;

/** ¿Hay credencial de xAI? Con clave, la prueba saldría a internet. */
function hayClaveXai(): boolean {
  if (process.env.XAI_API_KEY) return true;
  try {
    return /^XAI_API_KEY\s*=\s*\S/m.test(fs.readFileSync('.env', 'utf8'));
  } catch {
    return false;
  }
}

before(async () => {
  srv = await startServer();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wired-routes-'));
  const write = (rel: string, text: string) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  };
  write('src/app.ts', `export const MARCA = '${NEEDLE}';\n`);
  write('docs/guide.md', `guía con ${NEEDLE} dentro\n`);
  // Ruido que el walker debe ignorar: dependencias y ficheros de secretos.
  write('node_modules/paquete/index.js', `// ${NEEDLE}\n`);
  write('.env', `SECRETO=${NEEDLE}\n`);

  // El walker sólo recorre roots registrados: sin esto las búsquedas son 400.
  const added = await srv.request('POST', '/api/agent/roots', { path: root });
  assert.equal(added.status, 200, added.raw);
});

after(async () => {
  try { await srv?.request('DELETE', '/api/agent/roots', { path: root }); } catch { /* ya no estaba */ }
  try { if (root) fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignorar */ }
  await srv?.stop();
});

test('/api/search/files encuentra por nombre y salta lo que no es del proyecto', async () => {
  const res = await srv.request('GET', `/api/search/files?q=app&limit=20&${ROOT_Q()}`);
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.success, true);

  const paths: string[] = res.body.files.map((f: any) => f.path);
  assert.ok(paths.includes('src/app.ts'), `faltó src/app.ts: ${paths.join(', ') || '(vacío)'}`);
  assert.ok(!paths.some((p) => p.includes('node_modules')), 'no debe entrar en node_modules');
  assert.equal(typeof res.body.files[0].score, 'number', 'el picker `@` ordena por score');
});

test('/api/search/files no ofrece ficheros de secretos', async () => {
  const res = await srv.request('GET', `/api/search/files?q=env&${ROOT_Q()}`);
  assert.equal(res.status, 200, res.raw);
  const paths: string[] = res.body.files.map((f: any) => f.path);
  assert.ok(!paths.includes('.env'), 'el .env del proyecto no se lista');
});

test('/api/search/code agrupa por fichero y respeta el filtro de secretos', async () => {
  const res = await srv.request(
    'GET',
    `/api/search/code?q=${encodeURIComponent(NEEDLE)}&${ROOT_Q()}`
  );
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.success, true);
  assert.equal(res.body.semantic, false, 'sin embeddings: el badge de la UI no debe salir');

  const paths: string[] = res.body.results.map((r: any) => r.path).sort();
  assert.deepEqual(paths, ['docs/guide.md', 'src/app.ts'], 'ni node_modules ni .env');

  const hit = res.body.results.find((r: any) => r.path === 'src/app.ts');
  assert.equal(hit.matches[0].line, 1);
  assert.ok(hit.matches[0].text.includes(NEEDLE), `la línea no trae el texto: ${hit.matches[0].text}`);
});

test('/api/permissions lee, fusiona por campo y persiste en el proyecto', async () => {
  const initial = await srv.request('GET', `/api/permissions?${ROOT_Q()}`);
  assert.equal(initial.status, 200, initial.raw);
  assert.equal(initial.body.success, true);
  assert.equal(initial.body.permissions.mode, 'build');
  assert.equal(initial.body.permissions.allowedTools, null, 'sin lista blanca: todas permitidas');
  assert.deepEqual(initial.body.permissions.files, { read: [], write: [] });

  // El toggle de modo manda sólo `{ mode }` y no puede borrar globs ni tools.
  const modo = await srv.request('PUT', '/api/permissions', { root, permissions: { mode: 'plan' } });
  assert.equal(modo.status, 200, modo.raw);
  assert.equal(modo.body.permissions.mode, 'plan');
  assert.deepEqual(modo.body.permissions.files, { read: [], write: [] });

  // El modal manda tools y globs sin tocar el modo que fijó el toggle.
  const modal = await srv.request('PUT', '/api/permissions', {
    root,
    permissions: { allowedTools: ['fs.read'], files: { read: ['src/**'], write: ['tests/**'] } },
  });
  assert.equal(modal.status, 200, modal.raw);
  assert.equal(modal.body.permissions.mode, 'plan', 'el modo no se pierde al guardar el modal');
  assert.deepEqual(modal.body.permissions.files, { read: ['src/**'], write: ['tests/**'] });
  assert.ok(
    modal.body.permissions.allowedTools.includes('fs.read'),
    'la lista blanca guardada tiene que contener lo enviado'
  );

  // Y quedó en disco, que es lo que hace que sobreviva a una recarga.
  const guardado = JSON.parse(fs.readFileSync(path.join(root, '.commander', 'permissions.json'), 'utf8'));
  assert.equal(guardado.mode, 'plan');
  assert.deepEqual(guardado.files.read, ['src/**']);
});

test('/api/ollama/models contesta JSON cuando no hay servidor Ollama', async () => {
  const res = await srv.request('GET', `/api/ollama/models?host=${encodeURIComponent('http://127.0.0.1:9')}`);
  assert.equal(res.status, 200, res.raw);
  assert.ok(res.body, 'la respuesta tiene que ser JSON, no el index.html de la SPA');
  assert.equal(res.body.success, false);
  assert.deepEqual(res.body.models, []);
  assert.ok(res.body.error, 'el modal necesita el motivo para mostrarlo');
});

test('/api/custom/models contesta JSON cuando el endpoint no responde', async () => {
  const res = await srv.request('POST', '/api/custom/models', { baseURL: 'http://127.0.0.1:9/v1' });
  assert.equal(res.status, 200, res.raw);
  assert.ok(res.body);
  assert.equal(res.body.success, false);
  assert.deepEqual(res.body.models, []);
  assert.ok(res.body.error);
});

test('/api/providers/detect distingue un endpoint OpenAI de uno que no lo es', async (t) => {
  const fake = http.createServer((req, res) => {
    const url = req.url || '';
    if (url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'demo-1' }, { id: 'demo-2' }] }));
      return;
    }
    if (url === '/auth/models') {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'invalid key' } }));
      return;
    }
    if (url === '/html/models') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><body>not an API</body></html>');
      return;
    }
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => fake.close(() => resolve())));
  const port = (fake.address() as any).port;
  const base = `http://127.0.0.1:${port}`;

  const compatible = await srv.request('POST', '/api/providers/detect', { baseURL: `${base}/v1` });
  assert.equal(compatible.status, 200, compatible.raw);
  assert.equal(compatible.body.compatible, true);
  assert.equal(compatible.body.status, 'compatible');
  assert.deepEqual(compatible.body.models, ['demo-1', 'demo-2']);

  const html = await srv.request('POST', '/api/providers/detect', { baseURL: `${base}/html` });
  assert.equal(html.body.compatible, false);
  assert.equal(html.body.status, 'incompatible');
  assert.match(String(html.body.error), /HTML/i);

  const auth = await srv.request('POST', '/api/providers/detect', { baseURL: `${base}/auth` });
  assert.equal(auth.body.compatible, false);
  assert.equal(auth.body.status, 'auth');
  assert.equal(auth.body.httpStatus, 401);

  const missing = await srv.request('POST', '/api/providers/detect', { baseURL: `${base}/missing` });
  assert.equal(missing.body.compatible, false);
  assert.equal(missing.body.status, 'incompatible');
  assert.equal(missing.body.httpStatus, 404);

  const unreachable = await srv.request('POST', '/api/providers/detect', { baseURL: 'http://127.0.0.1:9/v1' });
  assert.equal(unreachable.body.compatible, false);
  assert.equal(unreachable.body.status, 'unreachable');
});

test('/api/providers/custom no guarda un endpoint no compatible sin confirmación', async () => {
  const res = await srv.request('POST', '/api/providers/custom', {
    id: 'prueba-no-compatible',
    name: 'Prueba no compatible',
    baseUrl: 'http://127.0.0.1:9/v1',
  });
  assert.equal(res.status, 409, res.raw);
  assert.equal(res.body.success, false);
  assert.equal(res.body.incompatible, true);
  assert.equal(res.body.status, 'unreachable');
});

test('/api/xai/generate no cae en el index.html de la SPA', async (t) => {
  if (hayClaveXai()) {
    // Con clave configurada la petición saldría a api.x.ai: no es cosa de la suite.
    return t.skip('XAI_API_KEY configurada: la petición iría a internet');
  }
  const res = await srv.request('POST', '/api/xai/generate', { prompt: 'hola' });
  assert.equal(res.status, 200, res.raw);
  assert.ok(res.body, 'la ruta existe: no debe volver el HTML de la SPA');
  assert.equal(res.body.ok, false);
  assert.match(String(res.body.error), /XAI_API_KEY/);
});

test('/api/lmstudio/generate reenvía las tools y traduce las tool_calls', async () => {
  // LM Studio remoto simulado. Sin este contrato el agente que usa
  // `lmstudio/<modelo>` recibe texto sin toolCalls y se detiene en el primer
  // paso: la auditoría «gratis» no leería ni un fichero.
  const recibido: any[] = [];
  const cargas: any[] = [];
  const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      // El servidor también recibe la sonda GET /models que elige el host y la
      // consulta de estado previa al chat: ninguna es una petición de chat.
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'POST') {
        res.end(JSON.stringify(
          req.url === '/api/v0/models'
            ? { data: [{ id: 'qwen2.5-7b', state: 'loaded' }] }
            : { data: [{ id: 'qwen2.5-7b' }] }
        ));
        return;
      }
      if (req.url === '/api/v1/models/load') {
        cargas.push(JSON.parse(raw || '{}'));
        res.end(JSON.stringify({ type: 'llm', instance_id: 'qwen2.5-7b', status: 'loaded' }));
        return;
      }
      recibido.push(JSON.parse(raw || '{}'));
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: 'Voy a leer el README',
            tool_calls: [{ id: 'c1', function: { name: 'fs_read', arguments: '{"path":"README.md"}' } }],
          },
        }],
      }));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()));
  const { port } = fake.address() as any;

  try {
    const res = await srv.request('POST', '/api/lmstudio/generate', {
      prompt: 'hola',
      model: 'lmstudio/qwen2.5-7b',
      host: `http://127.0.0.1:${port}`,
      tools: [{ type: 'function', function: { name: 'fs_read' } }],
    });

    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.success, true);
    assert.equal(res.body.text, 'Voy a leer el README');
    assert.deepEqual(res.body.toolCalls, [{ id: 'c1', name: 'fs_read', args: { path: 'README.md' } }]);
    assert.equal(recibido[0].model, 'qwen2.5-7b');
    assert.equal(recibido[0].tools?.length, 1, 'sin tools el modelo no puede pedir fs.read');
    assert.equal(recibido[0].tool_choice, 'auto');
    assert.deepEqual(cargas, [], 'un modelo ya cargado no se vuelve a cargar');
  } finally {
    fake.close();
  }
});

test('/api/lmstudio/generate carga el modelo antes de generar si aún no está cargado', async () => {
  const cargas: any[] = [];
  const chats: any[] = [];
  const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') {
        res.end(JSON.stringify(
          req.url === '/api/v0/models'
            ? { data: [{ id: 'qwen2.5-7b', state: 'not-loaded', max_context_length: 32_768 }] }
            : { data: [{ id: 'qwen2.5-7b' }] }
        ));
        return;
      }
      if (req.url === '/api/v1/models/load') {
        cargas.push(JSON.parse(raw || '{}'));
        res.end(JSON.stringify({ type: 'llm', instance_id: 'qwen2.5-7b', status: 'loaded' }));
        return;
      }
      chats.push(JSON.parse(raw || '{}'));
      res.end(JSON.stringify({ choices: [{ message: { content: 'Modelo listo' } }] }));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()));
  const { port } = fake.address() as any;

  try {
    const res = await srv.request('POST', '/api/lmstudio/generate', {
      prompt: 'hola',
      model: 'lmstudio/qwen2.5-7b',
      host: `http://127.0.0.1:${port}`,
    });

    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.success, true);
    assert.equal(res.body.text, 'Modelo listo');
    assert.deepEqual(cargas, [{ model: 'qwen2.5-7b', context_length: 32_768 }], 'debe cargar con el contexto real del modelo');
    assert.equal(chats.length, 1);
    assert.equal(chats[0].model, 'qwen2.5-7b');
  } finally {
    fake.close();
  }
});

test('/api/lmstudio/generate devuelve el error de carga y no genera si el modelo no cabe', async () => {
  let chats = 0;
  const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') {
        res.end(JSON.stringify({ data: [{ id: 'qwen2.5-7b', state: 'not-loaded' }] }));
        return;
      }
      if (req.url === '/api/v1/models/load') {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: { message: 'not enough VRAM' } }));
        return;
      }
      chats += 1;
      res.end(JSON.stringify({ choices: [{ message: { content: 'no debería llegar' } }] }));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()));
  const { port } = fake.address() as any;

  try {
    const res = await srv.request('POST', '/api/lmstudio/generate', {
      prompt: 'hola',
      model: 'lmstudio/qwen2.5-7b',
      host: `http://127.0.0.1:${port}`,
    });

    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.ok, false);
    assert.match(String(res.body.error), /qwen2\.5-7b/);
    assert.match(String(res.body.error), /not enough VRAM/);
    assert.equal(chats, 0, 'sin modelo cargado no tiene sentido llamar al chat');
  } finally {
    fake.close();
  }
});

test('/api/lmstudio/generate sigue con el chat si LM Studio no tiene carga explícita', async () => {
  // 0.3.x sólo tiene v0: no existe /api/v1/models/load. El chat puede cargar
  // por JIT, así que un 404 no debe romper la generación.
  let chats = 0;
  const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') {
        res.end(JSON.stringify(
          req.url === '/api/v0/models'
            ? { data: [{ id: 'qwen2.5-7b', state: 'not-loaded', max_context_length: 32_768 }] }
            : { data: [{ id: 'qwen2.5-7b' }] }
        ));
        return;
      }
      if (req.url === '/api/v1/models/load') {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      chats += 1;
      res.end(JSON.stringify({ choices: [{ message: { content: 'Cargado por JIT' } }] }));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()));
  const { port } = fake.address() as any;

  try {
    const res = await srv.request('POST', '/api/lmstudio/generate', {
      prompt: 'hola',
      model: 'lmstudio/qwen2.5-7b',
      host: `http://127.0.0.1:${port}`,
    });

    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.success, true, res.raw);
    assert.equal(res.body.text, 'Cargado por JIT');
    assert.equal(chats, 1);
  } finally {
    fake.close();
  }
});

test('/api/lmstudio/loading informa el error del último intento fallido y lo limpia al reintentar', async () => {
  let loadFails = true;
  const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') {
        res.end(JSON.stringify(
          req.url === '/api/v0/models'
            ? { data: [{ id: 'qwen2.5-7b', state: 'not-loaded', max_context_length: 32_768 }] }
            : { data: [{ id: 'qwen2.5-7b' }] }
        ));
        return;
      }
      if (req.url === '/api/v1/models/load') {
        if (loadFails) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: { message: 'not enough VRAM' } }));
          return;
        }
        res.end(JSON.stringify({ type: 'llm', instance_id: 'qwen2.5-7b', status: 'loaded' }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ message: { content: 'listo' } }] }));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()));
  const { port } = fake.address() as any;

  try {
    const failed = await srv.request('POST', '/api/lmstudio/generate', {
      prompt: 'hola',
      model: 'lmstudio/qwen2.5-7b',
      host: `http://127.0.0.1:${port}`,
    });
    assert.equal(failed.body.ok, false, failed.raw);

    const afterFailure = await srv.request(
      'GET',
      `/api/lmstudio/loading?model=${encodeURIComponent('qwen2.5-7b')}`
    );
    assert.equal(afterFailure.body.loading, false);
    assert.equal(afterFailure.body.model, 'qwen2.5-7b', 'la UI necesita saber a qué modelo culpar');
    assert.match(String(afterFailure.body.error), /not enough VRAM/);
    assert.equal(typeof afterFailure.body.failedAt, 'number');

    // Reintento correcto: el aviso no debe resucitar el fallo viejo.
    loadFails = false;
    const retried = await srv.request('POST', '/api/lmstudio/generate', {
      prompt: 'hola',
      model: 'lmstudio/qwen2.5-7b',
      host: `http://127.0.0.1:${port}`,
    });
    assert.equal(retried.body.success, true, retried.raw);

    const afterRetry = await srv.request(
      'GET',
      `/api/lmstudio/loading?model=${encodeURIComponent('qwen2.5-7b')}`
    );
    assert.equal(afterRetry.body.loading, false);
    assert.equal(afterRetry.body.error, undefined, 'un intento correcto limpia el error anterior');
  } finally {
    fake.close();
  }
});

test('/api/lmstudio/loading refleja la carga en curso y se apaga al terminar', async () => {
  let releaseLoad!: () => void;
  let markLoadStarted!: () => void;
  let loadRequest: any;
  const loadStarted = new Promise<void>((resolve) => { markLoadStarted = resolve; });

  const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') {
        res.end(JSON.stringify(
          req.url === '/api/v0/models'
            ? { data: [{ id: 'qwen2.5-7b', state: 'not-loaded', max_context_length: 32_768 }] }
            : { data: [{ id: 'qwen2.5-7b' }] }
        ));
        return;
      }
      if (req.url === '/api/v1/models/load') {
        loadRequest = JSON.parse(raw || '{}');
        markLoadStarted();
        releaseLoad = () => {
          res.end(JSON.stringify({ type: 'llm', instance_id: 'qwen2.5-7b', status: 'loaded' }));
        };
        return;
      }
      res.end(JSON.stringify({ choices: [{ message: { content: 'listo' } }] }));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()));
  const { port } = fake.address() as any;

  try {
    const generate = srv.request('POST', '/api/lmstudio/generate', {
      prompt: 'hola',
      model: 'lmstudio/qwen2.5-7b',
      host: `http://127.0.0.1:${port}`,
      contextLength: 8192,
    });

    await loadStarted;
    assert.equal(
      loadRequest?.context_length,
      8192,
      'la carga debe pedir el contexto solicitado, no el máximo del modelo'
    );
    const during = await srv.request(
      'GET',
      `/api/lmstudio/loading?model=${encodeURIComponent('qwen2.5-7b')}`
    );
    assert.equal(during.status, 200, during.raw);
    assert.equal(during.body.loading, true, 'la UI necesita saber que la carga sigue en curso');
    assert.equal(during.body.model, 'qwen2.5-7b');
    assert.equal(
      during.body.contextLength,
      8192,
      'el aviso necesita el contexto que se está cargando'
    );

    releaseLoad();
    const done = await generate;
    assert.equal(done.body.success, true, done.raw);

    const after = await srv.request(
      'GET',
      `/api/lmstudio/loading?model=${encodeURIComponent('qwen2.5-7b')}`
    );
    assert.equal(after.body.loading, false, 'al terminar la carga el aviso debe apagarse');
  } finally {
    fake.close();
  }
});
