/**
 * Política MCP por servidor y tool.
 *
 * Una regla se identifica por la URL canónica del servidor remoto o por el
 * nombre del servidor stdio del registro, y por el nombre de la tool;
 * `tool: '*'` cubre todas las tools de ese servidor. Gana la última regla que
 * coincide, igual que en `permissionRules.ts`, para que una excepción concreta
 * pueda corregir una regla anterior.
 *
 * La política vive en `.commander/permissions.json` (`mcpToolRules`) y se
 * evalúa en el servidor: el modelo no puede saltarla cambiando el orden de los
 * argumentos ni la forma de enviar la URL o el nombre. Las reglas `deny` se
 * aplican antes de abrir la conexión MCP o arrancar el proceso stdio; `ask` y
 * `allow` las usa el bucle de la sesión para pedir o evitar la aprobación.
 */
import type { RuleDecision } from './permissionRules';

export interface McpToolPolicyRule {
  /** URL del servidor MCP remoto, normalizada al guardar. */
  serverUrl?: string;
  /** Nombre del servidor stdio en `tools.mcp.servers`. */
  server?: string;
  /** Nombre exacto de la tool, o `*` para todas. */
  tool: string;
  decision: RuleDecision;
}

/** Servidor de una llamada MCP: URL remota o nombre del registro stdio. */
export type McpToolTarget =
  | { kind: 'url'; serverUrl: string; tool: string }
  | { kind: 'name'; server: string; tool: string };

export const MAX_MCP_TOOL_RULES = 50;

/**
 * URL canónica para comparar reglas y llamadas.
 *
 * `URL` ya baja esquema/host, quita el puerto por defecto y resuelve `.`/`..`.
 * Se quita la barra final y el fragmento (nunca se envía al servidor), pero se
 * conserva el query porque puede distinguir endpoints. Las credenciales de
 * `userinfo` no forman parte de la identidad de la política y tampoco deben
 * aparecer en un error: `origin` las deja fuera.
 */
export function canonicalMcpServerUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.origin}${pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** Valida y normaliza las reglas venidas de disco o de la API. */
export function normalizeMcpToolRules(raw: unknown): McpToolPolicyRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: McpToolPolicyRule[] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== 'object') continue;
    const rule = candidate as Partial<McpToolPolicyRule>;
    const serverUrl = canonicalMcpServerUrl(rule.serverUrl);
    const server = typeof rule.server === 'string' ? rule.server.trim().slice(0, 200) : '';
    // Una regla apunta a una cosa: URL remota o nombre stdio. Si llegan las
    // dos, es ambigua y se descarta en vez de elegir una por azar.
    if ((serverUrl && server) || (!serverUrl && !server)) continue;
    const tool = typeof rule.tool === 'string' ? rule.tool.trim().slice(0, 200) : '';
    if (!tool) continue;
    if (rule.decision !== 'allow' && rule.decision !== 'ask' && rule.decision !== 'deny') continue;
    rules.push(serverUrl
      ? { serverUrl, tool, decision: rule.decision }
      : { server, tool, decision: rule.decision });
  }
  return rules.slice(-MAX_MCP_TOOL_RULES);
}

/**
 * Decisión para un objetivo ya resuelto, o `null` si ninguna regla lo cubre.
 * La URL se compara en forma canónica y el nombre stdio de forma exacta.
 */
export function decideMcpToolPolicyForTarget(
  target: McpToolTarget,
  rules: McpToolPolicyRule[] = [],
): RuleDecision | null {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    if (target.kind === 'url') {
      const ruleUrl = canonicalMcpServerUrl(rule.serverUrl);
      if (!ruleUrl || ruleUrl !== target.serverUrl) continue;
    } else {
      const ruleServer = typeof rule.server === 'string' ? rule.server.trim() : '';
      if (!ruleServer || ruleServer !== target.server) continue;
    }
    if (rule.tool !== '*' && rule.tool !== target.tool) continue;
    return rule.decision;
  }
  return null;
}

/** Compatibilidad para llamadas que ya tienen la URL del servidor remoto. */
export function decideMcpToolPolicy(
  serverUrl: unknown,
  tool: unknown,
  rules: McpToolPolicyRule[] = [],
): RuleDecision | null {
  const canonical = canonicalMcpServerUrl(serverUrl);
  const name = typeof tool === 'string' ? tool.trim() : '';
  if (!canonical || !name) return null;
  return decideMcpToolPolicyForTarget({ kind: 'url', serverUrl: canonical, tool: name }, rules);
}

/**
 * Servidor y tool que realmente va a ejecutar `mcp.call`.
 *
 * La rama stdio usa `input.tool` y no mira `method`; la remota usa
 * `params.name` cuando viene. El objetivo refleja exactamente esa elección:
 * mirar sólo `tool` en remoto permitiría denegar una tool y ejecutar otra
 * mandando el nombre dentro de `params`; mirar `method` en stdio permitiría
 * denegar una tool y ejecutarla con `method: 'tools/list'`. `mcp.list` y
 * `tools/list` no son llamadas a una tool y no pasan por esta política.
 */
export function mcpToolTarget(toolId: string, input: any): McpToolTarget | null {
  if (toolId !== 'mcp.call') return null;

  // Misma precedencia que `executeAgentToolCore`: si viene `server`, la rama
  // stdio ignora `serverUrl` y ejecuta `input.tool` sin mirar `method`.
  const server = String(input?.server || input?.serverName || '').slice(0, 200);
  if (server) {
    const tool = typeof input?.tool === 'string' ? input.tool.trim().slice(0, 200) : '';
    return tool ? { kind: 'name', server, tool } : null;
  }

  const method = String(input?.method || 'tools/call').trim().toLowerCase();
  if (method !== 'tools/call') return null;

  const params = input?.params && typeof input.params === 'object' ? input.params : null;
  const rawTool = params && 'name' in params ? params.name : input?.tool;
  const tool = typeof rawTool === 'string' ? rawTool.trim().slice(0, 200) : '';
  const serverUrl = canonicalMcpServerUrl(input?.serverUrl || input?.url);
  if (!tool || !serverUrl) return null;
  return { kind: 'url', serverUrl, tool };
}

export interface McpToolDenial {
  ok: false;
  code: 'MCP_TOOL_DENIED';
  error: string;
  hint: string;
  status: 403;
  data: {
    mcp: {
      decision: 'deny';
      serverUrl?: string;
      server?: string;
      tool: string;
      policy: 'mcpToolRules';
    };
  };
}

/** Error estable que recibe el modelo y el cliente HTTP. */
export function mcpToolDenial(target: McpToolTarget): McpToolDenial {
  const data = target.kind === 'url'
    ? { serverUrl: target.serverUrl }
    : { server: target.server };
  const donde = target.kind === 'url'
    ? target.serverUrl
    : `el servidor "${target.server}"`;
  return {
    ok: false,
    code: 'MCP_TOOL_DENIED',
    error: `MCP tool denegada por política del proyecto: ${target.tool} en ${donde}`,
    hint: 'Ajusta mcpToolRules en .commander/permissions.json para permitir esta tool.',
    status: 403,
    data: {
      mcp: {
        decision: 'deny',
        ...data,
        tool: target.tool,
        policy: 'mcpToolRules',
      },
    },
  };
}
