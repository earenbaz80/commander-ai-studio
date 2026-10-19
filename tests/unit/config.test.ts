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
import { loadConfig, writeConfig, getAgentConfig, CommanderConfigSchema, resetConfig } from '../../src/config/index';

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

describe('Agent Config helper', () => {
  it('debe devolver la configuración de agent con valores válidos', () => {
    const agent = getAgentConfig();

    expect(agent.maxSteps).toBeGreaterThan(0);
    expect(agent.maxTurns).toBeGreaterThan(0);
    expect(['auto', 'manual', 'never']).toContain(agent.approvalMode);
  });
});
