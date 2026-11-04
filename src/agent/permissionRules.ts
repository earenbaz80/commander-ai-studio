/**
 * Reglas de permisos por patrón, al estilo de OpenCode.
 *
 * Sin reglas, cada tool peligrosa abre el modal (o usa su allowlist). Con
 * reglas, `allow` ejecuta sin preguntar, `deny` bloquea y `ask` fuerza el modal
 * aunque la tool no lo pidiera. El patrón se compara con el comando de
 * `shell.run` o con la ruta de las tools de escritura; gana la última regla que
 * coincide, para que una regla nueva pueda corregir a una anterior.
 *
 * Se guardan en `localStorage` porque son preferencia de esta máquina, no del
 * repo: una regla `rm *: allow` no debería viajar con el proyecto.
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
const MAX_RULES = 50;

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
