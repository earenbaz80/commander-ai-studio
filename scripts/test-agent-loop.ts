// Test lógica del AgentLoop con fetch simulado (sin API real).
// Valida: vía nativa, ejecución paralela, memoria (turns), finalización.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

const runToolCalls: string[] = [];
let genCalls = 0;

(globalThis as any).fetch = async (url: string, opts: any) => {
  const body = JSON.parse(opts.body);
  if (String(url).includes('/api/gemini/generate')) {
    genCalls++;
    if (genCalls === 1) {
      return { ok: true, json: async () => ({
        success: true,
        text: 'Voy a leer dos archivos en paralelo',
        functionCalls: [
          { name: 'fs_read', args: { path: 'a.ts' } },
          { name: 'fs_read', args: { path: 'b.ts' } },
        ],
      }) };
    }
    return { ok: true, json: async () => ({ success: true, text: 'Listo, ambos leídos.', functionCalls: [] }) };
  }
  if (String(url).includes('/api/agent/run-tool')) {
    runToolCalls.push(`${body.toolId}:${JSON.stringify(body.input)}`);
    return { ok: true, json: async () => ({ ok: true, data: { content: 'x', exists: true } }) };
  }
  throw new Error('fetch inesperado: ' + url);
};

import { AgentOrchestrator } from '../src/agent/orchestrator';
import { AgentLoop } from '../src/agent/loop';

const noop = () => {};
const orch = new AgentOrchestrator({
  cwd: '.',
  onStep: noop,
  onPlanChange: noop,
  onStateChange: noop,
  approve: async () => ({ approved: true }),
});
const loop = new AgentLoop(orch, 'gemini-2.5-flash');

const assert = (name: string, cond: boolean) => {
  console.log(`${cond ? 'OK' : 'FAIL'} ${name}`);
  if (!cond) process.exitCode = 1;
};

(async () => {
  await loop.start({ id: 't1', goal: 'test paralelo', cwd: '.', maxSteps: 30 });
  // Espera a que el loop termine (timers de 400ms entre pasos)
  for (let i = 0; i < 40 && orch.getState().running; i++) {
    await new Promise((r) => setTimeout(r, 300));
  }
  const st = orch.getState();
  assert('loop terminó', !st.running);
  assert('2 tools en paralelo (a.ts+b.ts)', runToolCalls.some((c) => c.includes('a.ts')) && runToolCalls.some((c) => c.includes('b.ts')));
  assert('rutas fs.read', runToolCalls.every((c) => c.startsWith('fs.read:')));
  assert('thought registrado', st.steps.some((s) => s.type === 'thought' && s.title === 'Razonamiento'));
  assert('finalizado', st.steps.some((s) => s.title === 'Finalizado'));
  assert('memoria turns>0', (loop as any).turns.length > 0);
  assert('2 llamadas generate', genCalls === 2);
})();
