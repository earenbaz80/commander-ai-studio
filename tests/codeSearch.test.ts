import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listFiles, searchFiles, searchCode, rerankByEmbeddings, cosine } from '../codeSearch.js';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-search-'));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function fresh() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'src', 'mathUtils.ts'),
    ['export function add(a: number, b: number) {', '  return a + b;', '}', 'const UNUSED = 1;'].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(ROOT, 'src', 'Greeting.tsx'),
    ['export function Greeting() {', '  return <div>helloWorld</div>;', '}'].join('\n'),
    'utf8'
  );
  fs.mkdirSync(path.join(ROOT, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'node_modules', 'dep', 'index.js'), 'helloWorld ignored', 'utf8');
  fs.writeFileSync(path.join(ROOT, 'binary.bin'), Buffer.from([0, 1, 2, 3, 104, 105]));
}

test('searchFiles encuentra por nombre de archivo', () => {
  fresh();
  const hits = searchFiles(ROOT, 'math');
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].path, 'src/mathUtils.ts');
});

test('searchFiles con consulta vacía lista archivos del proyecto', () => {
  fresh();
  const hits = searchFiles(ROOT, '');
  const paths = hits.map((h) => h.path);
  assert.ok(paths.includes('src/mathUtils.ts'));
  assert.ok(!paths.some((p) => p.startsWith('node_modules')));
});

test('listFiles respeta el límite', () => {
  fresh();
  const hits = listFiles(ROOT, 1);
  assert.equal(hits.length, 1);
});

test('searchCode devuelve líneas y números, ignorando node_modules y binarios', () => {
  fresh();
  const hits = searchCode(ROOT, 'helloWorld');
  const paths = hits.map((h) => h.path);
  assert.ok(paths.includes('src/Greeting.tsx'));
  assert.ok(!paths.some((p) => p.startsWith('node_modules')));
  assert.ok(!paths.includes('binary.bin'));

  const greeting = hits.find((h) => h.path === 'src/Greeting.tsx')!;
  assert.equal(greeting.matches[0].line, 2);
  assert.match(greeting.matches[0].text, /helloWorld/);
});

test('searchCode sin coincidencias devuelve vacío', () => {
  fresh();
  assert.deepEqual(searchCode(ROOT, 'zzz_no_existe_xyz'), []);
});

test('searchCode soporta consultas de varios tokens', () => {
  fresh();
  const hits = searchCode(ROOT, 'add number');
  const paths = hits.map((h) => h.path);
  assert.ok(paths.includes('src/mathUtils.ts'));
});

test('cosine mide similitud entre vectores', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.ok(cosine([], [1]) === 0);
});

test('rerankByEmbeddings reordena con embeddings y marca ranked', async () => {
  // Candidatos léxicos manuales: a.ts puntúa más, pero b.ts es el "semántico".
  const lexical = [
    { path: 'src/a.ts', score: 50, matches: [{ line: 1, text: 'hace sumas y resta de numeros' }] },
    { path: 'src/b.ts', score: 40, matches: [{ line: 1, text: 'greeting and hello user' }] },
  ];
  const embed = async (text: string) => {
    const t = text.toLowerCase();
    if (t.includes('hello') || t.includes('greeting')) return [0, 1];
    if (t.includes('sumas')) return [1, 0];
    return [0.5, 0.5];
  };
  const { hits, ranked } = await rerankByEmbeddings('hello friend', lexical, embed, 10, 40);
  assert.equal(ranked, true);
  assert.equal(hits.length, 2);
  // El boost semántico mueve b.ts (cercano a "hello") por delante de a.ts.
  assert.equal(hits[0].path, 'src/b.ts');
});

test('rerankByEmbeddings respeta el ranking léxico si el embedder falla', async () => {
  fresh();
  const lexical = searchCode(ROOT, 'add number');
  const before = lexical.map((h) => h.path);
  const embed = async () => {
    throw new Error('provider caído');
  };
  const { hits, ranked } = await rerankByEmbeddings('add', lexical, embed, 10, 40);
  assert.equal(ranked, false);
  assert.deepEqual(hits.map((h) => h.path), before);
});
