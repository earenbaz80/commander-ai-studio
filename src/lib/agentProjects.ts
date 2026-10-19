/** Cliente de la allowlist de proyectos del agente. */

export interface AgentRoot {
  path: string;
  name: string;
  removable: boolean;
  cwd: boolean;
}

async function parse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Respuesta inválida del servidor (HTTP ${res.status})`);
  }
}

export async function listAgentRoots(): Promise<AgentRoot[]> {
  const res = await fetch('/api/agent/roots');
  const data = await parse(res);
  if (!data.success) throw new Error(data.error || 'No se pudieron cargar los proyectos');
  return data.roots || [];
}

export async function addAgentRoot(path: string): Promise<AgentRoot[]> {
  const res = await fetch('/api/agent/roots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const data = await parse(res);
  if (!data.success) throw new Error(data.error || 'No se pudo añadir el proyecto');
  return listAgentRoots();
}

export async function removeAgentRoot(path: string): Promise<AgentRoot[]> {
  const res = await fetch('/api/agent/roots', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const data = await parse(res);
  if (!data.success) throw new Error(data.error || 'No se pudo quitar el proyecto');
  return listAgentRoots();
}

export async function createProject(name: string, parentDir?: string): Promise<{ path: string; name: string }> {
  const res = await fetch('/api/agent/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentDir }),
  });
  const data = await parse(res);
  if (!data.success) throw new Error(data.error || 'No se pudo crear el proyecto');
  return { path: data.path, name: data.name };
}
