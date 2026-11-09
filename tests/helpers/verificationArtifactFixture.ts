/**
 * Fixture F2-07: artifact de verificación determinista.
 *
 * Simula el guion de un proveedor falso con dos tools (una aprobada y una
 * denegada), pero no levanta HTTP ni llama a ningún modelo. El artifact se
 * construye con las funciones reales de F2-02 (evidencia), F2-03 (decisiones y
 * diff) y F2-04 (informe), para que el E2E no pruebe una forma inventada.
 */
import type { SessionStepV2 } from '../../src/agent/sessionTypes';
import { withVerificationReport } from '../../src/artifacts/report';
import {
  buildNotRunTestEvidence,
  buildTestEvidence,
  buildVerificationEnvironment,
  DEFAULT_TAIL_CHARS,
} from '../../src/artifacts/testEvidence';
import {
  buildVerificationSections,
  type ApprovalPatchSource,
} from '../../src/artifacts/verificationDiff';
import type {
  BrowserRecordingArtifact,
  VerificationArtifact,
} from '../../src/artifacts/types';

export const FIXTURE_NOW = Date.UTC(2026, 10, 9, 15, 0, 0);
export const FIXTURE_SESSION_ID = 'session-e2e-f2-07';
export const FIXTURE_PROJECT_PATH = 'C:/tmp/commander-f2-07';
export const FIXTURE_RECORDING_ID = 'recording-e2e-f2-07';
export const FIXTURE_VERIFICATION_ID = 'verification-e2e-f2-07';
export const FIXTURE_FAILED_TEST_ID = 'e2e-failed';
export const FIXTURE_NOT_RUN_TEST_ID = 'e2e-not-run';
export const FIXTURE_VERIFICATION_TITLE = 'Verificación E2E checkout';
export const FIXTURE_RECORDING_TITLE = 'Checkout roto (grabación E2E)';

/** Token señuelo: sólo se usa para comprobar que la evidencia lo redacta. */
export const FIXTURE_SECRET = `ghp_${'a'.repeat(30)}`;

/** Guion fijo que haría un proveedor falso; no se ejecuta ninguna tool real. */
const FAKE_PROVIDER_SCRIPT = [
  { tool: 'fs.edit', args: { path: 'src/checkout.ts' } },
  { tool: 'shell.run', args: { command: 'npm test -- checkout' } },
] as const;

/** JPEG 1×1 válido para que el visor pueda pintar el frame sin red. */
const TINY_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

function scriptedSteps(): SessionStepV2[] {
  return FAKE_PROVIDER_SCRIPT.map((call, index) => ({
    id: `step-${index + 1}`,
    type: 'tool_call',
    toolId: call.tool,
    title: call.tool === 'fs.edit' ? 'Editar checkout' : 'Ejecutar tests',
    content:
      call.tool === 'fs.edit'
        ? 'Aplicar el cambio de total.'
        : 'Correr la suite de checkout.',
    input: call.args,
    status: index === 0 ? 'completed' : 'failed',
    ts: FIXTURE_NOW + index * 1_000,
    approval:
      index === 0
        ? { id: 'approval-1', decision: 'allow', reason: 'cambio revisado' }
        : { id: 'approval-2', decision: 'deny', reason: 'sin permiso' },
  }));
}

export interface VerificationArtifactFixture {
  verification: VerificationArtifact;
  recording: BrowserRecordingArtifact;
}

export function buildVerificationArtifactFixture(): VerificationArtifactFixture {
  const steps = scriptedSteps();
  const approvals: ApprovalPatchSource[] = [
    {
      id: 'approval-1',
      tool: 'fs.edit',
      diff: '--- a/src/checkout.ts\n+++ b/src/checkout.ts\n@@ -1 +1 @@\n-export const total = 2;\n+export const total = 3;',
    },
    {
      id: 'approval-2',
      tool: 'shell.run',
      // Esta aprobación fue denegada: su patch no debe acabar en el artifact.
      diff: '--- a/src/checkout.ts\n+++ b/src/checkout.ts\n@@ -1 +1 @@\n-export const total = 3;\n+export const total = 4;',
    },
  ];
  const sections = buildVerificationSections({
    steps,
    approvals,
    base: 'main',
    head: 'fix/checkout',
  });

  const failed = buildTestEvidence({
    id: FIXTURE_FAILED_TEST_ID,
    command: 'npm test -- checkout',
    cwd: FIXTURE_PROJECT_PATH,
    exitCode: 1,
    startedAt: FIXTURE_NOW + 1_000,
    durationMs: 1_200,
    stdout: `${'x'.repeat(DEFAULT_TAIL_CHARS + 2_000)}\nAssertionError: expected 2 to be 3`,
    stderr: `fatal: no se pudo autenticar con Bearer ${FIXTURE_SECRET}\nAssertionError: expected 2 to be 3`,
  });
  const notRun = buildNotRunTestEvidence({
    id: FIXTURE_NOT_RUN_TEST_ID,
    command: 'npm test -- smoke',
    cwd: FIXTURE_PROJECT_PATH,
    startedAt: FIXTURE_NOW + 3_000,
  });

  const verificationBase: VerificationArtifact = {
    id: FIXTURE_VERIFICATION_ID,
    kind: 'verification',
    schemaVersion: 1,
    projectPath: FIXTURE_PROJECT_PATH,
    title: FIXTURE_VERIFICATION_TITLE,
    createdAt: FIXTURE_NOW + 5_000,
    sessionId: FIXTURE_SESSION_ID,
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
    decisions: sections.decisions,
    diff: sections.diff,
    tests: [failed, notRun],
    browserRecordingId: FIXTURE_RECORDING_ID,
    environment: buildVerificationEnvironment({
      node: 'v22.13.0',
      os: 'win32-x64',
      commit: 'abc1234',
      branch: 'fix/checkout',
    }),
  };
  const verification = withVerificationReport(verificationBase, {
    format: 'markdown',
    generatedAt: FIXTURE_NOW + 6_000,
  });

  const recording: BrowserRecordingArtifact = {
    id: FIXTURE_RECORDING_ID,
    kind: 'browser-recording',
    projectPath: FIXTURE_PROJECT_PATH,
    title: FIXTURE_RECORDING_TITLE,
    createdAt: FIXTURE_NOW + 4_000,
    durationMs: 0,
    sessionId: FIXTURE_SESSION_ID,
    viewport: { width: 1280, height: 800 },
    frames: [
      {
        seq: 1,
        ts: FIXTURE_NOW,
        atMs: 0,
        mimeType: 'image/jpeg',
        data: TINY_JPEG,
        width: 1,
        height: 1,
        url: 'about:blank',
        title: 'Checkout E2E',
      },
    ],
    comments: [],
  };

  return { verification, recording };
}
