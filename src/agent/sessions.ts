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
