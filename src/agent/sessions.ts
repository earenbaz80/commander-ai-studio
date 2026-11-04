import { type AgentState } from './types';
import * as serverPersistence from './persistence';

export interface AgentSession {
  id: string;
  goal: string;
  ts: number;
  state: AgentState;
}

const KEY = 'commander_agent_sessions_v1';
const MAX = 20;

function loadLocal(): AgentSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocal(sessions: AgentSession[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(sessions)); } catch { /* ignore */ }
}

export function loadSessions(): AgentSession[] {
  return loadLocal();
}

export function getSession(id: string): AgentSession | undefined {
  return loadLocal().find((s) => s.id === id);
}

export function saveSession(s: AgentSession): void {
  // 1. Local (síncrono, inmediato, para la UI).
  const sessions = loadLocal().filter((x) => x.id !== s.id);
  sessions.unshift(s);
  if (sessions.length > MAX) sessions.length = MAX;
  saveLocal(sessions);

  // 2. Servidor (durable, asíncrono, fire-and-forget). No bloquea la UI.
  // Una corrida que no persiste hilo (la auditoría del chat) tampoco debe crear
  // sesión al guardarse: parar o el autoguardado abría una sesión más por
  // corrida, y el botón Detener seguía llenando el historial.
  if (s.state?.task?.persistThread === false) return;
  void (async () => {
    try {
      const projectId = (s.state as any)?.projectPath || (s.state as any)?.cwd || undefined;
      if (projectId) {
        await serverPersistence.createThread({
          id: s.id,
          projectPath: projectId,
          title: s.goal.slice(0, 80),
          model: (s.state as any)?.model,
          agentMode: (s.state as any)?.mode,
        });
      } else {
        await serverPersistence.createThread({ id: s.id, title: s.goal.slice(0, 80), model: (s.state as any)?.model });
      }
      await serverPersistence.appendMessage(s.id, {
        requestId: `goal-${s.id}`,
        role: 'user',
        parts: { goal: s.goal },
        ts: s.ts,
      });
      await serverPersistence.appendMessage(s.id, {
        requestId: `state-${s.id}`,
        role: 'assistant',
        parts: { state: s.state },
        ts: s.ts,
      });
    } catch { /* servidor no disponible: queda en localStorage */ }
  })();
}

/**
 * Guarda como mucho una vez por segundo.
 *
 * El estado cambia en cada paso del agente, y escribir en localStorage y en el
 * servidor en cada uno sería tirar trabajo. Con este margen, si el proceso se
 * corta (recarga, cierre de la app, servidor caído) se pierde como mucho el
 * último segundo de avance, y la sesión queda lista para continuar.
 */
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSession: AgentSession | null = null;

export function saveSessionThrottled(s: AgentSession): void {
  pendingSession = s;
  if (throttleTimer) return;
  throttleTimer = setTimeout(() => {
    throttleTimer = null;
    const next = pendingSession;
    pendingSession = null;
    if (next) saveSession(next);
  }, 1000);
}

export async function loadSessionFromServer(id: string): Promise<AgentSession | null> {
  try {
    const t = await serverPersistence.getThread(id);
    if (!t) return null;
    const msgs = await serverPersistence.loadMessages(id);
    let state: AgentState | null = null;
    let goal = t.title || '';
    for (const m of msgs) {
      try {
        const parts = JSON.parse(m.parts_json);
        if (m.role === 'user' && parts?.goal) goal = parts.goal;
        if (m.role === 'assistant' && parts?.state) state = parts.state as AgentState;
      } catch { /* ignore */ }
    }
    if (!state) return null;
    return { id: t.id, goal, ts: t.updated_at, state };
  } catch {
    return null;
  }
}

export async function loadSessionsFromServer(): Promise<AgentSession[]> {
  try {
    const threads = await serverPersistence.listThreads();
    const out: AgentSession[] = [];
    for (const t of threads) {
      const s = await loadSessionFromServer(t.id);
      if (s) out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}
export function deleteSession(id: string): void {
  const sessions = loadLocal().filter((s) => s.id !== id);
  saveLocal(sessions);
  void serverPersistence.deleteThread(id).catch(() => { /* ignore */ });
}

export function clearSessions(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
