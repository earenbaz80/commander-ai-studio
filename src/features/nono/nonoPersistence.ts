export interface NonoObservation { id: number; project_id: string | null; kind: string; content: string; ts: number; }

export async function saveObservation(projectId: string | null, kind: string, content: string): Promise<number | null> {
  try {
    const res = await fetch('/api/nono/observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, kind, content }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data as any).id ?? null;
  } catch { return null; }
}

export async function listObservations(projectId: string | null, limit = 50): Promise<NonoObservation[]> {
  try {
    const url = `/api/nono/observations?${projectId ? `projectId=${encodeURIComponent(projectId)}&` : ''}limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data as any).observations || [];
  } catch { return []; }
}

export async function searchObservations(projectId: string | null, query: string, limit = 20): Promise<NonoObservation[]> {
  try {
    const url = `/api/nono/observations?${projectId ? `projectId=${encodeURIComponent(projectId)}&` : ''}q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data as any).observations || [];
  } catch { return []; }
}
