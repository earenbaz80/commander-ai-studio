/**
 * Productor real de `VerificationArtifact` para una corrida del agente.
 *
 * La corrida que ejecuta la UI vive en `useAgent`/`AgentOrchestrator`, no en
 * `AgentSession` del servidor. Este módulo traduce el `AgentState` local a las
 * piezas que ya consumen F2-02/F2-03/F2-04: evidencia de tests, decisiones y
 * diff de aprobaciones, plan e informe.
 *
 * Es puro salvo la persistencia final (`persistVerificationArtifactFromRun`):
 * no ejecuta tools ni vuelve a comparar archivos. El patch sale de la
 * aprobación que el usuario revisó en el modal.
 */
import type { AgentState, AgentStep } from '../agent/types';
import type { SessionPlanItemV2, SessionStepV2 } from '../agent/sessionTypes';
import type { ShellRunOutput } from '../agent/tools/shell';
import type {
  VerificationArtifact,
  VerificationEnvironment,
  VerificationStatus,
  VerificationTestEvidence,
} from './types';
import {
  buildVerificationEnvironment,
  redactSecrets,
} from './testEvidence';
import {
  buildVerificationSections,
  type ApprovalPatchSource,
} from './verificationDiff';
import { withVerificationReport } from './report';
import { newArtifactId } from './utils';
import { saveArtifact } from './store';

export interface BuildVerificationArtifactOptions {
  /** Raíz del proyecto activo al arrancar la corrida. */
  projectPath?: string;
  createdAt?: number;
  /** Título explícito; por defecto sale del objetivo. */
  title?: string;
  browserRecordingId?: string;
}

export interface PersistVerificationArtifactOptions
  extends BuildVerificationArtifactOptions {
  /** La grabación se abre sola al terminar; una verificación no debe hacerlo. */
  open?: boolean;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clip(value: unknown, max: number): string {
  return redactSecrets(String(value ?? '').trim()).slice(0, max);
}

function toSessionStep(step: AgentStep): SessionStepV2 {
  return {
    id: step.id,
    type: step.type,
    toolId: step.toolId,
    title: step.title,
    content: step.content,
    input: step.input,
    output: step.output,
    status: step.status,
    durationMs: step.durationMs,
    ts: step.ts,
    ...(step.approval
      ? {
          approval: {
            id: step.approval.id,
            decision: step.approval.decision,
            ...(step.approval.reason ? { reason: step.approval.reason } : {}),
          },
        }
      : {}),
  };
}

function toSessionPlan(plan: AgentState['plan']): SessionPlanItemV2[] {
  return (plan ?? []).map((item) => ({
    id: String(item.id),
    text: clip(item.text, 500),
    status: item.done ? 'done' : 'pending',
    done: Boolean(item.done),
  }));
}

/** El resultado real de `shell.run` puede venir envuelto en `{ok, data}`. */
function shellOutput(step: AgentStep): ShellRunOutput | null {
  if (step.type !== 'tool_result' || step.toolId !== 'shell.run') return null;
  const raw = step.output as any;
  if (!raw || typeof raw !== 'object') return null;
  const data = raw.data && typeof raw.data === 'object' ? raw.data : raw;
  if (!data || typeof data !== 'object') return null;
  return data as ShellRunOutput;
}

function testEvidence(value: unknown): VerificationTestEvidence | null {
  if (!value || typeof value !== 'object') return null;
  const evidence = value as Partial<VerificationTestEvidence>;
  if (typeof evidence.id !== 'string' || !evidence.id.trim()) return null;
  if (typeof evidence.command !== 'string') return null;
  if (
    evidence.status !== 'passed' &&
    evidence.status !== 'failed' &&
    evidence.status !== 'not-run'
  ) {
    return null;
  }
  return evidence as VerificationTestEvidence;
}

function approvalsFor(steps: readonly AgentStep[]): ApprovalPatchSource[] {
  const approvals: ApprovalPatchSource[] = [];
  for (const step of steps) {
    const diff = step.approval?.diff;
    if (!step.approval || typeof diff !== 'string' || !diff.trim()) continue;
    approvals.push({
      id: step.approval.id,
      tool: String(step.toolId ?? step.title),
      diff,
    });
  }
  return approvals;
}

function hasFinalAnswer(steps: readonly AgentStep[]): boolean {
  return steps.some(
    (step) => step.type === 'thought' && step.title.trim().toLowerCase() === 'finalizado'
  );
}

/**
 * Construye el artifact de una corrida cerrada.
 *
 * Devuelve `null` cuando la corrida no intentó ninguna tool: una respuesta
 * conversacional sin plan ni ejecución no es evidencia de verificación.
 */
export function buildVerificationArtifactFromRun(
  state: AgentState,
  options: BuildVerificationArtifactOptions = {}
): VerificationArtifact | null {
  if (!state.task) return null;

  const steps = Array.isArray(state.steps) ? state.steps : [];
  const attemptedExecution = steps.some(
    (step) => step.type === 'tool_call' || step.type === 'tool_result'
  );
  if (!attemptedExecution) return null;

  const sessionSteps = steps.map(toSessionStep);
  const outputs = steps
    .map(shellOutput)
    .filter((output): output is ShellRunOutput => output !== null);
  const tests: VerificationTestEvidence[] = [];
  const seenTests = new Set<string>();
  for (const output of outputs) {
    const evidence = testEvidence(output.testEvidence);
    if (!evidence || seenTests.has(evidence.id)) continue;
    seenTests.add(evidence.id);
    tests.push(evidence);
  }

  let environment: VerificationEnvironment = buildVerificationEnvironment();
  for (const output of outputs) {
    if (output.environment) environment = buildVerificationEnvironment(output.environment);
  }

  const sections = buildVerificationSections({
    steps: sessionSteps,
    approvals: approvalsFor(steps),
  });

  const failedTest = tests.some(
    (test) =>
      test.status === 'failed' ||
      test.timedOut === true ||
      (test.exitCode !== null && test.exitCode !== 0)
  );
  const passed =
    !failedTest &&
    hasFinalAnswer(steps) &&
    tests.length > 0 &&
    tests.every((test) => test.status === 'passed' && test.exitCode === 0);
  const status: VerificationStatus = failedTest ? 'failed' : passed ? 'passed' : 'incomplete';

  const createdAt = finite(options.createdAt) ?? Date.now();
  const projectPath = String(options.projectPath || state.task.cwd || '.').trim() || '.';
  const goal = clip(state.task.goal, 120).replace(/\s+/g, ' ');
  const title = clip(options.title || goal || 'Corrida del agente', 160);

  const artifact: VerificationArtifact = {
    id: newArtifactId('verification'),
    kind: 'verification',
    schemaVersion: 1,
    projectPath,
    title,
    createdAt,
    sessionId: state.task.id,
    status,
    plan: toSessionPlan(state.plan ?? []),
    decisions: sections.decisions,
    ...(sections.diff ? { diff: sections.diff } : {}),
    tests,
    ...(options.browserRecordingId
      ? { browserRecordingId: options.browserRecordingId }
      : {}),
    environment,
  };

  return withVerificationReport(artifact, {
    format: 'markdown',
    generatedAt: createdAt,
  });
}

/**
 * Construye y guarda el artifact en IndexedDB (o en el fallback en memoria).
 * Devuelve `null` si la corrida no produjo evidencia que merezca un artifact.
 */
export async function persistVerificationArtifactFromRun(
  options: PersistVerificationArtifactOptions & { state: AgentState }
): Promise<VerificationArtifact | null> {
  const artifact = buildVerificationArtifactFromRun(options.state, options);
  if (!artifact) return null;

  await saveArtifact(artifact);

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('commander:artifact-created', {
        detail: { id: artifact.id, open: options.open === true },
      })
    );
  }

  return artifact;
}
