import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abandonedRunWarning, armRun, disarmRun, readAbandonedRun } from '../../evals/runMarker';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-marker-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('marca de corrida en curso', () => {
  it('deja la marca al empezar y la borra al registrar el resultado', () => {
    const dir = tmpDir();
    armRun({ runId: 'T10-1', taskId: 'T10', run: 1, pid: 4242, startedAt: '2026-11-21T08:15:20.000Z' }, dir);
    expect(readAbandonedRun(dir)?.runId).toBe('T10-1');
    disarmRun(dir);
    expect(readAbandonedRun(dir)).toBeNull();
  });

  it('si el runner muere, la marca sobrevive y explica qué corrida quedó a medias', () => {
    const dir = tmpDir();
    armRun({ runId: 'T10-2', taskId: 'T10', run: 2, pid: 4242, startedAt: '2026-11-21T08:16:34.455Z' }, dir);

    const marker = readAbandonedRun(dir);
    const warning = abandonedRunWarning(marker);

    expect(marker).toMatchObject({ runId: 'T10-2', pid: 4242 });
    expect(warning).toMatch(/T10-2 quedó a medias/);
    expect(warning).toMatch(/pid 4242/);
    expect(warning).toMatch(/sin traza de JS/);
  });

  it('sin marca no hay advertencia ni lectura', () => {
    const dir = tmpDir();
    expect(readAbandonedRun(dir)).toBeNull();
    expect(abandonedRunWarning(null)).toBeNull();
  });
});
