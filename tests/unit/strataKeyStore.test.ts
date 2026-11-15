import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  deleteStrataApiKey,
  getStrataApiKey,
  saveStrataApiKey,
  STRATA_API_KEY_NAMESPACE,
} from '../../src/lib/strataKeyStore';

/**
 * La API key de Strata no puede acabar en claro en disco. El vault ya cifra
 * tokens OAuth con AES-256-GCM; aquí se comprueba que el secreto de Strata usa
 * esa misma vía y que se puede rotar y borrar.
 */
let vaultDir: string;
let previousDir: string | undefined;
let previousKey: string | undefined;

beforeEach(() => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-strata-key-'));
  previousDir = process.env.COMMANDER_VAULT_DIR;
  previousKey = process.env.COMMANDER_VAULT_KEY;
  process.env.COMMANDER_VAULT_DIR = vaultDir;
  delete process.env.COMMANDER_VAULT_KEY;
});

afterEach(() => {
  if (previousDir === undefined) delete process.env.COMMANDER_VAULT_DIR;
  else process.env.COMMANDER_VAULT_DIR = previousDir;
  if (previousKey === undefined) delete process.env.COMMANDER_VAULT_KEY;
  else process.env.COMMANDER_VAULT_KEY = previousKey;
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

describe('strataKeyStore', () => {
  test('guarda la API key cifrada y la recupera sin escribirla en claro', () => {
    const secret = 'strata-key-super-secreta-123456';
    saveStrataApiKey(secret);

    expect(getStrataApiKey()).toBe(secret);
    const vault = fs.readFileSync(path.join(vaultDir, 'integrations.json'), 'utf8');
    expect(vault).not.toContain(secret);
    expect(vault).not.toContain('"value"');
    expect(vault).toContain(`secret:${STRATA_API_KEY_NAMESPACE}`);
  });

  test('rota y borra la clave sin dejar restos legibles', () => {
    saveStrataApiKey('primera-clave-1234');
    saveStrataApiKey('segunda-clave-5678');
    expect(getStrataApiKey()).toBe('segunda-clave-5678');

    expect(deleteStrataApiKey()).toBe(true);
    expect(getStrataApiKey()).toBeUndefined();
    const vault = fs.readFileSync(path.join(vaultDir, 'integrations.json'), 'utf8');
    expect(vault).not.toContain('primera-clave-1234');
    expect(vault).not.toContain('segunda-clave-5678');
  });

  test('rechaza una clave vacía y no crea una entrada', () => {
    expect(() => saveStrataApiKey('   ')).toThrow(/vacía/);
    expect(getStrataApiKey()).toBeUndefined();
  });
});
