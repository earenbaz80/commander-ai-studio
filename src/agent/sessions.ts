import type { AgentState } from './types';

const KEY = 'commander_agent_sessions_v1';
export interface AgentSession {
  id: string;
  goal: string;
  ts: number;
  state: AgentState;
}

export function loadSessions(): AgentSession[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch { return []; }
}

export function saveSession(s: AgentSession) {
  try {
    const all = loadSessions().filter((x) => x.id !== s.id);
    all.unshift(s);
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 20)));
  } catch { /* ignore */ }
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

export function getSession(id: string): AgentSession | undefined {
  return loadSessions().find((x) => x.id === id);
}

export function deleteSession(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadSessions().filter((x) => x.id !== id)));
  } catch { /* ignore */ }
}

export function clearSessions() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
