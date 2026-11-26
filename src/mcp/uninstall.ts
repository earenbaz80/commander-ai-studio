/**
 * Baja persistente de un servidor MCP.
 *
 * `writeConfig` fusiona con el fichero, así que borrar la clave en memoria y
 * reenviar `tools` no persistía nada: el servidor reaparecía en la lectura
 * siguiente. Se manda `null`, que `deepMerge` interpreta como borrado de la
 * clave —la misma baja que usa la desinstalación de plugins—. Si no queda
 * ninguno, `enabled` pasa a `false` en la misma escritura.
 */
import { getToolsConfig, writeConfig } from '../config/index.js';

export interface McpServerRemoval {
  removed: boolean;
  /** Servidores que quedan después de la baja. */
  remaining: number;
  /** Estado de MCP tras la baja. */
  enabled: boolean;
}

export function uninstallMcpServer(name: string): McpServerRemoval {
  const tools: any = getToolsConfig();
  const servers = tools?.mcp?.servers;
  const hasServers = servers && typeof servers === 'object';
  if (!hasServers || !Object.prototype.hasOwnProperty.call(servers, name)) {
    // Nada que borrar: no se reescribe la config.
    return {
      removed: false,
      remaining: hasServers ? Object.keys(servers).length : 0,
      enabled: Boolean(tools?.mcp?.enabled),
    };
  }

  const remaining = Object.keys(servers).filter((server) => server !== name).length;
  const closesMcp = remaining === 0;
  writeConfig(
    {
      tools: {
        mcp: {
          servers: { [name]: null },
          ...(closesMcp ? { enabled: false } : {}),
        },
      },
    } as any,
    'project',
  );

  return {
    removed: true,
    remaining,
    enabled: closesMcp ? false : tools.mcp.enabled !== false,
  };
}
