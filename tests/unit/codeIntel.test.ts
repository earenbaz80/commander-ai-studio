import { afterAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { analyzeSource, findReferences, invalidateCodeIntel, planRename } from '../../src/agent/codeIntel';

/**
 * Inteligencia de código sobre un proyecto de verdad, pero diminuto.
 *
 * Los tests montan un `tsconfig.json` y dos archivos en un directorio temporal
 * y comprueban las tres cosas que el agente necesita para fiarse: que el
 * análisis ve un import sin usar, que el renombrado toca TODOS los archivos que
 * usan el símbolo y que **no escribe nada** en disco.
 */

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-intel-'));

function project(name: string, files: Record<string, string>): string {
  const dir = path.join(BASE, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          noEmit: true,
        },
      },
      null,
      2
    ),
    'utf8'
  );
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content, 'utf8');
  return dir;
}

afterAll(() => {
  invalidateCodeIntel();
  fs.rmSync(BASE, { recursive: true, force: true });
});

describe('analyzeSource', () => {
  it('detecta un import que no se usa y no inventa diagnósticos', () => {
    const dir = project('analyze', {
      'a.ts': "export const saludo = 'hola';\nexport const otra = 1;\n",
      'b.ts': "import { saludo, otra } from './a';\nexport const texto = saludo;\n",
    });

    const res = analyzeSource(dir, 'b.ts');
    expect(res.ok).toBe(true);
    const data = res.data!;
    expect(data.checked).toBe(true);
    expect(data.errorCount).toBe(0);
    expect(data.unusedImports.map((u) => u.name)).toEqual(['otra']);
  });

  it('devuelve el error de tipo con su línea', () => {
    const dir = project('diagnostic', {
      'a.ts': "export const n: number = 'texto';\n",
    });

    const data = analyzeSource(dir, 'a.ts').data!;
    expect(data.errorCount).toBeGreaterThanOrEqual(1);
    expect(data.diagnostics[0].line).toBe(1);
    expect(data.diagnostics[0].code).toMatch(/^TS\d+$/);
  });

  it('en un proyecto sin tsconfig sigue devolviendo las reglas', () => {
    const dir = path.join(BASE, 'sin-tsconfig');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'x.ts'), "export const color = '#ff0000';\n", 'utf8');

    const data = analyzeSource(dir, 'x.ts').data!;
    expect(data.checked).toBe(false);
    expect(data.rules.map((r) => r.rule)).toEqual(['color-token']);
  });
});

describe('findReferences', () => {
  it('encuentra la declaración y los usos en otros archivos', () => {
    const dir = project('refs', {
      'a.ts': 'export const saludo = 1;\n',
      'b.ts': "import { saludo } from './a';\nexport const doble = saludo + saludo;\n",
    });

    const res = findReferences(dir, 'a.ts', 'saludo');
    expect(res.ok).toBe(true);
    const data = res.data!;
    expect(data.declarations.length).toBe(1);
    expect(data.references.map((r) => r.file)).toContain('b.ts');
    expect(data.references.length).toBeGreaterThanOrEqual(2);
  });
});

describe('planRename', () => {
  it('propone el cambio en todos los archivos y no escribe nada', () => {
    const dir = project('rename', {
      'a.ts': 'export const saludo = 1;\n',
      'b.ts': "import { saludo } from './a';\nexport const doble = saludo + saludo;\n",
    });
    const antesA = fs.readFileSync(path.join(dir, 'a.ts'), 'utf8');
    const antesB = fs.readFileSync(path.join(dir, 'b.ts'), 'utf8');

    const res = planRename(dir, 'a.ts', { symbol: 'saludo', newName: 'bienvenida' });
    expect(res.ok).toBe(true);
    const plan = res.data!;
    expect(plan.symbol).toBe('saludo');
    expect(plan.files.map((f) => f.path).sort()).toEqual(['a.ts', 'b.ts']);
    expect(plan.files.every((f) => f.changed)).toBe(true);
    expect(plan.files.find((f) => f.path === 'b.ts')!.diff).toContain('bienvenida');

    // La promesa de la tool: proponer no es aplicar.
    expect(fs.readFileSync(path.join(dir, 'a.ts'), 'utf8')).toBe(antesA);
    expect(fs.readFileSync(path.join(dir, 'b.ts'), 'utf8')).toBe(antesB);
  });

  it('rechaza un nombre que no es un identificador', () => {
    const dir = project('rename-invalid', { 'a.ts': 'export const saludo = 1;\n' });
    const res = planRename(dir, 'a.ts', { symbol: 'saludo', newName: 'con espacio' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Nombre inválido/);
  });
});
