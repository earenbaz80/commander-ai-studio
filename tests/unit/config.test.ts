/**
 * Unit tests para el sistema de configuración (CLI + runtime).
 *
 * Aislados en un directorio temporal para no leer/escribir el
 * commander.json real del proyecto (que puede tener cambios de pruebas).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadConfig,
  writeConfig,
  getAgentConfig,
  CommanderConfigSchema,
  resetConfig,
  setGoogleToolsMemoryTtlMinutes,
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

  it('un commander.json corrupto no vuelca su contenido al log', () => {
    const secret = 'sk-config-no-log';
    fs.writeFileSync(
      path.join(tmpDir, 'commander.json'),
      `{"providers":{"xai":{"apiKey":${secret}}}}`,
      'utf8'
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resetConfig();
    const config = loadConfig();
    // Se leen las llamadas antes de restaurar: mockRestore las limpia.
    const logged = warn.mock.calls.flat().map(String).join(' ');
    warn.mockRestore();

    expect(config.ui?.theme).toBe('norton');
    expect(logged).toContain('No se pudo cargar');
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('apiKey');
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

  it('writeConfig no vuelca en el fichero las API keys que sólo vienen del entorno', () => {
    fs.writeFileSync(path.join(tmpDir, 'commander.json'), JSON.stringify({ providers: {} }));
    resetConfig();

    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'clave-de-entorno-que-no-debe-persistirse';
    try {
      const file = writeConfig({ ui: { theme: 'amber' } });
      const raw = fs.readFileSync(file, 'utf8');
      expect(raw).not.toContain('clave-de-entorno-que-no-debe-persistirse');
      expect(JSON.parse(raw).ui.theme).toBe('amber');
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it('tras guardar, la configuración en memoria sigue viendo las claves del entorno', () => {
    resetConfig();
    const previous = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = 'clave-xai-solo-entorno';
    try {
      writeConfig({ ui: { theme: 'amber' } });
      expect(loadConfig().providers?.xai?.apiKey).toBe('clave-xai-solo-entorno');
    } finally {
      if (previous === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = previous;
    }
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

describe('Duración de la marca de herramientas integradas', () => {
  it('guarda los minutos en providers.google sin tocar el resto', () => {
    const file = path.join(tmpDir, 'commander.json');
    fs.writeFileSync(file, JSON.stringify({ providers: { google: { toolsMemoryTtlMinutes: 30 } }, agent: { maxSteps: 50 } }));
    resetConfig();

    const saved = setGoogleToolsMemoryTtlMinutes(7);
    const parsed = JSON.parse(fs.readFileSync(saved, 'utf8'));

    expect(parsed.providers.google.toolsMemoryTtlMinutes).toBe(7);
    expect(parsed.agent.maxSteps).toBe(50);
    resetConfig();
    expect(loadConfig().providers?.google?.toolsMemoryTtlMinutes).toBe(7);
  });

  it('no escribe en el fichero las API keys que sólo vienen del entorno', () => {
    const file = path.join(tmpDir, 'commander.json');
    fs.writeFileSync(file, JSON.stringify({ providers: {} }));
    resetConfig();

    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'clave-solo-del-entorno';
    try {
      const saved = setGoogleToolsMemoryTtlMinutes(15);
      const raw = fs.readFileSync(saved, 'utf8');
      expect(raw).not.toContain('clave-solo-del-entorno');
      expect(JSON.parse(raw).providers.google.toolsMemoryTtlMinutes).toBe(15);
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
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
    // `approvalMode` se eliminó por no tener efecto: el bucle no la consultaba.
    // Quién decide es la tool, las reglas del proyecto (`allow`/`ask`/`deny`),
    // `allow-session` o el prompt humano; esta clave no saltaba ninguno.
    expect('approvalMode' in agent).toBe(false);
  });

  it('un config viejo con approvalMode sigue parseando, sin la clave', () => {
    // Quien ya tenía el archivo escrito no debe romper: el objeto no es
    // estricto, así que la clave muerta se descarta en silencio.
    const parsed = CommanderConfigSchema.parse({ agent: { approvalMode: 'never' } });
    expect('approvalMode' in parsed.agent).toBe(false);
    expect(parsed.agent.maxSteps).toBeGreaterThan(0);
  });
});
