/**
 * Qué credenciales del cliente viajan con cada prefijo de modelo.
 *
 * `clientCredentialsFor` decide si la petición lleva `baseURL` y `apiKey` del
 * panel. Sólo `/api/custom/generate` las entiende como suyas: en el resto de
 * proveedores la clave se resuelve en el servidor, y si le llega la de Custom la
 * usa como propia —el proxy de Freebuff prefiere `baseURL` a `FREEBUFF_BASE_URL`
 * y toma `apiKey` como su clave—, así que la petición se iba a otro host con una
 * credencial ajena.
 *
 * Aquí se fija el contrato por prefijo, incluidos los ids que se parecen a un
 * prefijo sin serlo (`Custom/`, `mycustom/`), porque el bug original no fue un
 * `if` mal escrito sino olvidarse de que este objeto se mezcla en el cuerpo de
 * *todos* los proveedores.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientCredentialsFor, PROVIDER_CONFIGS } from '../src/lib/aiProviders.js';
import { GEMINI_DEFAULT_MODEL } from '../src/config/geminiModels.js';
import { FREEBUFF_DEFAULT_MODEL } from '../src/config/freebuffModels.js';

/** Claves que "el panel" tendría cargadas en este escenario. */
const PANEL: Record<string, string> = {
  CUSTOM_BASE_URL: 'https://custom.invalid/v1',
  CUSTOM_API_KEY: 'clave-de-custom',
  OPENCODE_API_KEY: 'clave-de-opencode',
};

const conPanel = (name: string) => PANEL[name] || undefined;

/** Lo que devuelve la función cuando sí hay credenciales. */
const ESPERADO_CUSTOM = { baseURL: 'https://custom.invalid/v1', apiKey: 'clave-de-custom' };

test('sólo el prefijo custom/ lleva credenciales del cliente', () => {
  const ids: [string, string][] = [
    [GEMINI_DEFAULT_MODEL, 'id plano de Gemini'],
    ['claude-sonnet-4-5', 'Claude'],
    ['grok-4', 'xAI'],
    ['antigravity-preview-09-2026', 'el agente Antigravity, que resuelve a Google'],
    ['openrouter/openai/gpt-4o', 'OpenRouter'],
    ['ollama/llama3.2', 'Ollama'],
    ['pollinations/openai', 'Pollinations'],
    [FREEBUFF_DEFAULT_MODEL, 'Freebuff: su proxy prefiere baseURL a la suya'],
    ['local/llama-3.2-3b', 'llama.cpp local'],
    ['meta-llama/Llama-3.2-3B-Instruct', 'HuggingFace org/repo'],
    ['custom/gpt-4o-mini', 'Custom, el único que las necesita'],
  ];

  for (const [id, motivo] of ids) {
    const creds = clientCredentialsFor(id, conPanel);
    if (id.startsWith('custom/')) {
      assert.deepEqual(creds, ESPERADO_CUSTOM, `${id} (${motivo}) es el destinatario de estas claves`);
    } else {
      assert.deepEqual(creds, {}, `${id} (${motivo}) no debe recibir la base ni la clave de Custom`);
    }
  }
});

test('con un id ajeno ni siquiera se leen las claves de Custom', () => {
  // Un `readKey` que lanza delata cualquier lectura futura: el contrato es «no
  // las manda», no «las lee y las descarta».
  const sinLecturas = (name: string) => {
    throw new Error(`no debería leer ${name} para un modelo que no es custom/`);
  };

  for (const id of [GEMINI_DEFAULT_MODEL, FREEBUFF_DEFAULT_MODEL, 'openrouter/openai/gpt-4o-mini']) {
    assert.deepEqual(clientCredentialsFor(id, sinLecturas), {});
  }
});

test('el prefijo se compara tal cual: Custom/ o mycustom/ no cuentan', () => {
  // Sin distinción de mayúsculas ni match por subcadena: un id que empieza igual
  // pero no por `custom/` seguiría yendo a otro endpoint, y mandarle la clave de
  // Custom lo expondría en el proveedor equivocado.
  for (const id of ['Custom/gpt-4o', 'CUSTOM/gpt-4o', 'mycustom/gpt-4o', 'custom', 'x/custom/gpt-4o']) {
    assert.deepEqual(clientCredentialsFor(id, conPanel), {}, `${id} no es un id custom/`);
  }
});

test('custom/ sin claves cargadas no inventa credenciales', () => {
  // El objeto lleva las dos claves con `undefined`: no es lo mismo que no
  // enviarlo, así que se fija la forma exacta para que un cambio de contrato se
  // vea aquí y no en un 400 del handler.
  assert.deepEqual(clientCredentialsFor('custom/gpt-4o-mini', () => undefined), {
    baseURL: undefined,
    apiKey: undefined,
  });
});

test('custom/ cae a la clave de OpenCode, igual que el panel', () => {
  const soloOpencode = (name: string) => (name === 'OPENCODE_API_KEY' ? 'clave-de-opencode' : undefined);

  assert.deepEqual(clientCredentialsFor('custom/gpt-4o-mini', soloOpencode), {
    baseURL: undefined,
    apiKey: 'clave-de-opencode',
  });
});

test('ningún proveedor conocido recibe credenciales salvo custom', () => {
  // Recorre la lista real de proveedores: si mañana se añade uno y se decide
  // mandarle estas claves, este test obliga a hacerlo a conciencia.
  for (const provider of Object.keys(PROVIDER_CONFIGS)) {
    const creds = clientCredentialsFor(`${provider}/modelo`, conPanel);
    if (provider === 'custom') assert.deepEqual(creds, ESPERADO_CUSTOM);
    else assert.deepEqual(creds, {}, `${provider} no debe recibir la base ni la clave de Custom`);
  }
});
