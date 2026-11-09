import { beforeEach, describe, expect, test } from 'vitest';
import { clearArtifacts, listArtifacts, saveArtifact } from '../../src/artifacts/store';
import {
  isBrowserRecordingArtifact,
  isVerificationArtifact,
  type ArtifactFrame,
  type BrowserRecordingArtifact,
  type VerificationArtifact,
} from '../../src/artifacts/types';

function makeFrame(): ArtifactFrame {
  return {
    seq: 1,
    ts: 1_000,
    atMs: 0,
    mimeType: 'image/jpeg',
    data: 'aGVsbG8=',
    width: 800,
    height: 600,
    url: 'https://app.test/',
    title: 'App',
  };
}

function makeBrowserArtifact(): BrowserRecordingArtifact {
  return {
    id: 'rec-1',
    kind: 'browser-recording',
    projectPath: 'C:/tmp/x',
    title: 'Checkout',
    createdAt: 1_700_000_000_000,
    durationMs: 1_400,
    sessionId: 's1',
    viewport: { width: 1280, height: 800 },
    frames: [makeFrame()],
    comments: [],
  };
}

function makeVerificationArtifact(): VerificationArtifact {
  return {
    id: 'ver-1',
    kind: 'verification',
    schemaVersion: 1,
    projectPath: 'C:/tmp/x',
    title: 'Verificación de checkout',
    createdAt: 1_700_000_000_000,
    sessionId: 's1',
    status: 'failed',
    plan: [
      {
        id: 'p1',
        text: 'Reproducir el fallo',
        status: 'done',
        done: true,
        files: ['src/checkout.ts'],
        criteria: 'test rojo',
      },
      {
        id: 'p2',
        text: 'Corregir el cálculo',
        status: 'in_progress',
        done: false,
      },
    ],
    decisions: [
      {
        stepId: 'step-1',
        tool: 'fs.edit',
        decision: 'allow',
        reason: 'cambio revisado',
      },
    ],
    diff: {
      patch: 'diff --git a/src/checkout.ts b/src/checkout.ts',
      files: ['src/checkout.ts'],
      base: 'main',
      head: 'fix/checkout',
    },
    tests: [
      {
        id: 't1',
        command: 'npm test -- checkout',
        cwd: 'C:/tmp/x',
        status: 'failed',
        exitCode: 1,
        durationMs: 1_200,
        startedAt: 1_700_000_000_100,
        finishedAt: 1_700_000_001_300,
        stdoutTail: '1 failing',
        stderrTail: 'AssertionError',
        timedOut: false,
      },
    ],
    browserRecordingId: 'rec-1',
    environment: {
      node: 'v22.0.0',
      os: 'win32',
      commit: 'abc123',
      branch: 'main',
    },
    report: {
      format: 'markdown',
      content: '# Verificación\n\nEl test falló.',
      generatedAt: 1_700_000_002_000,
    },
  };
}

describe('artifacts de verificación', () => {
  beforeEach(async () => {
    await clearArtifacts();
  });

  test('distingue grabaciones de artifacts de verificación', () => {
    const browser = makeBrowserArtifact();
    const verification = makeVerificationArtifact();

    expect(isBrowserRecordingArtifact(browser)).toBe(true);
    expect(isVerificationArtifact(browser)).toBe(false);
    expect(isBrowserRecordingArtifact(verification)).toBe(false);
    expect(isVerificationArtifact(verification)).toBe(true);
  });

  test('un VerificationArtifact sobrevive al store sin perder evidencia', async () => {
    const verification = makeVerificationArtifact();
    await saveArtifact(verification);

    const stored = await listArtifacts('C:/tmp/x');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(verification);
    expect(isVerificationArtifact(stored[0]!)).toBe(true);
  });

  test('el contrato conserva un fallo como fallo, no como aprobado', () => {
    const verification = makeVerificationArtifact();
    expect(verification.tests[0]).toMatchObject({
      status: 'failed',
      exitCode: 1,
      timedOut: false,
    });
  });

  test('la referencia conserva una sola copia de los frames', async () => {
    const browser = makeBrowserArtifact();
    const verification = makeVerificationArtifact();
    await saveArtifact(browser);
    await saveArtifact(verification);

    const stored = await listArtifacts('C:/tmp/x');
    expect(stored).toHaveLength(2);

    const recording = stored.find(isBrowserRecordingArtifact);
    const linked = stored.find(isVerificationArtifact);
    expect(linked?.browserRecordingId).toBe(recording?.id);
    expect(recording?.frames).toHaveLength(1);
    expect(linked).not.toHaveProperty('frames');
  });
});
