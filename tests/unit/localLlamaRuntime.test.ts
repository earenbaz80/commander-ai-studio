import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  LocalLlamaRuntimeManager,
  findLlamaBinaries,
  localModelPath,
  normalizeLocalRuntimeTuning,
} from '../../src/lib/localLlamaRuntime';

class FakeChild extends EventEmitter {
  pid = 5151;
  exitCode: number | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill() {
    if (this.exitCode === null) {
      this.exitCode = 0;
      this.emit('exit', 0, null);
    }
    return true;
  }
}

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-llama-runtime-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('runtime nativo de llama.cpp', () => {
  test('encuentra llama-server en un directorio anidado y prefiere server', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'build', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'build', 'bin', 'llama-server.exe'), '');
    fs.writeFileSync(path.join(dir, 'build', 'bin', 'llama-cli.exe'), '');
    const binaries = findLlamaBinaries(dir, { PATH: '' }, 'win32');
    expect(binaries.server).toContain('llama-server.exe');
    expect(binaries.cli).toContain('llama-cli.exe');
  });

  test('localModelPath sólo acepta un GGUF plano', () => {
    expect(localModelPath('C:/models', 'modelo.gguf')).toBe(path.join('C:/models', 'modelo.gguf'));
    expect(localModelPath('C:/models', '../modelo.gguf')).toBe(path.join('C:/models', 'modelo.gguf'));
    expect(localModelPath('C:/models', 'modelo.txt')).toBeNull();
  });

  test('arranca llama-server con contexto, GPU y puerto, y lo detiene', async () => {
    const dir = tempDir();
    const model = path.join(dir, 'modelo.gguf');
    fs.writeFileSync(model, 'GGUF');
    const calls: string[][] = [];
    const child = new FakeChild();
    const manager = new LocalLlamaRuntimeManager({
      findBinaries: () => ({ server: 'C:/llama/llama-server.exe' }),
      spawn: ((command: string, args: string[]) => {
        calls.push([command, ...args]);
        return child;
      }) as any,
      fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
      sleep: async () => undefined,
      timeoutMs: 1_000,
    });

    const started = await manager.start({
      modelPath: model,
      modelName: 'modelo.gguf',
      context: 16_384,
      gpuLayers: 42,
      port: 4567,
    });
    expect(started.success).toBe(true);
    expect(started.state).toBe('running');
    expect(started.baseUrl).toBe('http://127.0.0.1:4567/v1');
    expect(calls[0]).toEqual([
      'C:/llama/llama-server.exe',
      '-m',
      model,
      '-c',
      '16384',
      '-ngl',
      '42',
      '--host',
      '127.0.0.1',
      '--port',
      '4567',
      '--parallel',
      '1',
      '--jinja',
      '--flash-attn',
      'on',
    ]);

    const stopped = await manager.stop();
    expect(stopped.success).toBe(true);
    expect(stopped.state).toBe('stopped');
  });

  test('un modelo grande arranca con expertos MoE en CPU y caché KV cuantizada', async () => {
    const dir = tempDir();
    const model = path.join(dir, 'Qwen3.8-Flash-Next-IQ2_XS.gguf');
    fs.writeFileSync(model, 'GGUF');
    const calls: string[][] = [];
    const manager = new LocalLlamaRuntimeManager({
      findBinaries: () => ({ server: 'C:/llama/llama-server.exe' }),
      spawn: ((command: string, args: string[]) => {
        calls.push([command, ...args]);
        return new FakeChild();
      }) as any,
      fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
      sleep: async () => undefined,
      timeoutMs: 1_000,
    });

    const tuning = {
      context: 32_768,
      gpuLayers: 99,
      cpuMoeLayers: 24,
      cacheTypeK: 'q8_0',
      cacheTypeV: 'q8_0',
      tensorSplit: '1,1',
    };
    const started = await manager.start({ modelPath: model, port: 4568, ...tuning });
    expect(started.success).toBe(true);
    expect(started.cpuMoeLayers).toBe(24);
    expect(started.cacheTypeK).toBe('q8_0');
    expect(calls[0]).toEqual([
      'C:/llama/llama-server.exe',
      '-m',
      model,
      '-c',
      '32768',
      '-ngl',
      '99',
      '--host',
      '127.0.0.1',
      '--port',
      '4568',
      '--parallel',
      '1',
      '--jinja',
      '--flash-attn',
      'on',
      '--n-cpu-moe',
      '24',
      '--cache-type-k',
      'q8_0',
      '--cache-type-v',
      'q8_0',
      '--tensor-split',
      '1,1',
    ]);

    // Los mismos ajustes reutilizan el proceso vivo.
    await manager.start({ modelPath: model, ...tuning });
    expect(calls).toHaveLength(1);

    // Cambiar el reparto MoE recrea el proceso con los argumentos nuevos.
    await manager.start({ modelPath: model, ...tuning, cpuMoeLayers: 12 });
    expect(calls).toHaveLength(2);
    expect(calls[1][calls[1].indexOf('--n-cpu-moe') + 1]).toBe('12');
  });

  test('apagar jinja o flash-attn manda la forma negativa, no omite la bandera', async () => {
    const dir = tempDir();
    const model = path.join(dir, 'modelo.gguf');
    fs.writeFileSync(model, 'GGUF');
    const calls: string[][] = [];
    const manager = new LocalLlamaRuntimeManager({
      findBinaries: () => ({ server: 'C:/llama/llama-server.exe' }),
      spawn: ((command: string, args: string[]) => {
        calls.push([command, ...args]);
        return new FakeChild();
      }) as any,
      fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
      sleep: async () => undefined,
      timeoutMs: 1_000,
    });

    const started = await manager.start({
      modelPath: model,
      port: 4570,
      jinja: false,
      flashAttention: false,
    });
    expect(started.success).toBe(true);
    expect(calls[0]).toContain('--no-jinja');
    expect(calls[0][calls[0].indexOf('--flash-attn') + 1]).toBe('off');
  });

  test('acepta todos los tipos de caché KV de la build instalada', () => {
    for (const type of [
      'f32',
      'f16',
      'bf16',
      'f8_e4m3',
      'q8_0',
      'q5_1',
      'q5_0',
      'q4_1',
      'q4_0',
      'iq4_nl',
    ]) {
      expect(normalizeLocalRuntimeTuning({ cacheTypeK: type, cacheTypeV: type }).cacheTypeK).toBe(type);
    }
  });

  test('rechaza ajustes incoherentes antes de lanzar llama-server', async () => {
    const dir = tempDir();
    const model = path.join(dir, 'modelo.gguf');
    fs.writeFileSync(model, 'GGUF');
    let spawns = 0;
    const manager = new LocalLlamaRuntimeManager({
      findBinaries: () => ({ server: 'C:/llama/llama-server.exe' }),
      spawn: (() => {
        spawns += 1;
        return new FakeChild();
      }) as any,
      sleep: async () => undefined,
    });

    const badCache = await manager.start({ modelPath: model, cacheTypeK: 'q3_k' });
    expect(badCache.success).toBe(false);
    expect(badCache.error).toContain('Caché KV');

    const withoutFlash = await manager.start({
      modelPath: model,
      cacheTypeK: 'q8_0',
      flashAttention: false,
    });
    expect(withoutFlash.success).toBe(false);
    expect(withoutFlash.error).toContain('flash-attn');

    const badSplit = await manager.start({ modelPath: model, tensorSplit: '1;1' });
    expect(badSplit.success).toBe(false);
    expect(badSplit.error).toContain('tensor-split');

    expect(spawns).toBe(0);
  });

  test('falla claro si no hay llama-server', async () => {
    const dir = tempDir();
    const model = path.join(dir, 'modelo.gguf');
    fs.writeFileSync(model, 'GGUF');
    const manager = new LocalLlamaRuntimeManager({
      findBinaries: () => ({}),
      sleep: async () => undefined,
    });
    const result = await manager.start({ modelPath: model });
    expect(result.success).toBe(false);
    expect(result.error).toContain('llama-server');
  });
});
