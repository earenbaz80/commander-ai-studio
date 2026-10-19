import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toolDialectForModel,
  modelSupportsTools,
  toOpenAITools,
  normalizeOpenAIToolCalls,
} from '../src/agent/providers.js';

test('toolDialectForModel detecta los tres dialectos', () => {
  assert.equal(toolDialectForModel('gemini-2.5-flash'), 'gemini');
  assert.equal(toolDialectForModel('gemini-3.1-pro-preview'), 'gemini');
  assert.equal(toolDialectForModel('openrouter/openai/gpt-4o-mini'), 'openai');
  assert.equal(toolDialectForModel('ollama/llama3.2'), 'openai');
  assert.equal(toolDialectForModel('custom/big-pickle'), 'openai');
  assert.equal(toolDialectForModel('pollinations/openai'), 'json-text');
  assert.equal(toolDialectForModel('deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B'), 'json-text');
  assert.equal(toolDialectForModel(undefined), 'gemini');
});

test('modelSupportsTools según dialecto', () => {
  assert.equal(modelSupportsTools('gemini-2.5-flash'), true);
  assert.equal(modelSupportsTools('openrouter/openai/gpt-4o-mini'), true);
  assert.equal(modelSupportsTools('ollama/llama3.2'), true);
  assert.equal(modelSupportsTools('custom/big-pickle'), true);
  assert.equal(modelSupportsTools('pollinations/openai'), false);
  assert.equal(modelSupportsTools('meta-llama/Llama-3.2-3B-Instruct'), false);
});

test('toOpenAITools convierte declaraciones Gemini a formato OpenAI', () => {
  const tools = toOpenAITools([
    {
      name: 'fs_read',
      description: 'Leer archivo',
      parameters: {
        type: 'OBJECT',
        properties: {
          path: { type: 'STRING', description: 'Ruta' },
          limit: { type: 'INTEGER' },
          strict: { type: 'BOOLEAN' },
          ratio: { type: 'NUMBER' },
          tags: { type: 'ARRAY' },
        },
        required: ['path'],
      },
    },
  ]);

  assert.equal(tools.length, 1);
  const fn = tools[0] as any;
  assert.equal(fn.type, 'function');
  assert.equal(fn.function.name, 'fs_read');
  assert.equal(fn.function.parameters.type, 'object');
  assert.deepEqual(fn.function.parameters.required, ['path']);
  assert.equal(fn.function.parameters.properties.path.type, 'string');
  assert.equal(fn.function.parameters.properties.limit.type, 'integer');
  assert.equal(fn.function.parameters.properties.strict.type, 'boolean');
  assert.equal(fn.function.parameters.properties.ratio.type, 'number');
  assert.equal(fn.function.parameters.properties.tags.type, 'array');
  assert.equal(fn.function.parameters.properties.path.description, 'Ruta');
});

test('toOpenAITools usa las declaraciones del agente por defecto', () => {
  const tools = toOpenAITools();
  assert.ok(tools.length >= 10, 'debe incluir las tools del agente');
  const names = tools.map((t: any) => t.function.name);
  assert.ok(names.includes('fs_read'));
  assert.ok(names.includes('fs_write'));
  assert.ok(names.includes('shell_run'));
  // Todas las declaraciones por defecto deben ser funciones con parámetros object
  for (const t of tools) {
    assert.equal((t as any).type, 'function');
    assert.equal((t as any).function.parameters.type, 'object');
  }
});

test('normalizeOpenAIToolCalls parsea argumentos string JSON', () => {
  const calls = normalizeOpenAIToolCalls([
    { id: 'call_1', function: { name: 'fs_read', arguments: '{"path":"package.json"}' } },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'call_1');
  assert.equal(calls[0].name, 'fs_read');
  assert.deepEqual(calls[0].args, { path: 'package.json' });
});

test('normalizeOpenAIToolCalls acepta argumentos como objeto (Ollama)', () => {
  const calls = normalizeOpenAIToolCalls([
    { function: { name: 'shell_run', arguments: { command: 'ls' } } },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'shell_run');
  assert.deepEqual(calls[0].args, { command: 'ls' });
});

test('normalizeOpenAIToolCalls tolera JSON inválido y calls vacías', () => {
  const calls = normalizeOpenAIToolCalls([
    { id: 'x', function: { name: 'fs_edit', arguments: '{rotos' } },
    { function: { name: 'fs_write', arguments: null } },
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, {});
  assert.deepEqual(calls[1].args, {});
  assert.deepEqual(normalizeOpenAIToolCalls(undefined), []);
  assert.deepEqual(normalizeOpenAIToolCalls([null, { function: {} }]), []);
});