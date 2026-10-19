import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCatalog, mergeCatalogEntry, readProviderStatus, type CatalogEntry } from '../src/data/catalog.js';
import type { AIModel } from '../src/types/studio.js';

const base = (id: string, extra: Partial<AIModel> = {}): AIModel => ({
  id,
  name: `name-${id}`,
  provider: 'google',
  description: 'desc-base',
  contextWindow: '1K tokens',
  ...extra,
});

test('applyCatalog añade entradas nuevas al final y respeta el orden base', () => {
  const out = applyCatalog([base('a'), base('b')], [[{ id: 'c', name: 'C', provider: 'ollama' }]]);
  assert.deepEqual(out.map((m) => m.id), ['a', 'b', 'c']);
});

test('applyCatalog sobrescribe campos de un modelo existente sin perder los demás', () => {
  const out = applyCatalog(
    [base('g', { supportsTools: true, supportsThinking: true })],
    [[{ id: 'g', name: 'Gemini X', description: 'nueva', contextWindow: '2M tokens' }]],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Gemini X');
  assert.equal(out[0].description, 'nueva');
  assert.equal(out[0].contextWindow, '2M tokens');
  // Los flags no especificados se conservan.
  assert.equal(out[0].supportsTools, true);
  assert.equal(out[0].supportsThinking, true);
});

test('applyCatalog respeta booleans explícitos y no pisa con undefined', () => {
  const out = applyCatalog(
    [base('m', { supportsTools: true })],
    [
      [{ id: 'm', supportsTools: undefined }],
      [{ id: 'n', provider: 'pollinations', supportsTools: false }],
    ],
  );
  assert.equal(out.find((m) => m.id === 'm')?.supportsTools, true);
  assert.equal(out.find((m) => m.id === 'n')?.supportsTools, false);
});

test('mergeCatalogEntry ignora entradas sin id válido', () => {
  const byId = new Map<string, AIModel>();
  mergeCatalogEntry(byId, { name: 'sin id' } as CatalogEntry);
  mergeCatalogEntry(byId, { id: '   ' });
  mergeCatalogEntry(byId, undefined);
  assert.equal(byId.size, 0);
});

test('mergeCatalogEntry no pisa con strings vacíos', () => {
  const byId = new Map<string, AIModel>([['x', base('x')]]);
  mergeCatalogEntry(byId, { id: 'x', name: '', description: '' });
  assert.equal(byId.get('x')?.name, 'name-x');
  assert.equal(byId.get('x')?.description, 'desc-base');
});

test('readProviderStatus devuelve el mapa reportado por el server', () => {
  const providers = { ollama: { available: false, count: 0, host: 'http://localhost:11434' } };
  assert.deepEqual(readProviderStatus({ providers }), providers);
});

test('readProviderStatus cae a {} cuando no hay datos', () => {
  assert.deepEqual(readProviderStatus(null), {});
  assert.deepEqual(readProviderStatus({}), {});
  assert.deepEqual(readProviderStatus({ providers: undefined }), {});
});
