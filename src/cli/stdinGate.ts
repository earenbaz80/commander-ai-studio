/**
 * Compuerta de entrada de los prompts interactivos del CLI.
 *
 * Entre un prompt y el siguiente —la respuesta a `ask_user` y la aprobación de
 * la tool que viene después, por ejemplo— la terminal queda en modo canónico y
 * nadie lee stdin, así que una tecla de más (el Enter que sobra al enviar la
 * respuesta, o una pulsación mientras el modelo piensa) espera en el buffer y
 * la consume el prompt siguiente como si fuera suya. En G1-D3 eso aprobó una
 * escritura que el operador quería denegar.
 *
 * La compuerta se suscribe a stdin mientras dura la corrida y no deja de
 * leerlo: si hay un prompt abierto le entrega el chunk y, si no, lo descarta.
 * Cuando la aprobación abre, ya no queda nada pendiente que pueda interpretar
 * como decisión.
 */
import type { EventEmitter } from 'node:events';

export interface InputGateSource extends EventEmitter {
  resume?: () => unknown;
  pause?: () => unknown;
}

export interface InputGate {
  /** Entrega los chunks a `handler` desde este momento; devuelve el desenganche. */
  attach(handler: (chunk: Buffer | string) => void): () => void;
  /** Suelta stdin; lo que llegue después ya no se descarta aquí. */
  close(): void;
  /** Chunks que llegaron sin prompt abierto y se tiraron. */
  readonly discarded: number;
}

/**
 * Crea la compuerta y la deja leyendo stdin de inmediato: lo que se teclee
 * antes del primer prompt también se descarta en vez de quedar en cola.
 */
export function createInputGate(source: InputGateSource): InputGate {
  let handler: ((chunk: Buffer | string) => void) | null = null;
  let discarded = 0;
  let closed = false;

  const dispatch = (chunk: Buffer | string): void => {
    if (handler) handler(chunk);
    else discarded += 1;
  };

  source.on('data', dispatch);
  try {
    source.resume?.();
  } catch {
    /* stdin cerrado */
  }

  return {
    attach(next) {
      if (closed) return () => {};
      handler = next;
      return () => {
        if (handler === next) handler = null;
      };
    },
    close() {
      if (closed) return;
      closed = true;
      handler = null;
      source.removeListener('data', dispatch);
      try {
        source.pause?.();
      } catch {
        /* stdin cerrado */
      }
    },
    get discarded() {
      return discarded;
    },
  };
}
