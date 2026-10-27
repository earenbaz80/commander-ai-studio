// E2E agente: health + roundtrip fs (write/read/edit) + generate (si hay key).
// Requiere servidor en SMOKE_URL (default http://localhost:3000).
const fs = require('fs');
try { require('dotenv').config(); } catch { /* dotenv opcional */ }
const base = process.env.SMOKE_URL || 'http://localhost:3001';
let fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`OK ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); fail = 1; }
}
async function agent(toolId, input) {
  const r = await fetch(`${base}/api/agent/run-tool`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId, input }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || `tool ${toolId} not ok`);
  return j.data;
}
(async () => {
  await check('health', async () => {
    const r = await fetch(`${base}/api/health`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });
  const tmp = `e2e-agent-${Date.now()}.txt`;
  await check('fs.write roundtrip', async () => {
    await agent('fs.write', { path: tmp, content: 'hola e2e', overwrite: true });
  });
  await check('fs.read roundtrip', async () => {
    const d = await agent('fs.read', { path: tmp });
    if (!String(d.content).includes('hola e2e')) throw new Error('contenido inesperado');
  });
  await check('fs.edit roundtrip', async () => {
    const d = await agent('fs.edit', { path: tmp, oldString: 'hola e2e', newString: 'hola e2e ok' });
    if (d.replaced !== 1) throw new Error('replaced != 1');
  });
  await check('fs.grep encuentra', async () => {
    const d = await agent('fs.grep', { pattern: 'hola e2e ok' });
    if (!d.matches.length) throw new Error('sin matches');
  });
  await check('cleanup', async () => {
    fs.rmSync(tmp, { force: true });
  });
  if (process.env.GEMINI_API_KEY) {
    await check('gemini generate', async () => {
      const r = await fetch(`${base}/api/gemini/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: 'Responde solo: OK', model: 'gemini-2.0-flash', maxTokens: 16 }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'generate falló');
    });
  } else {
    console.log('SKIP gemini generate (sin GEMINI_API_KEY)');
  }
  process.exit(fail);
})();
