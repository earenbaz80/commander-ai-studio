export interface ThreadSummary {
  id: string; project_id: string | null; project_path: string | null; title: string | null;
  status: string; model: string | null; agent_mode: string; execution_mode: string; turn_state: string;
  created_at: number; updated_at: number; pinned?: number | null; state_json?: string | null;
}

export async function getThread(id: string): Promise<ThreadSummary | null> {
  const res = await fetch(`/api/threads/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return (data as any).thread || null;
}

export async function listThreads(filter?: { projectId?: string; projectPath?: string }): Promise<ThreadSummary[]> {
  const qs: string[] = [];
  if (filter?.projectId) qs.push('projectId=' + encodeURIComponent(filter.projectId));
  if (filter?.projectPath) qs.push('projectPath=' + encodeURIComponent(filter.projectPath));
  const url = qs.length ? '/api/threads?' + qs.join('&') : '/api/threads';
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data as any).threads || [];
}

export async function updateThread(id: string, patch: { title?: string; pinned?: boolean }): Promise<ThreadSummary | null> {
  const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data as any).thread || null;
}

export async function createThread(t: { id: string; projectId?: string; projectPath?: string; title?: string; model?: string; agentMode?: string; executionMode?: string; stateJson?: string; }): Promise<ThreadSummary | null> {
  const res = await fetch('/api/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) });
  if (!res.ok) return null;
  const data = await res.json();
  return (data as any).thread || null;
}

export async function appendMessage(threadId: string, msg: { requestId?: string; inputId?: string; origin?: string; steering?: boolean; role: string; parts: unknown; attachments?: unknown; metrics?: unknown; ts?: number; }): Promise<number | null> {
  const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) });
  if (!res.ok) return null;
  const data = await res.json();
  return (data as any).seq ?? null;
}

export async function loadMessages(threadId: string, limit = 200): Promise<any[]> {
  const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=${limit}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data as any).messages || [];
}

/** Coincidencia dentro de un mensaje, tal como la devuelve /api/search. */
export interface ConversationHit { thread_id: string; seq: number; snippet: string }

export async function searchConversations(q: string, limit = 20): Promise<ConversationHit[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data as any).results || [];
}

export async function deleteThread(id: string): Promise<boolean> {
  const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.ok;
}
