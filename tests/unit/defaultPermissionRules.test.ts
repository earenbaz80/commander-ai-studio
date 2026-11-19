import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PERMISSION_RULES,
  decide,
  effectiveRules,
} from '../../src/agent/permissionRules';

/**
 * Reglas por defecto: leer, testear y compilar dentro del workspace no piden
 * aprobación; escribir y los comandos de riesgo siguen preguntando.
 *
 * La lectura ya era gratis (sólo las tools mutantes pasan por el gate); lo que
 * cambia aquí es la verificación: T1 gastaba una aprobación por cada
 * `node --test` y esas son las que se ahorran.
 */

const allow = (command: string) =>
  decide('shell.run', { command }, DEFAULT_PERMISSION_RULES);

describe('comandos de verificación permitidos', () => {
  it.each([
    'node --test',
    'node --test math.test.mjs',
    'npm test',
    'npm run test',
    'npm run build',
    'npm run typecheck',
    'npm run lint',
    'npx vitest run',
    'npx tsc --noEmit',
    'tsc --noEmit',
    'vitest',
  ])('%s no pide aprobación', (command) => {
    expect(allow(command)).toBe('allow');
  });
});

describe('lo que no es verificación sigue preguntando', () => {
  it.each([
    'rm -rf src',
    'git push origin main',
    'git reset --hard',
    'npm publish',
    'npm install left-pad',
    'curl https://example.com',
    'node server.js',
    'node scripts/migrate.ts',
    'cat .env',
  ])('%s no está permitido por defecto', (command) => {
    expect(allow(command)).toBe(null);
  });

  it('las escrituras no tienen regla de allow', () => {
    expect(decide('fs.edit', { path: 'src/a.ts' }, DEFAULT_PERMISSION_RULES)).toBe(null);
    expect(decide('fs.write', { path: 'src/a.ts' }, DEFAULT_PERMISSION_RULES)).toBe(null);
  });
});

describe('reglas del usuario sobre las de por defecto', () => {
  it('una regla explícita del mismo tool y patrón gana', () => {
    const rules = effectiveRules([{ tool: 'shell.run', pattern: 'npm test*', decision: 'deny' }]);
    expect(decide('shell.run', { command: 'npm test' }, rules)).toBe('deny');
    expect(decide('shell.run', { command: 'npm run build' }, rules)).toBe('allow');
  });

  it('las de por defecto no amplían nada más', () => {
    const rules = effectiveRules([]);
    expect(decide('shell.run', { command: 'rm -rf dist' }, rules)).toBe(null);
    expect(decide('task', { goal: 'algo' }, rules)).toBe(null);
  });
});
