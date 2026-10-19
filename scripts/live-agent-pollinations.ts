// Loop agente REAL contra Pollinations (sin mocks): valida LLM->tools->LLM en vivo.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

const BASE = process.env.SMOKE_URL || 'http://localhost:3100';
const realFetch = globalThis.fetch;
(globalThis as any).fetch = (url: string, opts: any) =>
  realFetch(String(url).startsWith('/api') ? BASE + url : url, opts);

import { AgentOrchestrator } from '../src/agent/orchestrator';
import { AgentLoop } from '../src/agent/loop';

const orch = new AgentOrchestrator({
  cwd: '.',
  onStep: () => {},
  onPlanChange: () => {},
  onStateChange: () => {},
  approve: async () => ({ approved: true }),
});
const loop = new AgentLoop(orch, 'pollinations/openai');

(async () => {
  await loop.start({ id: 'live1', goal: 'Usa fs.glob con pattern src/agent/*.ts y termina resumiendo cuántos archivos hay', cwd: '.', maxSteps: 30 });
  for (let i = 0; i < 60 && orch.getState().running; i++) {
    await new Promise((r) => setTimeout(r, 3000));
  }
  const st = orch.getState();
  console.log('running:', st.running);
  for (const s of st.steps) {
    console.log(`- [${s.type}] ${s.title}${s.toolId ? ` (${s.toolId})` : ''} :: ${String(s.content || '').slice(0, 220)}`);
  }
})();
