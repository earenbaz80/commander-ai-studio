// Lanza el dev server desacoplado y espera a que responda /api/health.
// Uso: node scripts/start-dev.cjs
const { spawn } = require('node:child_process');
const path = require('node:path');

const cwd = path.join(__dirname, '..');
const url = 'http://localhost:3001/api/health';

const attempts = 30;
let n = 0;

async function ping() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

(async () => {
  // En Windows los .cmd requieren shell:true; detached lo desacopla del proceso padre.
  const child = spawn('npm', ['run', 'dev'], {
    cwd,
    detached: true,
    stdio: 'ignore',
    shell: process.platform === 'win32',
    env: { ...process.env, NODE_ENV: '', PORT: '', ELECTRON_START_URL: '' },
  });
  child.unref();

  while (n < attempts) {
    if (await ping()) {
      console.log(`OK dev server arriba (pid ${child.pid}) en http://localhost:3001`);
      return;
    }
    n += 1;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error('FALLO: el dev server no respondió /api/health');
  process.exit(1);
})();
