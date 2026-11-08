/**
 * Cola de mensajes pendientes del chat, por sesión.
 *
 * Antes vivía sólo en el estado de `ChatPlayground`: cambiar de modo (el
 * componente se desmonta) la borraba, y al cambiar de pestaña o de
 * conversación se mezclaba con la de la sesión nueva. Aquí cada sesión
 * conserva la suya, así que volver recupera los mensajes que seguían esperando.
 *
 * Es memoria del proceso a propósito: los adjuntos son `File` reales y no se
 * pueden serializar sin perderlos.
 */
import type { RunMode } from '../../types/studio';

export interface QueuedChatMessage {
  id: string;
  text: string;
  attachments: File[];
  runMode: RunMode;
}

const queues = new Map<string, QueuedChatMessage[]>();

export function readChatQueue(sessionKey: string): QueuedChatMessage[] {
  return queues.get(sessionKey) ?? [];
}

export function writeChatQueue(
  sessionKey: string,
  messages: QueuedChatMessage[]
): void {
  if (messages.length > 0) queues.set(sessionKey, messages);
  else queues.delete(sessionKey);
}
