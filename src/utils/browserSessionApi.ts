/**
 * Cliente del panel Navegador.
 *
 * Todo pasa por la sesión de Playwright del servidor: el renderer nunca crea
 * otra instancia ni usa un iframe para "simular" la página.
 */

export interface BrowserNavigationState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserSessionInfo {
  id: string;
  root: string;
  status: 'ready' | 'closed';
  createdAt: number;
  page: BrowserNavigationState;
  viewport: { width: number; height: number };
  lastSeq: number;
  oldestSeq: number;
  lastActor: 'user' | 'agent' | null;
}

export interface BrowserConsoleEntry {
  seq: number;
  type: string;
  text: string;
  ts: number;
  url?: string;
  line?: number;
  column?: number;
}

export interface BrowserNetworkEntry {
  seq: number;
  requestId: string;
  kind: 'http' | 'failed';
  method: string;
  url: string;
  status?: number;
  error?: string;
  ts: number;
  durationMs: number;
  resourceType?: string;
}

export interface BrowserFrame {
  seq: number;
  ts: number;
  mimeType: 'image/jpeg';
  data: string;
  width: number;
  height: number;
  url: string;
  title: string;
}

export interface BrowserScreenshot {
  mimeType: 'image/png';
  data: string;
  url: string;
  title: string;
  width: number;
  height: number;
  fullPage: boolean;
}

export type BrowserInput =
  | { action: 'navigate'; url: string }
  | { action: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle'; clickCount?: number }
  | { action: 'type'; text: string }
  | { action: 'key'; key: string }
  | { action: 'scroll'; deltaX?: number; deltaY?: number }
  | { action: 'back' | 'forward' | 'reload' };

interface SessionResponse {
  success: boolean;
  session?: BrowserSessionInfo;
  error?: string;
}

async function readJson(res: Response): Promise<any> {
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return json;
}

export async function ensureBrowserSession(root: string, url?: string): Promise<BrowserSessionInfo> {
  if (!root.trim()) throw new Error('Proyecto requerido para abrir el navegador');
  const res = await fetch('/api/browser/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, ...(url ? { url } : {}) }),
  });
  const json: SessionResponse = await readJson(res);
  if (!json.session) throw new Error('El servidor no devolvió la sesión');
  return json.session;
}

/** Busca una sesión existente sin arrancar Chromium. */
export async function getBrowserSession(root: string): Promise<BrowserSessionInfo | null> {
  if (!root.trim()) return null;
  const res = await fetch(`/api/browser/session?root=${encodeURIComponent(root)}`);
  if (res.status === 404) return null;
  const json: SessionResponse = await readJson(res);
  return json.session || null;
}

export async function getBrowserSessionById(id: string): Promise<BrowserSessionInfo | null> {
  if (!id.trim()) return null;
  const res = await fetch(`/api/browser/session/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  const json: SessionResponse = await readJson(res);
  return json.session || null;
}

export async function listBrowserSessions(): Promise<BrowserSessionInfo[]> {
  const res = await fetch('/api/browser/sessions');
  const json = await readJson(res);
  return Array.isArray(json.sessions) ? json.sessions : [];
}

export async function sendBrowserInput(sessionId: string, input: BrowserInput): Promise<BrowserSessionInfo> {
  const res = await fetch(`/api/browser/session/${encodeURIComponent(sessionId)}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await readJson(res);
  if (!json.session) throw new Error('El servidor no devolvió la sesión');
  return json.session;
}

export async function captureBrowserSessionScreenshot(
  sessionId: string,
  fullPage = false,
): Promise<BrowserScreenshot> {
  const res = await fetch(`/api/browser/session/${encodeURIComponent(sessionId)}/screenshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullPage }),
  });
  const json = await readJson(res);
  if (!json.screenshot) throw new Error('El servidor no devolvió la captura');
  return json.screenshot as BrowserScreenshot;
}

export async function getBrowserSessionLogs(
  sessionId: string,
  after = 0,
  limit = 200,
): Promise<{ console: BrowserConsoleEntry[]; network: BrowserNetworkEntry[] }> {
  const res = await fetch(
    `/api/browser/session/${encodeURIComponent(sessionId)}/logs?after=${after}&limit=${limit}`,
  );
  const json = await readJson(res);
  return {
    console: Array.isArray(json.console) ? json.console : [],
    network: Array.isArray(json.network) ? json.network : [],
  };
}

export async function closeBrowserSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/browser/session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
}

export function browserSessionStreamUrl(sessionId: string): string {
  return `/api/browser/session/${encodeURIComponent(sessionId)}/stream`;
}
