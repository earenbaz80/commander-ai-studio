import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  LocalLlamaRuntimeManager,
  findLlamaBinaries,
  localModelPath,
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
    ]);

    const stopped = await manager.stop();
    expect(stopped.success).toBe(true);
    expect(stopped.state).toBe('stopped');
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
