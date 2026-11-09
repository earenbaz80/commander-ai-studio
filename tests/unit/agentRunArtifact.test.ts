import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { AgentState, AgentStep } from '../../src/agent/types';
import type { VerificationTestEvidence } from '../../src/artifacts/types';
import {
  buildVerificationArtifactFromRun,
  persistVerificationArtifactFromRun,
} from '../../src/artifacts/fromAgentRun';
import { clearArtifacts, listArtifacts } from '../../src/artifacts/store';

const NOW = Date.UTC(2026, 10, 9, 18, 0, 0);
const PROJECT = 'C:/tmp/commander-run';

function evidence(overrides: Partial<VerificationTestEvidence> = {}): VerificationTestEvidence {
  return {
    id: 'test-1',
    command: 'npm test',
    cwd: PROJECT,
    status: 'passed',
    exitCode: 0,
    durationMs: 1_000,
    startedAt: NOW + 1_000,
    finishedAt: NOW + 2_000,
    stdoutTail: 'ok',
    stderrTail: '',
    ...overrides,
  };
}

function step(overrides: Partial<AgentStep>): AgentStep {
  return {
    id: 'step-1',
    type: 'thought',
    title: 'Inicio',
    content: 'Objetivo',
    status: 'completed',
    ts: NOW,
    ...overrides,
  };
}

function state(overrides: Partial<AgentState> = {}): AgentState {
  return {
    task: {
      id: 'task-run-1',
      goal: 'Corregir checkout',
      cwd: '.',
      maxSteps: 40,
    },
    plan: [
      { id: 'p1', text: 'Reproducir el fallo', done: true },
      { id: 'p2', text: 'Corregir el cálculo', done: false },
    ],
    steps: [
      step({ id: 'inicio', type: 'thought', title: 'Inicio', content: 'Objetivo' }),
      step({
        id: 'call-edit',
        type: 'tool_call',
        toolId: 'fs.edit',
        title: 'Llamando fs.edit',
        input: { path: 'src/checkout.ts' },
        status: 'completed',
        approval: {
          id: 'apr-1',
          decision: 'allow',
          reason: 'revisado',
          diff: '--- a/src/checkout.ts\n+++ b/src/checkout.ts\n@@ -1 +1 @@\n-const total = 2;\n+const total = 3;',
        },
      }),
      step({
        id: 'result-tests',
        type: 'tool_result',
        toolId: 'shell.run',
        title: 'shell.run OK',
        output: {
          ok: true,
          data: {
            stdout: 'ok',
            stderr: '',
            exitCode: 0,
            durationMs: 1_000,
            testEvidence: evidence(),
            environment: { node: 'v22.13.0', os: 'win32-x64' },
          },
        },
        status: 'completed',
      }),
      step({ id: 'fin', type: 'thought', title: 'Finalizado', content: 'Listo' }),
    ],
    thinking: false,
    running: false,
    ...overrides,
  };
}

beforeEach(async () => {
  await clearArtifacts();
});

afterEach(async () => {
  await clearArtifacts();
});

describe('productor de VerificationArtifact desde una corrida', () => {
  test('construye plan, tests, entorno, decisiones y diff reales', () => {
    const artifact = buildVerificationArtifactFromRun(state(), {
      projectPath: PROJECT,
      createdAt: NOW + 5_000,
    });

    expect(artifact).not.toBeNull();
    expect(artifact).toMatchObject({
      kind: 'verification',
      schemaVersion: 1,
      projectPath: PROJECT,
      sessionId: 'task-run-1',
      status: 'passed',
      title: 'Corregir checkout',
      createdAt: NOW + 5_000,
    });
    expect(artifact?.plan).toEqual([
      { id: 'p1', text: 'Reproducir el fallo', status: 'done', done: true },
      { id: 'p2', text: 'Corregir el cálculo', status: 'pending', done: false },
    ]);
    expect(artifact?.tests).toHaveLength(1);
    expect(artifact?.tests[0]).toMatchObject({ id: 'test-1', status: 'passed' });
    expect(artifact?.environment).toEqual({ node: 'v22.13.0', os: 'win32-x64' });
    expect(artifact?.decisions).toEqual([
      { stepId: 'call-edit', tool: 'fs.edit', decision: 'allow', reason: 'revisado' },
    ]);
    expect(artifact?.diff?.files).toEqual(['src/checkout.ts']);
    expect(artifact?.report?.format).toBe('markdown');
    expect(artifact?.report?.content).toContain('# Verificación — Corregir checkout');
  });

  test('un test fallido marca failed aunque la corrida haya terminado', () => {
    const base = state();
    const artifact = buildVerificationArtifactFromRun(
      {
        ...base,
        steps: base.steps.map((item) =>
          item.id === 'result-tests'
            ? {
                ...item,
                output: {
                  ok: true,
                  data: {
                    ...(item.output as any).data,
                    testEvidence: evidence({ status: 'failed', exitCode: 1 }),
                  },
                },
              }
            : item
        ),
      },
      { projectPath: PROJECT, createdAt: NOW + 5_000 }
    );

    expect(artifact?.status).toBe('failed');
  });

  test('un exitCode distinto de cero no se vuelve verde aunque el estado diga passed', () => {
    const base = state();
    const artifact = buildVerificationArtifactFromRun(
      {
        ...base,
        steps: base.steps.map((item) =>
          item.id === 'result-tests'
            ? {
                ...item,
                output: {
                  ok: true,
                  data: {
                    ...(item.output as any).data,
                    testEvidence: evidence({ status: 'passed', exitCode: 1 }),
                  },
                },
              }
            : item
        ),
      },
      { projectPath: PROJECT, createdAt: NOW + 5_000 }
    );

    expect(artifact?.status).toBe('failed');
  });

  test('una corrida detenida sin respuesta final queda incomplete', () => {
    const base = state();
    const artifact = buildVerificationArtifactFromRun(
      { ...base, steps: base.steps.filter((item) => item.id !== 'fin') },
      { projectPath: PROJECT, createdAt: NOW + 5_000 }
    );

    expect(artifact?.status).toBe('incomplete');
  });

  test('sin ejecución de tools no fabrica un artifact', () => {
    const artifact = buildVerificationArtifactFromRun(
      {
        ...state(),
        plan: [],
        steps: [step({ id: 'solo-respuesta', title: 'Finalizado', content: 'Hola' })],
      },
      { projectPath: PROJECT }
    );

    expect(artifact).toBeNull();
  });

  test('persiste el artifact y lo deja visible en el store del proyecto', async () => {
    const artifact = await persistVerificationArtifactFromRun({
      state: state(),
      projectPath: PROJECT,
      createdAt: NOW + 6_000,
    });

    expect(artifact).not.toBeNull();
    const stored = await listArtifacts(PROJECT);
    expect(stored.map((item) => item.id)).toContain(artifact?.id);
    expect(stored.find((item) => item.id === artifact?.id)).toMatchObject({
      kind: 'verification',
      sessionId: 'task-run-1',
    });
  });
});
