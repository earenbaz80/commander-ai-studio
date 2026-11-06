/**
 * Navegador del agente (Playwright) — driver server-side.
 *
 * Un solo proceso Chromium headless compartido, con un contexto aislado por
 * sesión (cookies/storage separados). Las sesiones viven en memoria del
 * servidor: cada tool-call es una petición HTTP distinta, así que el navegador
 * NO puede cerrarse entre llamadas.
 *
 * Playwright se carga de forma diferida: si no está instalado (o falta el
 * binario de Chromium) el error lo dice con el comando exacto para arreglarlo,
 * en vez de tumbar el servidor al importar el módulo.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_SNAPSHOT_NODES,
  BROWSER_ACTIONS,
  formatSnapshot,
  normalizeBrowserUrl,
  resolveUid,
  toSnapshotNodes,
  type BrowserAction,
  type SnapshotNode,
} from './src/agent/browserTarget';
import { assertSafeOutboundUrl } from './ssrf';

/** Sesiones simultáneas: al abrir una más se cierra la más antigua. */
export const MAX_SESSIONS = 3;
/** Tope de entradas de log guardadas por sesión (consola y red por separado). */
const MAX_LOG_ENTRIES = 200;
/** Tiempo máximo de una acción del navegador (evita colgar la petición HTTP). */
const ACTION_TIMEOUT_MS = 25_000;
const NAV_TIMEOUT_MS = 20_000;
const CLICK_TIMEOUT_MS = 8_000;
/** El panel no necesita 60 fps: un frame JPEG cada 700 ms ya se siente vivo. */
const FRAME_INTERVAL_MS = 700;
const FRAME_QUALITY = 62;

const INSTALL_HINT =
  'Playwright no está disponible. Instálalo con `npm i -D playwright` y descarga el navegador con `npx playwright install chromium`.';

/**
 * Selector de elementos que interesan al agente: interactivos (para actuar) y
 * encabezados (para orientarse).
 */
const COLLECT_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[role]',
  '[contenteditable="true"]',
  '[onclick]',
  'h1',
  'h2',
  'h3',
].join(',');

/**
 * Script que se ejecuta dentro de la página. Devuelve el array que consume
 * `toSnapshotNodes` (rol, nombre accesible, valor y profundidad). El orden es el
 * del DOM y es el mismo en cada llamada: es lo que da sentido al índice de un
 * `uid` entre el snapshot y la acción.
 */
const COLLECT_SCRIPT = `(() => {
  const MAX = ${MAX_SNAPSHOT_NODES + 50};
  /** Hojas de texto que se añaden al final (resultados de una acción, avisos). */
  const MAX_TEXT_LEAVES = 40;

  const labelFor = (el) => {
    const id = el.getAttribute && el.getAttribute('id');
    if (id) {
      try {
        const l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(id) : id).replace(/"/g, '') + '"]');
        if (l && l.textContent) return l.textContent;
      } catch (e) { /* id raro */ }
    }
    const wrap = el.closest && el.closest('label');
    return (wrap && wrap.textContent) || '';
  };

  const nameOf = (el) => {
    const attr = (n) => (el.getAttribute ? el.getAttribute(n) : null);
    return attr('aria-label') || attr('placeholder') || attr('title') || attr('alt')
      || (el.innerText || el.textContent || '') || labelFor(el) || el.value || el.name || '';
  };

  const roleOf = (el) => {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      return 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'iframe') return 'iframe';
    if (tag === 'audio') return 'audio';
    if (tag === 'video') return 'video';
    return tag;
  };

  const isHidden = (el) => {
    if (el.type === 'hidden') return true;
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return false;
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  };

  const els = Array.from(document.querySelectorAll(${JSON.stringify(COLLECT_SELECTOR)})).slice(0, MAX);
  const chosen = new Set(els);

  // Sin esta pasada, un <div></div> donde el clic escribe el resultado sería
  // invisible para el agente: acaba de actuar y no puede comprobar el efecto.
  // Sólo hojas de texto (sin hijos elemento) y con un tope, para no inundar.
  const extras = [];
  for (const el of document.querySelectorAll('body *')) {
    if (extras.length >= MAX_TEXT_LEAVES) break;
    if (chosen.has(el) || el.firstElementChild) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'br' || tag === 'template') continue;
    if (!(el.textContent || '').trim() || isHidden(el)) continue;
    extras.push(el);
    chosen.add(el);
  }

  const all = els.concat(extras);
  const set = new Set(all);

  return all.filter((el) => !isHidden(el)).map((el) => {
    let depth = 0;
    for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) depth++;
    const value = el.value;
    return {
      role: String(roleOf(el)),
      name: String(nameOf(el) || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
      ...(typeof value === 'string' && value ? { value: value.slice(0, 200) } : {}),
      depth: Math.min(depth, 8),
    };
  }).slice(0, ${MAX_SNAPSHOT_NODES + 50});
})()`;

export type BrowserActor = 'user' | 'agent';
export type BrowserSessionStatus = 'ready' | 'closed';

export interface BrowserConsoleEntry {
  seq: number;
  /** log | debug | info | warning | error | pageerror */
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

export interface BrowserNavigationState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserSessionInfo {
  id: string;
  root: string;
  status: BrowserSessionStatus;
  createdAt: number;
  page: BrowserNavigationState;
  viewport: { width: number; height: number };
  lastSeq: number;
  oldestSeq: number;
  lastActor: BrowserActor | null;
}

export type BrowserSessionEvent =
  | { type: 'frame'; seq: number; frame: BrowserFrame }
  | { type: 'console'; seq: number; entry: BrowserConsoleEntry }
  | { type: 'network'; seq: number; entry: BrowserNetworkEntry }
  | { type: 'navigation'; seq: number; state: BrowserNavigationState }
  | { type: 'status'; seq: number; status: BrowserSessionStatus; lastActor: BrowserActor | null };

type BrowserListener = (event: BrowserSessionEvent) => void;

interface Session {
  id: string;
  root: string;
  context: any;
  page: any;
  /** Sesión CDP para leer el historial real de Chromium. */
  cdp: any | null;
  nodes: SnapshotNode[];
  console: BrowserConsoleEntry[];
  net: BrowserNetworkEntry[];
  createdAt: number;
  lastTitle: string;
  lastActor: BrowserActor | null;
  seq: number;
  requestSeq: number;
  pending: Map<any, { id: string; start: number }>;
  listeners: Set<BrowserListener>;
  lastFrame: BrowserFrame | null;
  frameTimer: ReturnType<typeof setInterval> | null;
  frameBusy: boolean;
}

export interface BrowserResult<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

const sessions = new Map<string, Session>();
let browserPromise: Promise<any> | null = null;
let seq = 0;
let exiting = false;

function trim<T>(list: T[], extra: T): T[] {
  list.push(extra);
  if (list.length > MAX_LOG_ENTRIES) list.splice(0, list.length - MAX_LOG_ENTRIES);
  return list;
}

function nextSeq(session: Session): number {
  session.seq += 1;
  return session.seq;
}

function emit(session: Session, event: BrowserSessionEvent): void {
  for (const listener of [...session.listeners]) {
    try {
      listener(event);
    } catch {
      // Un cliente SSE lento o desconectado no puede romper la página.
    }
  }
}

/** Una entrada de historial sólo cuenta si tiene un destino real. */
function historyEntryNavigable(entry: any): boolean {
  const url = String(entry?.url || '').trim();
  return Boolean(url) && url !== 'about:blank';
}

/**
 * Chromium mantiene el historial por página. Leerlo por CDP evita inventar una
 * pila paralela que se desincroniza con back/forward, redirecciones y SPAs.
 */
async function readHistoryFlags(
  session: Session,
): Promise<{ canGoBack: boolean; canGoForward: boolean }> {
  try {
    if (!session.cdp) {
      session.cdp = await withTimeout(
        session.context.newCDPSession(session.page),
        2_000,
        'conectar con el historial',
      );
    }
    const history: any = await withTimeout(
      session.cdp.send('Page.getNavigationHistory'),
      2_000,
      'leer el historial',
    );
    const entries = Array.isArray(history?.entries) ? history.entries : [];
    const index = Number(history?.currentIndex);
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
      return { canGoBack: false, canGoForward: false };
    }
    return {
      canGoBack: index > 0 && historyEntryNavigable(entries[index - 1]),
      canGoForward: index < entries.length - 1 && historyEntryNavigable(entries[index + 1]),
    };
  } catch {
    return { canGoBack: false, canGoForward: false };
  }
}

async function readNavigationState(session: Session): Promise<BrowserNavigationState> {
  const [title, flags] = await Promise.all([
    session.page.title().catch(() => session.lastTitle || ''),
    readHistoryFlags(session),
  ]);
  const safeTitle = String(title || '').slice(0, 200);
  session.lastTitle = safeTitle;
  return {
    url: session.page.url(),
    title: safeTitle,
    ...flags,
  };
}

function emitNavigation(session: Session): void {
  if (!sessions.has(session.id)) return;
  void readNavigationState(session)
    .then((state) => {
      if (!sessions.has(session.id)) return;
      emit(session, {
        type: 'navigation',
        seq: nextSeq(session),
        state,
      });
    })
    .catch(() => {});
}

async function captureFrame(session: Session): Promise<void> {
  if (session.frameBusy || session.listeners.size === 0 || session.page?.isClosed?.()) return;
  session.frameBusy = true;
  try {
    const buffer: Buffer = await withTimeout(
      session.page.screenshot({ type: 'jpeg', quality: FRAME_QUALITY }),
      5_000,
      'capturar el frame',
    );
    if (!sessions.has(session.id)) return;
    const frame: BrowserFrame = {
      seq: nextSeq(session),
      ts: Date.now(),
      mimeType: 'image/jpeg',
      data: buffer.toString('base64'),
      width: 1280,
      height: 800,
      url: session.page.url(),
      title: session.lastTitle,
    };
    session.lastFrame = frame;
    emit(session, { type: 'frame', seq: frame.seq, frame });
  } catch {
    // La página puede estar navegando o cerrada: el siguiente tick lo reintenta.
  } finally {
    session.frameBusy = false;
  }
}

function startFramePump(session: Session): void {
  if (session.frameTimer) return;
  void captureFrame(session);
  session.frameTimer = setInterval(() => void captureFrame(session), FRAME_INTERVAL_MS);
  session.frameTimer.unref?.();
}

function stopFramePump(session: Session): void {
  if (session.frameTimer) clearInterval(session.frameTimer);
  session.frameTimer = null;
}

async function loadChromium(): Promise<any> {
  let mod: any;
  try {
    mod = await import('playwright');
  } catch {
    throw new Error(INSTALL_HINT);
  }
  const chromium = mod?.chromium ?? mod?.default?.chromium;
  if (!chromium) throw new Error(INSTALL_HINT);
  return chromium;
}

/** Chromium perezoso y compartido. Si el binario falta, el error es accionable. */
async function getBrowser(): Promise<any> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const chromium = await loadChromium();
      try {
        return await chromium.launch({ headless: true });
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (/Executable doesn't exist|please run the following command|install/i.test(msg)) {
          throw new Error(`No se pudo lanzar Chromium. ${INSTALL_HINT}`);
        }
        throw new Error(`No se pudo lanzar Chromium: ${msg.slice(0, 300)}`);
      }
    })();
    // Un fallo de arranque no debe quedar cacheado para siempre.
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tiempo agotado (${ms}ms) en ${what}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function forget(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  stopFramePump(session);
  emit(session, {
    type: 'status',
    seq: nextSeq(session),
    status: 'closed',
    lastActor: session.lastActor,
  });
  session.listeners.clear();
  sessions.delete(id);
  void session.context?.close?.().catch?.(() => {});
}

async function newSession(root: string): Promise<Session> {
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) forget(oldest.id);
  }

  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(CLICK_TIMEOUT_MS);

  seq += 1;
  const session: Session = {
    id: `b${seq}`,
    root,
    context,
    page,
    cdp: null,
    nodes: [],
    console: [],
    net: [],
    createdAt: Date.now(),
    lastTitle: '',
    lastActor: null,
    seq: 0,
    requestSeq: 0,
    pending: new Map(),
    listeners: new Set(),
    lastFrame: null,
    frameTimer: null,
    frameBusy: false,
  };

  page.on('console', (msg: any) => {
    const location = msg?.location?.() || {};
    const entry: BrowserConsoleEntry = {
      seq: nextSeq(session),
      type: String(msg?.type?.() || 'log'),
      text: String(msg?.text?.() || '').slice(0, 4000),
      ts: Date.now(),
      ...(location.url ? { url: String(location.url).slice(0, 500) } : {}),
      ...(Number.isFinite(Number(location.lineNumber)) ? { line: Number(location.lineNumber) } : {}),
      ...(Number.isFinite(Number(location.columnNumber)) ? { column: Number(location.columnNumber) } : {}),
    };
    trim(session.console, entry);
    emit(session, { type: 'console', seq: entry.seq, entry });
  });
  page.on('pageerror', (err: any) => {
    const entry: BrowserConsoleEntry = {
      seq: nextSeq(session),
      type: 'pageerror',
      text: String(err?.message || err).slice(0, 4000),
      ts: Date.now(),
    };
    trim(session.console, entry);
    emit(session, { type: 'console', seq: entry.seq, entry });
  });
  page.on('request', (req: any) => {
    session.requestSeq += 1;
    session.pending.set(req, { id: `r${session.requestSeq}`, start: Date.now() });
  });
  page.on('requestfailed', (req: any) => {
    const pending = session.pending.get(req) || { id: `r${++session.requestSeq}`, start: Date.now() };
    session.pending.delete(req);
    const entry: BrowserNetworkEntry = {
      seq: nextSeq(session),
      requestId: pending.id,
      kind: 'failed',
      method: String(req?.method?.() || 'GET'),
      url: String(req?.url?.() || '').slice(0, 1000),
      error: String(req?.failure?.()?.errorText || 'request failed').slice(0, 300),
      ts: Date.now(),
      durationMs: Date.now() - pending.start,
      resourceType: String(req?.resourceType?.() || 'other'),
    };
    trim(session.net, entry);
    emit(session, { type: 'network', seq: entry.seq, entry });
  });
  page.on('response', (res: any) => {
    const req = res?.request?.();
    const pending = (req && session.pending.get(req)) || { id: `r${++session.requestSeq}`, start: Date.now() };
    if (req) session.pending.delete(req);
    const status = Number(res?.status?.() || 0);
    const entry: BrowserNetworkEntry = {
      seq: nextSeq(session),
      requestId: pending.id,
      kind: 'http',
      method: String(req?.method?.() || 'GET'),
      url: String(req?.url?.() || res?.url?.() || '').slice(0, 1000),
      status,
      ts: Date.now(),
      durationMs: Date.now() - pending.start,
      resourceType: String(req?.resourceType?.() || 'other'),
    };
    trim(session.net, entry);
    emit(session, { type: 'network', seq: entry.seq, entry });
  });
  page.on('framenavigated', (frame: any) => {
    if (frame === page.mainFrame()) emitNavigation(session);
  });
  page.on('load', () => emitNavigation(session));

  sessions.set(session.id, session);
  return session;
}

/** Sesión por id, o la última abierta (para no repetir el id en cada llamada). */
function pickSession(id: unknown, root: string): Session | null {
  const wanted = String(id ?? '').trim();
  if (wanted) return sessions.get(wanted) ?? null;
  const mine = [...sessions.values()].filter((s) => !root || s.root === root);
  const pool = mine.length > 0 ? mine : [...sessions.values()];
  return pool.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

/** Normaliza y valida el destino: esquema y seguridad de red en una sola puerta. */
async function safeTarget(raw: unknown): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const check = normalizeBrowserUrl(raw);
  if (!check.ok) return check;
  try {
    await assertSafeOutboundUrl(check.url);
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
  return { ok: true, url: check.url };
}

async function collect(session: Session): Promise<any[]> {
  const raw = await session.page.evaluate(COLLECT_SCRIPT);
  return Array.isArray(raw) ? raw : [];
}

async function snapshot(session: Session) {
  const raw = await collect(session);
  session.nodes = toSnapshotNodes(raw);
  const header = { title: await session.page.title().catch(() => ''), url: session.page.url() };
  const formatted = formatSnapshot(session.nodes, header);
  return {
    sessionId: session.id,
    url: header.url,
    title: header.title,
    text: formatted.text,
    nodes: formatted.nodes,
    truncated: formatted.truncated,
    hint: 'Usa el uid (e1, e2…) para click/type. El uid sólo vale para este snapshot.',
  };
}

/** Localiza el elemento de un uid y comprueba que la página no ha cambiado. */
async function elementForUid(session: Session, uid: unknown): Promise<{ ok: true; locator: any; verified: boolean; role: string; name: string } | { ok: false; error: string }> {
  const resolved = resolveUid(session.nodes, uid);
  if (!resolved) {
    return { ok: false, error: `uid desconocido: ${String(uid).slice(0, 20)}. Haz action "snapshot" primero.` };
  }
  const raw = await collect(session);
  const current = toSnapshotNodes(raw);
  const node = current[resolved.index];
  if (!node) {
    return { ok: false, error: 'La página cambió y ese elemento ya no está. Vuelve a hacer action "snapshot".' };
  }
  if (node.role !== resolved.role) {
    return {
      ok: false,
      error: `La página cambió en esa posición (${resolved.role} → ${node.role}). Vuelve a hacer action "snapshot".`,
    };
  }
  return {
    ok: true,
    locator: session.page.locator(COLLECT_SELECTOR).nth(resolved.index),
    verified: node.name === resolved.name,
    role: node.role,
    name: node.name,
  };
}

async function settleNavigation(session: Session): Promise<string> {
  await session.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
  return session.page.url();
}

/**
 * Ejecuta una acción del navegador. Es el único punto de entrada: valida la
 * acción, resuelve la sesión y acota el tiempo de cada operación.
 */
export async function runBrowserAction(input: any): Promise<BrowserResult> {
  if (exiting) return { ok: false, error: 'El navegador se está cerrando', status: 503 };

  const action = String(input?.action || '').trim().toLowerCase() as BrowserAction;
  if (!BROWSER_ACTIONS.includes(action)) {
    return { ok: false, error: `action debe ser una de: ${BROWSER_ACTIONS.join(', ')}`, status: 400 };
  }
  const root = String(input?.root || '').slice(0, 1024);
  const actor: BrowserActor = input?.actor === 'user' ? 'user' : 'agent';

  try {
    if (action === 'list') {
      return {
        ok: true,
        data: {
          sessions: [...sessions.values()].map((s) => ({
            id: s.id,
            url: s.page?.url?.() || '',
            createdAt: s.createdAt,
          })),
          max: MAX_SESSIONS,
        },
      };
    }

    if (action === 'open') {
      let target: { url: string; title: string; status: number | null } | null = null;
      const rawUrl = String(input?.url ?? '').trim();
      // El destino se valida ANTES de arrancar Chromium: una URL rechazada no
      // debe dejar un navegador levantado de propina.
      const check = rawUrl ? await safeTarget(rawUrl) : null;
      if (check && !check.ok) return { ok: false, error: check.error, status: 403 };

      const candidate = pickSession(undefined, root);
      const existing = candidate && !candidate.page?.isClosed?.() ? candidate : null;
      if (candidate && !existing) forget(candidate.id);
      const session = existing || await withTimeout(newSession(root), ACTION_TIMEOUT_MS, 'abrir el navegador');
      session.lastActor = actor;
      if (check && check.ok) {
        const res: any = await withTimeout(
          session.page.goto(check.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }),
          ACTION_TIMEOUT_MS,
          'navegar',
        );
        session.nodes = [];
        target = { url: session.page.url(), title: await session.page.title().catch(() => ''), status: res?.status?.() ?? null };
        session.lastTitle = String(target.title || '').slice(0, 200);
      }
      return {
        ok: true,
        data: {
          sessionId: session.id,
          reused: Boolean(existing),
          ...(target ? { page: target } : {}),
          hint: 'Navega con action "navigate" y lee la página con action "snapshot".',
        },
      };
    }

    const session = pickSession(input?.sessionId ?? input?.id, root);
    if (!session) {
      return { ok: false, error: 'No hay ninguna sesión de navegador abierta. Usa action "open" primero.', status: 409 };
    }
    session.lastActor = actor;

    if (action === 'navigate') {
      const check = await safeTarget(input?.url);
      if (!check.ok) return { ok: false, error: check.error, status: 403 };
      const res: any = await withTimeout(
        session.page.goto(check.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }),
        ACTION_TIMEOUT_MS,
        'navegar',
      );
      session.nodes = [];
      return {
        ok: true,
        data: {
          sessionId: session.id,
          url: session.page.url(),
          title: await session.page.title().catch(() => ''),
          status: res?.status?.() ?? null,
          hint: 'Los uid anteriores ya no valen: haz action "snapshot".',
        },
      };
    }

    if (action === 'snapshot') {
      return { ok: true, data: await withTimeout(snapshot(session), ACTION_TIMEOUT_MS, 'leer la página') };
    }

    if (action === 'click') {
      const found = await elementForUid(session, input?.uid);
      if (!found.ok) return { ok: false, error: found.error };
      await withTimeout(found.locator.click({ timeout: CLICK_TIMEOUT_MS }), ACTION_TIMEOUT_MS, 'click');
      const url = await settleNavigation(session);
      return {
        ok: true,
        data: { sessionId: session.id, clicked: { role: found.role, name: found.name }, verified: found.verified, url },
      };
    }

    if (action === 'type') {
      const found = await elementForUid(session, input?.uid);
      if (!found.ok) return { ok: false, error: found.error };
      const text = String(input?.text ?? '').slice(0, 5000);
      await withTimeout(found.locator.fill(text, { timeout: CLICK_TIMEOUT_MS }), ACTION_TIMEOUT_MS, 'escribir');
      if (input?.submit === true) {
        await withTimeout(found.locator.press('Enter', { timeout: CLICK_TIMEOUT_MS }), ACTION_TIMEOUT_MS, 'enviar');
        await settleNavigation(session);
      }
      return {
        ok: true,
        data: {
          sessionId: session.id,
          typed: { role: found.role, name: found.name, chars: text.length, submit: input?.submit === true },
          verified: found.verified,
          url: session.page.url(),
        },
      };
    }

    if (action === 'press') {
      const uid = String(input?.uid ?? '').trim();
      const key = String(input?.key ?? '').trim().slice(0, 40);
      if (!key) return { ok: false, error: 'key requerido (p. ej. Enter, Tab, Escape)' };
      if (uid) {
        const found = await elementForUid(session, uid);
        if (!found.ok) return { ok: false, error: found.error };
        await withTimeout(found.locator.press(key, { timeout: CLICK_TIMEOUT_MS }), ACTION_TIMEOUT_MS, 'pulsar tecla');
      } else {
        await withTimeout(session.page.keyboard.press(key), ACTION_TIMEOUT_MS, 'pulsar tecla');
      }
      await settleNavigation(session);
      return { ok: true, data: { sessionId: session.id, key, url: session.page.url() } };
    }

    if (action === 'scroll') {
      const dy = Math.trunc(Number(input?.dy));
      const dx = Math.trunc(Number(input?.dx));
      if (!Number.isFinite(dy) && !Number.isFinite(dx)) return { ok: false, error: 'dy (o dx) requerido en píxeles' };
      const y = Math.max(-20_000, Math.min(20_000, Number.isFinite(dy) ? dy : 0));
      const x = Math.max(-10_000, Math.min(10_000, Number.isFinite(dx) ? dx : 0));
      await withTimeout(session.page.mouse.wheel(x, y), ACTION_TIMEOUT_MS, 'desplazar');
      return {
        ok: true,
        data: {
          sessionId: session.id,
          scrolled: { x, y },
          position: await session.page.evaluate('({ x: window.scrollX, y: window.scrollY })').catch(() => null),
        },
      };
    }

    if (action === 'screenshot') {
      const target = input?.screenshot as { absPath?: string; relPath?: string } | undefined;
      if (!target?.absPath) return { ok: false, error: 'screenshot sin ruta de destino resuelta', status: 400 };
      const fullPage = input?.fullPage === true;
      fs.mkdirSync(path.dirname(target.absPath), { recursive: true });
      const buffer: Buffer = await withTimeout(
        session.page.screenshot({ fullPage, type: 'png' }),
        ACTION_TIMEOUT_MS,
        'capturar la pantalla',
      );
      fs.writeFileSync(target.absPath, buffer);
      return {
        ok: true,
        data: {
          sessionId: session.id,
          // Separadores normalizados: la ruta la vuelve a leer el agente.
          path: String(target.relPath || target.absPath).split(path.sep).join('/'),
          absPath: target.absPath,
          bytes: buffer.length,
          fullPage,
          url: session.page.url(),
        },
      };
    }

    if (action === 'logs') {
      const data = { sessionId: session.id, console: [...session.console], network: [...session.net], url: session.page.url() };
      if (input?.clear === true) {
        session.console = [];
        session.net = [];
      }
      return { ok: true, data };
    }

    if (action === 'close') {
      forget(session.id);
      const remaining = sessions.size;
      return { ok: true, data: { sessionId: session.id, closed: true, remaining } };
    }

    return { ok: false, error: `action no implementada: ${action}`, status: 400 };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 500);
    return { ok: false, error: msg, status: /Tiempo agotado/.test(msg) ? 504 : 500 };
  }
}

/** Snapshot público de la sesión, apto para el renderer. */
export async function getBrowserSessionInfo(input: {
  id?: unknown;
  root?: unknown;
} = {}): Promise<BrowserSessionInfo | null> {
  const session = pickSession(input.id, String(input.root || '').slice(0, 1024));
  if (!session) return null;
  const navigation = await readNavigationState(session);
  const seqs = [session.console[0]?.seq, session.net[0]?.seq].filter(
    (value): value is number => Number.isFinite(value),
  );
  return {
    id: session.id,
    root: session.root,
    status: 'ready',
    createdAt: session.createdAt,
    page: navigation,
    viewport: { width: 1280, height: 800 },
    lastSeq: session.seq,
    oldestSeq: seqs.length ? Math.min(...seqs) : session.seq,
    lastActor: session.lastActor,
  };
}

/** Logs retenidos para backfill o para el primer frame del SSE. */
export function getBrowserSessionLogs(
  id: string,
  after = 0,
  limit = MAX_LOG_ENTRIES,
): { console: BrowserConsoleEntry[]; network: BrowserNetworkEntry[]; lastSeq: number; oldestSeq: number } | null {
  const session = sessions.get(id);
  if (!session) return null;
  const cursor = Number.isFinite(after) ? Math.max(0, Math.trunc(after)) : 0;
  const max = Math.max(1, Math.min(MAX_LOG_ENTRIES, Math.trunc(limit) || MAX_LOG_ENTRIES));
  const consoleEntries = session.console.filter((entry) => entry.seq > cursor).slice(-max);
  const networkEntries = session.net.filter((entry) => entry.seq > cursor).slice(-max);
  const seqs = [session.console[0]?.seq, session.net[0]?.seq].filter(
    (value): value is number => Number.isFinite(value),
  );
  return {
    console: consoleEntries,
    network: networkEntries,
    lastSeq: session.seq,
    oldestSeq: seqs.length ? Math.min(...seqs) : session.seq,
  };
}

export function getBrowserSessionFrame(id: string): BrowserFrame | null {
  return sessions.get(id)?.lastFrame || null;
}

/** Todas las sesiones vivas, de la más reciente a la más antigua. */
export async function listBrowserSessions(): Promise<BrowserSessionInfo[]> {
  const infos = await Promise.all(
    [...sessions.values()].map((session) => getBrowserSessionInfo({ id: session.id })),
  );
  return infos
    .filter((info): info is BrowserSessionInfo => Boolean(info))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Captura PNG bajo demanda para el botón del panel, sin escribir en disco. */
export async function captureBrowserScreenshot(
  id: string,
  fullPage = false,
): Promise<BrowserScreenshot | null> {
  const session = sessions.get(id);
  if (!session) return null;
  const viewport = session.page.viewportSize?.() ?? { width: 1280, height: 800 };
  const buffer: Buffer = await withTimeout(
    session.page.screenshot({ type: 'png', fullPage }),
    ACTION_TIMEOUT_MS,
    'capturar la pantalla',
  );
  return {
    mimeType: 'image/png',
    data: buffer.toString('base64'),
    url: session.page.url(),
    title: await session.page.title().catch(() => session.lastTitle || ''),
    width: viewport.width,
    height: viewport.height,
    fullPage,
  };
}

/**
 * Suscribe al renderer al mismo bus que ya usan las tools del agente. El primer
 * suscriptor enciende el capturador de frames; el último lo apaga.
 */
export function subscribeBrowserSession(
  id: string,
  listener: BrowserListener,
): (() => void) | null {
  const session = sessions.get(id);
  if (!session) return null;
  session.listeners.add(listener);
  startFramePump(session);
  return () => {
    const current = sessions.get(id);
    if (!current || current !== session) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) stopFramePump(current);
  };
}

export function closeBrowserSession(id: string): boolean {
  if (!sessions.has(id)) return false;
  forget(id);
  return true;
}

/**
 * Entrada del panel: coordenadas reales del viewport, teclado y navegación.
 * Es deliberadamente distinta de los uid de la tool del agente: el usuario ve
 * una imagen y hace clic donde quiere, mientras el agente sigue usando uid.
 */
export async function runBrowserInput(input: any): Promise<BrowserResult> {
  if (exiting) return { ok: false, error: 'El navegador se está cerrando', status: 503 };
  const action = String(input?.action || '').trim().toLowerCase();
  const root = String(input?.root || '').slice(0, 1024);
  const session = pickSession(input?.sessionId, root);
  if (!session) {
    return { ok: false, error: 'No hay ninguna sesión de navegador abierta.', status: 409 };
  }
  session.lastActor = 'user';

  const done = async (): Promise<BrowserResult> => {
    const info = await getBrowserSessionInfo({ id: session.id });
    return info
      ? { ok: true, data: { session: info } }
      : { ok: false, error: 'La sesión se cerró durante la acción', status: 409 };
  };

  try {
    if (action === 'navigate') {
      const check = await safeTarget(input?.url);
      if (!check.ok) return { ok: false, error: check.error, status: 403 };
      await withTimeout(
        session.page.goto(check.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }),
        ACTION_TIMEOUT_MS,
        'navegar',
      );
      session.nodes = [];
      session.lastTitle = await session.page.title().catch(() => '');
      return done();
    }

    if (action === 'click') {
      const x = Math.trunc(Number(input?.x));
      const y = Math.trunc(Number(input?.y));
      const viewport = session.page.viewportSize() || { width: 1280, height: 800 };
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) {
        return { ok: false, error: 'Coordenadas fuera del viewport', status: 400 };
      }
      const button = input?.button === 'right' ? 'right' : input?.button === 'middle' ? 'middle' : 'left';
      const clickCount = Math.max(1, Math.min(3, Math.trunc(Number(input?.clickCount)) || 1));
      await withTimeout(
        session.page.mouse.click(x, y, { button, clickCount }),
        ACTION_TIMEOUT_MS,
        'click',
      );
      await settleNavigation(session);
      session.nodes = [];
      return done();
    }

    if (action === 'type') {
      const text = String(input?.text ?? '');
      if (!text || text.length > 5000) return { ok: false, error: 'Texto vacío o demasiado largo', status: 400 };
      await withTimeout(session.page.keyboard.type(text), ACTION_TIMEOUT_MS, 'escribir');
      await settleNavigation(session);
      session.nodes = [];
      return done();
    }

    if (action === 'key') {
      const key = String(input?.key ?? '').trim().slice(0, 40);
      if (!key) return { ok: false, error: 'key requerido', status: 400 };
      await withTimeout(session.page.keyboard.press(key), ACTION_TIMEOUT_MS, 'pulsar tecla');
      await settleNavigation(session);
      session.nodes = [];
      return done();
    }

    if (action === 'scroll') {
      const dx = Math.max(-5000, Math.min(5000, Math.trunc(Number(input?.deltaX)) || 0));
      const dy = Math.max(-5000, Math.min(5000, Math.trunc(Number(input?.deltaY)) || 0));
      if (!dx && !dy) return { ok: false, error: 'deltaX o deltaY requerido', status: 400 };
      await withTimeout(session.page.mouse.wheel(dx, dy), ACTION_TIMEOUT_MS, 'desplazar');
      session.nodes = [];
      return done();
    }

    if (action === 'back' || action === 'forward') {
      const history = await readHistoryFlags(session);
      if (action === 'back' && !history.canGoBack) {
        return { ok: false, error: 'No hay historial hacia atrás', status: 409 };
      }
      if (action === 'forward' && !history.canGoForward) {
        return { ok: false, error: 'No hay historial hacia adelante', status: 409 };
      }
    }

    if (action === 'back' || action === 'forward' || action === 'reload') {
      const options = { waitUntil: 'domcontentloaded' as const, timeout: NAV_TIMEOUT_MS };
      if (action === 'back') await withTimeout(session.page.goBack(options), ACTION_TIMEOUT_MS, 'volver atrás');
      else if (action === 'forward') await withTimeout(session.page.goForward(options), ACTION_TIMEOUT_MS, 'avanzar');
      else await withTimeout(session.page.reload(options), ACTION_TIMEOUT_MS, 'recargar');
      session.nodes = [];
      session.lastTitle = await session.page.title().catch(() => '');
      return done();
    }

    return { ok: false, error: 'action debe ser navigate, click, type, key, scroll, back, forward o reload', status: 400 };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 500);
    return { ok: false, error: msg, status: /Tiempo agotado/.test(msg) ? 504 : 500 };
  }
}

/** Cierra el navegador y todas las sesiones. */
export async function shutdownBrowser(): Promise<void> {
  const ids = [...sessions.keys()];
  for (const id of ids) forget(id);
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    const browser = await pending;
    await browser?.close?.();
  } catch {
    /* ya cerrándose */
  }
}

/** Solo para tests: cuántas sesiones hay vivas. */
export function _sessionCount(): number {
  return sessions.size;
}

process.once('exit', () => {
  exiting = true;
  const pending = browserPromise;
  browserPromise = null;
  // En 'exit' no hay sitio para promesas: se pide la muerte del proceso hijo.
  try {
    void pending?.then((b: any) => b?.close?.());
  } catch {
    /* ignore */
  }
});
