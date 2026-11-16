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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer, type ServerHarness } from './helpers/serverHarness.js';
import { setPermissions } from '../permissions.js';

let srv: ServerHarness;

/**
 * Root temporal de los casos de `run-tool`.
 *
 * Sin `root`, el endpoint usa los permisos del repo: un `allowedTools`
 * guardado (o globs) tumbaba el control de lectura aunque el guard de secretos
 * funcionara. El package.json mínimo conserva el contrato de "archivo normal"
 * sin depender de la configuración local de nadie.
 */
const PERMS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tool-root-'));
fs.writeFileSync(path.join(PERMS_ROOT, 'package.json'), '{"name":"commander-test"}\n', 'utf8');
setPermissions(PERMS_ROOT, {
  mode: 'build',
  allowedTools: null,
  deniedTools: [],
  files: { read: [], write: [] },
});

before(async () => { srv = await startServer(); });
after(async () => {
  await srv?.stop();
  fs.rmSync(PERMS_ROOT, { recursive: true, force: true });
});

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
  cookie: string,
  extra: Record<string, string> = {}
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
          ...(cookie ? { Cookie: cookie } : {}),
          ...extra,
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

test('PATCH /api/threads/:id renombra y fija sin tocar el resto del hilo', async () => {
  const id = uniqueId('http-patch');
  const created = await srv.request('POST', '/api/threads', { id, title: 'viejo', projectPath: '/tmp/proyecto-patch' });
  assert.equal(created.status, 200, created.raw);

  const renamed = await srv.request('PATCH', '/api/threads/' + id, { title: '  nuevo nombre  ' });
  assert.equal(renamed.status, 200, renamed.raw);
  assert.equal(renamed.body.thread.title, 'nuevo nombre', 'el título se recorta');
  assert.equal(renamed.body.thread.pinned, 0, 'renombrar no fija el hilo');

  const pinned = await srv.request('PATCH', '/api/threads/' + id, { pinned: true });
  assert.equal(pinned.status, 200, pinned.raw);
  assert.equal(pinned.body.thread.pinned, 1);
  assert.equal(pinned.body.thread.title, 'nuevo nombre', 'fijar no pierde el título');

  // Un PATCH vacío no debe llegar a un UPDATE sin columnas.
  const empty = await srv.request('PATCH', '/api/threads/' + id, {});
  assert.equal(empty.status, 400, empty.raw);
  assert.match(String(empty.body.error), /nada que actualizar/);

  // Título en blanco: 400 y el hilo conserva el suyo.
  const blank = await srv.request('PATCH', '/api/threads/' + id, { title: '   ' });
  assert.equal(blank.status, 400, blank.raw);
  const still = await srv.request('GET', '/api/threads/' + id);
  assert.equal(still.body.thread.title, 'nuevo nombre');

  const missing = await srv.request('PATCH', '/api/threads/no-existe-este-hilo', { title: 'x' });
  assert.equal(missing.status, 404, missing.raw);

  await srv.request('DELETE', '/api/threads/' + id);
});

test('GET /api/threads lista primero los fijados y filtra por projectPath', async () => {
  const a = uniqueId('http-pin-a');
  const b = uniqueId('http-pin-b');
  const projectPath = '/tmp/proyecto-' + a; // única por corrida: la base es compartida

  await srv.request('POST', '/api/threads', { id: a, title: 'a', projectPath });
  await srv.request('POST', '/api/threads', { id: b, title: 'b', projectPath });
  await srv.request('PATCH', '/api/threads/' + b, { pinned: true });

  const filtered = await srv.request('GET', '/api/threads?projectPath=' + encodeURIComponent(projectPath));
  assert.equal(filtered.status, 200, filtered.raw);
  const ids = (filtered.body.threads as any[]).map((t) => t.id);
  assert.deepEqual(ids, [b, a], 'el fijado va primero y sólo salen los del proyecto');

  const other = await srv.request('GET', '/api/threads?projectPath=' + encodeURIComponent(projectPath + '-otro'));
  assert.deepEqual((other.body.threads as any[]).map((t: any) => t.id), [], 'otra ruta no ve estos hilos');

  await srv.request('DELETE', '/api/threads/' + a);
  await srv.request('DELETE', '/api/threads/' + b);
});

test('GET /api/threads incluye el remoto normalizado del proyecto', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-remote-'));
  const id = uniqueId('http-remote');
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:Owner/Repo.git'], {
      cwd: dir,
      stdio: 'ignore',
    });
    await srv.request('POST', '/api/threads', { id, title: 'remoto', projectPath: dir });

    const list = await srv.request('GET', '/api/threads?projectPath=' + encodeURIComponent(dir));
    const thread = (list.body.threads as any[]).find((t) => t.id === id);
    assert.equal(thread?.git_remote, 'github.com/owner/repo');
  } finally {
    await srv.request('DELETE', '/api/threads/' + id);
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

test('POST /api/agent/run-tool niega fs.read y fs.grep sobre archivos de secretos', async () => {
  // El predicado se prueba suelto en `tests/security.test.ts` y el ejecutor en
  // `tests/agentTools.test.ts`. Falta el camino que usa el agente de verdad:
  // `src/agent/tools/fs.ts` hace este mismo POST con `{toolId, input}`, así que
  // aquí se cubren la ruta, la puerta de `AGENT_TOOLS` y el mapeo del `status`
  // del ejecutor a HTTP. Quitar el guard del endpoint deja esto rojo; quitarlo
  // de `executeAgentTool` también.
  //
  // Las rutas ni siquiera existen en el repo: la comprobación de sensibilidad va
  // antes que la de existencia y que la de permisos, así que el 403 sólo puede
  // venir del guard. Con un archivo real, un verde también sería compatible con
  // "el archivo no estaba".
  const casos: Array<{ toolId: string; input: Record<string, unknown>; porque: string }> = [
    { toolId: 'fs.read', input: { path: '.env', root: PERMS_ROOT }, porque: 'las claves del proyecto' },
    { toolId: 'fs.read', input: { path: '.ssh/id_ed25519', root: PERMS_ROOT }, porque: 'una clave privada' },
    { toolId: 'fs.grep', input: { pattern: 'API_KEY', path: '.env', root: PERMS_ROOT }, porque: 'buscar dentro del .env' },
    { toolId: 'fs.grep', input: { pattern: 'PRIVATE', path: 'certs/server.pem', root: PERMS_ROOT }, porque: 'un certificado' },
  ];

  for (const caso of casos) {
    const res = await srv.request('POST', '/api/agent/run-tool', { toolId: caso.toolId, input: caso.input });
    const etiqueta = `${caso.toolId} ${JSON.stringify(caso.input)}`;
    assert.equal(res.status, 403, `${etiqueta} debía ser 403 (${caso.porque}): ${res.raw}`);
    assert.equal(res.body.ok, false, `${etiqueta} no puede devolver ok:true`);
    assert.match(String(res.body.error), /sensible/i, `${etiqueta} debe explicar el motivo`);
    assert.doesNotMatch(String(res.body.error), /No existe/i, `${etiqueta}: el guard va antes de mirar si existe`);
  }

  // Control: las mismas dos tools sobre un archivo normal funcionan. Sin esto,
  // un 403 por una ruta mal montada pasaría como si el filtro hiciera su trabajo.
  const lectura = await srv.request('POST', '/api/agent/run-tool', {
    toolId: 'fs.read',
    input: { path: 'package.json', root: PERMS_ROOT },
  });
  assert.equal(lectura.status, 200, lectura.raw);
  assert.equal(lectura.body.ok, true);
  assert.match(String(lectura.body.data.content), /"name"/);

  const busqueda = await srv.request('POST', '/api/agent/run-tool', {
    toolId: 'fs.grep',
    input: { pattern: '"name"', path: 'package.json', root: PERMS_ROOT },
  });
  assert.equal(busqueda.status, 200, busqueda.raw);
  assert.equal(busqueda.body.ok, true);
  assert.ok((busqueda.body.data.matches as any[]).length > 0, 'grep debe encontrar el campo de package.json');
});

test('POST /api/agent/sessions/:id/cancel para los hijos y dice cuántos paró', async () => {
  const creada = await srv.request('POST', '/api/agent/sessions', { goal: 'padre cancelable', maxSteps: 3 });
  assert.equal(creada.status, 200, creada.raw);
  const id = creada.body.session.id;

  // Sin hijos en marcha no hay nada que cancelar, y eso no es un error: el
  // botón puede pulsarse cuando la tanda ya acabó sola.
  const vacio = await srv.request('POST', `/api/agent/sessions/${id}/cancel`, {});
  assert.equal(vacio.status, 200, vacio.raw);
  assert.equal(vacio.body.cancelled, 0);
  assert.deepEqual(vacio.body.ids, []);

  const fantasma = await srv.request('POST', '/api/agent/sessions/sesion-que-no-existe/cancel', {});
  assert.equal(fantasma.status, 404, 'una sesión que no existe no se cancela a ciegas');
  assert.match(String(fantasma.body.error), /sesión no encontrada/);

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

test('Strata local detecta /v1/models y enruta su prefijo por el contrato OpenAI', async () => {
  // El host real no se levanta en la suite: un upstream efímero comprueba el
  // contrato de las rutas (health, modelos y generación) sin depender de que
  // Strata esté instalado o de una clave real.
  const recibido: Array<{ method?: string; auth?: string; body?: any }> = [];
  let queueAttempts = 0;
  let queueStreamAttempts = 0;
  let timeoutAttempts = 0;
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : null;
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const lastMessage = messages[messages.length - 1];
      const prompt = String(lastMessage?.content || body?.prompt || '');
      recibido.push({
        method: req.method,
        auth: req.headers.authorization,
        ...(body ? { body } : {}),
      });
      if (req.headers.authorization === 'Bearer clave-mala') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
        return;
      }
      const withoutTools = req.headers.authorization === 'Bearer clave-sin-tools';
      if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            engine: { model: 'strata-demo', max_context: 32768 },
            live: {
              state: 'idle',
              queued: 0,
              prompt_tokens: 1200,
              generated: 4,
              tok_s: 12.5,
              slots: [{ slot: 0, prompt_tokens: 1200, tok_s: 12.5 }],
            },
            hardware: {
              gpu_util: 35,
              gpu_temp: 48,
              gpu_power: 75,
              gpu_mem_used: 8 * 2 ** 30,
              gpu_mem_total: 24 * 2 ** 30,
              ram_used: 16 * 2 ** 30,
              ram_total: 64 * 2 ** 30,
            },
            hardware_static: { gpu_name: 'NVIDIA RTX de prueba' },
            totals: { requests: 2 },
          })
        );
        return;
      }
      if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ busy: false, queued: 0, phase: 'idle', prompt_tokens: 1200 }));
        return;
      }
      if (req.url === '/v1/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            service: 'strata',
            loaded: req.headers.authorization !== 'Bearer clave-modelo',
            model: withoutTools ? 'strata-sin-tools' : 'strata-demo',
            context: { native: 32768 },
            dialects: ['openai'],
          })
        );
        return;
      }
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: withoutTools
              ? [
                  {
                    id: 'strata-sin-tools',
                    object: 'model',
                    status: { value: 'loaded' },
                    meta: { n_ctx: 32768 },
                    capabilities: { tool_calls: false },
                  },
                ]
              : [
                  {
                    id: 'strata-demo',
                    object: 'model',
                    status: { value: 'loaded' },
                    meta: { n_ctx: 32768 },
                    architecture: { input_modalities: ['text', 'image'] },
                    capabilities: { tool_calls: true, parallel_tool_calls: false },
                  },
                  { id: 'strata-demo-alias', alias_of: 'strata-demo' },
                ],
          })
        );
        return;
      }
      if (req.url === '/v1/chat/completions' && prompt.includes('__strata_tools_bad')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    { id: 'call-bad', type: 'function', function: { name: 'fs.read', arguments: '{"path":' } },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          })
        );
        return;
      }
      if (req.url === '/v1/chat/completions' && prompt.includes('__strata_tools_multi')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call-read',
                      type: 'function',
                      function: { name: 'fs.read', arguments: '{"path":"src/index.ts"}' },
                    },
                    {
                      id: 'call-status',
                      type: 'function',
                      function: { name: 'git.status', arguments: '{"short":true}' },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          })
        );
        return;
      }
      if (req.url === '/v1/chat/completions' && prompt.includes('__strata_tools_stream_bad')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'call-bad', function: { name: 'fs.read', arguments: '{"path":' } },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          })}\n\n`
        );
        res.end('data: [DONE]\n\n');
        return;
      }
      if (req.url === '/v1/chat/completions' && prompt.includes('__strata_tools_stream')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'call-read', function: { name: 'fs.', arguments: '{"pa' } },
                  ],
                },
              },
            ],
          })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { name: 'read', arguments: 'th":"src/index.ts"}' } },
                    { index: 1, id: 'call-status', function: { name: 'git.status', arguments: '{"short":true}' } },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          })}\n\n`
        );
        res.end('data: [DONE]\n\n');
        return;
      }
      if (req.url === '/v1/chat/completions' && prompt.includes('__strata_context')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'context length exceeded: 40000 > 32768' } }));
        return;
      }
      if (req.url === '/v1/chat/completions' && prompt.includes('__strata_queue_stream')) {
        queueStreamAttempts += 1;
        if (queueStreamAttempts === 1) {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
          res.end(JSON.stringify({ error: { message: 'queue is full' } }));
          return;
        }
      }
      if (
        req.url === '/v1/chat/completions' &&
        prompt.includes('__strata_queue') &&
        !prompt.includes('__strata_queue_stream')
      ) {
        queueAttempts += 1;
        if (queueAttempts === 1) {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
          res.end(JSON.stringify({ error: { message: 'queue is full' } }));
          return;
        }
      }
      if (req.url === '/v1/chat/completions' && prompt.includes('__strata_timeout')) {
        timeoutAttempts += 1;
        if (timeoutAttempts === 1) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'request timeout' } }));
          return;
        }
      }
      if (req.url === '/v1/chat/completions' && body?.stream === true) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hola ' } }] })}\n\n`);
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: 'desde Strata' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
          })}\n\n`
        );
        res.end('data: [DONE]\n\n');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: 'hola desde Strata' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        })
      );
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));

  try {
    const baseURL = `http://127.0.0.1:${(upstream.address() as any).port}/v1`;
    const tools = [
      {
        type: 'function',
        function: {
          name: 'fs.read',
          parameters: {
            type: 'object',
            required: ['path'],
            properties: { path: { type: 'string' } },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git.status',
          parameters: { type: 'object', properties: { short: { type: 'boolean' } } },
        },
      },
    ];

    const health = await srv.request('POST', '/api/strata-local/health', {
      baseUrl: baseURL,
      apiKey: 'clave-strata',
    });
    assert.equal(health.status, 200, health.raw);
    assert.equal(health.body.ok, true, health.raw);
    assert.equal(health.body.status, 'ok');
    assert.deepEqual(health.body.models, ['strata-demo']);
    assert.equal(health.body.identity, 'verified');
    assert.equal(health.body.loaded, true);
    assert.equal(health.body.model, 'strata-demo');
    assert.equal(health.body.contextWindow, 32768);
    assert.equal(health.body.entries[0]?.contextWindow, 32768);
    assert.equal(recibido[0]?.auth, 'Bearer clave-strata');

    const models = await srv.request('POST', '/api/strata-local/models', { baseUrl: baseURL });
    assert.equal(models.status, 200, models.raw);
    assert.equal(models.body.success, true, models.raw);
    assert.deepEqual(models.body.models, ['strata-demo']);

    const runtime = await srv.request('POST', '/api/strata-local/runtime', { baseUrl: baseURL });
    assert.equal(runtime.body.model, 'strata-demo');
    assert.equal(runtime.body.runtime.instances[0].model, 'strata-demo');
    assert.equal(runtime.body.monitor.context.usedTokens, 1200);
    assert.equal(runtime.body.monitor.context.maxTokens, 32768);
    assert.equal(runtime.body.monitor.hardware.vramUsedGb, 8);
    assert.equal(runtime.body.monitor.hardware.vramTotalGb, 24);
    assert.equal(runtime.body.monitor.hardware.gpuName, 'NVIDIA RTX de prueba');
    assert.equal(runtime.body.monitor.generation.tokS, 12.5);

    const generate = await srv.request('POST', '/api/strata-local/generate', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-demo',
      prompt: 'hola',
      messages: [
        { role: 'system', content: 'eres local' },
        { role: 'user', content: 'antes' },
        { role: 'assistant', content: 'respuesta anterior' },
        { role: 'user', content: 'hola' },
      ],
      maxTokens: 64,
    });
    assert.equal(generate.status, 200, generate.raw);
    assert.equal(generate.body.success, true, generate.raw);
    assert.equal(generate.body.text, 'hola desde Strata');
    assert.ok(generate.body.metrics.latencyMs >= 0);
    const completion = recibido.find((entry) => entry.method === 'POST');
    assert.equal(completion?.auth, 'Bearer clave-strata');
    assert.equal(completion?.body?.model, 'strata-demo', 'el prefijo strata-local/ no sale hacia el host');
    assert.equal(completion?.body?.messages?.length, 4, 'la ruta local conserva el historial');
    assert.equal(completion?.body?.messages?.[1]?.content, 'antes');

    // Si el selector apunta a otro modelo, el host no debe recibir la petición:
    // Strata sólo mantiene cargado el modelo que confirma `/v1/status`.
    const wrongModel = await srv.request('POST', '/api/strata-local/generate', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-otro',
      prompt: 'no debe salir',
    });
    assert.equal(wrongModel.status, 409, wrongModel.raw);
    assert.equal(wrongModel.body.code, 'STRATA_MODEL_MISMATCH');
    assert.equal(wrongModel.body.activeModel, 'strata-demo');
    assert.equal(wrongModel.body.requestedModel, 'strata-otro');
    assert.ok(
      !recibido.some((entry) => entry.method === 'POST' && entry.body?.model === 'strata-otro'),
      'el modelo equivocado no debe llegar a /chat/completions'
    );

    const wrongStream = await srv.request('POST', '/api/strata-local/stream', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-otro',
      prompt: 'no debe salir',
    });
    assert.equal(wrongStream.status, 409, wrongStream.raw);
    assert.equal(wrongStream.body.code, 'STRATA_MODEL_MISMATCH');

    // Cada fallo se distingue con un código estable, sin depender del texto
    // libre del host. La clave inválida y el modelo sin cargar se detectan en
    // el preflight, antes de enviar el turno a `/chat/completions`.
    const invalidKey = await srv.request('POST', '/api/strata-local/generate', {
      baseURL,
      apiKey: 'clave-mala',
      model: 'strata-local/strata-demo',
      prompt: 'no debe salir con clave mala',
    });
    assert.equal(invalidKey.status, 401, invalidKey.raw);
    assert.equal(invalidKey.body.code, 'STRATA_INVALID_API_KEY');
    assert.equal(invalidKey.body.retryable, false);
    assert.ok(
      !recibido.some((entry) => entry.method === 'POST' && entry.body?.messages?.[0]?.content === 'no debe salir con clave mala'),
      'la clave inválida no debe llegar a /chat/completions'
    );

    const notLoaded = await srv.request('POST', '/api/strata-local/generate', {
      baseURL,
      apiKey: 'clave-modelo',
      model: 'strata-local/strata-demo',
      prompt: 'no debe salir sin modelo',
    });
    assert.equal(notLoaded.status, 409, notLoaded.raw);
    assert.equal(notLoaded.body.code, 'STRATA_MODEL_NOT_LOADED');
    assert.equal(notLoaded.body.retryable, false);

    const contextExceeded = await srv.request('POST', '/api/strata-local/generate', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-demo',
      prompt: '__strata_context: historial enorme',
    });
    assert.equal(contextExceeded.status, 413, contextExceeded.raw);
    assert.equal(contextExceeded.body.code, 'STRATA_CONTEXT_EXCEEDED');
    assert.equal(contextExceeded.body.retryable, false);

    // Un modelo que declara `tool_calls: false` no recibe el esquema de tools.
    const toolsUnsupported = await srv.request('POST', '/api/strata-local/generate', {
      baseURL,
      apiKey: 'clave-sin-tools',
      model: 'strata-local/strata-sin-tools',
      prompt: '__strata_tools_unsupported: no debe salir',
      tools,
    });
    assert.equal(toolsUnsupported.status, 422, toolsUnsupported.raw);
    assert.equal(toolsUnsupported.body.code, 'STRATA_TOOLS_UNSUPPORTED');
    assert.ok(
      !recibido.some(
        (entry) =>
          entry.method === 'POST' &&
          entry.body?.messages?.[0]?.content === '__strata_tools_unsupported: no debe salir'
      ),
      'no debe enviarse un esquema de tools a un modelo que no las soporta'
    );

    const multipleTools = await srv.request('POST', '/api/strata-local/generate', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-demo',
      prompt: '__strata_tools_multi: usa dos herramientas',
      tools,
    });
    assert.equal(multipleTools.status, 200, multipleTools.raw);
    assert.deepEqual(multipleTools.body.toolCalls, [
      { id: 'call-read', name: 'fs.read', args: { path: 'src/index.ts' } },
      { id: 'call-status', name: 'git.status', args: { short: true } },
    ]);
    const multiRequest = recibido.find(
      (entry) =>
        entry.method === 'POST' &&
        entry.body?.messages?.[0]?.content === '__strata_tools_multi: usa dos herramientas'
    );
    assert.equal(multiRequest?.body?.parallel_tool_calls, false);

    const malformedTools = await srv.request('POST', '/api/strata-local/generate', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-demo',
      prompt: '__strata_tools_bad: argumentos rotos',
      tools,
    });
    assert.equal(malformedTools.status, 422, malformedTools.raw);
    assert.equal(malformedTools.body.code, 'STRATA_TOOL_ARGUMENTS_INVALID');
    assert.equal(malformedTools.body.retryable, false);

    const fragmentedTools = await srv.request('POST', '/api/strata-local/stream', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-demo',
      prompt: '__strata_tools_stream: dos llamadas fragmentadas',
      tools,
      maxTokens: 64,
    });
    assert.equal(fragmentedTools.status, 200, fragmentedTools.raw);
    const fragmentedDone = fragmentedTools.raw
      .split('\n\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
      .map((line) => JSON.parse(line.slice(6)))
      .find((chunk) => chunk.type === 'done');
    assert.ok(fragmentedDone, 'el stream debe cerrar con un done');
    assert.deepEqual(fragmentedDone.toolCalls, [
      { id: 'call-read', name: 'fs.read', args: { path: 'src/index.ts' } },
      { id: 'call-status', name: 'git.status', args: { short: true } },
    ]);

    const malformedStream = await srv.request('POST', '/api/strata-local/stream', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-demo',
      prompt: '__strata_tools_stream_bad: una llamada rota',
      tools,
      maxTokens: 64,
    });
    assert.equal(malformedStream.status, 200, malformedStream.raw);
    assert.match(malformedStream.raw, /"type":"error"/);
    assert.match(malformedStream.raw, /STRATA_TOOL_ARGUMENTS_INVALID/);
    assert.doesNotMatch(malformedStream.raw, /"type":"done"/);

    // La cola ocupada y el timeout se reintentan una vez; el cliente recibe
    // una sola respuesta, no dos turnos duplicados.
    const queueBusy = await srv.request('POST', '/api/strata-local/generate', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-demo',
      prompt: '__strata_queue: espera un turno',
    });
    assert.equal(queueBusy.status, 200, queueBusy.raw);
    assert.equal(queueBusy.body.text, 'hola desde Strata');
    assert.equal(
      recibido.filter((entry) => entry.method === 'POST' && entry.body?.messages?.[0]?.content === '__strata_queue: espera un turno').length,
      2,
      'la cola ocupada se reintenta exactamente una vez'
    );

    const timeout = await srv.request('POST', '/api/strata-local/generate', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-demo',
      prompt: '__strata_timeout: espera un turno',
    });
    assert.equal(timeout.status, 200, timeout.raw);
    assert.equal(timeout.body.text, 'hola desde Strata');
    assert.equal(
      recibido.filter((entry) => entry.method === 'POST' && entry.body?.messages?.[0]?.content === '__strata_timeout: espera un turno').length,
      2,
      'el timeout se reintenta exactamente una vez'
    );

    // El reintento de streaming ocurre antes de enviar cabeceras: el host
    // ocupado no produce chunks parciales y el cliente recibe un solo `done`.
    const queueStream = await srv.request('POST', '/api/strata-local/stream', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-demo',
      prompt: '__strata_queue_stream: espera un turno',
      maxTokens: 64,
    });
    assert.equal(queueStream.status, 200, queueStream.raw);
    assert.equal((queueStream.raw.match(/"type":"done"/g) || []).length, 1);
    assert.match(queueStream.raw, /"fullText":"hola desde Strata"/);
    assert.equal(
      recibido.filter((entry) => entry.method === 'POST' && entry.body?.messages?.[0]?.content === '__strata_queue_stream: espera un turno').length,
      2,
      'el stream reintenta la conexión una vez antes de emitir chunks'
    );

    // Un seguimiento de tool calling no es un chat normal: el turno assistant
    // que pidió la tool y el mensaje `tool` con su resultado deben llegar al
    // host, o el modelo pierde el resultado y vuelve a pedir la herramienta.
    const toolHistory = await srv.request('POST', '/api/strata-local/generate', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-demo',
      messages: [
        { role: 'user', content: 'Obtén el código con get_secret.' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_secret', arguments: '{"text":"zafiro-42"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'zafiro-42' },
        { role: 'user', content: '¿Qué código devolvió la herramienta?' },
      ],
      maxTokens: 128,
    });
    assert.equal(toolHistory.body.success, true, toolHistory.raw);
    const toolCompletion = [...recibido]
      .reverse()
      .find((entry) => entry.method === 'POST' && entry.body?.messages?.some((message: any) => message.role === 'tool'));
    assert.ok(toolCompletion, 'el seguimiento con tool result debe llegar al host');
    assert.deepEqual(toolCompletion?.body?.messages, [
      { role: 'user', content: 'Obtén el código con get_secret.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_secret', arguments: '{"text":"zafiro-42"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'zafiro-42' },
      { role: 'user', content: '¿Qué código devolvió la herramienta?' },
    ]);

    const sinModelo = await srv.request('POST', '/api/strata-local/generate', {
      baseURL,
      apiKey: 'clave-strata',
      prompt: 'hola',
    });
    assert.equal(sinModelo.body.success, true, `el único modelo cargado debe elegirse solo: ${sinModelo.raw}`);
    assert.match(String(sinModelo.raw), /hola desde Strata/);

    const stream = await srv.request('POST', '/api/strata-local/stream', {
      baseURL,
      apiKey: 'clave-strata',
      model: 'strata-local/strata-demo',
      prompt: 'hola',
      maxTokens: 64,
    });
    assert.equal(stream.status, 200, stream.raw);
    assert.match(stream.raw, /"type":"chunk"/);
    assert.match(stream.raw, /hola /);
    assert.match(stream.raw, /"type":"done"/);
    assert.match(stream.raw, /"fullText":"hola desde Strata"/);

    const compact = await srv.request('POST', '/api/strata-local/compact', {
      baseURL,
      model: 'strata-local/strata-demo',
      messages: [
        { role: 'user', content: 'turno antiguo 1' },
        { role: 'assistant', content: 'respuesta 1' },
        { role: 'user', content: 'turno reciente' },
      ],
      keepRecent: 2,
    });
    assert.equal(compact.body.success, true, compact.raw);
    assert.equal(compact.body.removed, 1);
    assert.equal(compact.body.kept, 2);
    assert.equal(compact.body.summary, 'hola desde Strata');
    assert.ok(compact.body.beforeTokens > 0, compact.raw);
    assert.ok(compact.body.afterTokens >= 0, compact.raw);

    // El presupuesto del siguiente turno también decide cuántos recientes se
    // conservan; el antes/después se calcula con el prompt completo.
    const compactBudget = await srv.request('POST', '/api/strata-local/compact', {
      baseURL,
      model: 'strata-local/strata-demo',
      messages: [
        { role: 'user', content: `antiguo ${'x'.repeat(4000)}` },
        { role: 'assistant', content: `respuesta ${'y'.repeat(4000)}` },
        { role: 'user', content: 'reciente' },
      ],
      keepRecent: 2,
      contextWindow: 4096,
      reservedTokens: 512,
      toolTokens: 1024,
      draftTokens: 100,
    });
    assert.equal(compactBudget.body.success, true, compactBudget.raw);
    assert.ok(compactBudget.body.beforeTokens > compactBudget.body.afterTokens, compactBudget.raw);
    assert.equal(
      compactBudget.body.savedTokens,
      compactBudget.body.beforeTokens - compactBudget.body.afterTokens
    );
    assert.ok(compactBudget.body.savedPercent > 0);

    const lifecycle = await srv.request('GET', '/api/strata-local/lifecycle');
    assert.equal(lifecycle.status, 200, lifecycle.raw);
    assert.equal(lifecycle.body.success, true);
    assert.ok(['stopped', 'starting', 'running', 'stopping', 'error'].includes(lifecycle.body.state));
    assert.equal(typeof lifecycle.body.available, 'boolean');

    // Una clave jamás sale hacia un host remoto por HTTP sin confirmación.
    const remoteDenied = await srv.request('POST', '/api/strata-local/generate', {
      baseURL: 'http://192.0.2.1:8080/v1',
      apiKey: 'clave-remota-de-prueba',
      model: 'strata-local/strata-demo',
      prompt: 'no debe viajar',
    });
    assert.equal(remoteDenied.status, 422, remoteDenied.raw);
    assert.equal(remoteDenied.body.code, 'STRATA_INSECURE_REMOTE');
    assert.ok(!recibido.some((entry) => entry.auth === 'Bearer clave-remota-de-prueba'));

    const remoteHealth = await srv.request('POST', '/api/strata-local/health', {
      baseUrl: 'http://192.0.2.1:8080/v1',
      apiKey: 'clave-remota-de-prueba',
    });
    assert.equal(remoteHealth.status, 422, remoteHealth.raw);
    assert.equal(remoteHealth.body.code, 'STRATA_INSECURE_REMOTE');
    assert.equal(remoteHealth.body.keyBlocked, true);

    const remoteSaveDenied = await srv.request('POST', '/api/providers', {
      id: 'strata-local',
      target: 'global',
      config: {
        baseUrl: 'http://192.0.2.1:8080/v1',
        apiKey: 'clave-remota-de-prueba',
      },
    });
    assert.equal(remoteSaveDenied.status, 422, remoteSaveDenied.raw);
    assert.equal(remoteSaveDenied.body.code, 'STRATA_INSECURE_REMOTE');

    // Con confirmación explícita el host remoto HTTP sí se acepta, y la clave
    // sigue guardándose cifrada.
    const insecureSave = await srv.request('POST', '/api/providers', {
      id: 'strata-local',
      target: 'global',
      config: {
        baseUrl: 'http://192.0.2.1:8080/v1',
        apiKey: 'clave-remota-de-prueba',
        allowInsecure: true,
      },
    });
    assert.equal(insecureSave.status, 200, insecureSave.raw);
    assert.equal(insecureSave.body.allowInsecure, true);
    const insecureConfig = fs.readFileSync(String(insecureSave.body.configPath), 'utf8');
    assert.doesNotMatch(insecureConfig, /clave-remota-de-prueba/);
    assert.equal(
      JSON.parse(insecureConfig).providers?.['strata-local']?.allowInsecure,
      true
    );
    const insecureDelete = await srv.request('DELETE', '/api/providers/strata-local');
    assert.equal(insecureDelete.status, 200, insecureDelete.raw);

    // Guardar una clave normal la deja en el vault, no en config.json.
    const secret = `strata-vault-${Date.now()}`;
    const saved = await srv.request('POST', '/api/providers', {
      id: 'strata-local',
      target: 'global',
      config: {
        baseUrl: baseURL,
        defaultModel: 'strata-demo',
        apiKey: secret,
      },
    });
    assert.equal(saved.status, 200, saved.raw);
    assert.equal(saved.body.keyStorage, 'vault');
    assert.equal(saved.body.allowInsecure, false);
    const savedConfig = fs.readFileSync(String(saved.body.configPath), 'utf8');
    assert.doesNotMatch(savedConfig, new RegExp(secret));
    const savedJson = JSON.parse(savedConfig);
    assert.equal(savedJson.providers?.['strata-local']?.apiKey, undefined);
    const vaultFile = path.join(os.homedir(), '.commander', 'vault', 'integrations.json');
    assert.ok(fs.existsSync(vaultFile), 'la clave debe guardarse en el vault cifrado');
    const vaultRaw = fs.readFileSync(vaultFile, 'utf8');
    assert.doesNotMatch(vaultRaw, new RegExp(secret));

    // El gestor de proveedores también descubre el modelo que el host tiene
    // cargado, no sólo el catálogo vacío de models.dev.
    const providerList = await srv.request('GET', '/api/providers');
    const strataProvider = providerList.body.providers.find(
      (provider: any) => provider.id === 'strata-local'
    );
    assert.equal(strataProvider?.model, 'strata-demo');
    assert.equal(strataProvider?.loaded, true);
    assert.deepEqual(
      strataProvider?.allModels.map((model: any) => model.id),
      ['strata-local/strata-demo']
    );
    assert.equal(strataProvider?.modelCount, 1);

    // Al borrar el proveedor también se borra la credencial cifrada y no queda
    // una copia en la config global.
    const removed = await srv.request('DELETE', '/api/providers/strata-local');
    assert.equal(removed.status, 200, removed.raw);
    assert.equal(removed.body.vaultKeyRemoved, true);
    const afterDelete = JSON.parse(fs.readFileSync(String(saved.body.configPath), 'utf8'));
    assert.equal(afterDelete.providers?.['strata-local'], undefined);
    const vaultAfterDelete = fs.readFileSync(vaultFile, 'utf8');
    assert.doesNotMatch(vaultAfterDelete, new RegExp(secret));
  } finally {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test('un Host ajeno responde 403 (anti DNS rebinding)', async () => {
  // Una página del atacante cuyo dominio resuelve a 127.0.0.1 manda su propio
  // `Host`: es el único rastro que la delata, porque la IP de origen es loopback
  // y las cookies de sesión no viajan. Sin este guard, la API local le contesta.
  const rebinding = await requestConCookie('GET', '/api/health', undefined, '', { Host: 'evil.example' });
  assert.equal(rebinding.status, 403, `se esperaba 403, llegó ${rebinding.status}: ${rebinding.raw}`);
  assert.equal(rebinding.body.success, false);
  assert.match(String(rebinding.body.error), /Host no permitido/);

  const propio = await requestConCookie('GET', '/api/health', undefined, '', {
    Host: `127.0.0.1:${new URL(srv.baseUrl).port}`,
  });
  assert.equal(propio.status, 200, `el Host real debe seguir pasando: ${propio.raw}`);
  assert.equal(propio.body.status, 'ok');
});
test('los paneles usan panelRoot: un root inválido responde 400', async () => {
  // checkpoints y plugins tragaban el fallo de resolución y seguían con el cwd:
  // un root inválido operaba en silencio sobre otro proyecto. Ahora comparten
  // `panelRoot` y el handler responde 400, igual que /api/permissions.
  const raizDeUnidad = path.parse(process.cwd()).root;

  const plugins = await srv.request('GET', `/api/plugins?root=${encodeURIComponent(raizDeUnidad)}`);
  assert.equal(plugins.status, 400, `plugins debía rechazar la raíz de la unidad: ${plugins.raw}`);

  const checkpoints = await srv.request('GET', `/api/checkpoints?root=${encodeURIComponent(raizDeUnidad)}`);
  assert.equal(checkpoints.status, 400, `checkpoints debía rechazar la raíz de la unidad: ${checkpoints.raw}`);

  const worktree = await srv.request('POST', '/api/checkpoints/worktree', { root: raizDeUnidad });
  assert.equal(worktree.status, 400, `worktree debía rechazar la raíz de la unidad: ${worktree.raw}`);

  // Sin pista se usa el cwd del server: el camino sano no cambia.
  const pluginsCwd = await srv.request('GET', '/api/plugins');
  assert.equal(pluginsCwd.status, 200, pluginsCwd.raw);
  const checkpointsCwd = await srv.request('GET', '/api/checkpoints');
  assert.equal(checkpointsCwd.status, 200, checkpointsCwd.raw);
});

test('Strata cloud responde 400 sin clave y 502 si el host no responde', async () => {
  const sinClave = await srv.request('POST', '/api/strata/generate', {});
  assert.equal(sinClave.status, 400, sinClave.raw);
  assert.match(String(sinClave.body.error), /STRATA_API_KEY/);

  const hostCaido = await srv.request('POST', '/api/strata/generate', {
    apiKey: 'clave-de-prueba',
    baseUrl: 'http://127.0.0.1:1/v1',
    prompt: 'ping',
  });
  assert.equal(hostCaido.status, 502, hostCaido.raw);
});
test('Strata cloud emite el sobre SSE de chunk y done', async () => {
  const sinClave = await srv.request('POST', '/api/strata/stream', {});
  assert.equal(sinClave.status, 400, sinClave.raw);

  const upstream = http.createServer((req, res) => {
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"po"}}]}\n\n');
      res.end('data: {"choices":[{"delta":{"content":"ng"}}]}\n\ndata: [DONE]\n\n');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }).end('{}');
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
  const port = (upstream.address() as { port: number }).port;
  try {
    const stream = await srv.request('POST', '/api/strata/stream', {
      apiKey: 'clave-de-prueba',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      prompt: 'ping',
    });
    assert.equal(stream.status, 200, stream.raw);
    assert.match(String(stream.raw), /"type":"chunk"/);
    assert.match(String(stream.raw), /po/);
    assert.match(String(stream.raw), /"type":"done"/);
    assert.match(String(stream.raw), /pong/);
  } finally {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
