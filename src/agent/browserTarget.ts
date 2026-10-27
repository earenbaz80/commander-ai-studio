/**
 * Piezas puras del navegador del agente.
 *
 * Las comparten el cliente (para decidir si un destino necesita aprobación) y
 * el servidor (para normalizar y formatear), sin depender de Playwright ni del
 * DOM. Todo lo que se pueda decidir aquí en vez de en el driver se decide aquí:
 * así se puede probar sin abrir un navegador.
 */

/** Tope de elementos devueltos en un snapshot: más ya no cabe en el contexto. */
export const MAX_SNAPSHOT_NODES = 150;
/** Tope de anidamiento: la indentación deja de aportar información útil. */
export const MAX_DEPTH = 8;
/** Etiqueta sintética para los nodos sin nombre accesible. */
const UNNAMED = '(sin nombre)';

const MAX_URL_LEN = 2000;

/** Esquemas que se reconocen siempre como esquema, con `//` o sin él. */
const KNOWN_SCHEMES = new Set([
  'http', 'https', 'file', 'data', 'javascript', 'about', 'chrome', 'blob', 'ws', 'wss', 'mailto', 'ftp',
]);
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):(.*)$/i;

/**
 * ¿`host:5173` es un host con puerto, o un esquema?
 *
 * La diferencia importa: `new URL('localhost:5173')` no falla, interpreta
 * `localhost:` como esquema. Un `host:puerto` (lo que escribe cualquiera para
 * apuntar a su dev server) termina en dígitos y no es un esquema conocido.
 */
function looksLikeHostPort(input: string): boolean {
  const match = SCHEME_RE.exec(input);
  if (!match) return false;
  const [, scheme, rest] = match;
  if (KNOWN_SCHEMES.has(scheme.toLowerCase())) return false;
  return /^\d+([/?#]|$)/.test(rest);
}

/** Acciones que acepta la tool `browser`. */
export const BROWSER_ACTIONS = [
  'open',
  'navigate',
  'snapshot',
  'click',
  'type',
  'press',
  'scroll',
  'screenshot',
  'logs',
  'close',
  'list',
] as const;

export type BrowserAction = (typeof BROWSER_ACTIONS)[number];

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Normaliza una URL de navegación: si no trae esquema se asume `http://` (los
 * dev servers locales son http, no https).
 *
 * Sólo comprueba la *forma*: los esquemas peligrosos (`file:`, `data:`,
 * `javascript:`) y las credenciales embebidas se rechazan aquí; la seguridad de
 * red real (rangos internos, metadata cloud, DNS) la aplica
 * `assertSafeOutboundUrl` en el servidor, que es quien tiene contexto de red.
 */
export function normalizeBrowserUrl(raw: unknown): UrlCheck {
  let input = String(raw ?? '').trim();
  if (!input) return { ok: false, error: 'url requerida' };
  if (input.length > MAX_URL_LEN) return { ok: false, error: 'URL demasiado larga' };
  if (/\s/.test(input)) return { ok: false, error: 'La URL no puede contener espacios' };

  // `//host/x` es una URL sin esquema; `/ruta` no lo es (es una ruta de API).
  if (input.startsWith('//')) input = `http:${input}`;
  else if (!SCHEME_RE.test(input) || looksLikeHostPort(input)) input = `http://${input}`;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: 'URL inválida' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: `Esquema no permitido (${parsed.protocol.replace(':', '')}): sólo http/https`,
    };
  }
  if (!parsed.hostname) return { ok: false, error: 'URL sin host' };
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URL con credenciales bloqueada' };
  }
  return { ok: true, url: parsed.toString() };
}

/**
 * ¿El host apunta a la propia máquina? Las interacciones con un preview local
 * son libres; salir a internet pide aprobación.
 */
export function isLoopbackHost(hostname: unknown): boolean {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

/** Igual que `isLoopbackHost` pero sobre una URL completa (ya normalizada). */
export function isLoopbackUrl(raw: unknown): boolean {
  const check = normalizeBrowserUrl(raw);
  if (!check.ok) return false;
  try {
    return isLoopbackHost(new URL(check.url).hostname);
  } catch {
    return false;
  }
}

/** Elemento tal como lo devuelve el script que recorre la página. */
export interface RawSnapshotNode {
  role?: string;
  name?: string;
  value?: string;
  depth?: number;
}

/** Nodo con su handle (`uid`), que es lo que el modelo usa para actuar. */
export interface SnapshotNode {
  uid: string;
  role: string;
  name: string;
  value?: string;
  depth: number;
}

/**
 * Asigna un `uid` estable dentro del snapshot (`e1`, `e2`, …) en el orden del
 * DOM. El uid sólo vale para el último snapshot: si la página cambia, hay que
 * volver a leerla.
 */
export function toSnapshotNodes(raw: RawSnapshotNode[], limit = MAX_SNAPSHOT_NODES): SnapshotNode[] {
  const out: SnapshotNode[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (out.length >= limit) break;
    const role = String(item?.role ?? '').trim() || 'generic';
    const name = String(item?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || UNNAMED;
    const value = item?.value === undefined || item?.value === null ? undefined : String(item.value).slice(0, 120);
    const depth = Number.isFinite(Number(item?.depth))
      ? Math.max(0, Math.min(MAX_DEPTH, Math.trunc(Number(item.depth))))
      : 0;
    out.push({ uid: `e${out.length + 1}`, role, name, ...(value ? { value } : {}), depth });
  }
  return out;
}

/**
 * Traduce un `uid` a la posición del elemento en el snapshot y a lo que decía
 * ser. El índice es lo que el driver vuelve a usar sobre el DOM (mismo orden de
 * colección); rol y nombre sirven para detectar que la página cambió por debajo
 * entre el snapshot y la acción.
 */
export function resolveUid(
  nodes: SnapshotNode[],
  uid: unknown,
): { index: number; role: string; name: string } | null {
  const wanted = String(uid ?? '').trim();
  if (!wanted) return null;
  const index = nodes.findIndex((n) => n.uid === wanted);
  if (index < 0) return null;
  const target = nodes[index];
  return { index, role: target.role, name: target.name };
}

export interface SnapshotHeader {
  title?: string;
  url?: string;
}

/**
 * Renderiza el snapshot como texto plano: una línea por elemento, indentada por
 * profundidad, con el uid delante. Es lo que lee el modelo para decidir sobre
 * qué elemento pulsar.
 */
export function formatSnapshot(
  nodes: SnapshotNode[],
  header: SnapshotHeader = {},
): { text: string; nodes: number; truncated: boolean } {
  const lines: string[] = [];
  if (header.title || header.url) {
    lines.push(`# ${header.title || '(sin título)'}${header.url ? ` — ${header.url}` : ''}`);
  }
  for (const node of nodes) {
    const value = node.value ? ` value="${node.value}"` : '';
    lines.push(`${'  '.repeat(node.depth)}- ${node.uid} ${node.role} "${node.name}"${value}`);
  }
  if (nodes.length === 0) lines.push('(sin elementos interactivos ni encabezados)');
  return {
    text: lines.join('\n'),
    nodes: nodes.length,
    truncated: nodes.length >= MAX_SNAPSHOT_NODES,
  };
}
