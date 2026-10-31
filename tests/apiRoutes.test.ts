/**
 * Cada `/api/...` que el cliente llama tiene que existir en el servidor.
 *
 * El cliente y el servidor se nombran las rutas por texto: no hay un contrato
 * compartido, así que una ruta puede quedarse sin montar y el síntoma llega
 * tarde y disfrazado —el `express.static`/SPA responde `index.html`, el
 * `res.json()` del cliente revienta con `Unexpected token '<'` y la pantalla
 * muestra un error genérico—. El caso que originó esta guardia: Nono consultaba
 * `/api/nono/observations` antes de que existiera y se quedaba mudo sin avisar.
 *
 * Se comparan dos extracciones: los literales que aparecen en `src/` y las
 * rutas que declara el servidor (`app.<método>('/api/...')` más los routers que
 * monta con `app.use('/api/x', router)`).
 *
 * Lo que NO cuenta, a propósito:
 *  - `{ url: '/api/...' }`, que son catálogos y peticiones de demo para la UI,
 *    no peticiones (RightPanel, ExtensionsManager, McpServerManager).
 *  - Las líneas de comentario, donde se documenta una ruta sin llamarla.
 *  - `src/data/`, que son plantillas y catálogos para mostrar al usuario.
 *
 * Limitaciones conocidas, por si algún día toca cerrarlas: se compara por ruta,
 * no por método (una ruta montada sólo como POST pasa por buena aunque el
 * cliente haga GET), y una ruta compuesta en una variable fuera del archivo no
 * se ve.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Carpetas que no son fuente de la app. */
const SKIP_DIRS = ['node_modules', 'dist', '.git', 'release', 'release-packager', 'staging', 'build', 'coverage'];

/** Plantillas y catálogos para mostrar: mencionan rutas, no las llaman. */
const NOT_CALLS_DIRS = ['src/data'];

/** Archivos donde el servidor declara sus rutas. */
const SERVER_FILES = ['server.ts', 'src/mcp/index.ts', 'skills/api.ts', 'previewServer.ts'];

/**
 * Rutas que el cliente llama y el servidor no monta **hoy**.
 *
 * Están aquí para que la suite pueda estar verde mientras se decide qué hacer
 * con cada una, pero no para olvidarlas: el test exige que sigan sin montarse
 * —si alguien las conecta, hay que borrar la entrada— y que alguien las siga
 * llamando. Con `COMMANDER_API_ROUTES_STRICT=1` la lista deja de valer y el
 * test falla también por éstas.
 */
const PENDIENTES: Record<string, string> = {
  '/api/search/files':
    'lo llama la búsqueda de código (utils/codeSearchApi) desde el panel Workbench y el autocompletado @ del chat',
  '/api/search/code':
    'lo llama el panel Search (components/panel/CodeSearchView) a través de utils/codeSearchApi',
  '/api/ollama/models':
    'lo llama el modal Local LLM (utils/localLlmApi) para listar los modelos de un servidor Ollama',
  '/api/custom/models':
    'lo llama el modal Local LLM y el botón de probar del proveedor Custom (ProviderManager)',
  '/api/permissions':
    'lo llama PermissionsModal en GET y PUT; el GET se traga el fallo en un catch «best-effort»',
  '/api/decompose': 'lo llama el orquestador del agente al descomponer una tarea',
  '/api/xai/generate':
    'es el defaultEndpoint que declara aiProviders para los modelos grok; ninguna ruta lo sirve',
};

interface ClientPath {
  path: string;
  files: string[];
}

const read = (file: string): string | null => {
  try {
    return readFileSync(join(ROOT, file), 'utf8');
  } catch {
    return null;
  }
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Normaliza un literal a la forma que se compara.
 *
 * `${x}` y demás interpolaciones pasan a `:p`, que después casa con cualquier
 * segmento. Una marca pegada a un nombre (`/api/permissions${q}`) no es un
 * segmento sino un query: se recorta a `/api/permissions`.
 */
function normalizeLiteral(raw: string): string {
  let path = raw.trim().split('?')[0];
  path = path.replace(/\$\{[^}]*\}/g, ':p');
  path = path.replace(/\{[^}]*\}?/g, '');
  path = path.replace(/\$+/g, ':p');
  path = path.replace(/([A-Za-z0-9_.-]+):p/g, '$1');
  path = path.replace(/\/{2,}/g, '/');
  path = path.replace(/\/+$/, '');
  return path || '/api';
}

/** Rutas `/api/...` que menciona el cliente, con los archivos que las llaman. */
export function clientApiPaths(): ClientPath[] {
  const found = new Map<string, Set<string>>();
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (NOT_CALLS_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`))) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(url:\s*)?['"`](\/api\/[A-Za-z0-9/_.:$%{}()-]*)/g)) {
      if (match[1]) continue; // { url: '/api/...' }: lista para la UI
      const line = text.slice(text.lastIndexOf('\n', match.index) + 1, text.indexOf('\n', match.index));
      if (/^\s*(\*|\/\/)/.test(line)) continue; // comentario: no es una llamada
      const path = normalizeLiteral(match[2]);
      if (!found.has(path)) found.set(path, new Set());
      found.get(path)!.add(rel);
    }
  }
  return [...found].map(([path, files]) => ({ path, files: [...files].sort() }));
}

/** Rutas que el servidor declara montar, routers incluidos. */
export function serverApiRoutes(): string[] {
  const serverText = read('server.ts') ?? '';
  const routerDecl = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:express\.)?Router\(\)/g;

  /** Variable del router -> archivo donde vive su declaración. */
  const routerFile = new Map<string, string>();
  for (const file of SERVER_FILES) {
    const text = read(file);
    if (!text) continue;
    for (const match of text.matchAll(routerDecl)) routerFile.set(match[1], file);
  }

  /** `app.use('/api/x', <var>)`: qué router, de qué archivo, con qué nombre. */
  const mounts: { prefix: string; file: string | null; routerVar: string | undefined }[] = [];
  for (const match of serverText.matchAll(/app\.use\(\s*['"`](\/api\/[^'"`]+)['"`]\s*,\s*([A-Za-z_$][\w$]*)/g)) {
    const local = match[2];
    // El nombre puede venir de un import (default o nombrado) de otro archivo.
    const imported =
      new RegExp(`import\\s+${local}\\s+from\\s+'([^']+)'`).exec(serverText) ??
      new RegExp(`import\\s*\\{[^}]*\\b${local}\\b[^}]*\\}\\s*from\\s+'([^']+)'`).exec(serverText);
    let file = routerFile.get(local) ?? null;
    if (imported) {
      const target = imported[1].replace(/^\.\//, '').replace(/\.js$/, '');
      file = SERVER_FILES.find((candidate) => candidate.replace(/\.ts$/, '') === target) ?? file;
    }
    const declared = file ? [...(read(file) ?? '').matchAll(routerDecl)].map((m) => m[1]) : [];
    mounts.push({ prefix: match[1], file, routerVar: routerFile.get(local) === file ? local : declared[0] });
  }

  const routes = new Set<string>();
  for (const file of SERVER_FILES) {
    const text = read(file);
    if (!text) continue;
    for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/g)) {
      const [, owner, , path] = match;
      if (owner === 'app') {
        routes.add(path);
        continue;
      }
      if (routerFile.get(owner) !== file) continue;
      for (const mount of mounts) {
        if (mount.file !== file || mount.routerVar !== owner) continue;
        routes.add(mount.prefix + (path === '/' ? '' : path));
      }
    }
  }
  return [...routes].sort();
}

/** ¿La ruta encaja en el patrón? `:param` casa con un segmento cualquiera. */
export function routeMatches(pattern: string, route: string): boolean {
  const patternSegments = pattern.split('/').filter(Boolean);
  const routeSegments = route.split('/').filter(Boolean);
  if (patternSegments.length !== routeSegments.length) return false;
  return patternSegments.every((segment, i) => {
    if (segment.startsWith(':') || segment.startsWith('*')) return true;
    return segment === routeSegments[i] || routeSegments[i].startsWith(':');
  });
}

const clientPaths = clientApiPaths();
const serverRoutes = serverApiRoutes();

/** Rutas del cliente que no casan con ninguna del servidor. */
const huerfanas = clientPaths.filter((call) => !serverRoutes.some((route) => routeMatches(call.path, route)));

test('la extracción mira de verdad: hay rutas en los dos lados', () => {
  // Sin esto, un regex roto dejaría las dos listas vacías y la guardia pasaría
  // en verde sin haber comparado nada.
  assert.ok(clientPaths.length >= 50, `sólo se extrajeron ${clientPaths.length} rutas del cliente`);
  assert.ok(
    huerfanas.length < clientPaths.length,
    'ninguna ruta del cliente casó: la extracción del servidor está rota'
  );
  // Una de cada forma: ruta suelta, ruta con parámetro y ruta de router montado.
  for (const known of ['/api/health', '/api/keys/:key', '/api/agent/run-tool', '/api/mcp/list', '/api/skills']) {
    assert.ok(
      serverRoutes.some((route) => routeMatches(known, route)),
      `no se reconoció una ruta que el servidor sí monta: ${known}`
    );
  }
});

test('toda ruta que llama el cliente la monta el servidor', () => {
  const strict = process.env.COMMANDER_API_ROUTES_STRICT === '1';
  const inesperadas = huerfanas.filter((call) => strict || !(call.path in PENDIENTES));

  assert.deepEqual(
    inesperadas,
    [],
    'Estas rutas las llama el cliente y el servidor no las monta:\n' +
      inesperadas.map((call) => `  ${call.path}  <-  ${call.files.join(', ')}`).join('\n') +
      '\nMonta la ruta en server.ts o, si es una llamada muerta, quítala del cliente.' +
      (strict ? '' : '\n(Con COMMANDER_API_ROUTES_STRICT=1 también fallan las pendientes conocidas.)')
  );
});

test('las rutas pendientes siguen pendientes y alguien las sigue llamando', () => {
  // Dos formas de que esta lista se quede obsoleta y nadie se entere: que una
  // ruta se monte (hay que borrar su entrada) o que el cliente deje de llamarla.
  for (const [path, motivo] of Object.entries(PENDIENTES)) {
    assert.ok(
      !serverRoutes.some((route) => routeMatches(path, route)),
      `${path} ya está montada en el servidor: quita su entrada de PENDIENTES (${motivo})`
    );
    assert.ok(
      huerfanas.some((call) => call.path === path),
      `${path} ya no la llama el cliente: quita su entrada de PENDIENTES (${motivo})`
    );
  }
});
