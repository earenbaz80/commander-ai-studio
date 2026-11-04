import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listProjectPrompts, parsePromptFile } from '../promptsApi.js';

function proyecto(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-prompts-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return root;
}

test('lee comandos y agentes con front-matter opcional', () => {
  const root = proyecto({
    '.commander/commands/revisar.md': '---\nname: Revisar\ndescription: Mira el diff\n---\nRevisa el diff.\n',
    '.commander/commands/plano.md': 'Sin cabecera.\n',
    '.commander/agents/revisor.md': '---\nname: Revisor\n---\nEres estricto.\n',
  });
  try {
    const { commands, agents } = listProjectPrompts(root);
    assert.deepEqual(commands.map((c) => c.id), ['plano', 'revisar']);
    const revisar = commands.find((c) => c.id === 'revisar')!;
    assert.equal(revisar.name, 'Revisar');
    assert.equal(revisar.description, 'Mira el diff');
    assert.equal(revisar.body, 'Revisa el diff.');
    assert.equal(commands.find((c) => c.id === 'plano')!.name, 'plano');
    assert.equal(agents.length, 1);
    assert.equal(agents[0].body, 'Eres estricto.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sin .commander devuelve listas vacías', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-prompts-'));
  try {
    assert.deepEqual(listProjectPrompts(root), { commands: [], agents: [] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tolera CRLF y descarta ficheros vacíos', () => {
  const root = proyecto({
    '.commander/commands/crlf.md': '---\r\nname: Con CRLF\r\n---\r\nCuerpo.\r\n',
    '.commander/commands/vacio.md': '---\nname: Vacío\n---\n',
  });
  try {
    const { commands } = listProjectPrompts(root);
    assert.deepEqual(commands.map((c) => c.id), ['crlf']);
    assert.equal(commands[0].body, 'Cuerpo.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('parsePromptFile separa metadatos y cuerpo', () => {
  const parsed = parsePromptFile('---\nname: X\ndescription: "Y"\n---\nHola');
  assert.equal(parsed.meta.name, 'X');
  assert.equal(parsed.meta.description, 'Y');
  assert.equal(parsed.body, 'Hola');
  assert.deepEqual(parsePromptFile('solo cuerpo'), { meta: {}, body: 'solo cuerpo' });
});
