import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  cachedLocalModels,
  localModelsCachePath,
  rememberLocalModels,
  resetLocalModelsCache,
} from '../../src/lib/localModelCache';

describe('caché de modelos locales', () => {
  let dir: string;
  const previous = process.env.COMMANDER_LOCAL_MODELS_CACHE;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-modelos-'));
    process.env.COMMANDER_LOCAL_MODELS_CACHE = path.join(dir, 'local-models.json');
    resetLocalModelsCache();
  });

  afterEach(() => {
    resetLocalModelsCache();
    if (previous === undefined) delete process.env.COMMANDER_LOCAL_MODELS_CACHE;
    else process.env.COMMANDER_LOCAL_MODELS_CACHE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('guarda la lista por host y la recupera aunque el servidor esté apagado', () => {
    expect(rememberLocalModels('lmstudio', 'http://192.168.178.77:1234/v1/', ['qwen2.5-coder', 'llama-3.2'])).toBe(true);

    const cached = cachedLocalModels('lmstudio', 'http://192.168.178.77:1234/v1');
    expect(cached.models).toEqual(['qwen2.5-coder', 'llama-3.2']);
    expect(cached.host).toBe('http://192.168.178.77:1234/v1');
    expect(cached.updatedAt).toBeTruthy();
  });

  test('remoto y local son claves distintas y la consulta sin host une ambos', () => {
    rememberLocalModels('lmstudio', 'http://192.168.178.77:1234/v1', ['remoto-a', 'comun']);
    rememberLocalModels('lmstudio', 'http://localhost:1234/v1', ['local-b', 'comun']);

    expect(cachedLocalModels('lmstudio', 'http://localhost:1234/v1').models).toEqual(['local-b', 'comun']);
    // La unión no repite ids aunque los dos servidores tengan el mismo modelo.
    expect(cachedLocalModels('lmstudio').models.sort()).toEqual(['comun', 'local-b', 'remoto-a']);
    expect(cachedLocalModels('lmstudio').hosts).toHaveLength(2);
  });

  test('una respuesta vacía no borra la lista guardada', () => {
    rememberLocalModels('ollama', 'http://localhost:11434', ['llama3.2']);
    expect(rememberLocalModels('ollama', 'http://localhost:11434', [])).toBe(false);
    expect(cachedLocalModels('ollama', 'http://localhost:11434').models).toEqual(['llama3.2']);
  });

  test('ignora hosts vacíos y archivo corrupto sin lanzar', () => {
    expect(rememberLocalModels('ollama', '   ', ['x'])).toBe(false);
    fs.mkdirSync(path.dirname(localModelsCachePath()), { recursive: true });
    fs.writeFileSync(localModelsCachePath(), '{no es json', 'utf8');

    expect(() => cachedLocalModels('ollama')).not.toThrow();
    expect(cachedLocalModels('ollama').models).toEqual([]);
  });
});
