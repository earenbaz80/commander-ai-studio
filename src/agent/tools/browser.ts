import type { ToolDefinition } from '../types';
import { withActiveRoot } from '../activeProject';
import { BROWSER_ACTIONS, isLoopbackUrl } from '../browserTarget';

/**
 * Navegador del agente (Chromium headless vía Playwright, en el servidor).
 *
 * Una sola tool con `action` porque todas las acciones comparten sesión: el
 * servidor recuerda el último snapshot y sus uid, y sin esa continuidad
 * "click e3" no significaría nada.
 *
 * Aprobación: navegar fuera de la máquina pide revisión, porque es lo único que
 * puede sacar datos del proyecto hacia internet. Interactuar con un preview
 * local (o abrir/cerrar sesión) no. El servidor revalida el destino con la
 * guardia anti-SSRF de todas formas.
 */
export interface BrowserInput {
  action: 'open' | 'navigate' | 'snapshot' | 'click' | 'type' | 'press' | 'scroll' | 'screenshot' | 'logs' | 'close' | 'list';
  /** Sesión concreta; por defecto la última abierta en este proyecto. */
  sessionId?: string;
  /** Destino de `open`/`navigate` (sin esquema se asume http://). */
  url?: string;
  /** uid del último snapshot (`e1`, `e2`…) para click/type/press. */
  uid?: string;
  /** Texto a escribir en `type`. */
  text?: string;
  /** Con `type`: pulsa Enter después de escribir. */
  submit?: boolean;
  /** Tecla de `press` (Enter, Tab, Escape, Control+a…). */
  key?: string;
  /** Desplazamiento en píxeles (`scroll`). */
  dy?: number;
  dx?: number;
  /** Con `screenshot`: guardar en esta ruta del proyecto (por defecto .commander/screenshots). */
  path?: string;
  /** Con `screenshot`: capturar la página completa, no sólo el viewport. */
  fullPage?: boolean;
  /** Con `logs`: vaciar los registros después de devolverlos. */
  clear?: boolean;
}

async function callServer(toolId: string, input: any): Promise<any> {
  const res = await fetch('/api/agent/run-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId, input: withActiveRoot(input || {}) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: (err as any).error || `HTTP ${res.status}` };
  }
  return res.json();
}

export const browserTool: ToolDefinition<BrowserInput, any> = {
  id: 'browser',
  description:
    'Navegador headless: open, navigate, snapshot (árbol de la página con uid), click, type, press, scroll, screenshot, logs, close, list.',
  danger: true,
  requiresApproval: (input) => {
    const action = String((input as any)?.action || '').trim().toLowerCase();
    if (action !== 'open' && action !== 'navigate') return false;
    const url = String((input as any)?.url ?? '').trim();
    // `open` sin url sólo levanta el navegador; con url es una navegación.
    if (!url) return false;
    return !isLoopbackUrl(url);
  },
  run: async (input) => {
    const action = String((input as any)?.action || '').trim().toLowerCase();
    if (!action) return { ok: false, error: `action requerido (${BROWSER_ACTIONS.join(', ')})` };
    return callServer('browser', { ...input, action });
  },
};

/**
 * Preview de un dev server: el comando corre en segundo plano (mismo registro
 * que `shell.run`, con parada por id) y la tool espera a que el puerto
 * responda. Así el agente no tiene que adivinar cuándo levantar el navegador.
 */
export interface PreviewInput {
  action: 'open' | 'check' | 'status' | 'stop';
  /** Con `open`: comando a arrancar (misma allowlist que shell.run). */
  command?: string;
  /** Con `check`: URL a sondear. También acepta `url` en `open` para fijarla. */
  url?: string;
  /** Con `open`: puerto del dev server, si se conoce. */
  port?: number;
  /** Con `open`: cuánto esperar a que responda (1000-180000 ms). */
  timeoutMs?: number;
  /** Con `stop`: el trabajo a parar. */
  jobId?: string;
  /** Con `stop`: comprobación extra de que el pid pertenece al trabajo. */
  pid?: number;
}

export const previewTool: ToolDefinition<PreviewInput, any> = {
  id: 'preview',
  description:
    'Preview de un dev server: open (arranca en segundo plano y espera HTTP), check (¿responde una URL?), status (previews vivos) y stop (para el trabajo).',
  danger: true,
  // Arrancar y parar procesos es una acción de ejecución; sondear no lo es.
  requiresApproval: (input) => {
    const action = String((input as any)?.action || '').trim().toLowerCase();
    return action === 'open' || action === 'stop';
  },
  run: async (input) => {
    const action = String((input as any)?.action || '').trim().toLowerCase();
    if (!action) return { ok: false, error: 'action requerido (open/check/status/stop)' };
    return callServer('preview', { ...input, action });
  },
};
