/**
 * Persistencia del mini-chat de Nono.
 *
 * Los mensajes vivían sólo en estado de React y desaparecían al recargar, así
 * que Nono no podía recordar lo hablado ni retomarlo. Se guardan por proyecto
 * (o en `global` cuando no hay proyecto) y con un tope para no crecer sin fin.
 */
import type { Message } from '../../components/nono/content';

const STORAGE_PREFIX = 'nono-chat-v1';
const MAX_MESSAGES = 40;

const storageKey = (projectId: string | null): string => `${STORAGE_PREFIX}:${projectId || 'global'}`;

export function loadNonoChat(projectId: string | null): Message[] {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is Message =>
          !!m &&
          typeof m.id === 'string' &&
          typeof m.text === 'string' &&
          typeof m.fromUser === 'boolean' &&
          typeof m.timestamp === 'string'
      )
      .slice(-MAX_MESSAGES);
  } catch {
    // JSON corrupto o almacenamiento no disponible
    return [];
  }
}

export function saveNonoChat(projectId: string | null, messages: Message[]): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {
    // Cuota llena o modo privado: el chat sigue funcionando sin persistir.
  }
}

export function clearNonoChat(projectId: string | null): void {
  try {
    localStorage.removeItem(storageKey(projectId));
  } catch {
    // ignorar
  }
}
