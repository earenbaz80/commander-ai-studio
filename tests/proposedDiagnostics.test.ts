import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeAgentTool } from '../agentTools.js';

/**
 * `diagnose: true` en `fs.propose.*`: typechequear el contenido propuesto sin
 * escribirlo.
 *
 * Lo que estos tests protegen, en orden de importancia:
 *
 *  1. El archivo propuesto NO aparece en disco. Es la promesa de las tools; si
 *     se implementara escribiendo, lanzando `tsc` y borrando, un fallo a mitad
 *     dejaría el repo sucio y este test sólo lo notaría a veces.
 *  2. Lo que se compila es el contenido propuesto, no lo que hay en disco. Un
 *     `checked: true` con 0 errores también se consigue no compilando nada, así
 *     que el caso que importa es el borrador con un error.
 *  3. El error es del borrador, con su línea: el modelo necesita poder corregir.
 *  4. Los errores de otros archivos no se le achacan al cambio propuesto.
 */

// Fuera del proyecto: `executeAgentTool` acepta el `root` que le pasen como
// raíz, así que no hace falta ensuciar el repo. Y no es sólo estética: cada
// `tsconfig.json` creado bajo el proyecto hace que Vite se recargue entero.
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-diag-'));

/** Proyecto mínimo en disco: tsconfig + archivos. Devuelve el directorio raíz. */
function project(name: string, files: Record<string, string>, withTsconfig = true): string {
  const dir = path.join(BASE, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (withTsconfig) {
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
  }
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content, 'utf8');
  return dir;
}

after(() => {
  fs.rmSync(BASE, { recursive: true, force: true });
});

test('diagnose en fs.propose.write typechequea el borrador sin crearlo', async () => {
  const dir = project('write-error', {});

  const res = await executeAgentTool('fs.propose.write', {
    root: dir,
    path: 'nuevo.ts',
    content: "export const a: number = 'texto';\n",
    diagnose: true,
  });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.changed, true, 'el dry-run sigue devolviendo su diff');

  const diag = data.diagnostics;
  assert.equal(diag.checked, true, `no se pudo comprobar: ${diag.note || ''}`);
  assert.ok(diag.errorCount >= 1, 'un string asignado a number es un error de tipo');
  const first = diag.diagnostics[0];
  assert.equal(first.severity, 'error');
  assert.equal(first.file, 'nuevo.ts', 'el error se atribuye a la ruta relativa propuesta');
  assert.equal(first.line, 1);
  assert.match(first.code, /^TS\d+$/);
  assert.match(first.message, /string|number/i);

  assert.equal(fs.existsSync(path.join(dir, 'nuevo.ts')), false, 'el typecheck no debe crear el archivo');
});

test('un borrador válido sale con cero errores', async () => {
  const dir = project('write-ok', {});

  const res = await executeAgentTool('fs.propose.write', {
    root: dir,
    path: 'ok.ts',
    content: 'export const a: number = 1;\nexport const b = `${a}`;\n',
    diagnose: true,
  });

  assert.equal(res.ok, true, String(res.error));
  const diag = (res.data as any).diagnostics;
  assert.equal(diag.checked, true);
  assert.equal(diag.errorCount, 0, `errores inesperados: ${JSON.stringify(diag.diagnostics)}`);
  assert.equal(fs.existsSync(path.join(dir, 'ok.ts')), false);
});

test('diagnose en fs.propose.edit comprueba el resultado y no el archivo actual', async () => {
  const dir = project('edit-error', { 'app.ts': 'export const a = 1;\n' });

  const res = await executeAgentTool('fs.propose.edit', {
    root: dir,
    path: 'app.ts',
    oldString: 'export const a = 1;',
    newString: 'export const a: string = 1;',
    diagnose: true,
  });

  assert.equal(res.ok, true, String(res.error));
  const diag = (res.data as any).diagnostics;
  assert.equal(diag.checked, true, `no se pudo comprobar: ${diag.note || ''}`);
  assert.ok(diag.errorCount >= 1, 'el archivo actual compila; el propuesto no');

  assert.equal(fs.readFileSync(path.join(dir, 'app.ts'), 'utf8'), 'export const a = 1;\n', 'el archivo no se toca');
});

test('los errores de otros archivos no se achacan al borrador', async () => {
  const dir = project('ajeno', {
    // Este error ya existía antes del cambio: no es del borrador.
    'roto.ts': "export const b: number = 'x';\n",
  });

  const res = await executeAgentTool('fs.propose.write', {
    root: dir,
    path: 'main.ts',
    content: "import { b } from './roto';\nexport const c = b;\n",
    diagnose: true,
  });

  assert.equal(res.ok, true, String(res.error));
  const diag = (res.data as any).diagnostics;
  assert.equal(diag.checked, true, `no se pudo comprobar: ${diag.note || ''}`);
  assert.equal(diag.errorCount, 0, `se colaron errores ajenos: ${JSON.stringify(diag.diagnostics)}`);
  assert.equal(fs.existsSync(path.join(dir, 'main.ts')), false);
});

test('un archivo importado que cambió en disco no se sirve desde caché', async () => {
  const dir = project('cache', { 'helpers.ts': 'export const n = 1;\n' });
  const draft = { root: dir, path: 'main.ts', content: "import { n } from './helpers';\nexport const x: number = n;\n", diagnose: true };

  const antes = await executeAgentTool('fs.propose.write', draft);
  assert.equal(antes.ok, true, String(antes.error));
  assert.equal((antes.data as any).diagnostics.errorCount, 0, JSON.stringify((antes.data as any).diagnostics));

  // Cambia el tipo del import en disco: el segundo borrador deja de compilar.
  // Con una caché sin validar seguiría diciendo 0 errores.
  fs.writeFileSync(path.join(dir, 'helpers.ts'), "export const n = 'texto';\n", 'utf8');

  const despues = await executeAgentTool('fs.propose.write', draft);
  assert.equal(despues.ok, true, String(despues.error));
  const diag = (despues.data as any).diagnostics;
  assert.ok(diag.errorCount >= 1, `diagnóstico rancio: el import ya no es un number (${JSON.stringify(diag)})`);
});

test('sin tsconfig se avisa y el diff se devuelve igual', async () => {
  const dir = project('sin-tsconfig', {}, false);

  const res = await executeAgentTool('fs.propose.write', {
    root: dir,
    path: 'suelto.ts',
    content: 'export const a = 1;\n',
    diagnose: true,
  });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.changed, true, 'no poder comprobar no invalida la propuesta');
  assert.equal(data.diagnostics.checked, false);
  assert.match(String(data.diagnostics.note), /tsconfig/);
});

test('con diagnose:false no se compila nada', async () => {
  const dir = project('opt-in', {});

  const res = await executeAgentTool('fs.propose.write', {
    root: dir,
    path: 'tranquilo.ts',
    content: "export const a: number = 'texto';\n",
    diagnose: false,
  });

  assert.equal(res.ok, true, String(res.error));
  assert.equal((res.data as any).diagnostics, undefined, 'diagnose:false desactiva el typecheck');

  // El typecheck es lo que hay por defecto: un borrador roto se avisa sin pedirlo.
  const porDefecto = await executeAgentTool('fs.propose.write', {
    root: dir,
    path: 'por-defecto.ts',
    content: "export const a: number = 'texto';\n",
  });
  const diag = (porDefecto.data as any).diagnostics;
  assert.equal(diag.checked, true, `debe comprobarse por defecto: ${diag.note || ''}`);
  assert.ok(diag.errorCount >= 1, 'sin diagnose el borrador roto pasaba sin aviso');

  // Y si no hay cambio que aplicar, tampoco se compila: no hay nada que revisar.
  const igual = await executeAgentTool('fs.propose.write', {
    root: dir,
    path: 'tranquilo.ts',
    content: 'x\n',
    diagnose: true,
  });
  assert.equal(igual.ok, true, String(igual.error));
  assert.equal((igual.data as any).changed, true);

  fs.writeFileSync(path.join(dir, 'igual.ts'), 'igual\n', 'utf8');
  const sinCambio = await executeAgentTool('fs.propose.write', {
    root: dir,
    path: 'igual.ts',
    content: 'igual\n',
    diagnose: true,
  });
  assert.equal(sinCambio.ok, true, String(sinCambio.error));
  assert.equal((sinCambio.data as any).changed, false);
  assert.equal((sinCambio.data as any).diagnostics, undefined, 'sin cambio no hay borrador que compilar');
});
