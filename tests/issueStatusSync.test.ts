import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyStatuses,
  findUncheckedCriteria,
  parseRows,
  syncIssueStatus,
  TABLE_FILES,
  type IssueStatus,
} from '../scripts/sync-issue-status.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const row = (id: string, number: number, status: IssueStatus, title = 'Título') =>
  `| ${id} | [#${number}](https://github.com/acme/repo/issues/${number}) | ${status} | ${title} |`;

test('parseRows: lee las dos formas de tabla y extrae el issue', () => {
  const markdown = [
    '| Archivo | Issue | Estado | Título |',
    '| --- | --- | --- | --- |',
    '| [F1-01](F1-01.md) | [#2](https://github.com/acme/repo/issues/2) | Abierto | Uno |',
    '| F1-02 | [#3](https://github.com/acme/other/issues/3) | Cerrado | Dos |',
  ].join('\n');

  const rows = parseRows(markdown);
  assert.deepEqual(
    rows.map((parsed) => ({
      id: parsed.id,
      owner: parsed.issue.owner,
      repo: parsed.issue.repo,
      number: parsed.issue.number,
      status: parsed.status,
    })),
    [
      { id: 'F1-01', owner: 'acme', repo: 'repo', number: 2, status: 'Abierto' },
      { id: 'F1-02', owner: 'acme', repo: 'other', number: 3, status: 'Cerrado' },
    ]
  );
});

test('applyStatuses: cambia sólo la celda Estado y conserva CRLF', () => {
  const markdown = `${row('F1-01', 2, 'Abierto')}\r\n${row('F1-02', 3, 'Abierto')}\r\n`;
  const result = applyStatuses(
    markdown,
    new Map([
      ['F1-01', 'Cerrado'],
      ['F1-02', 'Abierto'],
    ])
  );

  assert.equal(
    result.text,
    `${row('F1-01', 2, 'Cerrado')}\r\n${row('F1-02', 3, 'Abierto')}\r\n`
  );
  assert.deepEqual(result.changes, [{ id: 'F1-01', from: 'Abierto', to: 'Cerrado' }]);
});

test('applyStatuses: no escribe ni reporta cambios si ya coincide', () => {
  const markdown = `${row('F1-01', 2, 'Cerrado')}\n`;
  const result = applyStatuses(markdown, new Map([['F1-01', 'Cerrado']]));

  assert.equal(result.text, markdown);
  assert.deepEqual(result.changes, []);
});

test('applyStatuses: falla si falta el estado resuelto de una fila', () => {
  assert.throws(
    () => applyStatuses(row('F1-01', 2, 'Abierto'), new Map()),
    /falta el estado de F1-01/
  );
});

test('parseRows: rechaza una fila sin estado válido', () => {
  assert.throws(
    () => parseRows('| F1-01 | [#2](https://github.com/acme/repo/issues/2) | Pendiente | Uno |'),
    /Abierto\/Cerrado/
  );
});

test('findUncheckedCriteria: sólo lee la sección de aceptación', () => {
  const body = [
    '**Criterios de aceptación**',
    '- [x] Hecho',
    '- [ ] Pendiente uno',
    '* [ ] Pendiente dos',
    '',
    '**Pruebas**',
    '- [ ] No es un criterio de aceptación',
  ].join('\n');

  assert.deepEqual(findUncheckedCriteria(body), ['Pendiente uno', 'Pendiente dos']);
  assert.deepEqual(findUncheckedCriteria('**Pruebas**\n- [ ] Tampoco cuenta'), []);
});

test('syncIssueStatus: falla si un issue cerrado tiene criterios sin marcar', async () => {
  const target = parseRows(readFileSync(join(ROOT, TABLE_FILES[0]), 'utf8'))[0];
  const originalFetch = globalThis.fetch;
  const previousCwd = process.cwd();
  process.chdir(ROOT);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const issueNumber = Number(String(input).match(/\/issues\/(\d+)$/)?.[1]);
    const body =
      issueNumber === target.issue.number
        ? '**Criterios de aceptación**\n- [x] Hecho\n- [ ] Pendiente'
        : '**Criterios de aceptación**\n- [x] Hecho';
    return new Response(JSON.stringify({ state: 'closed', body }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => syncIssueStatus({ check: true, token: 'test' }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return (
          message.includes(target.id) &&
          message.includes('Pendiente') &&
          message.includes('criterios de aceptación sin marcar')
        );
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(previousCwd);
  }
});

test('las tablas reales tienen los mismos issues y son parseables', () => {
  const tables = TABLE_FILES.map((file) => ({
    file,
    rows: parseRows(readFileSync(join(ROOT, file), 'utf8')),
  }));

  assert.equal(tables.length, 2);
  for (const table of tables) {
    assert.equal(table.rows.length, 14, `${table.file} debe tener 14 issues F1`);
  }
  assert.deepEqual(
    tables[0].rows.map((parsed) => parsed.id),
    tables[1].rows.map((parsed) => parsed.id),
    'las dos tablas deben listar los mismos IDs'
  );
});
