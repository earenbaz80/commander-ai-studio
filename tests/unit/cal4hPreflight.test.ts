import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contarListeners, verificarWorktree } from '../../scripts/cal4h-preflight';

function lineaNetstat(port: number, pid: number): string {
  return `  TCP    127.0.0.1:${port}         0.0.0.0:0              LISTENING       ${pid}`;
}

function crearRepo(): { dir: string; sha: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-cal4h-preflight-'));
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  git(['init', '--quiet']);
  git([
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--allow-empty',
    '--quiet',
    '-m',
    'init',
  ]);
  return { dir, sha: git(['rev-parse', 'HEAD']) };
}

describe('preflight CAL4H: listener del puerto exacto', () => {
  it('no cuenta :32830 como :3283 y conserva el PID del listener real', () => {
    const salida = [lineaNetstat(32830, 111), lineaNetstat(3283, 222)].join('\r\n');
    expect(contarListeners(salida, 3283)).toEqual({ count: 1, pids: ['222'] });
  });

  it('devuelve cero si el único listener parecido es :32830', () => {
    expect(contarListeners(lineaNetstat(32830, 111), 3283)).toEqual({ count: 0, pids: [] });
  });
});

describe('preflight CAL4H: worktree detached', () => {
  it('acepta HEAD detached en el commit pineado', () => {
    const { dir, sha } = crearRepo();
    try {
      execFileSync('git', ['checkout', '--detach', sha], {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(verificarWorktree(dir, sha)).toBe(`${sha.slice(0, 7)} (detached)`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rechaza una rama aunque apunte al commit pineado', () => {
    const { dir, sha } = crearRepo();
    try {
      expect(() => verificarWorktree(dir, sha)).toThrow(/no detached/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
