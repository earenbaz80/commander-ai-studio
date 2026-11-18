/**
 * Recuperación de un turno que no entra en la ventana del runtime local.
 *
 * llama.cpp de esta build no desplaza el KV: si el prompt excede `n_ctx`
 * responde HTTP 400 («the request exceeds the available context size») y el
 * turno muere entero. Acá viven las tres piezas compartidas por `/generate` y
 * `/stream`, sin depender de nada del server para poder testearlas:
 *
 *   1. `isContextOverflow` — distingue el 400 de ventana de cualquier otro 400.
 *   2. `shrinkLocalMessages` — recorta con el presupuesto que ya usa el bucle
 *      del agente (`contextBudget`), sin tocar el system ni el último turno.
 *   3. `fetchChatWithOverflowRetry` — un único reintento con el historial
 *      recortado.
 */
import { RESULT_TURN_CHARS, TURNS_BUDGET_CHARS, clipMiddle } from '../agent/contextBudget';

export interface LocalChatMessage {
  role: string;
  content: string;
}

/** Presupuesto total del historial recortado (el mismo del bucle). */
const OVERFLOW_BUDGET_CHARS = TURNS_BUDGET_CHARS;

/** Caracteres que se conservan de un turno del medio al recortarlo. */
const OVERFLOW_MIDDLE_CHARS = 1_200;

/** Caracteres que se conservan del system y del último turno. */
const OVERFLOW_EDGE_CHARS = RESULT_TURN_CHARS;

/**
 * ¿El error del runtime es «no entra en la ventana»?
 *
 * Sólo el 400 importa: llama.cpp contesta 400 con el texto del contexto, y un
 * 400 por parámetros de muestreo no se arregla recortando el historial.
 */
export function isContextOverflow(status: number, detail: string): boolean {
  if (status !== 400) return false;
  return /context|n_ctx|exceeds|too long|too many tokens/i.test(String(detail || ''));
}

export interface ShrunkLocalMessages {
  messages: LocalChatMessage[];
  dropped: number;
}

export interface ShrinkLocalMessagesOptions {
  /** Presupuesto total en caracteres. */
  budgetChars?: number;
}

/**
 * Recorta el historial para poder reintentar: el system (primeros turnos) y el
 * último turno se conservan —clipeados si hace falta— y los del medio se
 * recortan y, si aun así no entra, se descartan de los más viejos a los más
 * nuevos.
 *
 * Devuelve `null` cuando no puede cambiar nada: reintentar con el mismo
 * historial sólo duplicaría la petición.
 */
export function shrinkLocalMessages(
  messages: LocalChatMessage[],
  options: ShrinkLocalMessagesOptions = {}
): ShrunkLocalMessages | null {
  const budget = options.budgetChars ?? OVERFLOW_BUDGET_CHARS;
  const list = (Array.isArray(messages) ? messages : []).map((message) => ({
    role: String(message?.role || 'user'),
    content: String(message?.content ?? ''),
  }));
  if (list.length === 0) return null;

  const lastIndex = list.length - 1;
  const next: LocalChatMessage[] = list.map((message, index) => {
    if (message.role === 'system' || index === lastIndex) {
      return message.content.length > OVERFLOW_EDGE_CHARS
        ? { ...message, content: clipMiddle(message.content, OVERFLOW_EDGE_CHARS) }
        : message;
    }
    return message.content.length > OVERFLOW_MIDDLE_CHARS
      ? { ...message, content: clipMiddle(message.content, OVERFLOW_MIDDLE_CHARS) }
      : message;
  });

  let dropped = 0;
  const totalChars = () => next.reduce((sum, message) => sum + message.content.length, 0);
  // Nunca se descartan el system ni el turno actual: son el contrato y el paso.
  for (let index = 0; index < next.length && totalChars() > budget; index += 1) {
    if (next[index].role === 'system' || index === next.length - 1) continue;
    next.splice(index, 1);
    dropped += 1;
    index -= 1;
  }

  const changed =
    dropped > 0 ||
    next.length !== list.length ||
    next.some((message, index) => message.content !== list[index]?.content);
  if (!changed) return null;
  return { messages: next, dropped };
}

export interface OverflowRetryOptions {
  signal?: AbortSignal;
  /** Cabeceras extra (el stream pide `Accept: text/event-stream`). */
  headers?: Record<string, string>;
  /** Para tests: reemplaza `fetch`. */
  fetchImpl?: typeof fetch;
  /** Presupuesto del recorte; por defecto el del bucle. */
  budgetChars?: number;
}

export interface OverflowRetryResult {
  response: Response;
  /** Si hubo que recortar y reintentar. */
  trimmed: boolean;
  droppedMessages: number;
}

/**
 * Hace la petición a `llama-server` y, si contesta 400 por ventana de contexto,
 * recorta el historial y reintenta **una sola vez**. Un segundo 400 se devuelve
 * tal cual: el llamador decide cómo reportarlo.
 */
export async function fetchChatWithOverflowRetry(
  url: string,
  payload: { messages?: LocalChatMessage[] } & Record<string, unknown>,
  options: OverflowRetryOptions = {}
): Promise<OverflowRetryResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const post = (body: unknown) =>
    doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });

  const first = await post(payload);
  if (first.status !== 400) return { response: first, trimmed: false, droppedMessages: 0 };

  // `clone()` deja intacto el cuerpo original por si no hay nada que recortar.
  const detail = await first.clone().text().catch(() => '');
  if (!isContextOverflow(first.status, detail)) {
    return { response: first, trimmed: false, droppedMessages: 0 };
  }

  const shrunk = shrinkLocalMessages(payload.messages || [], { budgetChars: options.budgetChars });
  if (!shrunk) return { response: first, trimmed: false, droppedMessages: 0 };

  const second = await post({ ...payload, messages: shrunk.messages });
  return { response: second, trimmed: true, droppedMessages: shrunk.dropped };
}
