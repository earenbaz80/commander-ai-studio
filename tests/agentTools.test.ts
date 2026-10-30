import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { handleAgentRunTool, executeAgentTool } from '../agentTools.js';
import { addRoot, removeRoot } from '../projects.js';
import { AGENT_TOOLS } from '../security.js';
import { AGENT_FUNCTION_DECLARATIONS, mapFunctionCall } from '../src/agent/fnTools.js';
import { gitConflictTool } from '../src/agent/tools/git.js';
import { setPermissions } from '../permissions.js';

function mockReq(body: any) {
  return { body, ip: '127.0.0.1', headers: {} } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.body = data; return this; },
    setHeader() { return this; },
    flushHeaders() { return this; },
    write() { return this; },
    end() { return this; },
  };
  return res;
}

const TEST_DIR = path.join(process.cwd(), 'tests', 'tmp');
const TEST_FILE = path.join(TEST_DIR, 'test.txt');

before(() => {
  // Estado limpio: si una corrida anterior se interrumpió, `after` no llegó a
  // borrar TEST_DIR y `fs.write` (que no sobrescribe por defecto) fallaría.
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

test('fs.read lee un archivo existente', async () => {
  fs.writeFileSync(TEST_FILE, 'Hola mundo', 'utf8');
  const req = mockReq({ toolId: 'fs.read', input: { path: 'tests/tmp/test.txt' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.content, 'Hola mundo');
});

test('fs.read devuelve error si el archivo no existe', async () => {
  const req = mockReq({ toolId: 'fs.read', input: { path: 'tests/tmp/no-existe.txt' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, false);
});

test('fs.write crea un archivo nuevo', async () => {
  const req = mockReq({ toolId: 'fs.write', input: { path: 'tests/tmp/write-test.txt', content: 'Nuevo contenido' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.equal(fs.readFileSync(path.join(TEST_DIR, 'write-test.txt'), 'utf8'), 'Nuevo contenido');
});

test('fs.write sin overwrite falla si el archivo existe', async () => {
  fs.writeFileSync(TEST_FILE, 'Original', 'utf8');
  const req = mockReq({ toolId: 'fs.write', input: { path: 'tests/tmp/test.txt', content: 'Nuevo' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, false);
});

test('fs.edit reemplaza texto exacto', async () => {
  fs.writeFileSync(TEST_FILE, 'Hola mundo', 'utf8');
  const req = mockReq({ toolId: 'fs.edit', input: { path: 'tests/tmp/test.txt', oldString: 'mundo', newString: 'Commander' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.equal(fs.readFileSync(TEST_FILE, 'utf8'), 'Hola Commander');
});

test('fs.edit con replaceAll reemplaza todas las ocurrencias', async () => {
  fs.writeFileSync(TEST_FILE, 'foo bar foo', 'utf8');
  const req = mockReq({ toolId: 'fs.edit', input: { path: 'tests/tmp/test.txt', oldString: 'foo', newString: 'baz', replaceAll: true } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.equal(fs.readFileSync(TEST_FILE, 'utf8'), 'baz bar baz');
});

test('fs.edit no interpreta $& ni $1 en newString', async () => {
  fs.writeFileSync(TEST_FILE, 'valor = X', 'utf8');
  const req = mockReq({ toolId: 'fs.edit', input: { path: 'tests/tmp/test.txt', oldString: 'X', newString: '$& $1 $$' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.equal(fs.readFileSync(TEST_FILE, 'utf8'), 'valor = $& $1 $$');
});

test('fs.glob lista archivos', async () => {
  const req = mockReq({ toolId: 'fs.glob', input: { pattern: '*.txt' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.ok(Array.isArray(res.body.data.files));
});

test('fs.grep encuentra texto en archivos', async () => {
  fs.writeFileSync(TEST_FILE, 'texto_unico_para_grep', 'utf8');
  const req = mockReq({ toolId: 'fs.grep', input: { pattern: 'texto_unico_para_grep' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.data.matches.length > 0);
});

test('fs.glob y fs.grep buscan en el root de la petición, no en el repo', async () => {
  const dir = path.join(TEST_DIR, 'root-propio');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'solo-aqui.ts'), 'export const MARCA_ROOT_PROPIO = 1;\n', 'utf8');

  const glob = await executeAgentTool('fs.glob', { pattern: 'solo-aqui.ts', root: dir });
  assert.equal(glob.ok, true, String(glob.error));
  const globData = glob.data as any;
  assert.deepEqual(
    globData.files.map((file: string) => file.replace(/\\/g, '/')),
    ['src/solo-aqui.ts'],
    'glob no debe devolver ficheros del repo real'
  );
  assert.deepEqual(
    globData.roots.map((root: string) => root.replace(/\\/g, '/').toLowerCase()),
    [path.resolve(dir).replace(/\\/g, '/').toLowerCase()],
    'la búsqueda debe reportar el root pedido'
  );

  // `**/` tiene que cruzar directorios también en Windows, donde la ruta del
  // sistema lleva `\` y la comparación por subcadena no casaba nunca.
  const deep = await executeAgentTool('fs.glob', { pattern: '**/solo-aqui.ts', root: dir });
  assert.deepEqual((deep.data as any).files, ['src/solo-aqui.ts'], 'el patrón **/ debe cruzar directorios');

  const nada = await executeAgentTool('fs.glob', { pattern: '**/no-existe.ts', root: dir });
  assert.deepEqual((nada.data as any).files, [], 'un patrón sin coincidencias no debe inventarlas');

  const grep = await executeAgentTool('fs.grep', { pattern: 'MARCA_ROOT_PROPIO', root: dir });
  assert.equal(grep.ok, true, String(grep.error));
  const matches = (grep.data as any).matches;
  assert.equal(matches.length, 1, `grep no debe ver el repo real: ${JSON.stringify(matches).slice(0, 200)}`);
  assert.match(String(matches[0].file).replace(/\\/g, '/'), /solo-aqui\.ts$/);
});

// --- fs.read por ventana --------------------------------------------------

test('fs.read con offset/limit devuelve solo la ventana, con sus metadatos', async () => {
  const file = path.join(TEST_DIR, 'ventana.txt');
  fs.writeFileSync(file, Array.from({ length: 50 }, (_, i) => `linea ${i + 1}`).join('\n') + '\n', 'utf8');

  const res = await executeAgentTool('fs.read', { path: 'tests/tmp/ventana.txt', offset: 10, limit: 5 });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.content, 'linea 10\nlinea 11\nlinea 12\nlinea 13\nlinea 14');
  assert.equal(data.startLine, 10);
  assert.equal(data.endLine, 14);
  assert.equal(data.totalLines, 50);
  assert.equal(data.truncated, true);
  assert.match(String(data.hint), /Ventana 10-14 de 50/);
});

test('fs.read sin ventana devuelve el archivo exacto, incluido el salto final', async () => {
  fs.writeFileSync(TEST_FILE, 'Hola mundo\n', 'utf8');

  const res = await executeAgentTool('fs.read', { path: 'tests/tmp/test.txt' });

  const data = res.data as any;
  assert.equal(data.content, 'Hola mundo\n', 'el contenido debe ser literal para poder usarlo en fs.edit');
  assert.equal(data.totalLines, 1);
  assert.equal(data.truncated, false);
});

test('fs.read trunca un archivo largo en vez de volcarlo entero', async () => {
  const file = path.join(TEST_DIR, 'largo.txt');
  fs.writeFileSync(file, Array.from({ length: 400 }, (_, i) => `l${i + 1}`).join('\n'), 'utf8');

  const data = (await executeAgentTool('fs.read', { path: 'tests/tmp/largo.txt' })).data as any;

  assert.equal(data.endLine, 200, 'la ventana por defecto son 200 líneas');
  assert.equal(data.totalLines, 400);
  assert.equal(data.truncated, true);
  assert.equal(String(data.content).split('\n').length, 200);
  assert.ok(String(data.content).length < 4000, 'no debe acercarse al volcado completo');
});

test('fs.read numberLines numera sin alterar los metadatos', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'numeros.txt'), 'uno\ndos\ntres\n', 'utf8');

  const data = (await executeAgentTool('fs.read', {
    path: 'tests/tmp/numeros.txt',
    offset: 2,
    limit: 2,
    numberLines: true,
  })).data as any;

  assert.equal(data.content, '    2| dos\n    3| tres');
  assert.equal(data.startLine, 2);
  assert.equal(data.endLine, 3);
  assert.equal(data.truncated, true, 'la línea 1 queda fuera de la ventana');
});

test('fs.read con offset después del final devuelve ventana vacía y avisa', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'tres.txt'), 'a\nb\nc\n', 'utf8');

  const res = await executeAgentTool('fs.read', { path: 'tests/tmp/tres.txt', offset: 99, limit: 10 });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.content, '', 'no debe devolver la última línea como si fuera la 99');
  assert.equal(data.totalLines, 3);
  assert.equal(data.truncated, true);
  assert.match(String(data.hint), /fuera del archivo/);
});

// --- fs.grep con contexto ------------------------------------------------

test('fs.grep devuelve contexto antes y después de la coincidencia', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'grep-ctx.txt'), 'a\nb\nOBJETIVO_CTX\nc\nd\n', 'utf8');

  const res = await executeAgentTool('fs.grep', {
    path: 'tests/tmp',
    pattern: 'OBJETIVO_CTX',
    before: 2,
    after: 1,
  });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.deepEqual(data.context, { before: 2, after: 1 });
  const match = data.matches.find((m: any) => m.file.replace(/\\/g, '/').endsWith('grep-ctx.txt'));
  assert.ok(match, 'debe encontrar el archivo de prueba');
  assert.equal(match.line, 3);
  assert.equal(match.text, 'OBJETIVO_CTX');
  assert.deepEqual(match.before, ['a', 'b']);
  assert.deepEqual(match.after, ['c']);
});

test('fs.grep sin contexto no añade before/after', async () => {
  fs.writeFileSync(path.join(TEST_DIR, 'grep-sin-ctx.txt'), 'x\nSIN_CTX\ny\n', 'utf8');

  const data = (await executeAgentTool('fs.grep', { pattern: 'SIN_CTX' })).data as any;
  const match = data.matches.find((m: any) => m.file.replace(/\\/g, '/').endsWith('grep-sin-ctx.txt'));

  assert.ok(match);
  assert.equal(match.before, undefined);
  assert.equal(match.after, undefined);
  assert.equal(data.context, undefined);
});

test('shell.run ejecuta comando permitido', async () => {
  const req = mockReq({ toolId: 'shell.run', input: { command: 'echo hola' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.data.stdout.includes('hola'));
});

test('shell.run admite pipes entre etapas permitidas', async () => {
  // `grep` no está en Windows y `findstr` no está en POSIX: cada uno en su casa.
  const command = process.platform === 'win32'
    ? 'echo hola | findstr hola'
    : 'echo hola | grep hola';

  // Root temporal: el proyecto local puede tener `allowedTools` guardado.
  const res = await executeAgentTool('shell.run', { command, root: gitRoot });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.exitCode, 0);
  assert.match(String(data.stdout), /hola/);
});

test('shell.run valida cada etapa del pipeline, no solo la primera', async () => {
  const res = await executeAgentTool('shell.run', { command: 'echo x | sh' });

  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  assert.match(String(res.error), /Comando no permitido/);
});

test('shell.run en segundo plano devuelve id y log consultable con shell.job', async () => {
  const started = await executeAgentTool('shell.run', { command: 'npm --version', background: true, root: gitRoot });

  assert.equal(started.ok, true, String(started.error));
  const job = started.data as any;
  assert.match(job.id, /^job-/);
  assert.ok(job.pid > 0, 'debe devolver el pid');
  assert.ok(job.logPath, 'debe devolver la ruta del log');

  let logs: any = null;
  for (let i = 0; i < 100; i++) {
    const r = await executeAgentTool('shell.job', { action: 'logs', id: job.id, tail: 20, root: gitRoot });
    assert.equal(r.ok, true, String(r.error));
    logs = r.data;
    if (logs.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.notEqual(logs?.status, 'running', 'npm --version debe terminar solo');
  assert.match(String(logs?.content), /\d+\.\d+/, 'el log debe tener la versión');

  const list = await executeAgentTool('shell.job', { action: 'list', root: gitRoot });
  assert.ok((list.data as any).jobs.some((j: any) => j.id === job.id));

  // Un trabajo terminado no se puede parar: no debe fingir éxito.
  const late = await executeAgentTool('shell.job', { action: 'stop', id: job.id, root: gitRoot });
  assert.equal(late.ok, false);
  assert.match(String(late.error), /ya terminó/);

  const bad = await executeAgentTool('shell.job', { action: 'reiniciar', id: job.id, root: gitRoot });
  assert.equal(bad.ok, false);
  assert.match(String(bad.error), /action debe ser/);
});

test('shell.run bloquea comando peligroso', async () => {
  const req = mockReq({ toolId: 'shell.run', input: { command: 'sudo rm -rf /' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.statusCode, 403);
});

test('shell.run bloquea operador de shell', async () => {
  const req = mockReq({ toolId: 'shell.run', input: { command: 'echo hola | cat /etc/passwd' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.statusCode, 403);
});

test('shell.run bloquea $()', async () => {
  const req = mockReq({ toolId: 'shell.run', input: { command: 'echo $(whoami)' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.statusCode, 403);
});

test('shell.run bloquea ejecutores de código (node, npx, python)', async () => {
  for (const command of ['node -e "1"', 'npx cowsay hi', 'python -c "1"']) {
    const res = mockRes();
    await handleAgentRunTool(mockReq({ toolId: 'shell.run', input: { command } }), res);
    assert.equal(res.statusCode, 403, command);
  }
});

test('shell.run bloquea lectura de archivos con type/cat', async () => {
  for (const command of ['type tests\\tmp\\test.txt', 'cat tests/tmp/test.txt']) {
    const res = mockRes();
    await handleAgentRunTool(mockReq({ toolId: 'shell.run', input: { command } }), res);
    assert.equal(res.statusCode, 403, command);
  }
});

test('shell.run bloquea expansión %VAR% de cmd.exe', async () => {
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'shell.run', input: { command: 'echo %GEMINI_API_KEY%' } }), res);
  assert.equal(res.statusCode, 403);
});

test('shell.run bloquea rutas absolutas fuera de los proyectos', async () => {
  const outside = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'shell.run', input: { command: `ls ${outside}` } }), res);
  assert.equal(res.statusCode, 403);
});

test('toolId inválido devuelve error', async () => {
  const req = mockReq({ toolId: 'tool.inexistente', input: {} });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.body.ok, false);
});

test('fs.read fuera de los proyectos responde 403 (no 500)', async () => {
  const req = mockReq({ toolId: 'fs.read', input: { path: '../../../../Windows/System32/drivers/etc/hosts' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /fuera de los proyectos permitidos/);
});

test('fs.write fuera de los proyectos responde 403', async () => {
  const req = mockReq({ toolId: 'fs.write', input: { path: '../escaped.txt', content: 'x' } });
  const res = mockRes();
  await handleAgentRunTool(req, res);
  assert.equal(res.statusCode, 403);
});

// --- Inyección de comandos en las tools de git ---------------------------
// Estas tools se invocan con `executeAgentTool` sobre un root temporal registrado:
// + el proyecto local puede tener `allowedTools` sin git.rebase/git.worktree,
// + y así `git` corre en un directorio desechable, no en este repo.

const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-inject-'));
addRoot(gitRoot);

before(() => {
  // Repo mínimo con un commit: `worktree list/add` necesitan un HEAD.
  execFileSync('git', ['init', '-q'], { cwd: gitRoot });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=test', 'commit', '--allow-empty', '-qm', 'init'], {
    cwd: gitRoot,
  });
});

test('los tools git avanzados están expuestos y no devuelven 400', async () => {
  for (const id of ['git.worktree', 'git.rebase', 'git.conflict']) {
    assert.ok(AGENT_TOOLS.has(id), `${id} debe estar en AGENT_TOOLS`);
  }
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'git.worktree', input: { root: gitRoot, action: 'list' } }), res);
  assert.notEqual(res.statusCode, 400, 'el toolId no debe ser rechazado como inválido');
  assert.equal(res.statusCode, 200);
});

test('las tres tools git se anuncian al modelo y mapean a su toolId', () => {
  for (const fn of ['git_worktree', 'git_rebase', 'git_conflict']) {
    const decl = AGENT_FUNCTION_DECLARATIONS.find((d) => d.name === fn);
    assert.ok(decl, `${fn} debe tener declaración de función`);
    assert.equal(mapFunctionCall(fn, { action: 'list' })?.tool, fn.replace('_', '.'));
  }
});

test('git.worktree list devuelve rutas y ramas reales', async () => {
  const res = await executeAgentTool('git.worktree', { root: gitRoot, action: 'list' });
  assert.equal(res.ok, true, String(res.error));
  const list = (res.data as any).worktrees as Array<{ path: string; branch: string }>;
  assert.ok(list.length >= 1, 'debe incluir al menos el worktree principal');
  assert.ok(path.isAbsolute(list[0].path), `path debe ser absoluta, fue: ${list[0].path}`);
  assert.notEqual(list[0].path, 'worktree');
  assert.doesNotMatch(list[0].branch, /^(HEAD|worktree)\b/, `branch debe ser una rama: ${list[0].branch}`);
});

test('git.worktree add/remove funcionan dentro del proyecto', async () => {
  const wt = path.join(gitRoot, 'wt-feature');
  const added = await executeAgentTool('git.worktree', { root: gitRoot, action: 'add', path: 'wt-feature' });
  assert.equal(added.ok, true, String(added.error));
  assert.equal(fs.existsSync(wt), true, 'el worktree debe existir');

  const removed = await executeAgentTool('git.worktree', { root: gitRoot, action: 'remove', path: 'wt-feature' });
  assert.equal(removed.ok, true, String(removed.error));
  assert.equal(fs.existsSync(wt), false, 'el worktree debe haberse borrado');
});

test('git.worktree add no crea worktrees fuera del proyecto', async () => {
  const outside = `escape-wt-${process.pid}`;
  const res = await executeAgentTool('git.worktree', { root: gitRoot, action: 'add', path: `../${outside}` });

  assert.equal(res.ok, false);
  assert.match(String(res.error), /fuera del proyecto/);
  assert.equal(fs.existsSync(path.join(gitRoot, '..', outside)), false);
});

test('git.conflict devuelve ours y theirs del primer bloque', async () => {
  const output = 'auto-merging src/x.ts\n<<<<<<< HEAD\nlado-local\n=======\nlado-remoto\n>>>>>>> feature\n';
  const res = await executeAgentTool('git.conflict', { root: gitRoot, output });

  assert.equal(res.ok, true, String(res.error));
  assert.equal((res.data as any).ours, 'lado-local');
  assert.equal((res.data as any).theirs, 'lado-remoto');
});

test('git.conflict sin resolve inspecciona y no escribe el archivo', async () => {
  const file = path.join(gitRoot, 'inspect.ts');
  const raw = 'a\n<<<<<<< HEAD\nlocal\n=======\nremote\n>>>>>>> feature\n';
  fs.writeFileSync(file, raw, 'utf8');

  const res = await executeAgentTool('git.conflict', { root: gitRoot, output: `Merge conflict in inspect.ts\n${raw}` });

  assert.equal(res.ok, true, String(res.error));
  assert.equal((res.data as any).path, 'inspect.ts', 'debe deducir la ruta de la salida');
  assert.equal(fs.readFileSync(file, 'utf8'), raw, 'la inspección no debe tocar el archivo');
});

test('git.conflict resolve=ours aplica nuestro lado a todos los bloques', async () => {
  const file = path.join(gitRoot, 'both.ts');
  const raw = [
    'uno',
    '<<<<<<< HEAD',
    'local-1',
    '=======',
    'remoto-1',
    '>>>>>>> feature',
    'dos',
    '<<<<<<< HEAD',
    'local-2',
    '=======',
    'remoto-2',
    '>>>>>>> feature',
    'tres',
    '',
  ].join('\n');
  fs.writeFileSync(file, raw, 'utf8');

  // Sin `path`: la ruta sale de la propia salida de merge.
  const res = await executeAgentTool('git.conflict', {
    root: gitRoot,
    resolve: 'ours',
    output: `Auto-merging both.ts\nCONFLICT (content): Merge conflict in both.ts\n${raw}`,
  });

  assert.equal(res.ok, true, String(res.error));
  assert.equal((res.data as any).resolved, 2);
  assert.equal(fs.readFileSync(file, 'utf8'), 'uno\nlocal-1\ndos\nlocal-2\ntres\n');
});

test('git.conflict resolve=theirs entiende bloques diff3', async () => {
  const file = path.join(gitRoot, 'diff3.ts');
  const raw = '<<<<<<< HEAD\nnuestro\n||||||| base\nbase\n=======\nsuyo\n>>>>>>> feature\n';
  fs.writeFileSync(file, raw, 'utf8');

  const res = await executeAgentTool('git.conflict', { root: gitRoot, path: 'diff3.ts', output: raw, resolve: 'theirs' });

  assert.equal(res.ok, true, String(res.error));
  assert.equal(fs.readFileSync(file, 'utf8'), 'suyo\n');
});

test('git.conflict resolve rechaza rutas fuera del proyecto', async () => {
  const outside = path.join(os.tmpdir(), `conflict-outside-${process.pid}.ts`);
  const raw = '<<<<<<< HEAD\nlocal\n=======\nremote\n>>>>>>> feature\n';
  fs.writeFileSync(outside, raw, 'utf8');

  const res = await executeAgentTool('git.conflict', {
    root: gitRoot,
    path: `../${path.basename(outside)}`,
    output: raw,
    resolve: 'ours',
  });

  assert.equal(res.ok, false);
  assert.match(String(res.error), /fuera del proyecto/);
  assert.equal(fs.readFileSync(outside, 'utf8'), raw, 'no debe escribir fuera del proyecto');
  fs.rmSync(outside, { force: true });
});

test('git.conflict resolve sin ruta la exige en vez de adivinar', async () => {
  const raw = '<<<<<<< HEAD\nlocal\n=======\nremote\n>>>>>>> feature\n';
  const res = await executeAgentTool('git.conflict', { root: gitRoot, output: raw, resolve: 'ours' });

  assert.equal(res.ok, false);
  assert.match(String(res.error), /path requerido/);
});

test('git.conflict resolve respeta el modo y los globs de escritura', async () => {
  const file = path.join(gitRoot, 'perm.ts');
  const raw = '<<<<<<< HEAD\nlocal\n=======\nremote\n>>>>>>> feature\n';
  fs.writeFileSync(file, raw, 'utf8');

  try {
    setPermissions(gitRoot, { mode: 'readonly' });
    const ro = await executeAgentTool('git.conflict', { root: gitRoot, path: 'perm.ts', output: raw, resolve: 'ours' });
    assert.equal(ro.ok, false, 'en modo readonly no debe escribir');
    assert.match(String(ro.error), /Sólo lectura/);

    // Inspeccionar (sin resolve) sigue permitido en readonly.
    const inspect = await executeAgentTool('git.conflict', { root: gitRoot, path: 'perm.ts', output: raw });
    assert.equal(inspect.ok, true, String(inspect.error));

    setPermissions(gitRoot, { mode: 'build', files: { read: [], write: ['src/**'] } });
    const globbed = await executeAgentTool('git.conflict', { root: gitRoot, path: 'perm.ts', output: raw, resolve: 'ours' });
    assert.equal(globbed.ok, false, 'no debe escribir fuera de los globs permitidos');
    assert.match(String(globbed.error), /permisos de escritura/);

    assert.equal(fs.readFileSync(file, 'utf8'), raw, 'el archivo debe quedar intacto');
  } finally {
    setPermissions(gitRoot, { mode: 'build' });
  }
});

test('git.conflict en readonly deja consultar el merge y no modificarlo', async () => {
  try {
    setPermissions(gitRoot, { mode: 'readonly' });
    // La consulta de estado es la que hace el panel al abrirse: leer no es tocar.
    const state = await executeAgentTool('git.conflict', { root: gitRoot, all: true });
    assert.equal(state.ok, true, String(state.error));
    assert.equal(Array.isArray((state.data as any).files), true, 'debe devolver la lista de archivos');

    // Cerrar el merge con `git add` sí modifica el índice: sigue bloqueado.
    const stage = await executeAgentTool('git.conflict', { root: gitRoot, all: true, stage: true });
    assert.equal(stage.ok, false, 'stage no puede correr en readonly');
    assert.match(String(stage.error), /Sólo lectura/);
  } finally {
    setPermissions(gitRoot, { mode: 'build' });
  }
});

test('git.conflict sólo pide aprobación cuando resuelve', () => {
  assert.equal(gitConflictTool.requiresApproval({ output: 'x' } as any, {} as any), false);
  assert.equal(gitConflictTool.requiresApproval({ output: 'x', resolve: 'ours' } as any, {} as any), true);
  assert.equal(gitConflictTool.requiresApproval({ output: 'x', resolve: 'theirs' } as any, {} as any), true);
});

// --- Resolver todo el merge de una vez ------------------------------------
// Repo aparte con un conflicto real (dos archivos) para no ensuciar gitRoot.

const mergeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-merge-'));
addRoot(mergeRoot);

before(() => {
  const g = (args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=test', ...args], { cwd: mergeRoot });
  g(['init', '-q']);
  // El servidor ejecuta `git commit` sin -c: la identidad debe estar en el repo
  // para que el commit de merge no dependa de la config global de la máquina.
  g(['config', 'user.email', 't@example.com']);
  g(['config', 'user.name', 'test']);
  g(['checkout', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(mergeRoot, 'a.ts'), 'base\n');
  fs.writeFileSync(path.join(mergeRoot, 'b.ts'), 'base\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  g(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(mergeRoot, 'a.ts'), 'feature\n');
  fs.writeFileSync(path.join(mergeRoot, 'b.ts'), 'feature\n');
  g(['commit', '-qam', 'feature']);
  g(['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(mergeRoot, 'a.ts'), 'main\n');
  fs.writeFileSync(path.join(mergeRoot, 'b.ts'), 'main\n');
  g(['commit', '-qam', 'main']);
  assert.throws(() => g(['merge', 'feature']), 'el merge debe quedar en conflicto');
});

/** git en Windows reescribe a CRLF: comparar sin depender del fin de línea. */
const lf = (p: string) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

test('git.conflict all sin resolve consulta el estado del merge', async () => {
  const res = await executeAgentTool('git.conflict', { root: mergeRoot, all: true });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.inMerge, true);
  assert.equal(data.total, 2);
  assert.deepEqual(data.files.map((f: any) => f.path).sort(), ['a.ts', 'b.ts']);
  assert.equal(data.files.every((f: any) => f.conflicts === 1 && f.ready === false), true);
  assert.equal(lf(path.join(mergeRoot, 'a.ts')).includes('<<<<<<<'), true, 'consultar no debe escribir');
});

test('git.conflict stage no marca archivos que aún tienen marcas', async () => {
  const res = await executeAgentTool('git.conflict', { root: mergeRoot, all: true, stage: true });

  assert.equal(res.ok, false);
  assert.match(String(res.error), /marcas de conflicto/);
  assert.equal(lf(path.join(mergeRoot, 'a.ts')).includes('<<<<<<<'), true, 'sigue sin resolver');
});

test('git.conflict commit se niega mientras queden archivos sin preparar', async () => {
  const res = await executeAgentTool('git.conflict', { root: mergeRoot, all: true, commit: true });

  assert.equal(res.ok, false);
  assert.match(String(res.error), /Faltan 2 archivo\(s\) por preparar/);
  // No se comprometió nada: el merge sigue abierto.
  const state = await executeAgentTool('git.conflict', { root: mergeRoot, all: true });
  assert.equal((state.data as any).inMerge, true);
});

test('git.conflict all resuelve todos los archivos del merge', async () => {
  const res = await executeAgentTool('git.conflict', { root: mergeRoot, all: true, resolve: 'theirs' });

  assert.equal(res.ok, true, String(res.error));
  const files = (res.data as any).files as Array<{ path: string; resolved: number }>;
  assert.deepEqual(files.map((f) => f.path).sort(), ['a.ts', 'b.ts']);
  assert.equal(files.every((f) => f.resolved === 1), true);
  assert.equal(lf(path.join(mergeRoot, 'a.ts')), 'feature\n');
  assert.equal(lf(path.join(mergeRoot, 'b.ts')), 'feature\n');
});

test('git.conflict all sin marcas avisa de que falta git add', async () => {
  // Los archivos ya están resueltos pero siguen sin fusionar en el índice:
  // debe decir qué falta, no repetir un error genérico ni fingir éxito.
  const res = await executeAgentTool('git.conflict', { root: mergeRoot, all: true, resolve: 'ours' });

  assert.equal(res.ok, false);
  assert.match(String(res.error), /falta `git add`/);
});

test('git.conflict stage cierra el merge con git add', async () => {
  const res = await executeAgentTool('git.conflict', { root: mergeRoot, all: true, stage: true });

  assert.equal(res.ok, true, String(res.error));
  assert.deepEqual([...(res.data as any).staged].sort(), ['a.ts', 'b.ts']);

  // Ya no queda nada sin fusionar en el índice.
  const state = await executeAgentTool('git.conflict', { root: mergeRoot, all: true });
  assert.equal(state.ok, true, String(state.error));
  assert.equal((state.data as any).total, 0);
  assert.equal((state.data as any).inMerge, true, 'MERGE_HEAD sigue hasta el commit');
});

test('git.conflict commit completa el merge tras git add', async () => {
  const before = String(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: mergeRoot, encoding: 'utf8' })).trim();
  const res = await executeAgentTool('git.conflict', { root: mergeRoot, all: true, commit: true });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.committed, true);
  assert.ok(String(data.hash).length >= 7, 'devuelve el hash corto del commit');

  const head = String(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: mergeRoot, encoding: 'utf8' })).trim();
  assert.notEqual(head, before, 'el HEAD debe avanzar');
  // `rev-list --parents` incluye el propio commit: 3 campos = dos padres.
  const parents = String(execFileSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], { cwd: mergeRoot, encoding: 'utf8' })).trim().split(/\s+/);
  assert.equal(parents.length, 3, 'debe ser un commit de fusión con dos padres');

  // El árbol conserva el lado elegido y el merge queda cerrado.
  assert.equal(lf(path.join(mergeRoot, 'a.ts')), 'feature\n');
  const state = await executeAgentTool('git.conflict', { root: mergeRoot, all: true });
  assert.equal((state.data as any).inMerge, false, 'MERGE_HEAD desaparece tras el commit');
  assert.equal((state.data as any).total, 0);
});

test('git.conflict commit sin merge en curso falla', async () => {
  const res = await executeAgentTool('git.conflict', { root: mergeRoot, all: true, commit: true });

  assert.equal(res.ok, false);
  assert.match(String(res.error), /No hay merge en curso/);
});

// --- Abortar el merge -----------------------------------------------------
// Repo propio: abortar deshace el conflicto, así que no puede compartir el
// estado de mergeRoot (que ya quedó commiteado).

const abortRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-abort-'));
addRoot(abortRoot);

before(() => {
  const g = (args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=test', ...args], { cwd: abortRoot });
  g(['init', '-q']);
  g(['checkout', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(abortRoot, 'a.ts'), 'base\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  g(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(abortRoot, 'a.ts'), 'feature\n');
  g(['commit', '-qam', 'feature']);
  g(['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(abortRoot, 'a.ts'), 'main\n');
  g(['commit', '-qam', 'main']);
  assert.throws(() => g(['merge', 'feature']), 'el merge debe quedar en conflicto');
});

test('git.conflict abort restaura el árbol previo al merge', async () => {
  const head = String(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: abortRoot, encoding: 'utf8' })).trim();

  const res = await executeAgentTool('git.conflict', { root: abortRoot, all: true, abort: true });

  assert.equal(res.ok, true, String(res.error));
  assert.equal((res.data as any).aborted, true);

  // El archivo vuelve al contenido de main, sin marcas.
  assert.equal(lf(path.join(abortRoot, 'a.ts')), 'main\n');

  const state = await executeAgentTool('git.conflict', { root: abortRoot, all: true });
  assert.equal((state.data as any).inMerge, false, 'MERGE_HEAD debe desaparecer');
  assert.equal((state.data as any).total, 0);

  // Abortar no mueve el historial.
  const after = String(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: abortRoot, encoding: 'utf8' })).trim();
  assert.equal(after, head);
});

test('git.conflict abort sin merge en curso falla', async () => {
  const res = await executeAgentTool('git.conflict', { root: abortRoot, all: true, abort: true });

  assert.equal(res.ok, false);
  assert.match(String(res.error), /No hay merge en curso/);
});

test('git.conflict all sin conflictos falla en vez de fingir éxito', async () => {
  const res = await executeAgentTool('git.conflict', { root: gitRoot, all: true, resolve: 'ours' });

  assert.equal(res.ok, false);
  assert.match(String(res.error), /No hay archivos en conflicto/);
});

test('git.rebase no ejecuta comandos metidos en el nombre de branch', async () => {
  const marker = path.join(gitRoot, 'git-pwned.txt');
  const payload = `main & echo PWNED > "${marker}" & "`;
  const res = await executeAgentTool('git.rebase', { root: gitRoot, action: 'start', branch: payload });

  assert.equal(res.ok, false, 'una branch inexistente debe fallar');
  assert.equal(fs.existsSync(marker), false, 'el payload no debe ejecutarse como comando');
});

test('git.rebase rechaza branch/base que empiezan por "-" (inyección de opción)', async () => {
  const branch = await executeAgentTool('git.rebase', { root: gitRoot, action: 'start', branch: '--exec=calc' });
  assert.equal(branch.ok, false);
  assert.match(String(branch.error), /inválido/i);
});

test('git.worktree remove rechaza un path que empieza por "-"', async () => {
  const res = await executeAgentTool('git.worktree', { root: gitRoot, action: 'remove', path: '--force' });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /inválido/i);
});

test('git.diff con ruta que contiene metacaracteres no ejecuta nada', async () => {
  const marker = path.join(TEST_DIR, 'diff-pwned.txt');
  const res = await executeAgentTool('git.diff', { path: `x & echo PWNED > "${marker}"` });

  // git recibe la ruta tal cual: no existe, así que el diff es vacío o falla,
  // pero en ningún caso se ejecuta el `echo`.
  assert.equal(fs.existsSync(marker), false, 'la ruta no debe interpretarse como shell');
  assert.ok(!JSON.stringify(res).includes('PWNED'), 'la salida no debe contener el efecto del payload');
});

// --- Conflictos modify/delete ---------------------------------------------
// Un lado borra el archivo y el otro lo modifica: no hay marcas que contar y
// el archivo puede faltar en el worktree. Cada repo se resuelve una sola vez,
// así que se crean dos: uno para `ours` y otro para `theirs`.

function makeModifyDeleteRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-md-'));
  addRoot(dir);
  const g = (args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=test', ...args], { cwd: dir });
  g(['init', '-q']);
  // El servidor hace `git add`/`git rm`; la identidad local evita depender de
  // la config global si más adelante se commitea el merge.
  g(['config', 'user.email', 't@example.com']);
  g(['config', 'user.name', 'test']);
  g(['checkout', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'keep.ts'), 'base keep\n');
  fs.writeFileSync(path.join(dir, 'gone.ts'), 'base gone\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  // feature modifica keep.ts y borra gone.ts
  g(['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(dir, 'keep.ts'), 'feature keep\n');
  g(['rm', '-q', 'gone.ts']);
  g(['commit', '-qam', 'feature']);
  // main borra keep.ts y modifica gone.ts
  g(['checkout', '-q', 'main']);
  g(['rm', '-q', 'keep.ts']);
  fs.writeFileSync(path.join(dir, 'gone.ts'), 'main gone\n');
  g(['commit', '-qam', 'main']);
  assert.throws(() => g(['merge', 'feature']), 'el merge debe quedar en conflicto');
  // keep.ts queda DU (borrado por nosotros) y gone.ts UD (borrado por ellos).
  return dir;
}

const mdOursRoot = makeModifyDeleteRepo();
const mdTheirsRoot = makeModifyDeleteRepo();

test('git.conflict informa los modify/delete en vez de devolver conflicts -1', async () => {
  const res = await executeAgentTool('git.conflict', { root: mdOursRoot, all: true });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.inMerge, true);
  assert.equal(data.total, 2);
  const byPath = Object.fromEntries(data.files.map((f: any) => [f.path, f]));
  assert.equal(byPath['keep.ts'].kind, 'modify-delete');
  assert.equal(byPath['keep.ts'].deletedBy, 'ours');
  assert.equal(byPath['gone.ts'].kind, 'modify-delete');
  assert.equal(byPath['gone.ts'].deletedBy, 'theirs');
  assert.equal(data.files.some((f: any) => f.conflicts === -1), false, 'ya no queda como ilegible');
});

test('git.conflict stage no decide un modify/delete por su cuenta', async () => {
  const res = await executeAgentTool('git.conflict', { root: mdOursRoot, all: true, stage: true });

  assert.equal(res.ok, false);
  assert.match(String(res.error), /modify\/delete sin decidir/);
  // No se toca nada: git deja keep.ts con el contenido del otro lado aunque
  // nosotros lo hayamos borrado, y gone.ts conserva el de main.
  assert.equal(lf(path.join(mdOursRoot, 'keep.ts')), 'feature keep\n');
  assert.equal(lf(path.join(mdOursRoot, 'gone.ts')), 'main gone\n');
});

test('git.conflict resolve ours en un modify/delete conserva el archivo que sobrevive', async () => {
  // gone.ts: nosotros lo modificamos y ellos lo borraron → ours = conservar.
  const res = await executeAgentTool('git.conflict', { root: mdOursRoot, path: 'gone.ts', resolve: 'ours' });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.kind, 'modify-delete');
  assert.equal(data.kept, true);
  assert.equal(data.staged, true);
  assert.equal(lf(path.join(mdOursRoot, 'gone.ts')), 'main gone\n');

  const state = await executeAgentTool('git.conflict', { root: mdOursRoot, all: true });
  assert.deepEqual(((state.data as any).files as any[]).map((f) => f.path), ['keep.ts']);
});

test('git.conflict resolve ours en un modify/delete acepta el borrado del otro lado', async () => {
  // keep.ts: nosotros lo borramos y ellos lo modificaron → ours = borrar.
  const res = await executeAgentTool('git.conflict', { root: mdOursRoot, path: 'keep.ts', resolve: 'ours' });

  assert.equal(res.ok, true, String(res.error));
  assert.equal((res.data as any).kept, false);
  assert.equal(fs.existsSync(path.join(mdOursRoot, 'keep.ts')), false);

  const state = await executeAgentTool('git.conflict', { root: mdOursRoot, all: true });
  assert.equal(state.ok, true, String(state.error));
  assert.equal((state.data as any).total, 0);
  assert.equal((state.data as any).inMerge, true, 'el merge sigue abierto hasta el commit');
});

test('git.conflict resolve all theirs restaura el archivo borrado por nosotros', async () => {
  const res = await executeAgentTool('git.conflict', { root: mdTheirsRoot, all: true, resolve: 'theirs' });

  assert.equal(res.ok, true, String(res.error));
  const files = (res.data as any).files as Array<{ path: string; kind?: string; kept?: boolean }>;
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
  assert.equal(byPath['keep.ts'].kept, true, 'theirs conserva keep.ts');
  assert.equal(byPath['gone.ts'].kept, false, 'theirs borró gone.ts');
  assert.equal(lf(path.join(mdTheirsRoot, 'keep.ts')), 'feature keep\n');
  assert.equal(fs.existsSync(path.join(mdTheirsRoot, 'gone.ts')), false);

  const state = await executeAgentTool('git.conflict', { root: mdTheirsRoot, all: true });
  assert.equal((state.data as any).total, 0);
  assert.equal((state.data as any).inMerge, true);
});

after(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  try { removeRoot(gitRoot); } catch { /* ignore */ }
  if (fs.existsSync(gitRoot)) fs.rmSync(gitRoot, { recursive: true, force: true });
  try { removeRoot(mergeRoot); } catch { /* ignore */ }
  if (fs.existsSync(mergeRoot)) fs.rmSync(mergeRoot, { recursive: true, force: true });
  for (const dir of [mdOursRoot, mdTheirsRoot]) {
    try { removeRoot(dir); } catch { /* ignore */ }
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});
