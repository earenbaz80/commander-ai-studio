/**
 * Las pestañas del chat viven en localStorage: una conversación sólo existía en
 * ese navegador. Aquí se vuelca al hilo del servidor cuyo id es el `sessionId`
 * de la pestaña, así la misma sesión aparece en el sidebar y se puede reabrir
 * desde otra máquina sin duplicarse.
 */
import type { WorkspaceTab } from '../hooks/useTabs';
import * as server from './persistence';

/** Hash estable (djb2) del contenido: reenviar la misma charla no duplica filas. */
function hash(texto: string): string {
  let h = 5381;
  for (let i = 0; i < texto.length; i += 1) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Id de petición del mensaje: mismo rol y texto ⇒ misma fila en el servidor.
 * Si el usuario repite literalmente el mismo mensaje, el servidor lo cuenta
 * una vez; es el precio de poder reenviar la conversación entera sin duplicar.
 */
export function messageRequestId(role: string, content: string): string {
  return 'tab-' + hash(role + '\u0000' + content);
}

/**
 * Vuelca una pestaña completa a su hilo. Devuelve false si el servidor no
 * responde: la conversación sigue en localStorage, así que no se pierde nada.
 */
export async function saveTabToServer(tab: WorkspaceTab): Promise<boolean> {
  if (!tab || !tab.sessionId) return false;
  const hilo = await server.createThread({
    id: tab.sessionId,
    title: tab.title,
    projectPath: tab.projectPath || undefined,
    model: tab.selectedModel,
  });
  if (!hilo) return false;

  // Título y proyecto pueden cambiar después de crear el hilo (elegir carpeta,
  // retitular la pestaña): el hilo los sigue para no desagruparse en el sidebar.
  const cambiaTitulo = hilo.title !== tab.title;
  const cambiaProyecto = (hilo.project_path || '') !== (tab.projectPath || '');
  if (cambiaTitulo || cambiaProyecto) {
    await server.updateThread(tab.sessionId, {
      ...(cambiaTitulo ? { title: tab.title } : {}),
      ...(cambiaProyecto ? { projectPath: tab.projectPath || '' } : {}),
    });
  }

  for (const m of tab.messages.slice(-40)) {
    const content = typeof m.content === 'string' ? m.content : '';
    if (!content.trim()) continue;
    await server.appendMessage(tab.sessionId, {
      requestId: messageRequestId(m.role, content),
      role: m.role === 'model' ? 'assistant' : m.role,
      parts: { text: content },
      ts: Date.now(),
    });
  }
  return true;
}

const pending = new Map<string, WorkspaceTab>();
let timer: ReturnType<typeof setTimeout> | null = null;
let onFlush: (() => void) | undefined;

/**
 * Volcado con retardo: el chat cambia en cada token y escribir en cada uno
 * sería tirar trabajo. Con 1,5 s se pierde como mucho el último tramo si se
 * cierra la pestaña, y sólo se envía una vez por ráfaga.
 */
export function scheduleTabSync(tab: WorkspaceTab, onSaved?: () => void): void {
  if (!tab || !tab.sessionId || tab.messages.length === 0) return;
  pending.set(tab.sessionId, tab);
  onFlush = onSaved ?? onFlush;
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    const lote = [...pending.values()];
    pending.clear();
    const done = onFlush;
    onFlush = undefined;
    for (const t of lote) {
      try { await saveTabToServer(t); } catch { /* servidor caído: queda en local */ }
    }
    done?.();
  }, 1500);
}
