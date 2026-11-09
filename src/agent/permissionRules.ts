/**
 * Reglas de permisos por patrón.
 *
 * Sin reglas, cada tool peligrosa abre el modal (o usa su allowlist). Con
 * reglas, `allow` ejecuta sin preguntar, `deny` bloquea y `ask` fuerza el modal
 * aunque la tool no lo pidiera. El patrón se compara con el comando de
 * `shell.run` o con la ruta de las tools de escritura; gana la última regla que
 * coincide, para que una regla nueva pueda corregir a una anterior.
 *
 * La UI las edita en `localStorage` y las sincroniza a
 * `.commander/permissions.json`; el servidor (y por tanto el CLI) evalúa ese
 * archivo para que ambas superficies apliquen exactamente las mismas reglas.
 */
export type RuleDecision = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
  /** Tool a la que aplica, o `*` para todas las que admiten patrón. */
  tool: string;
  /** Comando o ruta con `*` como comodín de cualquier secuencia. */
  pattern: string;
  decision: RuleDecision;
}

const STORAGE_KEY = 'commander.agent.permissionRules';
export const MAX_RULES = 50;

/** Tools cuyo objetivo se puede expresar como patrón de texto. */
const RULE_TOOLS = new Set([
  'shell.run',
  'fs.write',
  'fs.edit',
  'fs.propose.write',
  'fs.propose.edit',
]);

/** Texto contra el que se compara la regla, o `null` si la tool no admite reglas. */
export function ruleTarget(toolId: string, input: unknown): string | null {
  // MCP y subagentes no tienen comando ni ruta: el patrón se compara con el
  // nombre de la tool para que `deny` también pueda cubrirlos.
  if (toolId === 'task' || toolId === 'mcp.call' || toolId.startsWith('mcp.')) return toolId;
  if (!RULE_TOOLS.has(toolId)) return null;
  const value = (input ?? {}) as { command?: unknown; path?: unknown };
  if (toolId === 'shell.run') {
    return typeof value.command === 'string' && value.command.trim() ? value.command : null;
  }
  return typeof value.path === 'string' && value.path ? value.path : null;
}

/** Glob mínimo: `*` cubre cualquier secuencia y el resto es literal. */
export function patternMatches(pattern: string, value: string): boolean {
  const raw = pattern.trim();
  if (!raw) return false;
  const escaped = raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Valida y recorta un conjunto de reglas venido de disco, red o localStorage. */
export function normalizeRules(raw: unknown): PermissionRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (rule): rule is PermissionRule =>
        Boolean(rule) &&
        typeof (rule as PermissionRule).tool === 'string' &&
        typeof (rule as PermissionRule).pattern === 'string' &&
        ['allow', 'ask', 'deny'].includes((rule as PermissionRule).decision)
    )
    .map((rule) => ({
      tool: rule.tool.slice(0, 100),
      pattern: rule.pattern.slice(0, 500),
      decision: rule.decision,
    }))
    .slice(-MAX_RULES);
}

/** Une dos conjuntos; para el mismo tool+patrón gana la regla entrante. */
export function mergeRuleSets(
  base: PermissionRule[],
  incoming: PermissionRule[]
): PermissionRule[] {
  const out = [...normalizeRules(base)];
  for (const rule of normalizeRules(incoming)) {
    const at = out.findIndex((item) => item.tool === rule.tool && item.pattern === rule.pattern);
    if (at >= 0) out[at] = rule;
    else out.push(rule);
  }
  return out.slice(-MAX_RULES);
}

/**
 * ¿Hace falta preguntar al humano?
 *
 * `deny` no llega aquí: el motor de tools lo corta antes de ejecutar y no se
 * puede saltar con `allow-session` ni con `--yes`. `ask` siempre pregunta;
 * `allow` ejecuta sin modal aunque la tool sea peligrosa.
 */
export function needsHumanApproval(
  rule: RuleDecision | null,
  toolRequiresApproval: boolean,
  allowedForSession: boolean
): boolean {
  if (rule === 'ask') return true;
  if (rule === 'allow') return false;
  return toolRequiresApproval && !allowedForSession;
}

export function loadRules(): PermissionRule[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (rule: any) =>
          rule &&
          typeof rule.tool === 'string' &&
          typeof rule.pattern === 'string' &&
          (rule.decision === 'allow' || rule.decision === 'ask' || rule.decision === 'deny')
      )
      .slice(-MAX_RULES) as PermissionRule[];
  } catch {
    return [];
  }
}

export function saveRules(rules: PermissionRule[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(rules.slice(-MAX_RULES)));
  } catch {
    /* sin storage disponible */
  }
}

/** Añade o reemplaza la regla de ese par tool+patrón y la deja al final. */
export function addRule(rule: PermissionRule): PermissionRule[] {
  const rules = loadRules().filter((r) => !(r.tool === rule.tool && r.pattern === rule.pattern));
  const next = [...rules, rule].slice(-MAX_RULES);
  saveRules(next);
  return next;
}

export function removeRule(tool: string, pattern: string): PermissionRule[] {
  const next = loadRules().filter((r) => !(r.tool === tool && r.pattern === pattern));
  saveRules(next);
  return next;
}

export function clearRules(): void {
  saveRules([]);
}

/**
 * Decisión para esta llamada, o `null` si ninguna regla aplica (se usa el
 * comportamiento normal de la tool).
 */
export function decide(
  toolId: string,
  input: unknown,
  rules: PermissionRule[] = loadRules()
): RuleDecision | null {
  const target = ruleTarget(toolId, input);
  if (!target || rules.length === 0) return null;
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    if (rule.tool !== '*' && rule.tool !== toolId) continue;
    if (patternMatches(rule.pattern, target)) return rule.decision;
  }
  return null;
}

export interface ProjectRulesResponse {
  rules?: unknown;
  migrated?: boolean;
}

/**
 * Lee las reglas del proyecto y, la primera vez, sube las de localStorage.
 * La UI sigue editando en localStorage; el archivo del proyecto es lo que ve
 * el servidor (y por tanto el CLI).
 */
export async function syncRulesWithServer(
  root: string,
  fetcher: typeof fetch = fetch
): Promise<PermissionRule[]> {
  const res = await fetcher(`/api/agent/permission-rules?root=${encodeURIComponent(root)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as ProjectRulesResponse;
  const server = normalizeRules(body.rules);
  const local = loadRules();

  if (body.migrated) {
    saveRules(server);
    return server;
  }

  const merged = mergeRuleSets(server, local);
  if (merged.length === 0) return server;
  const put = await fetcher('/api/agent/permission-rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, rules: merged, migrate: true }),
  });
  if (!put.ok) throw new Error(`HTTP ${put.status}`);
  const saved = (await put.json().catch(() => ({}))) as ProjectRulesResponse;
  const rules = normalizeRules(saved.rules);
  saveRules(rules);
  return rules;
}

/** Persiste una regla nueva en el proyecto para que el CLI la aplique. */
export async function persistRuleToProject(
  root: string,
  rule: PermissionRule,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const res = await fetcher(`/api/agent/permission-rules?root=${encodeURIComponent(root)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as ProjectRulesResponse;
  const merged = mergeRuleSets(normalizeRules(body.rules), [rule]);
  const put = await fetcher('/api/agent/permission-rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, rules: merged }),
  });
  if (!put.ok) throw new Error(`HTTP ${put.status}`);
  saveRules(mergeRuleSets(loadRules(), [rule]));
}
