import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  handleAgentRunTool as handleAgentRunToolRaw,
  executeAgentTool as executeAgentToolRaw,
} from '../agentTools.js';
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

/**
 * Root propio de esta suite.
 *
 * Las tools sin `root` usaban el cwd del repo y, con él, los permisos
 * persistidos en `.commander/permissions.json`: un proyecto en readonly
 * tumbaba los tests de escritura y de shell. Aquí todo pasa por un directorio
 * temporal cuyos permisos fija el propio test, así que el resultado no depende
 * de la configuración local de nadie.
 */
const WORK_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tools-root-'));

/** Inyecta el root de pruebas; un `root` explícito (gitRoot, dir…) manda. */
function withTestRoot(input: any): any {
  if (!input || typeof input !== 'object') return input;
  const { root, ...rest } = input;
  return { ...rest, root: root ?? WORK_ROOT };
}

const executeAgentTool = (
  toolId: string,
  input: any,
  opts?: { signal?: AbortSignal; sessionId?: string },
) => executeAgentToolRaw(toolId, withTestRoot(input), opts);

const handleAgentRunTool = (req: any, res: any) => {
  const body = req?.body;
  const next =
    body && typeof body === 'object'
      ? { ...body, input: withTestRoot(body.input) }
      : body;
  return handleAgentRunToolRaw({ ...req, body: next }, res);
};

const TEST_DIR = path.join(WORK_ROOT, 'tests', 'tmp');
const TEST_FILE = path.join(TEST_DIR, 'test.txt');

before(() => {
  // Estado limpio: si una corrida anterior se interrumpió, `after` no llegó a
  // borrar TEST_DIR y `fs.write` (que no sobrescribe por defecto) fallaría.
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  // Permisos de la suite, no del proyecto: un `.commander/permissions.json`
  // readonly en el repo ya no cambia lo que estas tools pueden hacer.
  setPermissions(WORK_ROOT, {
    mode: 'build',
    allowedTools: null,
    deniedTools: [],
    files: { read: [], write: [] },
  });
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

test('fs.edit con replacements aplica todas las ediciones en orden', async () => {
  fs.writeFileSync(TEST_FILE, 'uno dos tres', 'utf8');
  const res = mockRes();
  await handleAgentRunTool(
    mockReq({
      toolId: 'fs.edit',
      input: {
        path: 'tests/tmp/test.txt',
        replacements: [
          { oldString: 'uno', newString: '1' },
          { oldString: 'tres', newString: '3' },
        ],
      },
    }),
    res,
  );
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.replaced, 2);
  assert.equal(res.body.data.edits, 2);
  assert.equal(fs.readFileSync(TEST_FILE, 'utf8'), '1 dos 3');
});

test('fs.edit con replacements no escribe nada si una edición no encuentra su texto', async () => {
  fs.writeFileSync(TEST_FILE, 'alfa beta', 'utf8');
  const res = mockRes();
  await handleAgentRunTool(
    mockReq({
      toolId: 'fs.edit',
      input: {
        path: 'tests/tmp/test.txt',
        replacements: [
          { oldString: 'alfa', newString: 'A' },
          { oldString: 'no-existe', newString: 'B' },
        ],
      },
    }),
    res,
  );
  assert.equal(res.body.ok, false);
  assert.match(String(res.body.error), /replacements\[1\]/);
  assert.equal(fs.readFileSync(TEST_FILE, 'utf8'), 'alfa beta', 'la edición que sí coincidía no debe quedar escrita');
});

test('shell.run respeta cwd dentro del workspace', async () => {
  fs.mkdirSync(path.join(TEST_DIR, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, 'sub', 'cwd-probe.js'), 'console.log(process.cwd());\n', 'utf8');
  // `node <script>` queda fuera de la allowlist a propósito (ejecuta código), así
  // que aquí se pide el permiso explícito: lo que se prueba es el cwd.
  const res: any = await executeAgentTool('shell.run', {
    command: 'node cwd-probe.js',
    cwd: 'tests/tmp/sub',
    allowUnlisted: true,
  });
  assert.equal(res.ok, true, res.ok ? '' : res.error);
  const last = String(res.data.stdout).trim().split(/[\\/]/).pop();
  assert.equal(last, 'sub', 'el proceso debe arrancar en el cwd pedido');
  fs.rmSync(path.join(TEST_DIR, 'sub'), { recursive: true, force: true });
});

test('shell.run sin allowUnlisted rechaza un comando fuera de la lista', async () => {
  const res: any = await executeAgentTool('shell.run', { command: 'node --version' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
});

test('shell.run con allowUnlisted ejecuta el comando pero respeta los bloqueos', async () => {
  const permitido: any = await executeAgentTool('shell.run', { command: 'node --version', allowUnlisted: true });
  assert.equal(permitido.ok, true, permitido.ok ? '' : permitido.error);
  assert.match(String(permitido.data.stdout), /v\d+\./);

  const bloqueado: any = await executeAgentTool('shell.run', { command: 'sudo whoami', allowUnlisted: true });
  assert.equal(bloqueado.ok, false, 'allowUnlisted no debe abrir los patrones bloqueados');
  assert.equal(bloqueado.status, 403);
});

test('shell.run interactive escribe en el stdin del proceso', async () => {
  // Root temporal: la lista blanca de este repo no incluye shell.job, y lo que
  // se prueba aquí es el stdin, no la configuración del proyecto.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-stdin-'));
  fs.writeFileSync(
    path.join(dir, 'echo-stdin.js'),
    // Sale tras el primer dato: un proceso vivo al final del test dejaría abierto
    // el event loop del runner (que entonces espera para siempre).
    "process.stdin.setEncoding('utf8');\nprocess.stdin.on('data', (d) => { process.stdout.write('ECO:' + d); process.exit(0); });\n",
    'utf8',
  );
  addRoot(dir);
  setPermissions(dir, {
    mode: 'build',
    allowedTools: ['shell.run', 'shell.job'],
    deniedTools: [],
    files: { read: [], write: [] },
  } as any);
  let id = '';
  try {
    const started: any = await executeAgentTool('shell.run', {
      command: 'node echo-stdin.js',
      // Sin cwd: el directorio del proceso ya es el root del proyecto.
      root: dir,
      background: true,
      interactive: true,
      allowUnlisted: true,
    });
    assert.equal(started.ok, true, started.ok ? '' : started.error);
    id = String(started.data.id);
    const written: any = await executeAgentTool('shell.job', { action: 'write', id, data: 'hola\n', root: dir });
    assert.equal(written.ok, true, written.ok ? '' : written.error);

    // Sondeo acotado, no un sleep fijo: el proceso escribe cuando le llega el dato.
    let texto = '';
    for (let i = 0; i < 120 && !texto.includes('ECO:hola'); i++) {
      const read: any = await executeAgentTool('shell.job', { action: 'read', id, cursor: 0, root: dir });
      texto = String(read.data?.chunk || '');
      if (!texto.includes('ECO:hola')) await new Promise((r) => setTimeout(r, 50));
    }
    assert.match(texto, /ECO:hola/);
  } finally {
    if (id) await executeAgentTool('shell.job', { action: 'stop', id, root: dir });
    removeRoot(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fs.list devuelve directorios primero y omite los ocultos', async () => {
  fs.mkdirSync(path.join(TEST_DIR, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, 'visible.txt'), 'x', 'utf8');
  fs.writeFileSync(path.join(TEST_DIR, '.oculto'), 'x', 'utf8');
  const res = mockRes();
  await handleAgentRunTool(mockReq({ toolId: 'fs.list', input: { path: 'tests/tmp' } }), res);
  assert.equal(res.body.ok, true);
  const entries = res.body.data.entries as { path: string; type: string }[];
  assert.ok(entries.some((e) => e.path === 'tests/tmp/sub' && e.type === 'dir'));
  assert.ok(entries.some((e) => e.path === 'tests/tmp/visible.txt' && e.type === 'file'));
  assert.ok(!entries.some((e) => e.path.includes('.oculto')));
  assert.equal(entries[0].type, 'dir', 'los directorios van primero');
  fs.rmSync(path.join(TEST_DIR, 'sub'), { recursive: true, force: true });
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

test('fs.read se niega a leer archivos de secretos y sí lee la plantilla', async () => {
  const dir = path.join(TEST_DIR, 'secretos');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=secreto\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.env.example'), 'API_KEY=\n', 'utf8');

  const env = await executeAgentTool('fs.read', { path: 'tests/tmp/secretos/.env' });
  assert.equal(env.ok, false, 'un .env no se lee, aunque exista y esté dentro del root');
  assert.equal((env as any).status, 403);
  assert.match(String(env.error), /sensible/i);

  const template = await executeAgentTool('fs.read', { path: 'tests/tmp/secretos/.env.example' });
  assert.equal(template.ok, true, String(template.error));
  assert.match(String((template.data as any).content), /API_KEY=/);
});

test('fs.glob no lista secretos y fs.grep no busca dentro de ellos', async () => {
  const dir = path.join(TEST_DIR, 'secretos');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=secreto\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.env.example'), 'API_KEY=\n', 'utf8');

  const glob = await executeAgentTool('fs.glob', { pattern: '.env', root: dir });
  assert.equal(glob.ok, true, String(glob.error));
  const listed = (glob.data as any).files as string[];
  assert.equal(listed.includes('.env'), false, 'listar el nombre ya es filtrar mal');
  assert.ok(listed.includes('.env.example'), 'la plantilla sí aparece');

  const byPath = await executeAgentTool('fs.grep', { pattern: 'secreto', path: 'tests/tmp/secretos/.env' });
  assert.equal(byPath.ok, false, 'grep sobre un .env explícito debe negarse');
  assert.equal((byPath as any).status, 403);
  assert.match(String(byPath.error), /sensible/i);

  const byWalk = await executeAgentTool('fs.grep', { pattern: 'secreto', root: dir });
  assert.equal(byWalk.ok, true, String(byWalk.error));
  assert.deepEqual((byWalk.data as any).matches, [], 'recorrer el root no puede abrir el .env');
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

test('shell.run recorta la salida y dice cuánto omitió', async () => {
  // La salida larga sale de listar un directorio con muchos ficheros: el comando
  // en sí está limitado a 2000 caracteres, así que no vale un `echo <9000 x>`.
  const dir = path.join(TEST_DIR, 'salida-larga');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 300; i++) {
    fs.writeFileSync(path.join(dir, `archivo-de-prueba-con-nombre-largo-${i}.txt`), 'x', 'utf8');
  }

  // cmd.exe lee las barras normales como opciones: en Windows la ruta va con
  // separador del sistema, y cada plataforma lista con su comando.
  const command = process.platform === 'win32'
    ? 'dir ' + path.join('tests', 'tmp', 'salida-larga')
    : 'ls tests/tmp/salida-larga';
  const big = await executeAgentTool('shell.run', { command });
  assert.equal(big.ok, true, String(big.error));
  const data = big.data as any;
  assert.ok(data.stdoutBytes > 8000, `debe informar el tamaño real: ${data.stdoutBytes}`);
  assert.ok(data.stdout.length < data.stdoutBytes, 'lo entregado va recortado');
  assert.match(String(data.stdout), /caracteres omitidos/);
  assert.equal(data.truncated, true);
  assert.match(String(data.hint), /shell\.job/);
});

test('shell.run no marca recorte cuando la salida es corta', async () => {
  const short = await executeAgentTool('shell.run', { command: 'echo hola' });
  assert.equal(short.ok, true, String(short.error));
  const data = short.data as any;
  assert.match(String(data.stdout), /hola/);
  assert.equal(typeof data.stdoutBytes, 'number');
  assert.equal(data.truncated, undefined, 'sin recorte no debe anunciarlo');
  assert.equal(data.hint, undefined);
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
  const started = await executeAgentTool('shell.run', { command: 'echo hola', background: true, root: gitRoot });

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

  assert.notEqual(logs?.status, 'running', 'echo debe terminar solo');
  assert.match(String(logs?.content), /hola/, 'el log debe tener la salida');

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

test('shell.job en readonly deja listar y leer, pero no escribir ni parar', async () => {
  const dir = path.join(TEST_DIR, 'shell-job-modos');
  fs.mkdirSync(dir, { recursive: true });
  try {
    setPermissions(dir, { mode: 'readonly' });

    // El contexto de Nono pide `list` al cargar: es una consulta y no puede
    // convertirse en un 403 que ensucie la consola del navegador.
    const list = await executeAgentTool('shell.job', { root: dir, action: 'list' });
    assert.equal(list.ok, true, String(list.error));

    const logs = await executeAgentTool('shell.job', { root: dir, action: 'logs', id: 'no-existe' });
    assert.doesNotMatch(String(logs.error || ''), /Modo Sólo lectura/);

    for (const input of [
      { root: dir, action: 'write', id: 'x', data: 'hola\n' },
      { root: dir, action: 'stop', id: 'x' },
    ]) {
      const blocked = await executeAgentTool('shell.job', input);
      assert.equal((blocked as any).status, 403, `${input.action} debe bloquearse`);
      assert.match(String(blocked.error), /Sólo lectura/);
    }
  } finally {
    setPermissions(dir, { mode: 'build' });
  }
});

test('mcp.call con tools/list pasa en plan y readonly; tools/call sigue bloqueado', async () => {
  const dir = path.join(TEST_DIR, 'mcp-modos');
  fs.mkdirSync(dir, { recursive: true });
  // Servidor inexistente a propósito: lo que se prueba es el gate, que decide
  // antes de salir a la red. El fallo de conexión no es un 403.
  const input = { root: dir, serverUrl: 'http://127.0.0.1:9/nada' };
  try {
    for (const mode of ['plan', 'readonly'] as const) {
      setPermissions(dir, { mode });

      // El gate es lo único que se afirma: si pasa, el error que llegue será de
      // transporte o de la lista SSRF, nunca el del modo.
      const listing = await executeAgentTool('mcp.call', { ...input, method: 'tools/list' });
      assert.doesNotMatch(
        String(listing.error || ''),
        /no se puede ejecutar mcp\.call/,
        `${mode}: enumerar no puede cortarse en el gate de permisos`
      );

      const invoking = await executeAgentTool('mcp.call', { ...input, method: 'tools/call' });
      assert.equal((invoking as any).status, 403, `${mode}: invocar sí se bloquea`);
      assert.match(String(invoking.error), /Modo (Plan|Sólo lectura)/);

      // Sin `method` la rama MCP asume tools/call: tampoco pasa.
      const implicit = await executeAgentTool('mcp.call', { ...input, tool: 'saluda', args: {} });
      assert.equal((implicit as any).status, 403, `${mode}: sin method es una invocación`);
    }
  } finally {
    setPermissions(dir, { mode: 'build' });
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
  const marker = path.join(gitRoot, 'diff-pwned.txt');
  const res = await executeAgentTool('git.diff', {
    root: gitRoot,
    path: 'x & echo PWNED > "diff-pwned.txt"',
  });

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

test('fs.propose.write devuelve el diff y no crea el archivo', async () => {
  const dir = path.join(TEST_DIR, 'propose-write');
  fs.mkdirSync(dir, { recursive: true });

  const res = await executeAgentTool('fs.propose.write', {
    root: dir,
    path: 'nuevo.ts',
    content: 'export const a = 1;\nexport const b = 2;\n',
  });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.changed, true);
  assert.equal(data.exists, false, 'un archivo nuevo se declara como tal');
  assert.equal(data.additions, 2);
  assert.equal(data.deletions, 0);
  assert.match(data.diff, /^--- \/dev\/null$/m, 'un archivo nuevo no tiene versión anterior');
  assert.match(data.diff, /^\+\+\+ b\/nuevo\.ts$/m);
  assert.equal(fs.existsSync(path.join(dir, 'nuevo.ts')), false, 'el dry-run no debe tocar disco');
});

test('fs.propose.edit muestra el cambio y deja el archivo intacto', async () => {
  const dir = path.join(TEST_DIR, 'propose-edit');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'app.ts');
  const original = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
  fs.writeFileSync(file, original, 'utf8');

  const res = await executeAgentTool('fs.propose.edit', {
    root: dir,
    path: 'app.ts',
    oldString: 'const b = 2;',
    newString: 'const b = 20;\nconst d = 4;',
  });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.changed, true);
  assert.equal(data.exists, true);
  assert.equal(data.additions, 2);
  assert.equal(data.deletions, 1);
  assert.match(data.diff, /^--- a\/app\.ts$/m);
  assert.match(data.diff, /^-const b = 2;$/m);
  assert.match(data.diff, /^\+const b = 20;$/m);
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'el archivo no se toca sin aprobación');
});

test('fs.propose.edit sin coincidencia no inventa un diff', async () => {
  const dir = path.join(TEST_DIR, 'propose-sin-match');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.ts'), 'uno\n', 'utf8');

  const res = await executeAgentTool('fs.propose.edit', {
    root: dir,
    path: 'a.ts',
    oldString: 'no-existe',
    newString: 'x',
  });

  assert.equal(res.ok, false);
  assert.match(String(res.error), /oldString no encontrado/);
});

test('proponer el mismo contenido no se presenta como cambio', async () => {
  const dir = path.join(TEST_DIR, 'propose-igual');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'igual.ts'), 'igual\n', 'utf8');

  const res = await executeAgentTool('fs.propose.write', { root: dir, path: 'igual.ts', content: 'igual\n' });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.changed, false);
  assert.equal(data.diff, '', 'sin cambio no hay diff que revisar');
  assert.match(String(data.hint), /Sin cambios/);
});

test('en plan y readonly se puede proponer, pero no aplicar', async () => {
  const dir = path.join(TEST_DIR, 'propose-modos');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'x.ts');
  fs.writeFileSync(file, 'viejo\n', 'utf8');

  try {
    for (const mode of ['plan', 'readonly'] as const) {
      setPermissions(dir, { mode });

      const propose = await executeAgentTool('fs.propose.edit', {
        root: dir,
        path: 'x.ts',
        oldString: 'viejo',
        newString: 'nuevo',
      });
      assert.equal(propose.ok, true, `${mode}: proponer es leer (${String(propose.error)})`);
      assert.match(String((propose.data as any).diff), /^\+nuevo$/m);

      const write = await executeAgentTool('fs.write', { root: dir, path: 'x.ts', content: 'otra cosa\n' });
      assert.equal((write as any).status, 403, `${mode}: aplicar sigue bloqueado`);
      assert.equal(fs.readFileSync(file, 'utf8'), 'viejo\n');
    }
  } finally {
    setPermissions(dir, { mode: 'build' });
  }
});

test('fs.propose.write no propone sobre un archivo de secretos', async () => {
  const dir = path.join(TEST_DIR, 'propose-secretos');
  fs.mkdirSync(dir, { recursive: true });

  const res = await executeAgentTool('fs.propose.write', { root: dir, path: '.env', content: 'K=1\n' });

  assert.equal(res.ok, false, 'proponer una escritura no es excusa para leer el secreto');
  assert.equal((res as any).status, 403);
});

test('skill lee el SKILL.md del proyecto abierto, no sólo del cwd del servidor', async () => {
  const dir = path.join(TEST_DIR, 'skill-proyecto');
  fs.mkdirSync(path.join(dir, 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'skills', 'demo', 'SKILL.md'),
    '---\ndescription: Skill de prueba\n---\n\n# Demo\n',
    'utf8'
  );

  const res = await executeAgentTool('skill', { root: dir, name: 'demo' });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.name, 'demo');
  assert.equal(data.description, 'Skill de prueba');
  assert.match(String(data.path).replace(/\\/g, '/'), /skill-proyecto\/skills\/demo\/SKILL\.md$/);
  assert.match(data.content, /# Demo/);
});

test('skill sigue encontrando el catálogo propio cuando el proyecto no lo tiene', async () => {
  // `ponytail` vive en el `skills/` versionado del repo: es el fallback tras el root.
  const res = await executeAgentTool('skill', { root: TEST_DIR, name: 'ponytail' });

  assert.equal(res.ok, true, String(res.error));
  assert.match(String((res.data as any).path).replace(/\\/g, '/'), /skills\/ponytail\/SKILL\.md$/);
});

test('skill acepta un SKILL.md guardado con CRLF, como en un checkout de Windows', async () => {
  // El repo no fija `eol` en `.gitattributes`, así que en un checkout de Windows
  // con `core.autocrlf=true` los SKILL.md llegan con CRLF. Si el front-matter
  // exigía `\n` limpio, el catálogo del propio repo dejaba de leerse justo en
  // esa máquina (y sólo en esa: en una con `autocrlf=false` pasaba).
  const dir = path.join(TEST_DIR, 'skill-crlf');
  fs.mkdirSync(path.join(dir, 'skills', 'crlf'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'skills', 'crlf', 'SKILL.md'),
    '---\r\ndescription: Skill con saltos de Windows\r\n---\r\n\r\n# Crlf\r\n',
    'utf8'
  );

  const res = await executeAgentTool('skill', { root: dir, name: 'crlf' });

  assert.equal(res.ok, true, String(res.error));
  const data = res.data as any;
  assert.equal(data.description, 'Skill con saltos de Windows');
  // El contenido se devuelve tal cual se leyó: normalizar para interpretarlo no
  // puede reescribir el fichero ni el texto que ve quien lo consume.
  assert.match(data.content, /\r\n/);
});

test('skill rechaza nombres con traversal y SKILL.md sin front-matter', async () => {
  const traversal = await executeAgentTool('skill', { root: TEST_DIR, name: '../../package' });
  assert.equal(traversal.ok, false);
  assert.match(String(traversal.error), /inválido/);

  const dir = path.join(TEST_DIR, 'skill-sin-frontmatter');
  fs.mkdirSync(path.join(dir, 'skills', 'plano'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills', 'plano', 'SKILL.md'), '# sin cabecera\n', 'utf8');

  const plano = await executeAgentTool('skill', { root: dir, name: 'plano' });
  assert.equal(plano.ok, false);
  assert.match(String(plano.error), /front-matter/);
});

test('spawn_agents exige una sesión de servidor y no inventa una', async () => {
  // El handler existe y se alcanza (no responde «Tool desconocida»), pero los
  // subagentes necesitan una sesión padre viva en el servidor.
  const sinPadre = await executeAgentTool('spawn_agents', { root: TEST_DIR, agents: [{ goal: 'mirar' }] });
  assert.equal(sinPadre.ok, false);
  assert.match(String(sinPadre.error), /parentSessionId requerido/);

  const padreFantasma = await executeAgentTool('spawn_agents', {
    root: TEST_DIR,
    agents: [{ goal: 'mirar' }],
    parentSessionId: 'sesion-que-no-existe',
  });
  assert.equal(padreFantasma.ok, false);
  assert.equal((padreFantasma as any).status, 404);
  assert.match(String(padreFantasma.error), /Sesión padre no encontrada/);
});

test('worktree.create existe en run-tool y valida antes de tocar git', async () => {
  // Raíz propia: la del repo tiene su whitelist en `.commander/permissions.json`
  // y este test mide el registro, no la configuración local de nadie.
  const dir = path.join(TEST_DIR, 'worktree-create');
  fs.mkdirSync(dir, { recursive: true });

  // El cliente entra por `POST /api/worktrees`, pero el id está en AGENT_TOOLS:
  // si el handler no existiera aquí, la respuesta sería «Tool desconocida».
  const sinThread = await executeAgentTool('worktree.create', { root: dir, projectPath: '.' });
  assert.equal(sinThread.ok, false);
  assert.match(String(sinThread.error), /threadId requerido/);

  const sinProyecto = await executeAgentTool('worktree.create', { root: dir, threadId: 'th-1' });
  assert.equal(sinProyecto.ok, false);
  assert.match(String(sinProyecto.error), /projectPath requerido/);
});

after(() => {
  if (fs.existsSync(WORK_ROOT)) fs.rmSync(WORK_ROOT, { recursive: true, force: true });
  try { removeRoot(gitRoot); } catch { /* ignore */ }
  if (fs.existsSync(gitRoot)) fs.rmSync(gitRoot, { recursive: true, force: true });
  try { removeRoot(mergeRoot); } catch { /* ignore */ }
  if (fs.existsSync(mergeRoot)) fs.rmSync(mergeRoot, { recursive: true, force: true });
  for (const dir of [mdOursRoot, mdTheirsRoot]) {
    try { removeRoot(dir); } catch { /* ignore */ }
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});
