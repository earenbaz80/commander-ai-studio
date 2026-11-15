import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  LocalModelDownloadManager,
  listLocalModelRecords,
  parseHubGgufFiles,
  parseHubSearchResults,
  quantizationFromFilename,
  removeLocalModel,
  sanitizeGgufFilename,
  splitGgufParts,
} from '../../src/lib/localModelHub';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-local-model-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('catálogo GGUF', () => {
  test('detecta cuantización y multiparte', () => {
    expect(quantizationFromFilename('Qwen2.5-7B-Instruct-Q4_K_M.gguf')).toBe('Q4_K_M');
    expect(quantizationFromFilename('model-f16.gguf')).toBe('F16');
    expect(quantizationFromFilename('modelo.gguf')).toBe('GGUF');
    expect(splitGgufParts('modelo-00001-of-00003.gguf')).toEqual({ index: 1, total: 3 });
    expect(splitGgufParts('modelo.gguf')).toBeNull();
  });

  test('sanea nombres y rechaza rutas', () => {
    expect(sanitizeGgufFilename('../../modelo.Q4_K_M.GGUF')).toBe('modelo.Q4_K_M.GGUF');
    expect(sanitizeGgufFilename('sub/modelo.gguf')).toBe('modelo.gguf');
    expect(sanitizeGgufFilename('../modelo.bin')).toBeNull();
    expect(sanitizeGgufFilename('modelo.txt')).toBeNull();
  });

  test('extrae los GGUF de la respuesta de Hugging Face', () => {
    const files = parseHubGgufFiles(
      {
        siblings: [
          { rfilename: 'README.md', size: 100 },
          { rfilename: 'modelo-Q4_K_M.gguf', size: 4_000 },
          { rfilename: 'modelo-Q8_0.gguf', lfs: { size: 8_000 } },
          { rfilename: 'modelo-00001-of-00002.gguf', size: 2_000 },
          { rfilename: 'modelo-00002-of-00002.gguf', size: 3_000 },
        ],
      },
      'org/modelo'
    );
    expect(files.map((file) => file.filename)).toEqual([
      'modelo-Q4_K_M.gguf',
      'modelo-00001-of-00002.gguf',
      'modelo-Q8_0.gguf',
    ]);
    const split = files.find((file) => file.filename === 'modelo-00001-of-00002.gguf');
    expect(split?.sizeBytes).toBe(5_000);
    expect(split?.parts?.map((part) => part.filename)).toEqual([
      'modelo-00001-of-00002.gguf',
      'modelo-00002-of-00002.gguf',
    ]);
    expect(files.find((file) => file.filename === 'modelo-Q8_0.gguf')?.sizeBytes).toBe(8_000);
    expect(files.every((file) => file.downloadUrl.includes('huggingface.co/org/modelo/resolve/main/'))).toBe(true);
  });

  test('normaliza resultados de búsqueda', () => {
    expect(
      parseHubSearchResults([
        { id: 'b/model', downloads: 10, likes: 1 },
        { id: 'a/model', downloads: 100, likes: 2, pipeline_tag: 'text-generation' },
      ])
    ).toMatchObject([
      { id: 'a/model', downloads: 100, pipelineTag: 'text-generation' },
      { id: 'b/model', downloads: 10 },
    ]);
  });
});

describe('biblioteca y descargas', () => {
  test('lista el GGUF y su sidecar, y permite borrarlo', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'modelo-Q4_K_M.gguf'), Buffer.alloc(1024));
    fs.writeFileSync(
      path.join(dir, 'modelo-Q4_K_M.gguf.json'),
      JSON.stringify({
        repoId: 'org/modelo',
        quantization: 'Q4_K_M',
        downloadedAt: '2026-01-02T03:04:05.000Z',
      })
    );
    const records = listLocalModelRecords(dir);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'local/modelo-Q4_K_M.gguf',
      filename: 'modelo-Q4_K_M.gguf',
      repoId: 'org/modelo',
      quantization: 'Q4_K_M',
    });
    expect(removeLocalModel(dir, 'modelo-Q4_K_M.gguf')).toBe(true);
    expect(fs.existsSync(path.join(dir, 'modelo-Q4_K_M.gguf'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'modelo-Q4_K_M.gguf.json'))).toBe(false);
  });

  test('descarga bytes reales y escribe el sidecar', async () => {
    const dir = tempDir();
    const body = Buffer.alloc(256 * 1024, 7);
    const fetchImpl = (async () =>
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length) },
      })) as typeof fetch;
    const manager = new LocalModelDownloadManager(dir, { fetchImpl });
    const job = manager.start({
      repoId: 'org/modelo',
      filename: 'modelo-Q4_K_M.gguf',
      sizeBytes: body.length,
      quantization: 'Q4_K_M',
    });

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5_000;
      const timer = setInterval(() => {
        const current = manager.get(job.id);
        if (current?.status === 'completed') {
          clearInterval(timer);
          resolve();
        } else if (current?.status === 'error' || Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error(current?.error || 'timeout'));
        }
      }, 25);
    });

    const target = path.join(dir, 'modelo-Q4_K_M.gguf');
    expect(fs.readFileSync(target).length).toBe(body.length);
    const records = listLocalModelRecords(dir);
    expect(records[0].sizeBytes).toBe(body.length);
    expect(records[0].quantization).toBe('Q4_K_M');
  });
});
