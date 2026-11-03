/**
 * Reglas propias del repo, comprobadas con el AST (sin modelo, sin red).
 *
 * Son las dos convenciones que un agente rompe sin darse cuenta al escribir
 * código nuevo y que ni `tsc` ni ESLint vigilan:
 *
 *  - `color-token`: un color literal (`#00ffff`) en lugar de la paleta. Hay
 *    muchísima deuda previa, así que lo que se castiga no es «hay colores» sino
 *    «este cambio añade uno nuevo» (ver `newViolations`).
 *  - `i18n-literal`: texto de interfaz que no pasa por `L(es, en)` / `t(...)` /
 *    `deText`, que es como este repo traduce. Se exige precisión, no cobertura:
 *    una regla ruidosa se desactiva a la semana.
 *
 * El módulo es puro a propósito: recibe el módulo `typescript` ya cargado y no
 * toca `fs`, así corre igual en el servidor, en el script de CLI y en los tests
 * de la suite `node`.
 */

export type RuleId = 'color-token' | 'i18n-literal';

export interface RuleViolation {
  rule: RuleId;
  /** Ruta relativa con `/`, también en Windows. */
  file: string;
  line: number;
  column: number;
  message: string;
  /** Fragmento normalizado que identifica la violación (se usa para comparar). */
  excerpt: string;
}

/** Nombres que este repo usa para traducir. */
const TRANSLATORS = new Set(['L', 't', 'tr', 'deText', 'translate']);

/** Atributos JSX cuyo valor es texto que ve el usuario. */
const UI_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label']);

/** Color hexadecimal: 3, 6 u 8 dígitos. */
const HEX = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const ACCENT = /[áéíóúÁÉÍÓÚñÑüÜ¿¡]/;

/** Tope por archivo: por encima ya no es una lista, es un volcado. */
const MAX_PER_FILE = 200;

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function isTranslatorCall(node: any, ts: any): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return TRANSLATORS.has(callee.text);
  if (ts.isPropertyAccessExpression(callee)) return TRANSLATORS.has(callee.name?.text);
  return false;
}

/**
 * ¿El nodo está dentro de una llamada al traductor? Sube por los padres: es lo
 * único que distingue `L('Sesión', 'Session')` de un literal suelto.
 */
function insideTranslator(node: any, ts: any): boolean {
  let cur = node.parent;
  while (cur) {
    if (isTranslatorCall(cur, ts)) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * ¿Parece texto para una persona? Deliberadamente conservador: exige 4+ letras
 * y además acento o espacio, así no marca identificadores (`btn-primary`),
 * rutas ni clases CSS.
 */
function isHumanText(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '').length;
  if (letters < 4) return false;
  return ACCENT.test(text) || /\s/.test(text);
}

/** Valor de un `<X placeholder="…" />`, no de `className` ni `data-*`. */
function isUiAttributeValue(node: any, ts: any): boolean {
  const parent = node.parent;
  if (!parent || !ts.isJsxAttribute(parent)) return false;
  const name = parent.name?.getText?.() || parent.name?.text || '';
  return UI_ATTRS.has(String(name));
}

/**
 * Analiza un archivo y devuelve sus violaciones. Un archivo que no parsea no
 * revienta: las reglas son un aviso, no una condición para trabajar.
 */
export function checkSource(ts: any, file: string, text: string): RuleViolation[] {
  const rel = String(file || '').split('\\').join('/');
  if (!/\.(ts|tsx)$/i.test(rel)) return [];
  const kind = rel.toLowerCase().endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  let sf: any;
  try {
    sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  } catch {
    return [];
  }

  const out: RuleViolation[] = [];
  const add = (rule: RuleId, node: any, message: string, excerpt: string) => {
    if (out.length >= MAX_PER_FILE) return;
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({
      rule,
      file: rel,
      line: pos.line + 1,
      column: pos.character + 1,
      message,
      excerpt: normalize(excerpt),
    });
  };

  const visit = (node: any) => {
    // ── Colores literales ──
    // Sólo cadenas y texto JSX: un color en un comentario es documentación, no
    // un valor que se pinte.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
      const value = String(node.text || '');
      for (const m of value.match(HEX) || []) {
        add(
          'color-token',
          node,
          `Color literal ${m}: usa un token del tema o una utilidad existente en lugar del literal.`,
          m
        );
      }
    }

    // ── Texto de interfaz sin traducir ──
    if (ts.isJsxText(node)) {
      const value = String(node.text || '').trim();
      if (value && isHumanText(value) && !insideTranslator(node, ts)) {
        add(
          'i18n-literal',
          node,
          'Texto de interfaz sin traducir: pásalo por L(es, en) (o t/deText) para que siga el idioma.',
          value
        );
      }
    } else if (ts.isStringLiteral(node) && isUiAttributeValue(node, ts)) {
      const value = String(node.text || '').trim();
      if (value && isHumanText(value) && !insideTranslator(node, ts)) {
        add(
          'i18n-literal',
          node,
          'Texto de interfaz sin traducir: pásalo por L(es, en) (o t/deText) para que siga el idioma.',
          value
        );
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Clave de comparación entre dos análisis: regla + fragmento, no la línea. */
export function violationKey(v: RuleViolation): string {
  return `${v.rule}|${v.excerpt}`;
}

/**
 * Violaciones **nuevas**: las de `after` que no existían en `before`.
 *
 * Se compara por multiconjunto (regla + fragmento), no por línea, porque el
 * cambio mueve el código de sitio constantemente. Así se puede exigir «no
 * añadas deuda» sin pedir que se arreglen los miles de colores que ya había.
 */
export function newViolations(before: RuleViolation[], after: RuleViolation[]): RuleViolation[] {
  const budget = new Map<string, number>();
  for (const v of before) {
    const k = violationKey(v);
    budget.set(k, (budget.get(k) || 0) + 1);
  }
  const introduced: RuleViolation[] = [];
  for (const v of after) {
    const k = violationKey(v);
    const left = budget.get(k) || 0;
    if (left > 0) {
      budget.set(k, left - 1);
      continue;
    }
    introduced.push(v);
  }
  return introduced;
}
