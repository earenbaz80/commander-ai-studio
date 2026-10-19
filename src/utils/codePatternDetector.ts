/**
 * codePatternDetector.ts
 *
 * Detector ligero de patrones de código en el cliente (browser).
 *
 * Proposito: soportar el roadmap #1 - "Auto-trigger suggestions based
 * on code patterns detected". Produce un resultado estructurado compatible
 * conceptualmente con `personalAgent.js#detectCodePatterns()` (server-side,
 * Node fs/child_process based), pero ejecutando puramente en el navegador
 * para que el FloatingAssistant pueda reaccionar en tiempo real.
 *
 * Sin dependencias de Node: solo analiza el texto que le entregue el
 * llamador (tipicamente el codigo del editor / ultima respuesta del
 * asistente / mensaje con bloque de codigo).
 */

export interface CodePatternResult {
  /** True si los patrones detectados justifican un trigger proactivo. */
  shouldTrigger: boolean;
  /** Lista de patrones detectados (mensajes cortos). */
  patterns: string[];
  /** Severidad agregada de los patrones detectados. */
  severity: 'none' | 'low' | 'medium' | 'high';
  /** Metricas rapidas estilo personalAgent complexity/coupling. */
  complexity: number;
  /** Estimado de cobertura de tests (0-1) basado en presencias. */
  coverage: number;
  /** Conteo de dependencias (imports/requires) detectadas. */
  coupling: number;
  /** Total de lineas analizadas. */
  lineCount: number;
}

const SEVERITY_ORDER: CodePatternResult['severity'][] = ['none', 'low', 'medium', 'high'];

function bumpSeverity(current: CodePatternResult['severity'], next: CodePatternResult['severity']): CodePatternResult['severity'] {
  return SEVERITY_ORDER.indexOf(next) > SEVERITY_ORDER.indexOf(current) ? next : current;
}

/**
 * Heuristicas de patrones anti-patrones / codigo problemático.
 */
function detectPatterns(code: string): { patterns: string[]; severity: CodePatternResult['severity'] } {
  const patterns: string[] = [];
  let severity: CodePatternResult['severity'] = 'none';

  if (!code.trim()) return { patterns, severity };

  const lines = code.split(/\r?\n/);
  const lineCount = lines.length;

  // 1. Funcion muy larga (>60 lines beteween braces heuristic: line count>100)
  if (lineCount > 100) {
    patterns.push('large_file');
    severity = bumpSeverity(severity, 'medium');
  }

  // 2. Imports / dependencies (>15)
  const importMatches = code.match(/\b(import\s+|require\()/g) || [];
  if (importMatches.length > 15) {
    patterns.push('high_coupling');
    severity = bumpSeverity(severity, 'medium');
  }

  // 3. Any types (TS) - escaping strict typing
  const anyCount = (code.match(/:\s*any\b/g) || []).length;
  if (anyCount >= 3) {
    patterns.push('many_any_types');
    severity = bumpSeverity(severity, 'low');
  }

  // 4. Empty catch blocks
  if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(code)) {
    patterns.push('empty_catch');
    severity = bumpSeverity(severity, 'high');
  }

  // 5. TODO / FIXME / HACK markers
  if (/(FIXME|TODO|HACK|XXX|BUG)[\s:]/i.test(code)) {
    patterns.push('pending_markers');
    severity = bumpSeverity(severity, 'low');
  }

  // 6. console.log leaves in production code
  const consoleLogCount = (code.match(/console\.log\(/g) || []).length;
  if (consoleLogCount > 3) {
    patterns.push('console_leftovers');
    severity = bumpSeverity(severity, 'low');
  }

  // 7. Deep nesting heuristic (count leading spaces max)
  let maxIndent = 0;
  for (const l of lines) {
    const m = l.match(/^( +)/);
    if (m) maxIndent = Math.max(maxIndent, m[1].length);
  }
  if (maxIndent >= 16) {
    patterns.push('deep_nesting');
    severity = bumpSeverity(severity, 'medium');
  }

  // 8. Potential absence of tests references (no describe/it/test)
  const hasTests = /(\btest\b|\bit\(|\bdescribe\(|jest|vitest)/.test(code);
  if (lineCount > 30 && !hasTests) {
    patterns.push('missing_tests');
    severity = bumpSeverity(severity, 'medium');
  }

  // 9. Long line (>200 chars) -> readability
  if (lines.some((l) => l.length > 200)) {
    patterns.push('long_lines');
    severity = bumpSeverity(severity, 'low');
  }

  // 10. eval / Function constructor
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) {
    patterns.push('dynamic_eval');
    severity = bumpSeverity(severity, 'high');
  }

  // 11. JSON.parse without try/catch adjacency (heuristic)
  if (/JSON\.parse\(/.test(code) && !/try\s*\{/.test(code)) {
    patterns.push('unchecked_parse');
    severity = bumpSeverity(severity, 'medium');
  }

  return { patterns, severity };
}

/**
 * Cliente-deduccion de cobertura: 0-1
 */
function estimateCoverage(code: string): number {
  if (!code.trim()) return 0.5;
  const hasTests = /(\btest\b|\bit\(|\bdescribe\(|jest|vitest|mocha)/.test(code);
  return hasTests ? 1.0 : 0.2;
}

/**
 * Detecion principal.
 */
export function detectCodePatterns(code: string): CodePatternResult {
  if (typeof code !== 'string') code = '';

  const patternsInfo = detectPatterns(code);
  const complexity = Math.min(100, Math.round((code.split(/\r?\n/).length / 5) + (patternsInfo.patterns.length * 5)));
  const coverage = estimateCoverage(code);
  const coupling = (code.match(/\b(import\s+|require\()/g) || []).length;

  // shouldTrigger si algun patron detectado
  const shouldTrigger = patternsInfo.patterns.length > 0;
  // Escalado: si severity high, siempre trigger
  return {
    shouldTrigger,
    patterns: patternsInfo.patterns,
    severity: patternsInfo.severity,
    complexity,
    coverage,
    coupling,
    lineCount: code.split(/\r?\n/).length,
  };
}

/**
 * Comparador rapido de 2 frames de codigo: true si cambio significativo.
 */
export function hasSignificantCodeChange(previous: string, next: string): boolean {
  if (!previous) return Boolean(next);
  if (previous === next) return false;
  // Comparacion normalizada (whitespace-insensitive)
  const n = (s: string) => s.trim().replace(/\s+/g, ' ');
  return n(previous) !== n(next);
}

export default detectCodePatterns;

export const CODE_PATTERN_LABELS: Record<string, { es: string; en: string }> = {
  large_file: { es: 'Archivo grande — sugerencia: modularizar', en: 'Large file — consider modularizing' },
  high_coupling: { es: 'Alto acoplamiento — sugerencia: simplificar imports', en: 'High coupling — simplify imports' },
  many_any_types: { es: 'Muchos `any` — sugerencia: tipado estricto', en: 'Many `any` types — use strict typing' },
  empty_catch: { es: 'Catch vacío — sugerencia: capturar errores', en: 'Empty catch — handle errors' },
  pending_markers: { es: 'Marcadores TODO/FIXME — sugerencia: resolver', en: 'Pending TODO/FIXME — resolve them' },
  console_leftovers: { es: 'console.log rezagados — sugerencia: limpiar', en: 'Console leftovers — clean up' },
  deep_nesting: { es: 'Anidamiento profundo — sugerencia: extraer funciones', en: 'Deep nesting — extract functions' },
  missing_tests: { es: 'Sin tests detectados — sugerencia: añadir tests', en: 'No tests detected — consider adding' },
  long_lines: { es: 'Lineas largas — sugerencia: rapping', en: 'Long lines — consider wrapping' },
  dynamic_eval: { es: 'Uso de eval/Function — revisar seguridad', en: 'eval/Function usage — review security' },
  unchecked_parse: { es: 'JSON.parse sin try/catch — sugerencia: validar', en: 'JSON.parse without guard — validate' },
};
