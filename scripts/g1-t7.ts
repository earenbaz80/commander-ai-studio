#!/usr/bin/env node
/**
 * T7 con el publicador local — la corrida de `G1-D5-01` y `G1-D5-02`.
 *
 * Sin agente, igual que `runT7` de F0: crea release 1 («Una release.»), la
 * promueve, cambia el HTML a «Segunda release.», crea la release 2, la promueve,
 * hace rollback y comprueba las condiciones de la tarea más el deploy remoto
 * desactivado. Deja el reporte crudo en `.commander/g1/<runId>-report.json` y
 * sale con código 1 si alguna comprobación falla (el reporte se escribe igual).
 *
 *   npm run g1:t7                                   # G1-D5-01 sobre tests/tmp-g1/d5-t7-01
 *   npm run g1:t7 -- --run-id G1-D5-02 --workspace tests/tmp-g1/d5-t7-02
 *   npm run g1:t7 -- --workspace tests/tmp-g1/d5-t7-01 --run-id G1-D5-01R
 *
 * La copia sembrada no trae `node_modules`: el build usa el vite del repo.
 * El workspace deja de estar prístino (el HTML cambia y aparece `dist/`); para
 * repetir la corrida hay que re-sembrarlo con
 * `npm run g1:seed -- --force --only <workspace>`.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface PublishStatus {
  project?: { slug?: string };
  preview?: { id?: string };
  production?: { id?: string };
  slug?: string;
}

type Json = Record<string, any>;

const repo = process.cwd();
const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.find((a, i) => !a.startsWith('--') && !String(argv[i - 1] || '').startsWith('--'));

const runId = arg('run-id') || 'G1-D5-01';
const ws = path.resolve(positional || arg('workspace') || 'tests/tmp-g1/d5-t7-01');
const server = arg('server') || process.env.G1_SERVER || 'http://127.0.0.1:3283';
const reportPath = path.resolve(arg('report') || path.join('.commander/g1', `${runId}-report.json`));
const viteBin = path.join(repo, 'node_modules/vite/bin/vite.js');

if (!fs.existsSync(path.join(ws, 'index.html'))) {
  console.error(`[g1:t7] no existe ${path.join(ws, 'index.html')}: siembra primero con npm run g1:seed`);
  process.exit(1);
}
// El workspace ya editado publicaría dos releases idénticas y el rollback no
// probaría nada: se para aquí en vez de dar un falso verde.
if (!fs.readFileSync(path.join(ws, 'index.html'), 'utf8').includes('Una release.')) {
  console.error(`[g1:t7] ${path.relative(repo, ws)} ya está editado; re-siembra: npm run g1:seed -- --force --only ${path.basename(ws)}`);
  process.exit(1);
}

const startedAt = Date.now();
const log: Json[] = [];
const checks: Check[] = [];
const sha = (file: string): string =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ws, file))).digest('hex');

const post = async (route: string, body: Json): Promise<Json> => {
  const t0 = Date.now();
  const res = await fetch(server + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Json;
  log.push({ step: route, ms: Date.now() - t0, ok: json.success !== false, error: json.error });
  if (json.success === false) throw new Error(`${route}: ${json.error}`);
  return json;
};
const page = async (slug: string, env: string): Promise<{ status: number; html: string }> => {
  const res = await fetch(`${server}/published/${slug}/${env}/`);
  return { status: res.status, html: await res.text() };
};
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail });
  if (!ok) console.error(`✖ ${name}: ${detail}`);
};

// 0) build de la copia sembrada (no trae node_modules: usa el vite del repo)
const buildStart = Date.now();
execFileSync(process.execPath, [viteBin, 'build', '--outDir', 'dist'], { cwd: ws, stdio: 'pipe' });
log.push({ step: 'vite build', ms: Date.now() - buildStart, ok: true });

// 1) release 1
const r1 = await post('/api/publish/preview', { root: ws, outputDir: 'dist', build: false });
const status1 = (r1.status || r1) as PublishStatus;
const slug = status1.project?.slug || status1.slug;
const release1 = r1.release?.id || r1.status?.preview?.id;
if (!slug || !release1) throw new Error(`respuesta de preview sin slug/release: ${JSON.stringify(r1).slice(0, 300)}`);
const indexSeed = sha('index.html');
const preview1 = await page(slug, 'preview');
check(
  'preview sirve la primera release',
  preview1.status === 200 && preview1.html.includes('Una release.'),
  `HTTP ${preview1.status}`
);

// 2) promoción de la primera
await post('/api/publish/production', { root: ws, releaseId: release1 });
const prod1 = await page(slug, 'production');
check('promoción a producción', prod1.status === 200 && prod1.html.includes('Una release.'), `HTTP ${prod1.status}`);

// 3) segunda release
const htmlPath = path.join(ws, 'index.html');
fs.writeFileSync(htmlPath, fs.readFileSync(htmlPath, 'utf8').replace('Una release.', 'Segunda release.'));
execFileSync(process.execPath, [viteBin, 'build', '--outDir', 'dist'], { cwd: ws, stdio: 'pipe' });
const r2 = await post('/api/publish/preview', { root: ws, outputDir: 'dist', build: false });
const release2 = r2.release?.id || r2.status?.preview?.id;
if (!release2) throw new Error(`respuesta de preview sin release: ${JSON.stringify(r2).slice(0, 300)}`);
const preview2 = await page(slug, 'preview');
check('segunda release en preview', preview2.status === 200 && preview2.html.includes('Segunda release.'), `HTTP ${preview2.status}`);
check('preview cambió a la segunda', !preview2.html.includes('Una release.'), 'sigue «Una release.»');

// 4) promoción de la segunda
await post('/api/publish/production', { root: ws, releaseId: release2 });
const prod2 = await page(slug, 'production');
check('segunda release en producción', prod2.status === 200 && prod2.html.includes('Segunda release.'), `HTTP ${prod2.status}`);

// 5) rollback
const rb = await post('/api/publish/rollback', { root: ws });
const prod3 = await page(slug, 'production');
const preview3 = await page(slug, 'preview');
check('rollback restaura la primera', prod3.status === 200 && prod3.html.includes('Una release.'), `HTTP ${prod3.status}`);
check('preview intacto tras el rollback', preview3.html.includes('Segunda release.'), 'el preview perdió la segunda');

// 6) asset JS y deploy remoto
const asset = (prod2.html.match(/assets\/[^"']+\.js/) || [])[0];
let assetStatus = 0;
let assetType = '';
if (asset) {
  const res = await fetch(`${server}/published/${slug}/production/${asset}`);
  assetStatus = res.status;
  assetType = String(res.headers.get('content-type') || '');
  await res.arrayBuffer();
}
check('asset JS servido como javascript', assetStatus === 200 && /javascript/i.test(assetType), `${assetStatus} ${assetType}`);

const deploy = (await (await fetch(`${server}/api/deploy/status?root=${encodeURIComponent(ws)}`)).json()) as Json;
const remoteConfigured = deploy.configured ?? deploy.status?.configured ?? null;
check('deploy remoto desactivado', remoteConfigured === false, JSON.stringify(deploy).slice(0, 160));

const report = {
  runId,
  task: 'T7',
  surface: 'API local',
  workspace: path.relative(repo, ws).replace(/\\/g, '/'),
  server,
  startedAt: new Date(startedAt).toISOString(),
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  slug,
  release1,
  release2,
  productionAfterRollback: (rb.status as PublishStatus | undefined)?.production?.id ?? null,
  hashes: { indexSeed, indexFinal: sha('index.html') },
  asset: { path: asset ?? null, status: assetStatus, contentType: assetType },
  remoteConfigured,
  checks,
  passed: checks.every((c) => c.ok),
  score: `${checks.filter((c) => c.ok).length}/${checks.length}`,
  log,
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(
  JSON.stringify(
    {
      runId,
      workspace: report.workspace,
      slug,
      release1,
      release2,
      checks: checks.map((c) => `${c.ok ? '✔' : '✖'} ${c.name}`),
      score: report.score,
      passed: report.passed,
      durationMs: report.durationMs,
      asset: report.asset,
      remoteConfigured,
      report: path.relative(repo, reportPath).replace(/\\/g, '/'),
    },
    null,
    1
  )
);

process.exitCode = report.passed ? 0 : 1;
