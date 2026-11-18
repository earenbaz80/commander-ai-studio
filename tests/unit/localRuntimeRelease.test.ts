/**
 * Selección del runtime a descargar: CUDA cuando hay GPU, CPU cuando no.
 */
import { describe, expect, test } from 'vitest';
import { scoreRuntimeAsset, selectCudartAsset } from '../../src/lib/localRuntimeRelease';

const assets = [
  { name: 'llama-b12375-bin-win-cpu-x64.zip' },
  { name: 'llama-b12375-bin-win-cuda-12.4-x64.zip' },
  { name: 'llama-b12375-bin-win-cuda-13.5-x64.zip' },
  { name: 'llama-b12375-bin-win-vulkan-x64.zip' },
  { name: 'cudart-llama-bin-win-cuda-12.4-x64.zip' },
  { name: 'cudart-llama-bin-win-cuda-13.5-x64.zip' },
];

const best = (hasGpu: boolean): string =>
  [...assets].sort(
    (a, b) => scoreRuntimeAsset(b.name, { hasGpu }) - scoreRuntimeAsset(a.name, { hasGpu })
  )[0].name;

describe('asset del runtime de llama.cpp', () => {
  test('con GPU prefiere CUDA 13 (Blackwell) sobre CPU y CUDA 12', () => {
    expect(best(true)).toBe('llama-b12375-bin-win-cuda-13.5-x64.zip');
    expect(scoreRuntimeAsset('llama-b12375-bin-win-cuda-13.5-x64.zip', { hasGpu: true })).toBeGreaterThan(
      scoreRuntimeAsset('llama-b12375-bin-win-cpu-x64.zip', { hasGpu: true })
    );
    expect(scoreRuntimeAsset('llama-b12375-bin-win-cuda-12.4-x64.zip', { hasGpu: true })).toBeLessThan(
      scoreRuntimeAsset('llama-b12375-bin-win-cuda-13.5-x64.zip', { hasGpu: true })
    );
  });

  test('sin GPU vuelve a la build de CPU', () => {
    expect(best(false)).toBe('llama-b12375-bin-win-cpu-x64.zip');
    expect(scoreRuntimeAsset('llama-b12375-bin-win-cuda-13.5-x64.zip', { hasGpu: false })).toBeLessThan(
      scoreRuntimeAsset('llama-b12375-bin-win-cpu-x64.zip', { hasGpu: false })
    );
  });

  test('las DLLs de cudart nunca se eligen como runtime', () => {
    for (const hasGpu of [true, false]) {
      expect(scoreRuntimeAsset('cudart-llama-bin-win-cuda-13.5-x64.zip', { hasGpu })).toBeLessThan(
        scoreRuntimeAsset('llama-b12375-bin-win-cuda-13.5-x64.zip', { hasGpu })
      );
    }
  });

  test('el cudart acompaña al binario de la misma versión', () => {
    expect(
      selectCudartAsset(assets, { name: 'llama-b12375-bin-win-cuda-13.5-x64.zip' })?.name
    ).toBe('cudart-llama-bin-win-cuda-13.5-x64.zip');
    expect(
      selectCudartAsset(assets, { name: 'llama-b12375-bin-win-cpu-x64.zip' })
    ).toBeUndefined();
  });
});
