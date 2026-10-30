/**
 * Catálogo de Freebuff que sirve para el agente.
 *
 * Los ids viven en `freebuff-models.json` y no aquí porque también los lee
 * `scripts/sync-freebuff-models.mjs`, que corre con Node y no puede importar
 * TypeScript. Antes estaban copiados en los dos sitios (y el default, en
 * `server.ts`): tres listas que había que acordarse de mover a la vez.
 *
 * Sólo entran los modelos que declaran `capabilities.toolCalls` en la API de
 * Freebuff: el resto sólo hace chat y en modo agente gastaría un paso fallido
 * por intento. Un id que no esté aquí se enruta a `json-text` (el agente le
 * pide el JSON en texto) en vez de llamar herramientas que no tiene.
 *
 * Se amplía con `npm run models:freebuff`, que avisa si la API sirve modelos
 * con tool-calling que falten en la lista.
 */
import meta from './freebuff-models.json';

/** Modelo que usa el proxy cuando la petición no pide ninguno. */
export const FREEBUFF_DEFAULT_MODEL: string = meta.defaultModel;

/** Ids con tool-calling, en el orden en que los declara el fichero. */
export const FREEBUFF_TOOL_MODEL_IDS: readonly string[] = meta.toolModels;

/** Los mismos ids, para preguntar `has(id)` sin recorrer el array. */
export const FREEBUFF_TOOL_MODELS: ReadonlySet<string> = new Set(FREEBUFF_TOOL_MODEL_IDS);
