import { describe, expect, test } from 'vitest';
import {
  buildNotRunTestEvidence,
  buildTestEvidence,
  buildVerificationEnvironment,
  captureVerificationEnvironment,
  isTestCommand,
  redactSecrets,
  tailText,
} from '../../src/artifacts/testEvidence';

const base = {
  command: 'npm test -- checkout',
  cwd: 'C:/tmp/checkout',
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_001_200,
};

describe('evidencia de tests', () => {
  test('exitCode 0 produce passed y conserva la duración', () => {
    const evidence = buildTestEvidence({ ...base, exitCode: 0 });
    expect(evidence).toMatchObject({
      status: 'passed',
      exitCode: 0,
      durationMs: 1_200,
      startedAt: base.startedAt,
      finishedAt: base.finishedAt,
    });
    expect(evidence.timedOut).toBeUndefined();
  });

  test('exitCode 1 sigue siendo failed, nunca passed', () => {
    const evidence = buildTestEvidence({
      ...base,
      exitCode: 1,
      stdout: '1 failing',
      stderr: 'AssertionError',
    });
    expect(evidence.status).toBe('failed');
    expect(evidence.exitCode).toBe(1);
    expect(evidence.stdoutTail).toContain('1 failing');
    expect(evidence.stderrTail).toContain('AssertionError');
  });

  test('sin ejecución queda not-run con exitCode null y duración 0', () => {
    const evidence = buildNotRunTestEvidence({
      command: 'npm test',
      cwd: '/tmp/x',
      startedAt: 100,
    });
    expect(evidence).toMatchObject({
      status: 'not-run',
      exitCode: null,
      durationMs: 0,
      startedAt: 100,
      finishedAt: 100,
    });
  });

  test('un timeout es failed y se distingue de un fallo normal', () => {
    const timeout = buildTestEvidence({ ...base, exitCode: 124, timedOut: true });
    const failure = buildTestEvidence({ ...base, exitCode: 1 });
    expect(timeout.status).toBe('failed');
    expect(timeout.timedOut).toBe(true);
    expect(failure.timedOut).toBeUndefined();
  });

  test('los tails conservan el final y quedan acotados', () => {
    const long = `${'A'.repeat(500)}FINAL`;
    const evidence = buildTestEvidence(
      { ...base, exitCode: 1, stdout: long, stderr: long },
      { maxTailChars: 80 }
    );
    expect(evidence.stdoutTail.length).toBeLessThanOrEqual(80);
    expect(evidence.stderrTail.length).toBeLessThanOrEqual(80);
    expect(evidence.stdoutTail).toContain('FINAL');
    expect(evidence.stdoutTail).toContain('caracteres omitidos');
  });

  test('redacta tokens del comando y de la salida', () => {
    const githubToken = `ghp_${'a'.repeat(30)}`;
    const npmToken = `npm_${'b'.repeat(24)}`;
    const evidence = buildTestEvidence({
      ...base,
      command: `npm test -- --token=supersecret ${githubToken}`,
      exitCode: 1,
      stdout: `token=supersecret\n${githubToken}\nBearer abcdefghijkl`,
      stderr: `npm_token=${npmToken}`,
    });

    const all = [
      evidence.command,
      evidence.stdoutTail,
      evidence.stderrTail,
    ].join('\n');
    expect(all).not.toContain('supersecret');
    expect(all).not.toContain(githubToken);
    expect(all).not.toContain(npmToken);
    expect(all).not.toContain('abcdefghijkl');
    expect(all).toContain('[REDACTED');
  });

  test('el id por defecto es estable para la misma corrida', () => {
    const first = buildTestEvidence({ ...base, exitCode: 0 });
    const second = buildTestEvidence({ ...base, exitCode: 0 });
    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^test-\d+-[0-9a-f]{8}$/);
  });

  test('tailText no devuelve más de lo pedido', () => {
    expect(tailText('x'.repeat(200), 50).length).toBeLessThanOrEqual(50);
    expect(tailText('corto', 50)).toBe('corto');
    expect(redactSecrets('token=secreto')).toBe('token=[REDACTED]');
  });

  test('redacta claves compuestas y cabeceras Basic', () => {
    expect(redactSecrets('OPENAI_API_KEY=super-secreto')).toBe(
      'OPENAI_API_KEY=[REDACTED]'
    );
    expect(redactSecrets('client_secret=super-secreto')).toBe(
      'client_secret=[REDACTED]'
    );
    expect(redactSecrets('access_token: super-secreto')).toBe(
      'access_token: [REDACTED]'
    );
    expect(redactSecrets('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toBe(
      'Authorization: Basic [REDACTED]'
    );
    expect(redactSecrets('Authorization: Bearer abcdefghijkl')).toBe(
      'Authorization: Bearer [REDACTED]'
    );
  });
});

describe('entorno de verificación', () => {
  test('acepta node, SO, commit y rama explícitos', () => {
    expect(
      buildVerificationEnvironment({
        node: 'v22.0.0',
        os: 'linux-x64',
        commit: 'abc123',
        branch: 'main',
      })
    ).toEqual({
      node: 'v22.0.0',
      os: 'linux-x64',
      commit: 'abc123',
      branch: 'main',
    });
  });

  test('captura Node/SO y tolera que git falle', async () => {
    const environment = await captureVerificationEnvironment(async () => ({
      commit: 'deadbee',
      branch: 'fix/tests',
    }));
    expect(environment.node).not.toBe('');
    expect(environment.os).not.toBe('');
    expect(environment.commit).toBe('deadbee');
    expect(environment.branch).toBe('fix/tests');

    const fallback = await captureVerificationEnvironment(async () => {
      throw new Error('no git');
    });
    expect(fallback.node).not.toBe('');
    expect(fallback.commit).toBeUndefined();
  });
});

describe('detección de comandos de tests', () => {
  test.each([
    'npm test',
    'npm run test',
    'npm run test:node -- tests/unit/testEvidence.test.ts',
    'npx vitest run tests/unit',
    'npx playwright test',
    'node --test tests/fixtures/x.mjs',
    'go test ./...',
  ])('reconoce %s', (command) => {
    expect(isTestCommand(command)).toBe(true);
  });

  test.each([
    'npm run build',
    'echo "npm test"',
    'tsc --noEmit',
    'git status',
  ])('no reconoce %s', (command) => {
    expect(isTestCommand(command)).toBe(false);
  });
});
