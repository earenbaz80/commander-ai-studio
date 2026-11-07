/**
 * Arnés mínimo para probar endpoints HTTP contra el server de verdad.
 *
 * Se levanta `server.ts` —el mismo que corre `npm run dev`— en un proceso hijo,
 * en un puerto efímero (`PORT=0`: el SO elige y el propio server anuncia cuál
 * fue) y con una base SQLite en un directorio temporal, para no tocar
 * `.commander/studio.db`.
 *
 * Por qué un proceso hijo y no un `import`: `server.ts` arranca en el momento
 * de importarse (`bootstrap()`), se queda vivo y abre cosas que no se cierran
 * de forma limpia. Dentro del proceso de `node:test` eso arrastraría a toda la
 * suite. Un hijo se mata al terminar y el resto de los tests no se enteran.
 *
 * Server compartido: `node --test` abre CADA archivo en su propio proceso, así
 * que un singleton en memoria no sirve de nada entre archivos — cada uno
 * pagaría su arranque. La vía es que un padre levante el server una sola vez y
 * se lo dé a los hijos que lo pidan: `startServer()` lo solicita por un canal de
 * control (`COMMANDER_TEST_SERVER_CONTROL`) y **no** lo mata, porque no es suyo.
 * `scripts/test-node.ts` es ese padre, y no arranca nada al empezar: sólo
 * escucha y compila `server.ts` la primera vez que un archivo lo pide, así que
 * un test que no toca HTTP no paga el arranque. Sin la variable, el arnés
 * arranca y mata su propio server: cada archivo sigue funcionando por separado
 * con `tsx --test tests/algo.test.ts`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Ruta del repo, calculada desde este archivo: los tests corren desde cualquier cwd. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Arrancar incluye compilar el server con tsx; en frío tarda decenas de segundos. */
const BOOT_TIMEOUT_MS = 90_000;
/** Ya anunciado el puerto, `/api/health` debería contestar casi de inmediato. */
const READY_TIMEOUT_MS = 30_000;

/**
 * Canal de control para pedirle el server al padre.
 *
 * Antes el padre anunciaba la URL por entorno y para eso tenía que arrancar el
 * server ANTES de saber si algún test lo usaba: una corrida de un archivo que no
 * toca HTTP pagaba igual los ~9 s de compilar `server.ts`. Con un canal, el
 * padre sólo escucha (un socket de loopback) y el arranque ocurre en la primera
 * petición real.
 */
export const SHARED_CONTROL_ENV = 'COMMANDER_TEST_SERVER_CONTROL';
/** Pedir el server incluye, la primera vez, arrancarlo en frío. */
const ACQUIRE_TIMEOUT_MS = BOOT_TIMEOUT_MS + READY_TIMEOUT_MS + 10_000;

/** Sólo el final del log: el arranque imprime bastante y el error útil va al final. */
function tail(text: string, max = 3000): string {
  return text.length > max ? `…${text.slice(-max)}` : text;
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    // Si no muere con SIGTERM (Windows lo traduce a TerminateProcess) se fuerza.
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ya murió */ }
      resolve();
    }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try { child.kill('SIGTERM'); } catch { clearTimeout(timer); resolve(); }
  });
}

export interface RequestOptions {
  /** Cabeceras adicionales (auth, content-type, nombre de archivo…). */
  headers?: Record<string, string>;
  /** Cuerpo binario o de texto ya serializado, en vez de `body` JSON. */
  rawBody?: Buffer | string;
}

export interface ServerHarness {
  /** Origen ya escuchando, p. ej. `http://127.0.0.1:53412`. */
  baseUrl: string;
  /** Base de datos temporal del hijo (borrada al parar). */
  dbPath: string;
  /** Log del server, para entender un fallo. */
  logs: () => string;
  stop: () => Promise<void>;
  /** Petición HTTP con socket propio (ver `makeRequest`). */
  request: (
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ) => Promise<HttpResult>;
}

export interface HttpResult {
  status: number;
  /** JSON parseado, o `null` si el cuerpo no era JSON. */
  body: any;
  /** Cuerpo crudo, para mensajes de error legibles. */
  raw: string;
}

/**
 * Petición HTTP sin `fetch`.
 *
 * `fetch` de Node reutiliza sockets (keep-alive) y el server los cierra a los
 * 5 s: bajo la carga de la suite completa, una petición que reusa un socket
 * recién cerrado muere con `ECONNRESET` (y un POST no se reintenta solo). Se
 * vio como un test rojo intermitente. Con `agent: false` cada petición abre su
 * socket y ese fallo desaparece; el cuerpo se lee entero siempre, que también
 * importa (un cuerpo a medio leer deja el socket ocupado).
 */
function makeRequest(baseUrl: string) {
  return (
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<HttpResult> =>
    new Promise<HttpResult>((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const rawBody = options?.rawBody;
      const payload =
        rawBody !== undefined
          ? Buffer.isBuffer(rawBody)
            ? rawBody
            : Buffer.from(rawBody)
          : body === undefined
            ? null
            : Buffer.from(JSON.stringify(body));
      const headers: Record<string, string> = { ...(options?.headers || {}) };
      if (payload) {
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
        headers['Content-Length'] = String(payload.length);
      }
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method,
          agent: false,
          headers,
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

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Server para este archivo de test: el que comparte el padre si hay canal, uno
 * propio si no.
 */
export async function startServer(): Promise<ServerHarness> {
  const control = process.env[SHARED_CONTROL_ENV]?.trim();
  if (control) return acquireShared(control);
  return spawnServer();
}

/**
 * Pide el server al padre. La primera petición de la corrida lo arranca; el
 * resto recibe la misma URL ya lista.
 */
async function acquireShared(control: string): Promise<ServerHarness> {
  const reply = await new Promise<{ baseUrl: string; dbPath: string }>((resolve, reject) => {
    const sep = control.lastIndexOf(':');
    const host = control.slice(0, sep) || '127.0.0.1';
    const port = Number(control.slice(sep + 1));
    if (!Number.isInteger(port) || port <= 0) {
      reject(new Error(`${SHARED_CONTROL_ENV}="${control}" no es host:puerto`));
      return;
    }

    const socket = net.createConnection({ host, port });
    let buffer = '';
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(e);
    };
    const timer = setTimeout(
      () => fail(new Error(`el padre no entregó el server en ${ACQUIRE_TIMEOUT_MS / 1000}s`)),
      ACQUIRE_TIMEOUT_MS
    );
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ op: 'acquire' })}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      let msg: any;
      try {
        msg = JSON.parse(buffer.slice(0, nl));
      } catch {
        fail(new Error(`respuesta ilegible del padre: ${buffer.slice(0, 200)}`));
        return;
      }
      if (!msg?.ok) {
        fail(new Error(`el padre no pudo darme el server: ${msg?.error ?? 'sin motivo'}`));
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ baseUrl: String(msg.baseUrl), dbPath: String(msg.dbPath ?? '') });
    });
    socket.on('error', (e: NodeJS.ErrnoException) =>
      fail(
        new Error(
          `no se pudo hablar con el padre (${control}): ${e.code ?? e.message}. ` +
            '¿Se lanzó con `npm run test:node`?'
        )
      )
    );
  });

  // El padre comprobó `/api/health` al arrancarlo, pero entre eso y esta petición
  // pudo morir: un error claro aquí ahorra N ECONNREFUSED difíciles de leer.
  if (!(await isHealthy(reply.baseUrl))) {
    throw new Error(
      `el server compartido ${reply.baseUrl} no responde /api/health (murió después de arrancar)`
    );
  }

  return {
    baseUrl: reply.baseUrl,
    dbPath: reply.dbPath,
    logs: () => `(server compartido en ${reply.baseUrl}; su log lo imprime quien lo arrancó)`,
    stop: async () => { /* no es nuestro: lo para el padre */ },
    request: makeRequest(reply.baseUrl),
  };
}

export interface ServerBroker {
  /** `host:puerto` que reciben los hijos por `SHARED_CONTROL_ENV`. */
  address: string;
  /** Peticiones recibidas (0 = ningún archivo necesitó HTTP). */
  requests: () => number;
  /** Log del server, si llegó a arrancar. */
  logs: () => string;
  stop: () => Promise<void>;
}

/**
 * Lado padre del canal: escucha peticiones y arranca el server la primera vez.
 *
 * Escuchar es barato; compilar `server.ts` no. Por eso el arranque vive dentro
 * del primer `acquire` y no aquí: una corrida que no toca HTTP nunca lo paga.
 */
export async function createServerBroker(onBoot?: (srv: ServerHarness) => void): Promise<ServerBroker> {
  let pending: Promise<ServerHarness> | null = null;
  let booted: ServerHarness | null = null;
  let requests = 0;

  const ensure = (): Promise<ServerHarness> => {
    if (!pending) {
      pending = spawnServer().then((srv) => {
        booted = srv;
        onBoot?.(srv);
        return srv;
      });
    }
    return pending;
  };

  const broker = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('error', () => { /* el hijo se fue: nada que contestar */ });

    const handle = async (line: string) => {
      let msg: any;
      try { msg = JSON.parse(line); } catch { msg = null; }
      if (msg?.op !== 'acquire') {
        socket.end(`${JSON.stringify({ ok: false, error: `operación desconocida: ${msg?.op ?? line.slice(0, 80)}` })}\n`);
        return;
      }
      requests++;
      try {
        const srv = await ensure();
        socket.end(`${JSON.stringify({ ok: true, baseUrl: srv.baseUrl, dbPath: srv.dbPath })}\n`);
      } catch (e: any) {
        // Un arranque fallido no debe envenenar el siguiente intento.
        pending = null;
        socket.end(`${JSON.stringify({ ok: false, error: String(e?.message ?? e) })}\n`);
      }
    };

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        void handle(line);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    broker.once('error', reject);
    broker.listen(0, '127.0.0.1', () => resolve());
  });
  // Sin esto, un cierre abrupto del runner dejaría al padre vivo por el canal.
  broker.unref();

  const addr = broker.address();
  if (!addr || typeof addr === 'string') throw new Error('el canal de control no quedó en un puerto TCP');

  return {
    address: `127.0.0.1:${addr.port}`,
    requests: () => requests,
    logs: () => (booted ? booted.logs() : '(el server compartido nunca llegó a arrancar)'),
    stop: async () => {
      await new Promise<void>((resolve) => broker.close(() => resolve()));
      if (pending) {
        try { await (await pending).stop(); } catch { /* el server ya no está */ }
      }
    },
  };
}

/** Arranca un server propio. Lo usa el padre del runner y el modo sin compartir. */
export async function spawnServer(): Promise<ServerHarness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-http-'));
  const dbPath = path.join(dir, 'studio.db');
  const publishDir = path.join(dir, 'publish');
  const tenantDbPath = path.join(dir, 'tenants.db');
  const tenantStorageDir = path.join(dir, 'tenant-storage');

  // `NODE_ENV=production` aquí no significa «desplegar»: es la única forma de
  // que el server NO monte Vite como middleware (`server.ts`, bootstrap). Con
  // Vite dentro, el primer re-optimizado de dependencias bloqueaba el proceso
  // decenas de segundos y una petición de test moría por timeout en mitad de
  // la suite; la superficie `/api/*` es la misma en los dos modos.
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: '0',
      NODE_ENV: 'production',
      COMMANDER_DB_PATH: dbPath,
      // El backend multiinquilino tampoco puede escribir en `.commander`.
      COMMANDER_TENANT_DB_PATH: tenantDbPath,
      COMMANDER_TENANT_STORAGE_DIR: tenantStorageDir,
      // Las releases de los tests no pueden caer en el .commander real.
      COMMANDER_PUBLISH_DIR: publishDir,
      // Las sesiones del agente (F1-02) tampoco.
      COMMANDER_AGENT_SESSIONS_DIR: path.join(dir, 'agent-sessions'),
      // Aunque el shell tenga credenciales, la suite nunca debe publicar en
      // una cuenta Vercel real. Los tests del adaptador usan un servidor local.
      VERCEL_TOKEN: '',
      VERCEL_PROJECT_ID: '',
      VERCEL_TEAM_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stdout?.on('data', (b: Buffer) => { log += b.toString(); });
  child.stderr?.on('data', (b: Buffer) => { log += b.toString(); });
  // Sin esto, un server que muere a mitad de suite sólo deja un ECONNRESET
  // opaco en el test; con la línea del exit se ve que el proceso terminó.
  child.once('exit', (code, signal) => {
    log += `\n[server salió: code=${code} signal=${signal}]\n`;
  });

  const announce = /running on port (\d+)/;
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`el server no anunció su puerto en ${BOOT_TIMEOUT_MS / 1000}s\n${tail(log)}`));
    }, BOOT_TIMEOUT_MS);
    const scan = () => {
      const match = log.match(announce);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    };
    child.stdout.on('data', scan);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`el server terminó (código ${code}) antes de escuchar\n${tail(log)}`));
    });
  }).catch(async (e) => {
    await stopChild(child);
    throw e;
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        await res.body?.cancel();
        return {
          baseUrl,
          dbPath,
          logs: () => tail(log),
          request: makeRequest(baseUrl),
          stop: async () => {
            await stopChild(child);
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
          },
        };
      }
      lastError = `HTTP ${res.status}`;
    } catch (e: any) {
      lastError = e?.message || String(e);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  await stopChild(child);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  throw new Error(`el server no respondió /api/health en ${READY_TIMEOUT_MS / 1000}s (${lastError})\n${tail(log)}`);
}
