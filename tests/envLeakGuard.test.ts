/**
 * Guardia antileak: ningún fichero versionado debe contener una API key.
 *
 * Motivo: `writeConfig` llegó a fusionar las variables de entorno al guardar,
 * así que una clave podía acabar escrita en `commander.json`. Esta prueba cierra
 * la puerta: toma las claves reales del entorno y de `.env` (que están ignorados
 * por git) y busca su valor literal en los ficheros que sí se versionan.
 *
 * También revisa el historial: un valor borrado del árbol sigue en los blobs
 * antiguos, y sigue siendo una fuga mientras la clave esté viva.
 *
 * Nunca muestra el valor encontrado: sólo el fichero y el nombre de la variable.
 *
 * La guardia también se prueba a sí misma: hay casos que le pasan contenido
 * sintético (claves de mentira, ficheros en un directorio temporal) y exigen que
 * detecte la fuga. Hace falta porque ésta es de las que pueden pasar en verde
 * sin mirar nada: sin claves que comparar se sale antes, y si el descubrimiento
 * o la lectura se rompen, no hay fuga que encontrar y el test no se queja.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Nombres de variables que llevan credenciales. */
const SECRET_NAME = /(^|_)(API_KEY|API_TOKEN|ACCESS_TOKEN|TOKEN|SECRET)$/i;

/** Valores de relleno que no son credenciales de verdad. */
const PLACEHOLDER = /(your|example|placeholder|changeme|cambiar|xxx|dummy|test|fake|<|>|\$\{)/i;

/** Menos de esto es demasiado corto para distinguir una clave de una palabra. */
const MIN_SECRET_LENGTH = 12;

/** Tope de tamaño para leer un blob del historial (igual que en el árbol actual). */
const MAX_BLOB_BYTES = 2 * 1024 * 1024;

/** Cuántas entradas se listan antes de resumir el resto. */
const MAX_REPORTED = 20;

/** Ficheros que, si no hay git, siguen mereciendo la pena revisar. */
const FALLBACK_FILES = ['commander.json', '.env.example', 'package.json', 'README.md'];

/** Ficheros de entorno locales (ignorados por git) de los que se leen las claves. */
const LOCAL_ENV_FILES = ['.env', '.env.local', '.env.production', '.env.development'];

/** Extrae `CLAVE=valor` de un fichero .env sin interpretar el resto de la sintaxis. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

/** ¿Este valor merece la pena buscarlo? Descarta vacíos, cortos y de relleno. */
function isRealSecret(value: string): boolean {
  return value.length >= MIN_SECRET_LENGTH && !PLACEHOLDER.test(value);
}

/** Credenciales conocidas: del entorno del proceso y de los `.env` locales. */
export function collectSecrets(
  env: NodeJS.ProcessEnv = process.env,
  readEnvFile: (file: string) => string | null = (file) => {
    const path = join(ROOT, file);
    if (!existsSync(path)) return null;
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }
): Map<string, string> {
  const secrets = new Map<string, string>();

  for (const [name, value] of Object.entries(env)) {
    if (!value || !SECRET_NAME.test(name) || !isRealSecret(value)) continue;
    secrets.set(name, value);
  }

  for (const file of LOCAL_ENV_FILES) {
    const text = readEnvFile(file);
    if (!text) continue;
    for (const [name, value] of Object.entries(parseEnvFile(text))) {
      if (!SECRET_NAME.test(name) || !isRealSecret(value)) continue;
      if (!secrets.has(name)) secrets.set(name, value);
    }
  }

  return secrets;
}

/** Ficheros versionados del repo; si git no está, un subconjunto sensato. */
function trackedFiles(): { files: string[]; viaGit: boolean } {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const files = out.split('\u0000').filter(Boolean);
    if (files.length > 0) return { files, viaGit: true };
  } catch {
    // Sin git (tarball, contenedor mínimo): se revisa lo más expuesto.
  }
  return { files: FALLBACK_FILES.filter((f) => existsSync(join(ROOT, f))), viaGit: false };
}

/** Un fichero que contiene el valor de una credencial. */
export interface Leak {
  file: string;
  secretName: string;
}

/**
 * Busca cada valor en los contenidos dados. Devuelve fichero + nombre de la
 * variable, nunca el valor: el mensaje de error no puede ser otra fuga.
 */
export function findLeaks(
  contents: Iterable<[file: string, text: string]>,
  secrets: Map<string, string>
): Leak[] {
  const leaks: Leak[] = [];
  for (const [file, text] of contents) {
    for (const [secretName, value] of secrets) {
      if (text.includes(value)) leaks.push({ file, secretName });
    }
  }
  return leaks;
}

/**
 * Contenido de los ficheros versionados, saltando binarios y ficheros enormes.
 *
 * `base` existe para poder apuntarlo a un directorio de prueba: si esto se
 * rompe y deja de leer ficheros, las dos guardias pasan sin mirar nada, y eso
 * sólo se detecta ejercitándolo con contenido conocido.
 */
function readTrackedContents(files: string[], base: string = ROOT): Array<[string, string]> {
  const contents: Array<[string, string]> = [];
  for (const file of files) {
    const path = join(base, file);
    try {
      const buffer = readFileSync(path);
      if (buffer.length > 2 * 1024 * 1024) continue;
      if (buffer.subarray(0, 8192).includes(0)) continue; // binario
      contents.push([file, buffer.toString('utf8')]);
    } catch {
      // Enlaces rotos o permisos: no es asunto de esta guardia.
    }
  }
  return contents;
}

/** Ejecuta git y devuelve bytes (los blobs no son UTF-8 de fiar). */
function git(args: string[], opts: { input?: string; cwd?: string } = {}): Buffer {
  return execFileSync('git', args, {
    cwd: opts.cwd ?? ROOT,
    input: opts.input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'ignore'],
  }) as Buffer;
}

/** Un blob del historial con la ruta donde apareció. */
export interface HistoryBlob {
  sha: string;
  path: string;
  text: string;
}

/**
 * Contenido de todos los blobs alcanzables desde cualquier rama o tag.
 *
 * Usa `rev-list --objects` para enumerar, `cat-file --batch-check` para tirar
 * árboles, binarios y ficheros enormes, y un único `cat-file --batch` para
 * traer el resto de golpe: un proceso, no uno por blob.
 */
export function readHistoryContents(cwd: string = ROOT): HistoryBlob[] {
  const paths = new Map<string, string>();
  for (const line of git(['rev-list', '--objects', '--all'], { cwd }).toString('utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(' ');
    if (space === -1) continue; // commits y árboles sin ruta: no interesan
    paths.set(trimmed.slice(0, space), trimmed.slice(space + 1));
  }

  const hashes = [...paths.keys()];
  if (hashes.length === 0) return [];

  const wanted: string[] = [];
  const checked = git(
    ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    { input: `${hashes.join('\n')}\n`, cwd }
  ).toString('utf8');
  for (const line of checked.split('\n')) {
    const [sha, type, size] = line.split(' ');
    if (!sha || type !== 'blob' || !Number.isFinite(Number(size))) continue;
    if (Number(size) > MAX_BLOB_BYTES) continue;
    wanted.push(sha);
  }
  if (wanted.length === 0) return [];

  const batch = git(['cat-file', '--batch'], { input: `${wanted.join('\n')}\n`, cwd });
  const blobs: HistoryBlob[] = [];
  let pos = 0;
  while (pos < batch.length) {
    const newline = batch.indexOf(0x0a, pos);
    if (newline === -1) break;
    const [sha, type, size] = batch.subarray(pos, newline).toString('utf8').split(' ');
    const length = Number(size);
    if (!sha || type !== 'blob' || !Number.isFinite(length)) break; // objeto ausente: no seguir desalineados
    const start = newline + 1;
    const content = batch.subarray(start, start + length);
    pos = start + length + 1; // salta el \n que cierra el objeto
    if (content.subarray(0, 8192).includes(0)) continue; // binario
    blobs.push({ sha, path: paths.get(sha) ?? '(sin ruta)', text: content.toString('utf8') });
  }
  return blobs;
}

/** Commits que introdujeron o tocaron un blob (sólo se llama al fallar). */
function commitsForBlob(sha: string, cwd: string = ROOT): string[] {
  try {
    return git(['log', '--all', '--format=%h', '-n', '3', `--find-object=${sha}`], { cwd })
      .toString('utf8')
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Formatea las fugas sin repetir jamás el valor de la credencial. */
export function formatLeaks(leaks: Leak[], resolve: (file: string) => string[] = () => []): string {
  const shown = leaks.slice(0, MAX_REPORTED).map((leak) => {
    const commits = resolve(leak.file);
    return `  ${leak.file} \u2190 ${leak.secretName}${commits.length ? ` (commits: ${commits.join(', ')})` : ''}`;
  });
  if (leaks.length > MAX_REPORTED) shown.push(`  \u2026 y ${leaks.length - MAX_REPORTED} m\u00e1s`);
  return shown.join('\n');
}

/** Empareja una etiqueta de historial (`ruta @ sha`) con su blob. */
const HISTORY_LABEL = /^(.*) @ ([0-9a-f]{7,})$/;

test('ningún fichero versionado contiene una API key del entorno ni de .env', () => {
  const secrets = collectSecrets();
  if (secrets.size === 0) {
    // Sin credenciales locales no hay nada que comparar; no es un fallo.
    console.log('[env-leak-guard] sin credenciales en el entorno ni en .env: nada que comprobar');
    return;
  }

  const { files, viaGit } = trackedFiles();
  const contents = readTrackedContents(files);
  const leaks = findLeaks(contents, secrets);

  assert.deepEqual(
    leaks,
    [],
    `Credenciales encontradas en ficheros versionados (${viaGit ? 'git ls-files' : 'lista de reserva'}):\n` +
      formatLeaks(leaks) +
      '\nQuita el valor del fichero y léelo del entorno.'
  );

  // Deja constancia de qué se revisó, útil cuando el test pasa en silencio.
  console.log(
    `[env-leak-guard] ${secrets.size} credenciales comprobadas contra ${contents.length} ficheros (${viaGit ? 'git' : 'sin git'})`
  );
});

test('ningún blob del historial de git contiene una API key del entorno ni de .env', () => {
  const secrets = collectSecrets();
  if (secrets.size === 0) {
    console.log('[env-leak-guard] sin credenciales en el entorno ni en .env: historial sin comparar');
    return;
  }

  let blobs: HistoryBlob[];
  try {
    blobs = readHistoryContents();
  } catch {
    // Sin git (o sin historial, p. ej. export de un tarball) no hay nada que mirar.
    console.log('[env-leak-guard] historial de git no disponible: revisión omitida');
    return;
  }

  const byLabel = new Map<string, string>();
  for (const blob of blobs) byLabel.set(`${blob.path} @ ${blob.sha.slice(0, 7)}`, blob.sha);

  const leaks = findLeaks(
    blobs.map((blob): [string, string] => [`${blob.path} @ ${blob.sha.slice(0, 7)}`, blob.text]),
    secrets
  );

  assert.deepEqual(
    leaks,
    [],
    'Credenciales encontradas en el historial de git:\n' +
      formatLeaks(leaks, (label) => {
        const match = HISTORY_LABEL.exec(label);
        const sha = byLabel.get(label);
        return match && sha ? commitsForBlob(sha) : [];
      }) +
      '\nRotar la credencial: reescribir el historial no la vuelve secreta otra vez.'
  );

  console.log(`[env-leak-guard] historial: ${secrets.size} credenciales contra ${blobs.length} blobs`);
});

test('la guardia detecta una clave que sólo vive en el historial', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-leak-history-'));
  const fake = 'clave-que-se-borro-del-arbol-987654321';
  try {
    const run = (args: string[]) =>
      git(['-c', 'user.email=guard@example.invalid', '-c', 'user.name=guard', ...args], { cwd: dir });

    run(['init', '-q']);
    writeFileSync(join(dir, 'commander.json'), JSON.stringify({ providers: { xai: { apiKey: fake } } }));
    run(['add', 'commander.json']);
    run(['commit', '-q', '-m', 'config con la clave']);

    // Segundo commit: la clave desaparece del árbol, pero sigue en el blob anterior.
    writeFileSync(join(dir, 'commander.json'), JSON.stringify({ providers: {} }));
    run(['add', 'commander.json']);
    run(['commit', '-q', '-m', 'quitar la clave']);

    const secrets = new Map([['XAI_API_KEY', fake]]);

    // El árbol actual está limpio...
    assert.deepEqual(
      findLeaks([['commander.json', readFileSync(join(dir, 'commander.json'), 'utf8')]], secrets),
      []
    );

    // ...pero el historial no: aquí debe saltar.
    const blobs = readHistoryContents(dir);
    const leaks = findLeaks(blobs.map((b): [string, string] => [b.path, b.text]), secrets);
    assert.equal(leaks.length, 1);
    assert.equal(leaks[0].file, 'commander.json');
    assert.equal(leaks[0].secretName, 'XAI_API_KEY');
    assert.ok(!JSON.stringify(leaks).includes(fake), 'el aviso no debe repetir el secreto');

    // Y el mensaje puede apuntar a los commits del blob: git reporta tanto el
    // que lo introdujo como el que lo eliminó.
    const blamed = blobs.find((b) => b.text.includes(fake))!;
    assert.equal(commitsForBlob(blamed.sha, dir).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('la guardia detecta una fuga de verdad (y no la imprime)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-leak-guard-'));
  try {
    const fake = 'clave-falsa-para-probar-la-guardia-123';
    const leaked = join(dir, 'commander.json');
    const clean = join(dir, 'safe.json');
    writeFileSync(leaked, JSON.stringify({ providers: { google: { apiKey: fake } } }));
    writeFileSync(clean, JSON.stringify({ providers: {} }));

    const secrets = new Map([['GEMINI_API_KEY', fake]]);
    const contents: Array<[string, string]> = [
      ['commander.json', readFileSync(leaked, 'utf8')],
      ['safe.json', readFileSync(clean, 'utf8')],
    ];

    const leaks = findLeaks(contents, secrets);
    assert.deepEqual(leaks, [{ file: 'commander.json', secretName: 'GEMINI_API_KEY' }]);
    assert.ok(!JSON.stringify(leaks).includes(fake), 'el aviso no debe repetir el secreto');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatLeaks resume la lista y añade los commits sin repetir el valor', () => {
  const leaks: Leak[] = Array.from({ length: MAX_REPORTED + 2 }, (_, i) => ({
    file: `f${i}`,
    secretName: 'GEMINI_API_KEY',
  }));
  const text = formatLeaks(leaks, (file) => (file === 'f0' ? ['abc1234'] : []));
  const lines = text.split('\n');
  assert.equal(lines[0], '  f0 ← GEMINI_API_KEY (commits: abc1234)');
  assert.equal(lines[1], '  f1 ← GEMINI_API_KEY');
  assert.equal(lines.length, MAX_REPORTED + 1); // 20 entradas + el resumen
  assert.ok(lines.at(-1)!.includes('y 2 más'));
});

test('collectSecrets encuentra claves reales y descarta rellenos, valores cortos y nombres que no son credenciales', () => {
  const secrets = collectSecrets(
    {
      GEMINI_API_KEY: 'clave-real-de-entorno-123456',
      XAI_API_KEY: 'your-key-here-please-change-me',
      OPENAI_API_KEY: 'corta',
      GEMINI_MODEL: 'un-valor-larguisimo-que-no-es-credencial',
      SIN_VALOR_API_KEY: '',
    } as NodeJS.ProcessEnv,
    () => null
  );

  // Si esto se rompe, las dos guardias reales pasan sin comparar nada.
  assert.deepEqual([...secrets.keys()], ['GEMINI_API_KEY']);
  assert.equal(secrets.get('GEMINI_API_KEY'), 'clave-real-de-entorno-123456');
});

test('collectSecrets lee los .env locales y no deja que el fichero pise al entorno', () => {
  const envFile = [
    '# comentario',
    'OPENROUTER_API_KEY="clave-del-fichero-abcdef"',
    'OTRA_API_KEY=clave-de-fichero-999',
    'XAI_API_KEY=your-key-de-relleno',
  ].join('\n');

  const secrets = collectSecrets(
    { OPENROUTER_API_KEY: 'clave-del-entorno-zzzzzz' } as NodeJS.ProcessEnv,
    (file) => (file === '.env' ? envFile : null)
  );

  assert.equal(secrets.get('OPENROUTER_API_KEY'), 'clave-del-entorno-zzzzzz', 'el entorno manda');
  assert.equal(secrets.get('OTRA_API_KEY'), 'clave-de-fichero-999', 'lo que sólo está en el .env también cuenta');
  assert.ok(!secrets.has('XAI_API_KEY'), 'el relleno del .env tampoco entra');
});

test('la guardia lee del disco y detecta la fuga, saltando binarios y ficheros enormes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-leak-read-'));
  const fake = 'clave-en-disco-para-la-guardia-4242';
  try {
    writeFileSync(join(dir, 'commander.json'), JSON.stringify({ providers: { google: { apiKey: fake } } }));
    writeFileSync(join(dir, 'limpio.json'), '{"providers":{}}');
    // Un NUL en los primeros bytes lo marca como binario; 2 MB+1 lo deja fuera por tamaño.
    writeFileSync(join(dir, 'binario.bin'), Buffer.concat([Buffer.from(fake), Buffer.from([0x00])]));
    writeFileSync(join(dir, 'enorme.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));

    const contents = readTrackedContents(
      ['commander.json', 'limpio.json', 'binario.bin', 'enorme.txt', 'no-existe.json'],
      dir
    );
    assert.deepEqual(
      contents.map(([file]) => file),
      ['commander.json', 'limpio.json'],
      'sólo se leen ficheros de texto de tamaño razonable'
    );

    assert.deepEqual(findLeaks(contents, new Map([['GEMINI_API_KEY', fake]])), [
      { file: 'commander.json', secretName: 'GEMINI_API_KEY' },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseEnvFile entiende comillas, export y comentarios', () => {
  const parsed = parseEnvFile(
    ['# comentario', 'GEMINI_API_KEY="abc-123"', "export XAI_API_KEY='xyz'", 'VACIA=', 'SIN_IGUAL'].join('\n')
  );
  assert.equal(parsed.GEMINI_API_KEY, 'abc-123');
  assert.equal(parsed.XAI_API_KEY, 'xyz');
  assert.equal(parsed.VACIA, '');
  assert.equal(parsed.SIN_IGUAL, undefined);
});
