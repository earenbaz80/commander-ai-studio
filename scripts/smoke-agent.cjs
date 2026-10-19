// Smoke test contra un servidor en marcha (SMOKE_URL, por defecto http://localhost:3000).
// Con SMOKE_PROD=1 se asume build de producción: exige las restricciones de producción
// (debug cerrado, CSP presente). Sin esa variable se asume desarrollo.
const base = process.env.SMOKE_URL || 'http://localhost:3000';
const isProd = process.env.SMOKE_PROD === '1';
const JSZip = require('jszip');

async function check(name, fn) {
  try { await fn(); console.log(`OK ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

const postJson = (path, body, headers = {}) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

(async () => {
  await check('health', async () => {
    const r = await fetch(`${base}/api/health`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });
  await check('agent fs.glob', async () => {
    const r = await postJson('/api/agent/run-tool', { toolId: 'fs.glob', input: { pattern: 'src/**/*.tsx' } });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'not ok');
  });
  await check('agent tool inválido 400', async () => {
    const r = await postJson('/api/agent/run-tool', { toolId: 'rm -rf', input: {} });
    if (r.status !== 400) throw new Error(`esperaba 400, fue ${r.status}`);
  });
  await check('debug de Gemini: 403 en prod, abierto en dev', async () => {
    const r = await fetch(`${base}/api/gemini/debug/listModels`);
    if (isProd && r.status !== 403) throw new Error(`en producción esperaba 403, fue ${r.status}`);
    if (!isProd && r.status === 403) throw new Error('en desarrollo debería estar abierto');
  });
  await check('CSP presente solo en producción', async () => {
    const r = await fetch(`${base}/`);
    const csp = r.headers.get('content-security-policy');
    if (isProd && !csp) throw new Error('falta Content-Security-Policy en producción');
    if (!isProd && csp) throw new Error('CSP aplicada en desarrollo (bloquearía Vite HMR)');
  });
  await check('origen externo bloqueado en /api/agent/run-tool', async () => {
    const r = await postJson('/api/agent/run-tool',
      { toolId: 'fs.glob', input: { pattern: 'src/**/*.tsx' } },
      { Origin: 'https://evil.example' });
    if (r.status !== 403) throw new Error(`esperaba 403, fue ${r.status}`);
  });
  await check('origen externo bloqueado en mutaciones de checkpoints', async () => {
    const r = await postJson('/api/checkpoints', { root: process.cwd(), label: 'x' },
      { Origin: 'https://evil.example' });
    if (r.status !== 403) throw new Error(`esperaba 403, fue ${r.status}`);
  });
  await check('custom/models solo acepta POST (la clave no va en la URL)', async () => {
    // El fallback SPA devuelve index.html (no JSON) para cualquier GET no registrado.
    const r = await fetch(`${base}/api/custom/models?apiKey=x`);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) throw new Error('GET /api/custom/models sigue respondiendo como API');
  });
  await check('hf download-local rechaza modelId inválido', async () => {
    const r = await postJson('/api/hf/download-local', { modelId: '../../api/whoami' });
    if (r.status !== 400) throw new Error(`esperaba 400, fue ${r.status}`);
  });
  await check('export ZIP devuelve application/zip', async () => {
    const r = await postJson('/api/export/native-project',
      { projectName: 'smoke app', files: [{ path: 'src/App.tsx', content: 'export default null;' }] });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/zip')) throw new Error(`content-type: ${ct}`);
    const cd = r.headers.get('content-disposition') || '';
    if (!cd.includes('attachment') || !cd.includes('filename=')) throw new Error(`content-disposition: ${cd}`);
    if (!cd.includes('smoke-app.zip')) throw new Error(`filename no sanitizado: ${cd}`);
  });
  await check('export ZIP: path traversal neutralizado', async () => {
    const r = await postJson('/api/export/native-project', {
      projectName: 'traversal',
      files: [{ path: '../../evil.txt', content: 'x' }, { path: '/abs.txt', content: 'x' }, { path: '....//oculto.txt', content: 'x' }],
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const zip = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
    const names = Object.keys(zip.files);
    if (names.some((n) => n.includes('evil.txt'))) throw new Error(`entrada con traversal: ${names.join(', ')}`);
    if (names.some((n) => n.startsWith('/'))) throw new Error(`entrada absoluta: ${names.join(', ')}`);
  });
  await check('export ZIP: projectName escapado en index.html', async () => {
    const r = await postJson('/api/export/native-project', { projectName: '<script>alert(1)</script>' });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const zip = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
    const html = await zip.file('index.html').async('string');
    if (html.includes('<script>alert(1)</script>')) throw new Error('título sin escapar en index.html');
    if (!html.includes('&lt;script&gt;')) throw new Error('título no aparece escapado');
    const cd = r.headers.get('content-disposition') || '';
    if (cd.includes('<')) throw new Error(`header injection: ${cd}`);
  });
})();
