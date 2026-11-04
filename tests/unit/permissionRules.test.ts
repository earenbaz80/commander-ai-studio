import { describe, expect, it } from 'vitest';
import { decide, patternMatches, ruleTarget } from '../../src/agent/permissionRules';

describe('reglas de permisos por patrón', () => {
  it('el comodín cubre el resto del comando', () => {
    expect(patternMatches('git status*', 'git status -s')).toBe(true);
    expect(patternMatches('git *', 'git commit -m x')).toBe(true);
    expect(patternMatches('git *', 'npm test')).toBe(false);
  });

  it('sin comodín exige coincidencia exacta', () => {
    expect(patternMatches('rm -rf dist', 'rm -rf dist')).toBe(true);
    expect(patternMatches('rm -rf dist', 'rm -rf dist/')).toBe(false);
  });

  it('el patrón es literal salvo el comodín', () => {
    // Los puntos no deben comportarse como "cualquier carácter".
    expect(patternMatches('a.b', 'axb')).toBe(false);
    expect(patternMatches('a.b', 'a.b')).toBe(true);
  });

  it('saca el objetivo del comando y de la ruta', () => {
    expect(ruleTarget('shell.run', { command: 'npm test' })).toBe('npm test');
    expect(ruleTarget('fs.edit', { path: 'src/a.ts' })).toBe('src/a.ts');
    expect(ruleTarget('fs.read', { path: 'src/a.ts' })).toBeNull();
    expect(ruleTarget('shell.run', {})).toBeNull();
  });

  it('gana la última regla que coincide', () => {
    const rules = [
      { tool: 'shell.run', pattern: 'npm *', decision: 'allow' as const },
      { tool: 'shell.run', pattern: 'npm publish*', decision: 'deny' as const },
    ];
    expect(decide('shell.run', { command: 'npm test' }, rules)).toBe('allow');
    expect(decide('shell.run', { command: 'npm publish' }, rules)).toBe('deny');
  });

  it('una regla comodín de tool aplica sólo a las que admiten patrón', () => {
    const rules = [{ tool: '*', pattern: 'src/*', decision: 'ask' as const }];
    expect(decide('fs.edit', { path: 'src/a.ts' }, rules)).toBe('ask');
    expect(decide('shell.run', { command: 'ls' }, rules)).toBeNull();
  });

  it('sin reglas no decide nada', () => {
    expect(decide('shell.run', { command: 'npm test' }, [])).toBeNull();
  });
});
