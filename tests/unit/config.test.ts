/**
 * Unit tests para el sistema de configuración (CLI + runtime).
 *
 * Aislados en un directorio temporal para no leer/escribir el
 * commander.json real del proyecto (que puede tener cambios de pruebas).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadConfig,
  writeConfig,
  getAgentConfig,
  CommanderConfigSchema,
  resetConfig,
  getGoogleFallbackModels,
  setGoogleFallbackModels,
} from '../../src/config/index';
import { GEMINI_FALLBACK_MODELS, MAX_FALLBACK_MODELS } from '../../src/config/geminiModels';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  // Crea un directorio temporal vacío y cambia a él.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  resetConfig();
});

afterEach(() => {
  // Restaura cwd y limpia.
  process.chdir(originalCwd);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignorar */
  }
  resetConfig();
});

describe('Config System', () => {
  it('debe cargar defaults del schema cuando no hay commander.json', () => {
    const config = loadConfig();

    expect(config.version).toBe(1);
    expect(config.ui?.theme).toBe('norton');
    expect(config.ui?.language).toBe('es');
    expect(config.agent?.maxSteps).toBe(25);
    expect(config.server?.port).toBe(3280);
  });

  it('debe persistir cambios en commander.json y releerlos', () => {
    writeConfig({ ui: { theme: 'matrix' }, agent: { maxSteps: 50 } });

    // El archivo debe existir en el tmpDir
    const file = path.join(tmpDir, 'commander.json');
    expect(fs.existsSync(file)).toBe(true);

    resetConfig();
    const updated = loadConfig();
    expect(updated.ui?.theme).toBe('matrix');
    expect(updated.agent?.maxSteps).toBe(50);
  });

  it('debe validar config correcta con Zod', () => {
    const result = CommanderConfigSchema.safeParse({
      ui: { theme: 'amber' },
      agent: { maxSteps: 100 },
    });

    expect(result.success).toBe(true);
    if (result.data) {
      expect(result.data.ui?.theme).toBe('amber');
    }
  });

  it('debe rechazar config inválida (theme inexistente)', () => {
    const result = CommanderConfigSchema.safeParse({
      ui: { theme: 'invalid-theme' },
    });

    expect(result.success).toBe(false);
  });
});

describe('Cadena de respaldo guardada', () => {
  it('sin cadena en la config devuelve null; el servidor cae entonces a la de fábrica', () => {
    resetConfig();
    expect(getGoogleFallbackModels()).toBeNull();
  });

  it('si existe providers.google pero no la cadena, el esquema rellena la de fábrica', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'commander.json'),
      JSON.stringify({ providers: { google: { defaultModel: 'gemini-3.5-flash' } } })
    );
    resetConfig();
    expect(getGoogleFallbackModels()).toEqual(GEMINI_FALLBACK_MODELS);
  });

  it('guarda la cadena sin tocar el resto del fichero', () => {
    const file = path.join(tmpDir, 'commander.json');
    fs.writeFileSync(file, JSON.stringify({ providers: { google: { toolsMemoryTtlMinutes: 30 } }, agent: { maxSteps: 50 } }));
    resetConfig();

    const saved = setGoogleFallbackModels(['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
    const parsed = JSON.parse(fs.readFileSync(saved, 'utf8'));

    expect(parsed.providers.google.fallbackModels).toEqual(['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
    expect(parsed.providers.google.toolsMemoryTtlMinutes).toBe(30);
    expect(parsed.agent.maxSteps).toBe(50);

    resetConfig();
    expect(getGoogleFallbackModels()).toEqual(['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
  });

  it('una cadena vacía se guarda y se lee como decisión, no como hueco', () => {
    setGoogleFallbackModels([]);
    resetConfig();
    expect(getGoogleFallbackModels()).toEqual([]);
  });

  it('no escribe en el fichero las API keys que sólo vienen del entorno', () => {
    const file = path.join(tmpDir, 'commander.json');
    fs.writeFileSync(file, JSON.stringify({ providers: {} }));
    resetConfig();

    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'clave-solo-del-entorno-respaldo';
    try {
      const raw = fs.readFileSync(setGoogleFallbackModels(['gemini-3.6-flash']), 'utf8');
      expect(raw).not.toContain('clave-solo-del-entorno-respaldo');
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });

  it('el esquema rechaza más modelos de los que admite la cadena', () => {
    const tooLong = Array.from({ length: MAX_FALLBACK_MODELS + 1 }, (_, i) => `gemini-m${i}`);
    const result = CommanderConfigSchema.safeParse({ providers: { google: { fallbackModels: tooLong } } });
    expect(result.success).toBe(false);
  });
});

describe('Agent Config helper', () => {
  it('debe devolver la configuración de agent con valores válidos', () => {
    const agent = getAgentConfig();

    expect(agent.maxSteps).toBeGreaterThan(0);
    expect(agent.maxTurns).toBeGreaterThan(0);
    expect(['auto', 'manual', 'never']).toContain(agent.approvalMode);
  });
});
