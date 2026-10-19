const API_BASE = '/api/sessions';

export async function forkSessionWorkspace(sourcePath: string): Promise<{ id: string; path: string }> {
  const res = await fetch(`${API_BASE}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ projectPath: sourcePath }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear el workspace de sesión');
  return { id: data.id, path: data.path };
}

export async function deleteSessionWorkspace(id: string): Promise<void> {
  if (!id) return;
  try {
    await fetch(`${API_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
  } catch { /* best effort */ }
}

export async function listSessionWorkspaces(): Promise<Array<{ id: string; path: string; source: string; createdAt: number }>> {
  try {
    const res = await fetch(API_BASE, { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    return data.success ? data.sessions || [] : [];
  } catch { return []; }
}