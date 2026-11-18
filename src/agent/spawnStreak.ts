/**
 * Guarda de racha de `spawn_agents`, compartida por los dos bucles del agente.
 *
 * Vive en su propio módulo porque `agentSession.ts` arrastra `browserSession` y
 * `mcp` (tocan el DOM) y el CLI (`src/cli/agentClient.ts`) corre en Node: si
 * importara el bucle del servidor para reusar estas dos funciones, el arranque
 * del CLI se llevaría por delante Playwright y MCP.
 */

/**
 * ¿La tanda de `spawn_agents` dejó algún hijo fallido?
 *
 * La racha cuenta también el fallo parcial: en G1-D5-10 un hijo cerraba bien y
 * el otro no, y el padre relanzó la misma tanda tres veces porque la guarda
 * sólo miraba «todos fallidos».
 */
export function spawnBatchHadFailure(children: any[]): boolean {
  return children.some((hijo: any) => hijo?.ok === false);
}


/**
 * Mensaje con el que los dos bucles cierran cuando la racha corta.
 *
 * Vive aquí, y no en cada bucle, porque el servidor (`AgentSession.stepNative`)
 * y el CLI (`runAgent`) tienen que decir exactamente lo mismo: con dos copias,
 * un cambio de redacción en uno dejaba al otro con un texto distinto y la
 * corrida se comparaba contra un mensaje que ya no existía.
 */
export function spawnFailureClosingMessage(children: any[]): string {
  const fallidos = children.filter((hijo: any) => hijo?.ok === false);
  const motivos = [...new Set(fallidos.map((hijo: any) => String(hijo?.error ?? '').trim()).filter(Boolean))];
  const todosFallidos = children.length > 0 && fallidos.length === children.length;
  const cierre = todosFallidos
    ? 'No completé la tarea: los subagentes fallaron en dos tandas seguidas.'
    : 'No completé la tarea: hubo subagentes fallidos en dos tandas seguidas.';
  return `${cierre}${motivos.length ? ` Motivo: ${motivos.join(' | ')}` : ''}`.slice(0, 1000);
}

/**
 * Hijos devueltos por cada `spawn_agents` de una tanda de tools.
 *
 * La forma depende de dónde se ejecutó la tool: en proceso el resultado es
 * `{ results, spawned, capped }`, pero fuera de proceso llega el sobre entero,
 * `{ ok, data: { results, … } }` (G1-D5-09 y G1-T10-06). Aceptar las dos formas
 * es lo que evita que la cuenta de hijos quede en cero y la racha se reinicie.
 */
export function spawnChildrenFromResults(results: any[]): any[] {
  return results.flatMap((r) => {
    const entrada = (r?.data ?? r) as any;
    const lista = entrada?.results ?? entrada?.data?.results;
    return Array.isArray(lista) ? lista : [];
  });
}
