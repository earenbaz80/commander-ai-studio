/**
 * Propuesta de ajustes del runtime nativo: reparto de expertos MoE, contexto y
 * capas GPU derivados del GGUF y del hardware. Los números son deliberadamente
 * exactos para que un cambio de heurística se vea en el test.
 */
import { describe, expect, test } from 'vitest';
import type { GgufProfile } from '../../src/lib/ggufProfile';
import {
  detectLocalHardware,
  mergeProposedTuning,
  proposeLocalRuntimeTuning,
} from '../../src/lib/localRuntimeProposal';

const GiB = 1024 ** 3;

function moeProfile(overrides: Partial<GgufProfile> = {}): GgufProfile {
  return {
    architecture: 'qwen3moe',
    blockCount: 48,
    expertCount: 128,
    expertsUsed: 8,
    contextLength: 262_144,
    tensorBytes: 20 * GiB,
    expertBytes: 18 * GiB,
    denseBytes: 2 * GiB,
    expertLayerCount: 48,
    moe: true,
    hasChatTemplate: true,
    ...overrides,
  };
}

function denseProfile(overrides: Partial<GgufProfile> = {}): GgufProfile {
  return {
    architecture: 'qwen3',
    blockCount: 48,
    contextLength: 32_768,
    tensorBytes: 40 * GiB,
    expertBytes: 0,
    denseBytes: 40 * GiB,
    expertLayerCount: 0,
    moe: false,
    hasChatTemplate: true,
    ...overrides,
  };
}

describe('propuesta de ajustes del runtime', () => {
  test('deriva --n-cpu-moe de los expertos por capa y la VRAM útil', () => {
    const { proposed, notes } = proposeLocalRuntimeTuning({
      profile: moeProfile(),
      hardware: {
        vramTotalMb: 12_288,
        vramFreeMb: 10_240,
        ramTotalGb: 64,
        gpuCount: 1,
      },
    });

    // 10 240 MB * 0,85 - 768 MB = 7 936 MB útiles; densas 2 048 MB;
    // 384 MB de expertos por capa -> 15 capas en GPU y 33 en RAM.
    expect(proposed.cpuMoeLayers).toBe(33);
    expect(proposed.gpuLayers).toBe(48);
    expect(proposed.context).toBe(32_768);
    expect(proposed.cacheTypeK).toBe('q8_0');
    expect(proposed.cacheTypeV).toBe('q8_0');
    expect(proposed.jinja).toBe(true);
    expect(proposed.flashAttention).toBe(true);
    expect(notes.join(' ')).toContain('--n-cpu-moe 33');
  });

  test('no propone MoE en CPU cuando el modelo entra completo en VRAM', () => {
    const { proposed, notes } = proposeLocalRuntimeTuning({
      profile: moeProfile({
        tensorBytes: 6 * GiB,
        expertBytes: 5 * GiB,
        denseBytes: 1 * GiB,
      }),
      hardware: {
        vramTotalMb: 24_576,
        vramFreeMb: 24_576,
        ramTotalGb: 64,
        gpuCount: 1,
      },
    });

    expect(proposed.cpuMoeLayers).toBeUndefined();
    expect(proposed.cacheTypeK).toBeUndefined();
    expect(notes.join(' ')).toContain('no hace falta --n-cpu-moe');
  });

  test('reparte capas GPU en un modelo denso que no entra en VRAM', () => {
    const { proposed, notes } = proposeLocalRuntimeTuning({
      profile: denseProfile(),
      hardware: {
        vramTotalMb: 8_192,
        vramFreeMb: 8_192,
        ramTotalGb: 64,
        gpuCount: 1,
      },
    });

    // 8 192 MB * 0,85 - 768 MB = 6 195 MB útiles sobre 40 960 MB: 7 de 48 capas.
    expect(proposed.gpuLayers).toBe(7);
    expect(proposed.cpuMoeLayers).toBeUndefined();
    expect(notes.join(' ')).toContain('7 de 48 capas');
  });

  test('acota el contexto a la ventana que declara el GGUF', () => {
    const { proposed, notes } = proposeLocalRuntimeTuning({
      profile: denseProfile({ tensorBytes: 4 * GiB, denseBytes: 4 * GiB }),
      hardware: {
        vramTotalMb: 24_576,
        vramFreeMb: 24_576,
        ramTotalGb: 64,
        gpuCount: 1,
      },
    });

    expect(proposed.context).toBe(32_768);
    expect(notes.join(' ')).toContain('32768 tokens');
  });

  test('sin VRAM detectada no inventa el reparto de expertos', () => {
    const { proposed, notes } = proposeLocalRuntimeTuning({
      profile: moeProfile(),
      hardware: { ramTotalGb: 32, gpuCount: 0 },
    });

    expect(proposed.cpuMoeLayers).toBeUndefined();
    expect(proposed.gpuLayers).toBe(99);
    expect(proposed.context).toBe(8_192);
    expect(notes.join(' ')).toContain('No se detectó VRAM');
  });

  test('con dos GPU propone tensor-split repartido', () => {
    const { proposed } = proposeLocalRuntimeTuning({
      profile: moeProfile(),
      hardware: {
        vramTotalMb: 49_152,
        vramFreeMb: 40_000,
        ramTotalGb: 64,
        gpuCount: 2,
      },
    });

    expect(proposed.tensorSplit).toBe('1,1');
  });
});

describe('ajustes del arranque automático', () => {
  const proposed = {
    context: 32_768,
    gpuLayers: 48,
    jinja: true,
    flashAttention: true,
    cpuMoeLayers: 33,
    cacheTypeK: 'q8_0',
    cacheTypeV: 'q8_0',
  };

  test('el reparto MoE sale del modelo, no del último set guardado', () => {
    const merged = mergeProposedTuning(
      { jinja: false, flashAttention: true, cpuMoeLayers: 7, cacheTypeK: 'f16' },
      proposed
    );

    expect(merged.cpuMoeLayers).toBe(33);
    expect(merged.cacheTypeK).toBe('q8_0');
    // Las preferencias guardadas sí mandan sobre la propuesta.
    expect(merged.jinja).toBe(false);
    expect(merged.flashAttention).toBe(true);
  });

  test('si el modelo no es MoE cae al valor guardado', () => {
    const merged = mergeProposedTuning(
      { cpuMoeLayers: 5 },
      { context: 8_192, gpuLayers: 99, jinja: true, flashAttention: true }
    );

    expect(merged.cpuMoeLayers).toBe(5);
  });

  test('no pide caché KV cuantizada con flash-attn apagado', () => {
    const merged = mergeProposedTuning({ flashAttention: false }, proposed);

    expect(merged.flashAttention).toBe(false);
    expect(merged.cacheTypeK).toBeUndefined();
    expect(merged.cacheTypeV).toBeUndefined();
    expect(merged.cpuMoeLayers).toBe(33);
  });
});

describe('detección de hardware', () => {
  test('suma la VRAM de todas las GPU que reporta nvidia-smi', () => {
    const snapshot = detectLocalHardware({
      exec: () =>
        'NVIDIA GeForce RTX 4090, 24576, 20000\nNVIDIA GeForce RTX 4090, 24576, 18000\n',
      totalmem: () => 64 * GiB,
    });

    expect(snapshot.gpuCount).toBe(2);
    expect(snapshot.vramTotalMb).toBe(49_152);
    expect(snapshot.vramFreeMb).toBe(38_000);
    expect(snapshot.gpuName).toContain('4090');
    expect(snapshot.ramTotalGb).toBe(64);
  });

  test('sin nvidia-smi deja la VRAM desconocida y conserva la RAM', () => {
    const snapshot = detectLocalHardware({
      exec: () => {
        throw new Error('ENOENT');
      },
      totalmem: () => 32 * GiB,
    });

    expect(snapshot.gpuCount).toBe(0);
    expect(snapshot.vramTotalMb).toBeUndefined();
    expect(snapshot.ramTotalGb).toBe(32);
  });
});
