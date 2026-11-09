/**
 * Artefactos locales del workspace.
 *
 * Una grabación de navegador es una secuencia de frames JPEG con sus
 * timestamps. No es un vídeo codificado: el visor reproduce los frames reales
 * que entregó Playwright y ancla los comentarios a un instante y a una posición
 * normalizada dentro del fotograma.
 *
 * Un artifact de verificación es el sobre revisable de una corrida: plan,
 * decisiones, diff, evidencia de tests, referencia a la grabación y entorno.
 * No duplica los frames de la grabación; la referencia por id evita dos copias
 * del mismo contenido.
 */
import type { ApprovalDecision, SessionPlanItemV2 } from '../agent/sessionTypes';

export interface ArtifactFrame {
  seq: number;
  /** Marca de tiempo original del servidor. */
  ts: number;
  /** Milisegundos desde el primer frame de la grabación. */
  atMs: number;
  mimeType: 'image/jpeg';
  data: string;
  width: number;
  height: number;
  url: string;
  title: string;
}

export interface ArtifactComment {
  id: string;
  /** Milisegundos desde el inicio de la grabación. */
  atMs: number;
  /** Posición horizontal normalizada (0..1) dentro del fotograma. */
  x: number;
  /** Posición vertical normalizada (0..1) dentro del fotograma. */
  y: number;
  body: string;
  author: string;
  createdAt: number;
  resolved: boolean;
}

export interface BrowserRecordingArtifact {
  id: string;
  kind: 'browser-recording';
  projectPath: string;
  title: string;
  createdAt: number;
  durationMs: number;
  sessionId: string;
  viewport: { width: number; height: number };
  frames: ArtifactFrame[];
  comments: ArtifactComment[];
}

/** Resultado global de la corrida que produjo el artifact. */
export type VerificationStatus = 'passed' | 'failed' | 'incomplete';

/** Decisión de aprobación que quedó registrada en la sesión. */
export interface VerificationDecision {
  stepId: string;
  tool: string;
  decision: ApprovalDecision;
  reason?: string;
}

/** Diff revisable; el patch completo se conserva para exportarlo. */
export interface VerificationDiff {
  /** Patch unificado original de la aprobación; el informe no lo regenera. */
  patch: string;
  files: string[];
  base?: string;
  head?: string;
}

export type VerificationTestStatus = 'passed' | 'failed' | 'not-run';

/**
 * Evidencia de un comando de tests.
 *
 * `exitCode` es `null` cuando el comando no llegó a ejecutarse; ese caso no
 * puede pintarse como aprobado. Los tails están acotados por el productor para
 * no convertir el artifact en un volcado de consola.
 */
export interface VerificationTestEvidence {
  id: string;
  command: string;
  cwd: string;
  status: VerificationTestStatus;
  exitCode: number | null;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
  stdoutTail: string;
  stderrTail: string;
  timedOut?: boolean;
}

export interface VerificationEnvironment {
  node: string;
  os: string;
  commit?: string;
  branch?: string;
}

export interface VerificationReport {
  format: 'markdown' | 'html';
  content: string;
  generatedAt: number;
}

/**
 * Artefacto de verificación de una sesión.
 *
 * `schemaVersion` permite evolucionar la forma sin confundir artifacts viejos
 * con nuevos. La grabación se referencia por id: sus frames siguen viviendo en
 * su propio artifact.
 */
export interface VerificationArtifact {
  id: string;
  kind: 'verification';
  schemaVersion: 1;
  projectPath: string;
  title: string;
  createdAt: number;
  sessionId: string;
  status: VerificationStatus;
  plan: SessionPlanItemV2[];
  decisions: VerificationDecision[];
  diff?: VerificationDiff;
  tests: VerificationTestEvidence[];
  browserRecordingId?: string;
  environment: VerificationEnvironment;
  report?: VerificationReport;
}

export type Artifact = BrowserRecordingArtifact | VerificationArtifact;

export function isBrowserRecordingArtifact(
  artifact: Artifact
): artifact is BrowserRecordingArtifact {
  return artifact.kind === 'browser-recording';
}

export function isVerificationArtifact(artifact: Artifact): artifact is VerificationArtifact {
  return artifact.kind === 'verification';
}
