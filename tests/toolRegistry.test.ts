import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_TOOLS } from '../security.js';
import { TOOL_REGISTRY } from '../src/agent/registry.js';

/**
 * `AGENT_TOOLS` y `TOOL_REGISTRY` son dos listas del mismo juego de tools:
 *
 *  - `TOOL_REGISTRY` (src/agent/registry.ts) es lo que el agente ve y lo que
 *    `getTool()` necesita para resolver una llamada.
 *  - `AGENT_TOOLS` (security.ts) es lo que el servidor ejecuta para el agente:
 *    el filtro de `/api/agent/run-tool` y la lista contra la que el gestor de
 *    permisos recorta `allowedTools`/`deniedTools` del proyecto.
 *
 * Cuando se separan el síntoma siempre es el mismo: una tool que el modelo cree
 * tener y que muere con 400/403 en la primera llamada. Ya pasó con `shell.job`,
 * `browser`, `preview`, las `git.*` avanzadas y con `spawn_agents`, `skill` y
 * `run_file_change_hooks`, así que esto es el canario.
 *
 * No hay excepciones a propósito: `worktree.create` no viaja por run-tool (el
 * cliente usa `POST /api/worktrees`), pero está en `AGENT_TOOLS` igual porque
 * ese endpoint aplica los mismos permisos. Una exención aquí volvería a dejar
 * una tool real fuera del alcance del gestor de permisos.
 */

const registryIds = Object.keys(TOOL_REGISTRY).sort();
const agentToolIds = [...AGENT_TOOLS].sort();

test('toda tool del registro del cliente está en AGENT_TOOLS', () => {
  const huerfanas = registryIds.filter((id) => !AGENT_TOOLS.has(id));
  assert.deepEqual(
    huerfanas,
    [],
    `Estas tools existen en TOOL_REGISTRY pero el servidor las rechaza: añádelas a ` +
      `AGENT_TOOLS en security.ts. Huérfanas: ${huerfanas.join(', ')}`
  );
});

test('toda tool de AGENT_TOOLS tiene definición en el registro del cliente', () => {
  const sinDefinicion = agentToolIds.filter((id) => !(id in TOOL_REGISTRY));
  assert.deepEqual(
    sinDefinicion,
    [],
    `Estas tools están en AGENT_TOOLS pero el agente no puede verlas ni resolverlas: ` +
      `añade su definición a TOOL_REGISTRY. Sin definición: ${sinDefinicion.join(', ')}`
  );
});

test('las tools que el agente puede invocar en paralelo o por ruta propia están en las dos listas', () => {
  // Estas cuatro se cayeron de `AGENT_TOOLS` aunque sus handlers existían: el
  // agente las veía en el registro y el servidor las rechazaba. Se nombran una a
  // una para que el fallo diga cuál falta, no sólo "huérfanas: [...]".
  for (const id of ['spawn_agents', 'skill', 'run_file_change_hooks', 'worktree.create']) {
    assert.ok(id in TOOL_REGISTRY, `${id} debe tener definición en TOOL_REGISTRY`);
    assert.ok(AGENT_TOOLS.has(id), `${id} debe estar en AGENT_TOOLS para que el servidor lo ejecute`);
  }
});
