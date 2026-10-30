/**
 * Endpoints HTTP contra el server real, en un puerto efímero.
 *
 * Cubre los contratos que hasta ahora sólo se probaban a mano con curl:
 *   • `POST /api/threads` exige id (antes nacía un hilo llamado `"undefined"`);
 *   • `POST /api/queue/:threadId` responde 404 si el hilo no existe (antes un
 *     400 con el texto crudo `FOREIGN KEY constraint failed`);
 *   • las rutas autónomas validan su cuerpo antes de gastar una llamada al
 *     LLM: sin `goal` (plan) o sin `parentSessionId` (run) son 400.
 *
 * Los dos últimos casos se paran en la validación a propósito: pasar de ahí
 * significa hablar con el modelo de verdad, y eso no puede vivir en la suite.
 *
 * La gracia del arnés es que ejercita las rutas reales de `server.ts`, no una
 * copia del handler: si alguien vuelve a quitar el guard, esto se pone rojo.
 *
 * Con `npm run test:node` el server es UNO para toda la suite y lo arranca
 * `scripts/test-node.ts` la primera vez que un archivo lo pide (este, vía el
 * canal de control del arnés); con `tsx --test tests/serverEndpoints.test.ts`
 * este archivo arranca el suyo. Los ids son únicos por corrida porque en modo
 * compartido la base también es compartida entre archivos.
 *
 * Las peticiones van por `srv.request`, no por `fetch`: ver el porqué del
 * keep-alive en `tests/helpers/serverHarness.ts`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;

before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

const uniqueId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/**
 * Petición con cabeceras propias. `srv.request` no las acepta y las claves del
 * panel viajan en la cookie, así que aquí se repite el mismo molde del arnés
 * (socket por petición, cuerpo leído entero, 30 s por petición).
 */
function requestConCookie(
  method: string,
  path: string,
  body: unknown,
  cookie: string
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, srv.baseUrl);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        agent: false,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
          Cookie: cookie,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: any = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
          resolve({ status: res.statusCode ?? 0, body: parsed, raw });
        });
      }
    );
    req.setTimeout(30_000, () => req.destroy(new Error('sin respuesta del server en 30s')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('la base del arnés es temporal: los tests no tocan la del proyecto', () => {
  assert.ok(srv.dbPath, 'el arnés debe declarar la base que está usando');
  assert.ok(
    srv.dbPath.startsWith(os.tmpdir()),
    `la base debe vivir en el temporal, no en el proyecto: ${srv.dbPath}`
  );
  assert.notEqual(path.resolve(srv.dbPath), path.resolve('.commander', 'studio.db'));
});

test('POST /api/threads sin id responde 400 y no crea un hilo "undefined"', async () => {
  const res = await srv.request('POST', '/api/threads', { title: 'sin id' });

  assert.equal(res.status, 400, `se esperaba 400, llegó ${res.status}: ${res.raw}`);
  assert.equal(res.body.success, false);
  assert.match(String(res.body.error), /id de hilo requerido/);

  const all = await srv.request('GET', '/api/threads');
  assert.equal(all.status, 200);
  assert.equal(
    (all.body.threads as any[]).some((t) => t.id === 'undefined'),
    false,
    'ninguna petición sin id debe dejar un hilo con ese nombre'
  );
});

test('un hilo se crea, encola y se borra con su cola en cascada', async () => {
  const id = uniqueId('http-th');

  const created = await srv.request('POST', '/api/threads', { id, title: 'hilo de prueba' });
  assert.equal(created.status, 200, created.raw);
  assert.equal(created.body.thread.id, id);
  assert.equal(created.body.thread.title, 'hilo de prueba');

  const queued = await srv.request('POST', `/api/queue/${id}`, { prompt: 'tarea válida', label: 'ok' });
  assert.equal(queued.status, 200, queued.raw);
  assert.equal(queued.body.item.state, 'pending', 'lo encolado nace pendiente');
  assert.equal(queued.body.item.thread_id, id);

  const list = await srv.request('GET', `/api/queue/${id}`);
  assert.equal(list.body.items.length, 1);

  const removed = await srv.request('DELETE', `/api/threads/${id}`);
  assert.equal(removed.status, 200);

  const after = await srv.request('GET', `/api/queue/${id}`);
  assert.equal(after.body.items.length, 0, 'borrar el hilo se lleva su cola');
});

test('POST /api/autonomous/:threadId/plan sin goal responde 400 sin llamar al modelo', async () => {
  const thread = uniqueId('http-auto-plan');
  const res = await srv.request('POST', `/api/autonomous/${thread}/plan`, { parentSessionId: 'sess-x' });

  assert.equal(res.status, 400, `se esperaba 400, llegó ${res.status}: ${res.raw}`);
  assert.equal(res.body.success, false);
  assert.match(String(res.body.error), /goal requerido/);

  // Un goal de sólo espacios pasa el `if (!goal)` de un string crudo, pero el
  // `trim()` del handler lo deja vacío: mismo 400, sin plan ni tareas.
  const blank = await srv.request('POST', `/api/autonomous/${thread}/plan`, { goal: '   ' });
  assert.equal(blank.status, 400, `un goal en blanco también es 400, llegó ${blank.status}: ${blank.raw}`);
  assert.match(String(blank.body.error), /goal requerido/);

  const queue = await srv.request('GET', `/api/queue/${thread}`);
  assert.equal(queue.body.items.length, 0, 'un rechazo no debe encolar nada');
});

test('POST /api/autonomous/:threadId/run sin parentSessionId responde 400', async () => {
  const thread = uniqueId('http-auto-run');
  const res = await srv.request('POST', `/api/autonomous/${thread}/run`, { goal: 'objetivo' });

  assert.equal(res.status, 400, `se esperaba 400, llegó ${res.status}: ${res.raw}`);
  assert.equal(res.body.success, false);
  assert.match(String(res.body.error), /parentSessionId requerido/);
  // Si el guard faltara, la ruta respondería 200 `started: true` y la campaña
  // correría en segundo plano sin sesión padre: el test no vería el fallo.
  assert.equal(res.body.started, undefined, 'no debe haberse lanzado una campaña');
});

test('POST /api/queue de un hilo inexistente responde 404, no un FOREIGN KEY', async () => {
  const ghost = uniqueId('http-fantasma');
  const res = await srv.request('POST', `/api/queue/${ghost}`, { prompt: 'tarea huérfana' });

  assert.equal(res.status, 404, `se esperaba 404, llegó ${res.status}: ${res.raw}`);
  assert.equal(res.body.success, false);
  assert.match(String(res.body.error), /hilo no encontrado/);
  assert.doesNotMatch(String(res.body.error), /FOREIGN KEY/i);

  const list = await srv.request('GET', `/api/queue/${ghost}`);
  assert.equal(list.body.items.length, 0, 'no debe quedar nada encolado');
});

test('las sesiones de agente se crean, listan y borran', async () => {
  const sinGoal = await srv.request('POST', '/api/agent/sessions', {});
  assert.equal(sinGoal.status, 400, sinGoal.raw);
  assert.match(String(sinGoal.body.error), /goal requerido/);

  const creada = await srv.request('POST', '/api/agent/sessions', { goal: 'revisar el diff', maxSteps: 5 });
  assert.equal(creada.status, 200, creada.raw);
  const id = creada.body.session.id;
  assert.ok(id, 'la respuesta trae el id que usará spawn_agents');
  assert.equal(creada.body.session.status, 'idle', 'crear la sesión no arranca el bucle del LLM');

  const lista = await srv.request('GET', '/api/agent/sessions');
  assert.equal(lista.status, 200, lista.raw);
  const item = (lista.body.sessions as any[]).find((s) => s.id === id);
  assert.ok(item, 'la sesión creada aparece en el registro');
  assert.ok(item.createdAt > 0, 'createdAt sirve para ordenar; antes era siempre 0');

  const borrada = await srv.request('DELETE', `/api/agent/sessions/${id}`);
  assert.equal(borrada.status, 200, borrada.raw);
  const otraVez = await srv.request('DELETE', `/api/agent/sessions/${id}`);
  assert.equal(otraVez.status, 404, 'borrar dos veces no finge éxito');

  const despues = await srv.request('GET', '/api/agent/sessions');
  assert.equal((despues.body.sessions as any[]).some((s) => s.id === id), false);
});

test('spawn_agents encuentra la sesión padre que crea el bootstrap', async () => {
  const creada = await srv.request('POST', '/api/agent/sessions', { goal: 'padre de subagentes', maxSteps: 3 });
  assert.equal(creada.status, 200, creada.raw);
  const id = creada.body.session.id;

  // Sin agentes responde 400, y sólo llega ahí si el padre existe: con un id
  // inventado el handler muere antes, con 404.
  const vacio = await srv.request('POST', '/api/agent/run-tool', {
    toolId: 'spawn_agents',
    input: { parentSessionId: id, agents: [] },
  });
  assert.equal(vacio.status, 400, `el padre debe existir: ${vacio.raw}`);
  assert.match(String(vacio.body.error), /agents requerido/);

  const fantasma = await srv.request('POST', '/api/agent/run-tool', {
    toolId: 'spawn_agents',
    input: { parentSessionId: 'sesion-que-no-existe', agents: [] },
  });
  assert.equal(fantasma.status, 404, fantasma.raw);
  assert.match(String(fantasma.body.error), /Sesión padre no encontrada/);

  await srv.request('DELETE', `/api/agent/sessions/${id}`);
});

test('GET /api/agent/sessions/:id/subagents expone los hijos del padre', async () => {
  const creada = await srv.request('POST', '/api/agent/sessions', { goal: 'padre del panel', maxSteps: 3 });
  assert.equal(creada.status, 200, creada.raw);
  const id = creada.body.session.id;

  // Sin hijos todavía: lista vacía, no 404 (el panel sondea desde el minuto uno).
  const vacio = await srv.request('GET', `/api/agent/sessions/${id}/subagents`);
  assert.equal(vacio.status, 200, vacio.raw);
  assert.deepEqual(vacio.body.subagents, []);

  const fantasma = await srv.request('GET', '/api/agent/sessions/sesion-que-no-existe/subagents');
  assert.equal(fantasma.status, 404, fantasma.raw);
  assert.match(String(fantasma.body.error), /sesión no encontrada/);

  // Al borrar el padre, su endpoint deja de existir: no se muestran huérfanos.
  const borrada = await srv.request('DELETE', `/api/agent/sessions/${id}`);
  assert.equal(borrada.status, 200, borrada.raw);
  const despues = await srv.request('GET', `/api/agent/sessions/${id}/subagents`);
  assert.equal(despues.status, 404, despues.raw);
});

test('GET /api/agent/sessions/:id/events abre un SSE con el estado inicial', async () => {
  const creada = await srv.request('POST', '/api/agent/sessions', { goal: 'padre del stream', maxSteps: 3 });
  assert.equal(creada.status, 200, creada.raw);
  const id = creada.body.session.id;

  const fantasma = await srv.request('GET', '/api/agent/sessions/sesion-que-no-existe/events');
  assert.equal(fantasma.status, 404, 'sin sesión no hay stream que abrir');

  // SSE no termina nunca: se corta en cuanto llega el primer evento (el estado
  // que ya había al conectar), que es justo lo que usa el panel al montarse.
  const primerEvento = await new Promise<string>((resolve, reject) => {
    const req = http.get(`${srv.baseUrl}/api/agent/sessions/${id}/events`, (res) => {
      try {
        assert.equal(String(res.headers['content-type']), 'text/event-stream');
      } catch (e) { reject(e); return; }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        if (buf.includes('\n\n')) { req.destroy(); resolve(buf); }
      });
    });
    req.on('error', (e: any) => {
      // Destruir el socket a propósito también emite error: ya hay respuesta.
      if (String(e?.code) !== 'ECONNRESET') reject(e);
    });
    setTimeout(() => { req.destroy(); reject(new Error('el stream no mandó el estado inicial')); }, 10_000).unref();
  });

  assert.match(primerEvento, /event: subagents/);
  assert.match(primerEvento, /"subagents":\[\]/);

  await srv.request('DELETE', `/api/agent/sessions/${id}`);
});

test('el stream SSE se cierra cuando se borra la sesión padre', async () => {
  const creada = await srv.request('POST', '/api/agent/sessions', { goal: 'padre que se borra', maxSteps: 2 });
  assert.equal(creada.status, 200, creada.raw);
  const id = creada.body.session.id;

  const resultado = await new Promise<{ texto: string; termino: boolean }>((resolve, reject) => {
    let borrando = false;
    const req = http.get(`${srv.baseUrl}/api/agent/sessions/${id}/events`, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        // Con el stream ya abierto se borra el padre: el servidor tiene que
        // avisar y cerrar en vez de dejar el socket abierto y mudo.
        if (!borrando && buf.includes('event: subagents')) {
          borrando = true;
          void srv.request('DELETE', `/api/agent/sessions/${id}`);
        }
      });
      res.on('end', () => resolve({ texto: buf, termino: true }));
    });
    req.on('error', reject);
    setTimeout(() => {
      req.destroy();
      reject(new Error('el stream no se cerró tras borrar la sesión padre'));
    }, 10_000).unref();
  });

  assert.equal(resultado.termino, true);
  assert.match(resultado.texto, /event: gone/);
});

test('POST /api/worktrees valida y aplica permisos antes de crear nada', async () => {
  // Crear un worktree hace `git worktree add`, copia .env y corre `npm install`:
  // la ruta pasa por los mismos permisos que las tools. Los dos casos de abajo
  // mueren antes de tocar git, así que no dejan worktrees ni ramas sueltas.
  const sinProyecto = await srv.request('POST', '/api/worktrees', { threadId: 'th-sin-proyecto' });
  assert.equal(sinProyecto.status, 400, `se esperaba 400, llegó ${sinProyecto.status}: ${sinProyecto.raw}`);
  assert.equal(sinProyecto.body.success, false);

  const fuera = await srv.request('POST', '/api/worktrees', {
    threadId: 'th-fuera',
    projectPath: path.join(os.tmpdir(), 'no-es-un-proyecto'),
  });
  assert.equal(fuera.status, 400, `una ruta fuera de los roots no puede gobernar un worktree: ${fuera.raw}`);
  assert.match(String(fuera.body.error), /No existe|fuera de los proyectos|Path requerido/i);
});

test('la clave y la base guardadas en el panel llegan al proxy de Freebuff', async () => {
  // El panel guarda las claves en cookies httpOnly con `POST /api/keys`; acá se
  // mandan directamente, que es lo que el navegador haría después. Se apunta el
  // destino a un upstream local para ver de verdad con qué clave sale la
  // petición, sin red externa ni créditos. Sin el middleware montado en /api,
  // el handler no ve la cookie y responde FREEBUFF_API_KEY requerida.
  const recibido: { auth?: string; body: any }[] = [];
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      recibido.push({ auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'gemini-4-argon', choices: [{ message: { content: 'hecho' } }] }));
    });
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));

  try {
    const port = (upstream.address() as any).port;
    const cookie = [
      `ai_studio_FREEBUFF_API_KEY=${encodeURIComponent('fb-del-panel')}`,
      `ai_studio_FREEBUFF_BASE_URL=${encodeURIComponent(`http://127.0.0.1:${port}`)}`,
    ].join('; ');

    const res = await requestConCookie(
      'POST',
      '/api/freebuff/generate',
      { prompt: 'hola', model: 'freebuff/gemini-4-argon' },
      cookie
    );

    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.success, true, `el proxy debía autenticarse con la clave del panel: ${res.raw}`);
    assert.equal(res.body.text, 'hecho');
    assert.equal(recibido.length, 1, 'una sola llamada al upstream');
    assert.equal(recibido[0].auth, 'Bearer fb-del-panel', 'la clave de la cookie llegó al proveedor');
    assert.equal(recibido[0].body.model, 'gemini-4-argon', 'el prefijo freebuff/ se quita antes de salir');
  } finally {
    await new Promise<void>((r) => upstream.close(() => r()));
  }
});
