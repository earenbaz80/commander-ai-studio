/**
 * saveAutomation.ts — Roadmap #2.
 *
 * Heuristica client-side para decidir que accion/bateria de pruebas
 * disparar al guardar un archivo. Es el equivalente navegador de
 * `personalAgent.js#maybeRunOnSave` (que usa fs/child_process en Node).
 *
 * Aqui no ejecutamos comandos (no hay `fs`/`child_process` en el
 * navegador). En su lugar, derivamos senales que FloatingAssistant
 * traduce a sugerencias accionables (run tests, tsc, eslint, refactor)
 * y actualizan `codeContext` para auto-trigger.
 */

import { detectCodePatterns, type CodePatternResult } from './codePatternDetector';

export interface SaveAutomationResult {
  /** Si deberia disparar auto-trigger de sugerencias. */
  shouldNotify: boolean;
  /** Comandos/sugerencias sugeridos para la UI/terminal. */
  suggestions: string[];
  /** Patrones de codigo detectados en el archivo. */
  patterns: CodePatternResult;
  /** Acciones sugeridas ("tests", "typecheck", "eslint", "refactor", "deps"). */
  actions: string[];
}

const EXTENSION_COMMANDS: Record<string, string[]> = {
  ts: ['typecheck', 'tests', 'eslint'],
  tsx: ['typecheck', 'tests', 'eslint'],
  js: ['tests', 'eslint'],
  jsx: ['tests', 'eslint'],
  json: ['lint'],
  css: ['format'],
};

export function analyzeSave(path: string, content: string): SaveAutomationResult {
  const patterns = detectCodePatterns(content || '');
  const ext = (path.split('.').pop() || '').toLowerCase();
  const actions = [...new Set([...(EXTENSION_COMMANDS[ext] || []), ...deriveFromPatterns(patterns)])];

  const suggestions: string[] = [];
  if (ext === 'ts' || ext === 'tsx') {
    suggestions.push('Run `tsc --noEmit` for type-checking?');
  }
  if (actions.includes('tests')) {
    suggestions.push('Run tests (`npm test`)?');
  }
  if (actions.includes('eslint')) {
    suggestions.push('Lint with ESLint?');
  }
  if (patterns.shouldTrigger) {
    for (const p of patterns.patterns) {
      suggestions.push(p);
    }
  }
  // de-dupe
  const unique = Array.from(new Set(suggestions));

  return {
    shouldNotify: patterns.shouldTrigger || actions.length > 0,
    suggestions: unique,
    patterns,
    actions,
  };
}

function deriveFromPatterns(p: CodePatternResult): string[] {
  const out: string[] = [];
  if (p.patterns.includes('missing_tests')) out.push('tests');
  if (p.patterns.includes('many_any_types')) out.push('typecheck');
  if (p.patterns.includes('high_coupling')) out.push('deps');
  if (p.patterns.includes('deep_nesting') || p.patterns.includes('large_file')) out.push('refactor');
  if (p.severity === 'high') out.push('refactor');
  return out;
}

export default analyzeSave;
