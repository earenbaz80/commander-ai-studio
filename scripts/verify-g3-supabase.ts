/**
 * Verificación real de G3: backend gestionado sobre Supabase.
 *
 * Se ejecuta contra un Commander ya arrancado con
 * `COMMANDER_BACKEND_PROVIDER=supabase` y sus credenciales. Recorre el ciclo
 * completo —aprovisionar, migrar, rotar, publicar— y comprueba la única
 * propiedad que cierra G3: la credencial rotada llega al archivo de entorno de
 * la release y no aparece en ninguna respuesta HTTP ni en el log del server.
 *
 * No imprime valores: sólo nombres, rutas y huellas SHA-256 cortas. El reporte
 * de evidencia tampoco los contiene.
 *
 *   npm run verify:g3-supabase -- --root <app> --publish-dir <dir> \
 *     --server-log <log> [--base-url http://127.0.0.1:3283]
 *
 *   # tras reiniciar Commander, comprobar que el estado persistido sobrevive:
 *   npm run verify:g3-supabase -- --root <app> --status-only
 *
 * Ver `docs/g3-supabase-runbook.md` para credenciales, preparación y criterio
 * de cierre.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { publishBaseDir, projectSlug } from '../publisher';
import { releaseEnvFile } from '../deploy/backend/releaseEnv';

const BINDINGS = ['database', 'storage', 'auth'] as const;
const MIGRATION = {
  id: '001_g3_probe',
  sql: 'create table if not exists g3_probe (id text primary key);',
};
const DEFAULT_BASE_URL = 'http://127.0.0.1:3283';

interface Options {
  baseUrl: string;
  root: string | null;
  projectId: string | null;
  outputDir: string;
  publishDir: string;
  serverLog: string | null;
  skipLogCheck: boolean;
  statusOnly: boolean;
  report: string | null;
  help: boolean;
}

interface HttpResult {
  label: string;
  status: number;
  body: any;
  raw: string;
  headers: string;
}

interface ReleaseEnvFileContents {
  version?: unknown;
  releaseId?: unknown;
  environment?: unknown;
  vars?: Record<string, unknown>;
}

const responses: HttpResult[] = [];

function printHelp(): void {
  console.log(`Verificación real de G3 (Supabase)

Uso:
  npm run verify:g3-supabase -- --root <app> --publish-dir <dir> [opciones]

Opciones:
  --root <ruta>          App a publicar (debe tener <output-dir>/index.html).
  --output-dir <nombre>  Directorio de build dentro de la app (defecto: dist).
  --publish-dir <ruta>   Base de publicación del server (defecto: COMMANDER_PUBLISH_DIR
                         o .commander/publish del cwd).
  --base-url <url>       Commander escuchando (defecto: ${DEFAULT_BASE_URL}).
  --server-log <ruta>    Log del server que se escanea en busca de filtraciones.
  --skip-log-check       Omite el escaneo del log (la evidencia queda incompleta).
  --status-only          Sólo comprueba el estado persistido tras reiniciar.
  --project-id <id>      Con --status-only, si no se pasa --root.
  --report <ruta>        Reporte JSON sin valores (defecto: .commander/g3-supabase/<fecha>.json).
  --help                 Esta ayuda.

El server debe estar arrancado con COMMANDER_BACKEND_PROVIDER=supabase y
SUPABASE_ACCESS_TOKEN, SUPABASE_ORG_ID y SUPABASE_REGION. Este script no lee
esas credenciales ni las imprime.`);
}

function parseArgs(argv: string[]): Options {
  const flag = (name: string): boolean => argv.includes(name);
  const value = (name: string): string | null => {
    const index = argv.indexOf(name);
    if (index < 0) return null;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`${name} necesita un valor`);
    return next;
  };
  const baseUrl = (value('--base-url') || process.env.COMMANDER_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    ''
  );
  return {
    baseUrl,
    root: value('--root'),
    projectId: value('--project-id'),
    outputDir: value('--output-dir') || 'dist',
    publishDir: publishBaseDir(value('--publish-dir') || undefined),
    serverLog: value('--server-log') || process.env.COMMANDER_SERVER_LOG || null,
    skipLogCheck: flag('--skip-log-check'),
    statusOnly: flag('--status-only'),
    report: value('--report'),
    help: flag('--help') || flag('-h'),
  };
}

function fail(message: string): never {
  throw new Error(message);
}

async function request(method: string, route: string, body?: unknown): Promise<HttpResult> {
  const res = await fetch(`${OPTIONS.baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const result: HttpResult = {
    label: `${method} ${route.split('?')[0]}`,
    status: res.status,
    body: parsed,
    raw,
    headers: [...res.headers].map(([key, entry]) => `${key}: ${entry}`).join('\n'),
  };
  responses.push(result);
  return result;
}

function assertOk(result: HttpResult, what: string): any {
  if (result.status >= 400 || result.body?.success === false) {
    fail(
      `${what} falló (HTTP ${result.status}): ${
        typeof result.body?.error === 'string' ? result.body.error : 'sin detalle'
      }`
    );
  }
  return result.body;
}

function fingerprint(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

/**
 * Busca los valores y sus variantes codificadas en todo lo que salió por HTTP.
 * El mensaje de error nombra la credencial, nunca el valor.
 */
function assertNoHttpLeak(values: Record<string, string>, label: string): void {
  const needles: { name: string; needle: string }[] = [];
  for (const [name, value] of Object.entries(values)) {
    needles.push({ name, needle: value });
    needles.push({ name, needle: encodeURIComponent(value) });
  }
  for (const response of responses) {
    for (const { name, needle } of needles) {
      if (!needle) continue;
      if (response.raw.includes(needle) || response.headers.includes(needle)) {
        fail(`El valor de ${name} apareció en la respuesta ${response.label}`);
      }
    }
  }
  console.log(`[g3] ${label}: ${responses.length} respuestas sin valores de credenciales`);
}

async function assertServerReady(): Promise<any> {
  const health = await request('GET', '/api/health');
  if (health.status !== 200) fail(`/api/health respondió ${health.status}; ¿está Commander arriba?`);

  const status = await request(
    'GET',
    `/api/backend/manage/status?projectId=${encodeURIComponent(PROJECT_ID)}`
  );
  if (status.status !== 200) {
    fail(`status respondió ${status.status}: ${String(status.body?.error ?? 'sin detalle')}`);
  }
  const data = status.body || {};
  if (data.enabled !== true) {
    fail(
      'el backend gestionado no está habilitado en el server: arranca Commander con ' +
        'COMMANDER_BACKEND_PROVIDER=supabase y sus tres variables'
    );
  }
  if (data.provider !== 'supabase') {
    fail(`el server usa el proveedor "${String(data.provider)}", no supabase`);
  }
  if (data.configured !== true) {
    fail('el adaptador de Supabase está sin configurar: faltan credenciales en el server');
  }
  return data.status;
}

async function runStatusOnly(previous?: any): Promise<void> {
  const status = previous ?? (await assertServerReady());
  const bindings = Array.isArray(status?.bindings) ? status.bindings : [];
  if (bindings.length === 0) {
    fail(
      'el proyecto figura sin aprovisionar: no se recuperó su ref del estado persistido. ' +
        'Revisa COMMANDER_BACKEND_STATE_DIR y que el server haya aprovisionado antes de reiniciar.'
    );
  }
  const database = bindings.find((binding: any) => binding.kind === 'database');
  const auth = bindings.find((binding: any) => binding.kind === 'auth');
  if (!database || !auth) fail('el estado persistido no tiene los bindings database y auth');
  if (database.resourceId !== auth.resourceId) {
    fail('database y auth no apuntan al mismo ref de proyecto');
  }
  console.log(`[g3] estado persistido ok · ref=${String(database.resourceId)}`);
  console.log(
    `[g3] bindings=${bindings.map((binding: any) => String(binding.kind)).join(',')} · ` +
      `credenciales=${status.secretNames?.length ? status.secretNames.join(',') : 'ninguna'}`
  );
}

async function provision(): Promise<any> {
  const result = await request('POST', '/api/backend/manage/provision', {
    projectId: PROJECT_ID,
    bindings: [...BINDINGS],
  });
  const body = assertOk(result, 'provision');
  const status = body.status;
  console.log(
    `[g3] provision: ${status.bindings
      .map((binding: any) => `${binding.kind}=${binding.resourceId}`)
      .join(' · ')}`
  );
  return status;
}

async function migrate(): Promise<any> {
  const first = assertOk(
    await request('POST', '/api/backend/manage/migrate', {
      projectId: PROJECT_ID,
      migrations: [MIGRATION],
    }),
    'migrate'
  );
  const second = assertOk(
    await request('POST', '/api/backend/manage/migrate', {
      projectId: PROJECT_ID,
      migrations: [MIGRATION],
    }),
    'migrate (repetición)'
  );
  if (first.result.failed.length > 0) {
    fail(`la migración falló: ${first.result.failed.map((entry: any) => entry.id).join(', ')}`);
  }
  if (second.result.failed.length > 0) {
    fail(`la repetición de la migración falló: ${second.result.failed[0]?.message ?? 'sin detalle'}`);
  }
  if (![...first.result.applied, ...first.result.skipped].includes(MIGRATION.id)) {
    fail('la migración de prueba no quedó registrada');
  }
  if (!second.result.skipped.includes(MIGRATION.id)) {
    fail('repetir la migración no la saltó: schema_migrations no es idempotente');
  }
  console.log(
    `[g3] migrate: ${MIGRATION.id} applied=${first.result.applied.length} ` +
      `skipped=${first.result.skipped.length} · repetición skipped=${second.result.skipped.length}`
  );
  return first.result;
}

async function rotate(): Promise<any> {
  const rotation = assertOk(
    await request('POST', '/api/backend/manage/rotate', { projectId: PROJECT_ID }),
    'rotate'
  ).rotation;
  const rotated: string[] = Array.isArray(rotation?.rotated) ? rotation.rotated : [];
  const skipped: any[] = Array.isArray(rotation?.skipped) ? rotation.skipped : [];
  if (!rotated.includes('DATABASE_URL') || !rotated.includes('AUTH_SECRET')) {
    fail(`la rotación no emitió DATABASE_URL y AUTH_SECRET: ${rotated.join(', ') || 'nada'}`);
  }
  if (rotated.includes('STORAGE_SECRET')) {
    fail('la rotación fingió STORAGE_SECRET: el storage no se rota por la Management API');
  }
  const storage = skipped.find((entry) => entry.kind === 'storage');
  if (!storage || storage.name !== 'STORAGE_SECRET' || !storage.reason) {
    fail('la rotación no informó el storage como omitido con nombre y motivo');
  }
  console.log(`[g3] rotate: ${rotated.join(', ')} · omitido ${storage.name} (${storage.reason})`);
  return rotation;
}

async function publish(): Promise<{ preview: any; envFile: string; env: ReleaseEnvFileContents }> {
  const published = assertOk(
    await request('POST', '/api/publish/preview', {
      root: ROOT,
      outputDir: OPTIONS.outputDir,
      build: false,
    }),
    'publish preview'
  );
  const preview = published.status?.preview;
  if (!preview?.id || !preview?.url) fail('la publicación no devolvió una release de preview');
  const slug = projectSlug(ROOT);
  const envFile = releaseEnvFile(OPTIONS.publishDir, slug, preview.id, 'preview');
  let raw: string;
  try {
    raw = await fsp.readFile(envFile, 'utf8');
  } catch {
    fail(
      `no existe el entorno de la release en ${envFile}. ¿El server usa otro ` +
        'COMMANDER_PUBLISH_DIR o se reinició después de rotar (el sink vive en memoria)?'
    );
  }
  let env: ReleaseEnvFileContents;
  try {
    env = JSON.parse(raw) as ReleaseEnvFileContents;
  } catch {
    fail('el archivo de entorno de la release no es JSON válido');
  }
  const vars = env.vars && typeof env.vars === 'object' ? env.vars : {};
  const names = Object.keys(vars).sort();
  if (!names.includes('DATABASE_URL') || !names.includes('AUTH_SECRET')) {
    fail(`el entorno de la release no tiene las credenciales esperadas: ${names.join(', ') || 'vacío'}`);
  }
  if ('STORAGE_SECRET' in vars) {
    fail('el entorno de la release recibió STORAGE_SECRET, que la rotación no emitió');
  }
  for (const name of names) {
    if (typeof vars[name] !== 'string' || !String(vars[name])) {
      fail(`la credencial ${name} llegó vacía al entorno de la release`);
    }
  }

  // La URL tiene que apuntar al proyecto que el adaptador aprovisionó.
  const status = assertOk(
    await request(
      'GET',
      `/api/backend/manage/status?projectId=${encodeURIComponent(PROJECT_ID)}`
    ),
    'status posterior'
  ).status;
  const ref = status.bindings.find((binding: any) => binding.kind === 'database')?.resourceId;
  let host = '';
  try {
    host = new URL(String(vars.DATABASE_URL)).hostname;
  } catch {
    fail('DATABASE_URL no es una URL válida');
  }
  if (!ref || host !== `db.${ref}.supabase.co`) {
    fail(`DATABASE_URL no apunta al proyecto aprovisionado (host=${host})`);
  }

  const stat = await fsp.stat(envFile);
  const mode = stat.mode & 0o777;
  console.log(`[g3] release: preview=${preview.id} url=${preview.url}`);
  console.log(`[g3] env: ${envFile} · vars=${names.join(', ')} · modo=${mode.toString(8)}`);
  console.log(
    `[g3] huellas: ${names.map((name) => `${name}=${fingerprint(String(vars[name]))}`).join(' · ')}`
  );
  if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
    fail(`el archivo de entorno tiene permisos demasiado abiertos (${mode.toString(8)})`);
  }
  if (process.platform === 'win32') {
    console.log('[g3] nota: en Windows los permisos POSIX del archivo no son verificables');
  }

  const secrets: Record<string, string> = {};
  for (const name of names) secrets[name] = String(vars[name]);
  assertNoHttpLeak(secrets, 'rotación/publicación');

  const served = await request('GET', preview.url);
  if (served.status !== 200) fail(`la release servida respondió ${served.status}`);
  const leakedPath = `${preview.url.replace(/\/?$/, '/')}env/preview-${preview.id}.json`;
  const leakAttempt = await request('GET', leakedPath);
  if (leakAttempt.status !== 404) {
    fail(`el archivo de entorno se sirvió por HTTP (${leakedPath} → ${leakAttempt.status})`);
  }
  const publishStatus = await request(
    'GET',
    `/api/publish/status?root=${encodeURIComponent(ROOT)}`
  );
  assertOk(publishStatus, 'publish status');
  assertNoHttpLeak(secrets, 'release servida y estado de publicación');

  let logCheck: { status: 'clean' | 'skipped'; bytes?: number; file?: string } = {
    status: 'skipped',
  };
  if (OPTIONS.skipLogCheck) {
    console.log('[g3] log: OMITIDO por --skip-log-check (evidencia incompleta)');
  } else if (!OPTIONS.serverLog) {
    fail('falta --server-log (o COMMANDER_SERVER_LOG); usa --skip-log-check para omitirlo a sabiendas');
  } else {
    const log = await fsp.readFile(OPTIONS.serverLog, 'utf8');
    for (const [name, value] of Object.entries(secrets)) {
      if (log.includes(value) || log.includes(encodeURIComponent(value))) {
        fail(`el valor de ${name} apareció en el log del server`);
      }
    }
    logCheck = { status: 'clean', bytes: Buffer.byteLength(log), file: path.resolve(OPTIONS.serverLog) };
    console.log(`[g3] log: ${logCheck.bytes} bytes sin valores · ${logCheck.file}`);
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    baseUrl: OPTIONS.baseUrl,
    projectId: PROJECT_ID,
    provider: 'supabase',
    ref,
    release: {
      id: String(preview.id),
      url: String(preview.url),
      envFile,
      vars: names,
      fingerprints: Object.fromEntries(
        names.map((name) => [name, fingerprint(String(vars[name]))])
      ),
      mode: mode.toString(8),
    },
    checks: {
      bindings: status.bindings.map((binding: any) => String(binding.kind)),
      httpResponses: responses.length,
      valuesInHttp: 0,
      servedRelease: served.status,
      envOverHttp: leakAttempt.status,
      serverLog: logCheck,
    },
  };
  const output =
    OPTIONS.report ||
    path.join(process.cwd(), '.commander', 'g3-supabase', `evidence-${Date.now()}.json`);
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await fsp.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`[g3] reporte: ${output}`);
  return { preview, envFile, env };
}

let OPTIONS: Options;
let ROOT = '';
let PROJECT_ID = '';

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  OPTIONS = options;
  if (options.help) {
    printHelp();
    return;
  }
  if (options.statusOnly) {
    PROJECT_ID = options.projectId || (options.root ? projectSlug(options.root) : '');
    if (!PROJECT_ID) fail('--status-only necesita --root o --project-id');
    const status = await assertServerReady();
    await runStatusOnly(status);
    console.log('[g3] ok: el estado persistido sobrevive al reinicio (status)');
    return;
  }

  if (!options.root) fail('falta --root con la app a publicar');
  ROOT = path.resolve(options.root);
  const index = path.join(ROOT, options.outputDir, 'index.html');
  if (!fs.existsSync(index)) {
    fail(`no existe ${index}; construye la app o corrige --output-dir`);
  }
  PROJECT_ID = projectSlug(ROOT);

  console.log(`[g3] base=${options.baseUrl} · proyecto=${PROJECT_ID}`);
  const initial = await assertServerReady();
  console.log(
    `[g3] server: supabase configurado · bindings previos=${
      initial?.bindings?.map((binding: any) => binding.kind).join(',') || 'ninguno'
    }`
  );

  await provision();
  await migrate();
  await rotate();
  const { preview } = await publish();

  // El valor no se imprime nunca; sólo se confirma que el ciclo terminó.
  console.log(
    `[g3] ok: credenciales de ${preview.id} en el entorno de la release, sin pasar por HTTP ni logs`
  );
}

main().catch((error: any) => {
  const message = String(error?.message ?? error);
  console.error(`[g3] FALLO: ${message}`);
  process.exitCode = 1;
});
