/**
 * Cliente del backend multiinquilino local.
 *
 * El token se pasa explícitamente en cada petición autenticada; este módulo no
 * lo guarda. La vista decide dónde vive (sessionStorage) y lo borra al cerrar
 * sesión. El servidor deriva tenant_id y user_id del bearer, nunca del body.
 */

export interface BackendUser {
  id: string;
  email: string;
  name: string;
  createdAt?: string;
}

export interface BackendTenant {
  id: string;
  name: string;
}

export interface BackendSession {
  token: string;
  expiresAt?: number;
  user: BackendUser;
  tenant: BackendTenant;
}

export interface BackendRecord {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackendFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

export class BackendApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'BackendApiError';
  }
}

const BASE = '/api/backend';

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  return `Error ${status}`;
}

async function request<T>(
  path: string,
  token: string | null,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok || (data && typeof data === 'object' && (data as { success?: unknown }).success === false)) {
    throw new BackendApiError(errorMessage(data, res.status), res.status);
  }
  return data as T;
}

export async function register(input: {
  email: string;
  password: string;
  name: string;
  tenantName?: string;
}): Promise<BackendSession> {
  return request<BackendSession>('/auth/register', null, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<BackendSession> {
  return request<BackendSession>('/auth/login', null, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function me(token: string): Promise<{ user: BackendUser; tenant: BackendTenant }> {
  return request<{ user: BackendUser; tenant: BackendTenant }>('/auth/me', token);
}

export async function logout(token: string): Promise<void> {
  await request<{ success: true }>('/auth/logout', token, { method: 'POST' });
}

export async function listRecords(token: string): Promise<BackendRecord[]> {
  const data = await request<{ records: BackendRecord[] }>('/records', token);
  return data.records;
}

export async function createRecord(
  token: string,
  input: { title: string; body: string }
): Promise<BackendRecord> {
  const data = await request<{ record: BackendRecord }>('/records', token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.record;
}

export async function updateRecord(
  token: string,
  id: string,
  input: { title: string; body: string }
): Promise<BackendRecord> {
  const data = await request<{ record: BackendRecord }>(`/records/${encodeURIComponent(id)}`, token, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return data.record;
}

export async function deleteRecord(token: string, id: string): Promise<void> {
  await request<void>(`/records/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
}

export async function listFiles(token: string): Promise<BackendFile[]> {
  const data = await request<{ files: BackendFile[] }>('/files', token);
  return data.files;
}

export async function deleteFile(token: string, id: string): Promise<void> {
  await request<void>(`/files/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
}

/**
 * Los headers HTTP no aceptan nombres de archivo no ASCII. El servidor vuelve a
 * sanear el valor; aquí se conserva el nombre legible todo lo posible sin
 * romper `fetch` en navegadores que rechazan bytes fuera de Latin-1.
 */
function safeFileName(name: string): string {
  return (
    name
      .replace(/[\r\n"]/g, '_')
      .replace(/[^\x20-\x7e]/g, '_')
      .trim()
      .slice(0, 200) || 'archivo.bin'
  );
}

export async function uploadFile(token: string, file: File): Promise<BackendFile> {
  const res = await fetch(`${BASE}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file.type || 'application/octet-stream',
      'X-Commander-File-Name': safeFileName(file.name),
    },
    body: file,
    credentials: 'same-origin',
  });

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data !== 'object' || !(data as { file?: unknown }).file) {
    throw new BackendApiError(errorMessage(data, res.status), res.status);
  }
  return (data as { file: BackendFile }).file;
}

export async function downloadFile(token: string, id: string): Promise<Blob> {
  const res = await fetch(`${BASE}/files/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    throw new BackendApiError(errorMessage(data, res.status), res.status);
  }
  return res.blob();
}
