import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

/**
 * El recibo `G1-T10-11` transcribe a mano lo que el JSONL ya guarda. En una
 * revisión se quedó con denominadores de dos corridas cuando ya eran tres, y
 * nada fallaba: el texto se leía bien y las cifras no coincidían con el
 * registro. Este test cruza las dos fuentes para que una duración, un paso o un
 * check desincronizado rompa la suite.
 */
const receipt = fs.readFileSync(
  new URL('../../docs/parity/receipts/G1-T10-11-2026-11-21.md', import.meta.url),
  'utf8'
);
const records: T10Record[] = fs
  .readFileSync(new URL('../../evals/baseline-results.jsonl', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as T10Record)
  .filter((record) => record.taskId === 'T10');

interface T10Record {
  runId: string;
  subset?: boolean;
  ts: string;
  commit: string;
  dirty: boolean;
  taskId: string;
  passed: boolean;
  steps: number;
  toolCalls: number;
  durationMs: number;
  checks: Array<{ name: string; error?: string }>;
  stopReason: string;
  timedOut: boolean;
}

/** Las tres líneas que el recibo identifica: dos de `55fea5e` y una de `4c3eeec`. */
const receiptRuns = records
  .filter((record) => record.subset === true && ['55fea5e', '4c3eeec'].includes(record.commit))
  .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

function section(heading: string): string {
  const start = receipt.indexOf(heading);
  expect(start, `falta la sección ${heading}`).toBeGreaterThanOrEqual(0);
  const rest = receipt.slice(start + heading.length);
  return rest.split(/\r?\n## /)[0];
}

function table(sectionText: string): string[][] {
  return sectionText
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim().replace(/\*\*/g, '').replace(/`/g, ''))
    )
    .filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell)))
    .slice(1);
}

/** Agrupa los miles con espacio, como el recibo: 396 305. */
function ms(value: number): string {
  return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ms`;
}

function clock(date: Date): string {
  return [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

describe('recibo G1-T10-11 contra evals/baseline-results.jsonl', () => {
  it('las tres corridas del recibo son las tres líneas registradas', () => {
    expect(receiptRuns).toHaveLength(3);
    expect(receiptRuns.map((record) => record.runId)).toEqual(['T10-1', 'T10-2', 'T10-1']);
    expect(receiptRuns.filter((record) => record.commit === '55fea5e')).toHaveLength(2);
    expect(receiptRuns.filter((record) => record.commit === '4c3eeec')).toHaveLength(1);
    expect(receiptRuns.every((record) => record.dirty === false || record.commit === '4c3eeec')).toBe(
      true
    );
    expect(receiptRuns.some((record) => record.commit === '4c3eeec' && record.dirty)).toBe(true);
    expect(receiptRuns.every((record) => record.subset && !record.passed)).toBe(true);

    const rows = table(section('## 2. Corridas'));
    expect(rows.map((row) => row[0])).toEqual(['1', '2', '3']);
    expect(rows.map((row) => row[6])).toEqual(receiptRuns.map(() => 'completed'));

    const registro = table(section('## 1. Identificación')).find(
      (row) => row[0] === 'Registros'
    )?.[1];
    expect(registro).toContain('3 líneas');
    expect(registro).toContain('2 con commit: "55fea5e"');
    expect(registro).toContain('1 con "4c3eeec" y dirty: true');
  });

  it('duraciones, pasos, tools y tiempos salen del JSONL', () => {
    const rows = table(section('## 2. Corridas'));

    expect(rows.map((row) => row[3].replace(/\s+/g, ''))).toEqual(
      receiptRuns.map((record) => `${record.durationMs}ms`)
    );
    expect(rows.map((row) => Number(row[4]))).toEqual(receiptRuns.map((record) => record.steps));
    expect(rows.map((row) => Number(row[5]))).toEqual(
      receiptRuns.map((record) => record.toolCalls)
    );

    // El `ts` es de fin; el inicio es `ts − durationMs` y tiene que encadenar.
    rows.forEach((row, index) => {
      const end = new Date(receiptRuns[index].ts);
      expect(row[2]).toBe(clock(end));
      expect(row[1]).toBe(clock(new Date(end.getTime() - receiptRuns[index].durationMs)));
    });

    const durations = receiptRuns.map((record) => record.durationMs).sort((a, b) => a - b);
    const total = durations.reduce((sum, value) => sum + value, 0);
    const p50 = durations[Math.floor((durations.length - 1) / 2)];
    const passed = receiptRuns.filter((record) => record.passed).length;
    const timeouts = receiptRuns.filter((record) => record.timedOut).length;

    expect(receipt).toContain(`**${passed} \`passed\` de ${receiptRuns.length}.**`);
    expect(receipt).toContain(`p50 de duración **${ms(p50)}**`);
    expect(receipt).toContain(`**${timeouts} timeouts**`);
    expect(receipt).toContain(`total registrado **${ms(total)}**`);
  });

  it('los seis checks verdes y sus nombres coinciden', () => {
    const rows = table(section('## 3. Los seis `checks` de `runT10`'));
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row[1])).toEqual(receiptRuns[0].checks.map((check) => check.name));

    const verdes = rows.map((_, index) =>
      receiptRuns.filter((record) => !record.checks[index].error).length
    );
    expect(rows.map((row) => row[2])).toEqual(verdes.map((value) => `${value}/3`));
    expect(verdes).toEqual([3, 3, 0, 2, 3, 3]);

    const denegacion = rows[3];
    expect(denegacion[2]).toBe('2/3');
  });

  it('el acumulado de T10 y el 0/18 coinciden con el registro', () => {
    const subset = records.filter((record) => record.subset === true).length;
    const sinSubset = records.filter((record) => record.subset !== true).length;
    const passed = records.filter((record) => record.passed).length;

    expect(records).toHaveLength(18);
    expect(subset).toBe(12);
    expect(sinSubset).toBe(6);
    expect(passed).toBe(0);

    expect(receipt).toContain(`**0/${records.length}**`);
    expect(receipt).toContain(
      `${records.length} líneas \`T10\` en \`evals/baseline-results.jsonl\` (${sinSubset} sin`
    );
    expect(receipt).toContain(`\`subset\` y ${subset} con \`subset\`)`);
    expect(receipt).toContain(`**${passed} \`passed\`**`);
    expect(receipt).toContain('T10 sigue **`failed` 0/3**');
  });

  it('no quedan denominadores de dos corridas ni fracciones de otro tamaño', () => {
    expect(receipt).not.toMatch(/\b\d+\/2\b/);
    expect(receipt).not.toMatch(/las 2 corridas|de 2 corridas|\b0 de 2\b/);

    const checks = table(section('## 3. Los seis `checks` de `runT10`'));
    for (const row of checks) {
      const [green, total] = row[2].split('/').map(Number);
      expect(total).toBe(receiptRuns.length);
      expect(green).toBeLessThanOrEqual(total);
    }
  });
});
