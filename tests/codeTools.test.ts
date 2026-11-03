import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeAgentTool } from '../agentTools.js';

/**
 * Las tres tools de análisis nativo, por el camino real del servidor.
 *
 * Lo que se protege aquí:
 *
 *  1. `code.analyze` ve el import que no se usa y las reglas del repo sin
 *     depender de ningún proveedor.
 *  2. `code.refactor` propone y **no escribe**: es la diferencia entre «te lo
 *     enseño» y «ya lo cambié», y sin eso el modo plan no serviría de nada.
 *  3. `code.fix` es una tool que ejecuta: en modo plan tiene que responder 403
 *     antes de tocar un archivo, aunque falten las dependencias.
 */

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-code-'));

function project(name: string, files: Record<string, string>, permissions?: unknown): string {
  const dir = path.join(BASE, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify(
      { compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', noEmit: true } },
      null,
      2
    ),
    'utf8'
  );
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content, 'utf8');
  if (permissions) {
    fs.mkdirSync(path.join(dir, '.commander'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.commander', 'permissions.json'), JSON.stringify(permissions), 'utf8');
  }
  return dir;
}

after(() => fs.rmSync(BASE, { recursive: true, force: true }));

test('code.analyze devuelve diagnósticos, imports sin usar y reglas', async () => {
  const dir = project('analyze', {
    'a.ts': 'export const saludo = 1;\nexport const otra = 2;\n',
    'b.ts': "import { saludo, otra } from './a';\nexport const texto = saludo;\nexport const color = '#ff0000';\n",
  });

  const res = await executeAgentTool('code.analyze', { root: dir, path: 'b.ts' });
  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.checked, true);
  assert.equal(data.errorCount, 0);
  assert.deepEqual(data.unusedImports.map((u: any) => u.name), ['otra']);
  assert.ok(data.rules.some((r: any) => r.rule === 'color-token'), 'la regla del color no se aplicó');
});

test('code.analyze con symbol devuelve las referencias del proyecto', async () => {
  const dir = project('refs', {
    'a.ts': 'export const saludo = 1;\n',
    'b.ts': "import { saludo } from './a';\nexport const doble = saludo * 2;\n",
  });

  const res = await executeAgentTool('code.analyze', { root: dir, path: 'a.ts', symbol: 'saludo' });
  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.references.error, undefined, JSON.stringify(data.references));
  assert.equal(data.references.declarations.length, 1);
  assert.ok(data.references.references.some((r: any) => r.file === 'b.ts'));
});

test('code.refactor propone el renombrado y no escribe en disco', async () => {
  const dir = project('rename', {
    'a.ts': 'export const saludo = 1;\n',
    'b.ts': "import { saludo } from './a';\nexport const doble = saludo * 2;\n",
  });
  const antes = fs.readFileSync(path.join(dir, 'b.ts'), 'utf8');

  const res = await executeAgentTool('code.refactor', { root: dir, path: 'a.ts', symbol: 'saludo', newName: 'bienvenida' });
  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.symbol, 'saludo');
  assert.deepEqual(data.files.map((f: any) => f.path).sort(), ['a.ts', 'b.ts']);
  assert.match(data.files.find((f: any) => f.path === 'b.ts').diff, /\+.*bienvenida/);

  assert.equal(fs.readFileSync(path.join(dir, 'b.ts'), 'utf8'), antes, 'la tool no debe escribir');
});

test('code.fix avisa si faltan las herramientas del proyecto', async () => {
  const dir = project('fix-sin-deps', { 'x.ts': "export const a: number = 1;\n" });

  const res = await executeAgentTool('code.fix', { root: dir, paths: ['x.ts'] });
  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.files[0].eslint.ran, false);
  assert.match(String(data.files[0].eslint.error), /eslint no está instalado/);
  assert.match(String(data.files[0].prettier.error), /prettier no está instalado/);
  assert.equal(data.files[0].changed, false);
});

test('code.fix en modo plan responde 403 sin tocar el archivo', async () => {
  const dir = project('fix-plan', { 'x.ts': "export const a: number = 1;\n" }, { mode: 'plan' });

  const res = await executeAgentTool('code.fix', { root: dir, paths: ['x.ts'] });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  assert.match(String(res.error), /Modo Plan/);
});

test('code.analyze sí funciona en modo plan: sólo lee', async () => {
  const dir = project('analyze-plan', { 'a.ts': 'export const a: number = 1;\n' }, { mode: 'plan' });

  const res = await executeAgentTool('code.analyze', { root: dir, path: 'a.ts' });
  assert.equal(res.ok, true, String(res.error));
  assert.equal((res.data as any).checked, true);
});
