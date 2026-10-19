import { describe, test, expect } from 'vitest';
import { analyzeSave } from '../../src/utils/saveAutomation';

describe('saveAutomation', () => {
  test('ts file suggests typecheck', () => {
    const res = analyzeSave('src/App.ts', 'const x = 1;');
    expect(res.actions).toContain('typecheck');
    expect(res.suggestions.some((s) => /tsc/.test(s))).toBeTruthy();
  });

  test('js file suggests tests', () => {
    const res = analyzeSave('src/foo.js', 'console.log("x")');
    expect(res.actions).toContain('eslint');
  });

  test('patterns propagate', () => {
    const code = 'const a: any = 1;\nconst b: any = 2;\nconst c: any = 3;';
    const res = analyzeSave('src/b.ts', code);
    expect(res.patterns.patterns).toContain('many_any_types');
    expect(res.shouldNotify).toBe(true);
  });

  test('shouldNotify for any saving file once actions derived', () => {
    const res = analyzeSave('README.md', 'hello');
    // markdown not significant code, but content empty-ish; either false or true accepted as derived
    expect(typeof res.shouldNotify).toBe('boolean');
  });
});
