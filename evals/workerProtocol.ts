/**
 * Utilidades del worker de corrida (`runWorker`). Sólo las usa el hijo; el
 * padre no las importa.
 */

/** Valor de una bandera `--nombre valor` del proceso. */
export function workerFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

interface StepLike {
  type?: string;
  title?: string;
  content?: string;
}

/**
 * Cuenta tools y guarda la respuesta final. Cada serie escucha el evento que
 * persiste su camino: `tool_call` en las tareas y `tool_result` en los
 * escenarios (las sesiones del servidor guardan el resultado, no la llamada).
 */
export function collectSteps(source: 'tool_call' | 'tool_result') {
  let toolCalls = 0;
  let answer = '';
  return {
    onStep(step: StepLike): void {
      if (step.type === source) toolCalls += 1;
      if (step.title === 'Finalizado') answer = step.content ?? '';
    },
    counts(): { toolCalls: number; answer: string } {
      return { toolCalls, answer };
    },
  };
}
