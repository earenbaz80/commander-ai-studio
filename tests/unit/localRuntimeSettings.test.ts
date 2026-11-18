/**
 * Persistencia de los ajustes del runtime nativo: sobreviven al reinicio y una
 * entrada inválida no tumba el arranque.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  LOCAL_RUNTIME_SETTINGS_ENV,
  localRuntimeSettingsPath,
  readLocalRuntimeTuning,
  sanitizeLocalRuntimeTuning,
  writeLocalRuntimeTuning,
} from '../../src/lib/localRuntimeSettings';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-runtime-settings-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env[LOCAL_RUNTIME_SETTINGS_ENV];
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('ajustes persistidos del runtime', () => {
  test('guarda y relee el último set, incluido jinja apagado', () => {
    const root = tempDir();
    const written = writeLocalRuntimeTuning(
      {
        jinja: false,
        flashAttention: true,
        cpuMoeLayers: 33,
        cacheTypeK: 'q8_0',
        cacheTypeV: 'q8_0',
        tensorSplit: '1,1',
      },
      root
    );

    expect(written.jinja).toBe(false);
    expect(written.cpuMoeLayers).toBe(33);
    const file = localRuntimeSettingsPath(root);
    expect(fs.existsSync(file)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk).toMatchObject({ jinja: false, cpuMoeLayers: 33, cacheTypeK: 'q8_0' });
    expect(readLocalRuntimeTuning(root)).toEqual(written);
  });

  test('sin archivo, corrupto o con otra forma devuelve los valores por defecto', () => {
    const root = tempDir();
    expect(readLocalRuntimeTuning(root)).toEqual({});

    const file = localRuntimeSettingsPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{no-json', 'utf8');
    expect(readLocalRuntimeTuning(root)).toEqual({});

    fs.writeFileSync(file, JSON.stringify(['jinja']), 'utf8');
    expect(readLocalRuntimeTuning(root)).toEqual({});
  });

  test('descarta sólo los campos inválidos', () => {
    const root = tempDir();
    const file = localRuntimeSettingsPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        jinja: false,
        flashAttention: true,
        cpuMoeLayers: 5_000,
        cacheTypeK: 'q3_k',
        tensorSplit: '1;1',
      }),
      'utf8'
    );

    expect(readLocalRuntimeTuning(root)).toEqual({ jinja: false, flashAttention: true });
  });

  test('una caché KV cuantizada sin flash-attn se descarta', () => {
    expect(
      sanitizeLocalRuntimeTuning({ flashAttention: false, cacheTypeK: 'q8_0', cacheTypeV: 'q8_0' })
    ).toEqual({ flashAttention: false });
  });

  test('COMMANDER_LOCAL_RUNTIME_SETTINGS aísla la ruta del archivo', () => {
    const root = tempDir();
    const override = path.join(tempDir(), 'custom', 'runtime.json');
    process.env[LOCAL_RUNTIME_SETTINGS_ENV] = override;

    expect(localRuntimeSettingsPath(root)).toBe(path.resolve(override));
    writeLocalRuntimeTuning({ cpuMoeLayers: 12 }, root);

    expect(fs.existsSync(override)).toBe(true);
    expect(readLocalRuntimeTuning(root).cpuMoeLayers).toBe(12);
  });
});
