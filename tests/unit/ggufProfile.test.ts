/**
 * Lectura de la cabecera GGUF: capas, expertos, ventana y bytes por tipo.
 *
 * Los archivos se construyen sintéticamente para no depender de un modelo real:
 * lo que se verifica es el formato (magic, versión, metadatos, descriptores de
 * tensores) y la clasificación de tensores de expertos.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { GGUF_MAGIC, ggmlTensorBytes, readGgufProfile } from '../../src/lib/ggufProfile';

const u32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

const u64 = (value: number): Buffer => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};

const str = (value: string): Buffer => {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([u64(bytes.length), bytes]);
};

const kvString = (key: string, value: string): Buffer => Buffer.concat([str(key), u32(8), str(value)]);
const kvU32 = (key: string, value: number): Buffer => Buffer.concat([str(key), u32(4), u32(value)]);
const kvStrings = (key: string, values: string[]): Buffer =>
  Buffer.concat([str(key), u32(9), u32(8), u64(values.length), ...values.map(str)]);

const tensor = (name: string, dims: number[], type: number): Buffer =>
  Buffer.concat([str(name), u32(dims.length), ...dims.map(u64), u32(type), u64(0)]);

function buildGguf(options: { magic?: number } = {}): Buffer {
  const arch = 'qwen3moe';
  const kvs = [
    kvString('general.architecture', arch),
    kvU32(`${arch}.block_count`, 4),
    kvU32(`${arch}.expert_count`, 8),
    kvU32(`${arch}.expert_used_count`, 2),
    kvU32(`${arch}.context_length`, 4_096),
    kvStrings('tokenizer.ggml.tokens', ['a', 'b', 'c']),
  ];
  const tensors = [
    tensor('token_embd.weight', [8, 4], 1),
    ...[0, 1, 2, 3].map((layer) => tensor(`blk.${layer}.ffn_gate_exps.weight`, [8, 8], 0)),
    ...[0, 1, 2, 3].map((layer) => tensor(`blk.${layer}.ffn_gate.weight`, [8, 8], 0)),
  ];
  return Buffer.concat([
    u32(options.magic ?? GGUF_MAGIC),
    u32(3),
    u64(tensors.length),
    u64(kvs.length),
    ...kvs,
    ...tensors,
  ]);
}

const tempDirs: string[] = [];

function writeTemp(contents: Buffer, name = 'modelo.gguf'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-gguf-'));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('perfil GGUF', () => {
  test('lee arquitectura, capas, expertos y ventana sin tocar los pesos', () => {
    const profile = readGgufProfile(writeTemp(buildGguf()));
    expect(profile).not.toBeNull();
    expect(profile?.architecture).toBe('qwen3moe');
    expect(profile?.blockCount).toBe(4);
    expect(profile?.expertCount).toBe(8);
    expect(profile?.expertsUsed).toBe(2);
    expect(profile?.contextLength).toBe(4_096);
    expect(profile?.moe).toBe(true);
    expect(profile?.expertLayerCount).toBe(4);
    // 4 tensores de expertos F32 [8,8] = 256 B cada uno.
    expect(profile?.expertBytes).toBe(1_024);
    // Embedding F16 [8,4] = 64 B + 4 densas F32 [8,8] = 1 024 B.
    expect(profile?.denseBytes).toBe(1_088);
    expect(profile?.tensorBytes).toBe(2_112);
  });

  test('devuelve null si el archivo no es GGUF', () => {
    const file = writeTemp(Buffer.concat([u32(0x12345678), u32(3), u64(0), u64(0)]));
    expect(readGgufProfile(file)).toBeNull();
  });

  test('estima bytes por tipo, incluidos los cuantizados por bloque', () => {
    expect(ggmlTensorBytes(0, 10)).toBe(40);
    expect(ggmlTensorBytes(1, 10)).toBe(20);
    // Q4_K: bloques de 256 elementos y 144 bytes por bloque.
    expect(ggmlTensorBytes(12, 512)).toBe(288);
    // Tipo desconocido: se asume fp16.
    expect(ggmlTensorBytes(999, 8)).toBe(16);
  });
});
