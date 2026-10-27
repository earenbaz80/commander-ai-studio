import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_TOOLS } from '../security.js';
import { TOOL_REGISTRY } from '../src/agent/registry.js';

/**
 * `AGENT_TOOLS` y `TOOL_REGISTRY` son dos listas del mismo juego de tools:
 *
 *  - `AGENT_TOOLS` (security.ts) es lo que `/api/agent/run-tool` acepta, y es
 *    contra lo que el gestor de permisos recorta la lista blanca del proyecto.
 *  - `TOOL_REGISTRY` (src/agent/registry.ts) es lo que el agente ve y lo que
 *    `getTool()` necesita para resolver una llamada.
 *
 * Cuando se separan el síntoma siempre es el mismo: una tool que el modelo cree
 * tener y que muere con 400/403 en la primera llamada. Ya pasó con `shell.job`,
 * `browser`, `preview` y las `git.*` avanzadas, así que esto es el canario.
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
