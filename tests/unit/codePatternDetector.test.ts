import { describe, test, expect } from 'vitest';
import {
  detectCodePatterns,
  hasSignificantCodeChange,
  CODE_PATTERN_LABELS,
} from '../../src/utils/codePatternDetector';

describe('codePatternDetector', () => {
  test('empty code returns no trigger', () => {
    const r = detectCodePatterns('');
    expect(r.shouldTrigger).toBe(false);
    expect(r.patterns).toHaveLength(0);
  });

  test('detects missing tests in long file', () => {
    const r = detectCodePatterns(Array(40).fill('const x = 1;').join('\n'));
    expect(r.patterns).toContain('missing_tests');
  });

  test('detects many any types', () => {
    const code = 'const a: any = 1;\nconst b: any = 2;\nconst c: any = 3;';
    const r = detectCodePatterns(code);
    expect(r.patterns).toContain('many_any_types');
  });

  test('detects empty catch', () => {
    const r = detectCodePatterns('try { x() } catch (e) {}');
    expect(r.patterns).toContain('empty_catch');
    expect(r.severity).not.toBe('none');
  });

  test('marks TODO markers', () => {
    const r = detectCodePatterns('// TODO: implement\nconst x = 1;');
    expect(r.patterns).toContain('pending_markers');
  });

  test('many console.log', () => {
    const code = Array(5).fill('console.log("x");').join('\n');
    const r = detectCodePatterns(code);
    expect(r.patterns).toContain('console_leftovers');
  });

  test('high coupling imports', () => {
    const code = Array(16).fill("import x from 'y';").join('\n');
    const r = detectCodePatterns(code);
    expect(r.patterns).toContain('high_coupling');
  });

  test('deep nesting', () => {
    const code = 'if (a) {\n                  x();\n}';
    const r = detectCodePatterns(code);
    expect(r.patterns).toContain('deep_nesting');
  });

  test('json.parse without try triggers unchecked_parse', () => {
    const r = detectCodePatterns('const x = JSON.parse(input);');
    expect(r.patterns).toContain('unchecked_parse');
  });

  test('eval triggers dynamic_eval', () => {
    const r = detectCodePatterns('const r = eval("1+1");');
    expect(r.patterns).toContain('dynamic_eval');
    expect(r.severity).toBe('high');
  });

  test('hasSignificantCodeChange compares semantics', () => {
    expect(hasSignificantCodeChange('a', 'a')).toBe(false);
    expect(hasSignificantCodeChange('a', 'b')).toBe(true);
    expect(hasSignificantCodeChange('', 'x')).toBe(true);
    expect(hasSignificantCodeChange('a b', 'a   b')).toBe(false);
  });

  test('labels exist for every pattern', () => {
    const r = detectCodePatterns('const x: any = 1;\nconst y: any = 2;\nconst z: any = 3;\ntry { a() } catch(e){}');
    for (const p of r.patterns) {
      expect(CODE_PATTERN_LABELS[p]).toBeDefined();
    }
  });
});
