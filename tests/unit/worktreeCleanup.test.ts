import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorktree, listWorktrees, removeWorktree, removeWorktreeSafe } from '../../worktrees.js';

const dirs: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'WT-'));
  dirs.push(dir);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('limpieza de worktrees', () => {
  it('quita el worktree y su registro en el camino normal', () => {
    const dir = makeRepo();
    const wt = createWorktree('sub_aaa111', dir);
    fs.writeFileSync(path.join(wt.worktreePath, 'hijo-a.txt'), 'a');
    expect(listWorktrees(dir)).toHaveLength(2);

    const result = removeWorktreeSafe(wt.worktreePath, dir, true, wt.branch);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.cause).toBeUndefined();
    expect(listWorktrees(dir)).toHaveLength(1);
    expect(fs.existsSync(wt.worktreePath)).toBe(false);
  });

  it('poda y verifica cuando el directorio ya no existe pero el registro sigue', () => {
    const dir = makeRepo();
    const wt = createWorktree('sub_bbb222', dir);
    // Así llegó T10-3 al check 6: directorio ausente, entrada `prunable` viva.
    fs.rmSync(wt.worktreePath, { recursive: true, force: true });
    expect(listWorktrees(dir)).toHaveLength(2);

    const result = removeWorktreeSafe(wt.worktreePath, dir, true, wt.branch);

    expect(result.ok).toBe(true);
    expect(listWorktrees(dir)).toHaveLength(1);
  });

  it('conserva el motivo cuando git worktree remove falla a medias y la poda recupera', () => {
    const dir = makeRepo();
    const wt = createWorktree('sub_eee555', dir);
    // Reproduce el fallo parcial de `git worktree remove`: borra el directorio
    // y después no puede eliminar `.git/worktrees/<id>`, así que la entrada
    // queda viva como `prunable`. Ese es el estado que llegó a T10-3.
    const run = (cwd: string, args: string[]): string => {
      if (args[0] === 'worktree' && args[1] === 'remove') {
        fs.rmSync(wt.worktreePath, { recursive: true, force: true });
        throw Object.assign(new Error('fallo parcial'), {
          stderr: 'fatal: could not delete .git/worktrees/sub_eee555: Permission denied',
        });
      }
      return git(cwd, args);
    };

    const result = removeWorktreeSafe(wt.worktreePath, dir, true, wt.branch, run);

    expect(result.ok).toBe(true);
    expect(result.recovered).toBe(true);
    expect(result.cause).toContain('Permission denied');
    // `error` sigue reservado para los fallos que no se pudieron resolver.
    expect(result.error).toBeUndefined();
    expect(listWorktrees(dir)).toHaveLength(1);
  });

  it('con un fallo inyectado devuelve ok:false y el motivo, sin lanzar', () => {
    const dir = makeRepo();
    const wt = createWorktree('sub_ccc333', dir);
    const proyectoInexistente = path.join(dir, 'no-es-un-repo');

    const result = removeWorktreeSafe(wt.worktreePath, proyectoInexistente, true, wt.branch);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.recovered).toBe(true);
    // El fallback igual retira el directorio: no deja basura aunque no pueda verificar.
    expect(fs.existsSync(wt.worktreePath)).toBe(false);
  });

  it('la API clásica sigue lanzando si la limpieza no se pudo verificar', () => {
    const dir = makeRepo();
    const wt = createWorktree('sub_ddd444', dir);
    const proyectoInexistente = path.join(dir, 'no-es-un-repo');

    expect(() => removeWorktree(wt.worktreePath, proyectoInexistente, true, wt.branch)).toThrow();
  });
});
