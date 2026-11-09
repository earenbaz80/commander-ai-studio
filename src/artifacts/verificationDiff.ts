/**
 * Diff y decisiones de una sesión para el artifact de verificación (F2-03).
 *
 * El patch no se regenera: se toma de la solicitud de aprobación que la sesión
 * mostró al usuario. Las decisiones salen de `SessionStepV2.approval`, que es
 * lo que queda persistido en el estado. Si no hay un patch aprobado, el
 * artifact se queda sin diff en vez de inventar uno vacío.
 *
 * El llamador pasa las solicitudes que vio la corrida (`approval_request` del
 * SSE o `getPendingApprovals()`); este módulo no lee disco, no ejecuta tools y
 * no vuelve a comparar archivos.
 */
import type { ApprovalRequestV2, SessionStepV2 } from '../agent/sessionTypes';
import type {
  VerificationArtifact,
  VerificationDecision,
  VerificationDiff,
} from './types';

/** Lo mínimo que hace falta de una solicitud de aprobación. */
export type ApprovalPatchSource = Pick<ApprovalRequestV2, 'id' | 'tool' | 'diff'>;

export interface VerificationSectionsInput {
  /** Pasos de la sesión, en orden; de aquí salen las decisiones. */
  steps: readonly SessionStepV2[];
  /** Solicitudes de aprobación con su patch original (sin regenerar). */
  approvals?: readonly ApprovalPatchSource[];
  /** Metadatos opcionales de git; sólo se incluyen si vienen informados. */
  base?: string;
  head?: string;
}

export interface VerificationSections {
  decisions: VerificationDecision[];
  diff?: VerificationDiff;
}

function clip(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

/**
 * Convierte `step.approval` en decisiones revisables. Una aprobación produce
 * una sola entrada aunque el paso se haya reutilizado; las denegaciones se
 * conservan con su motivo.
 */
export function buildVerificationDecisions(
  steps: readonly SessionStepV2[]
): VerificationDecision[] {
  const decisions: VerificationDecision[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const approval = step.approval;
    if (!approval) continue;
    const key = approval.id || step.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = clip(approval.reason, 500);
    decisions.push({
      stepId: clip(step.id, 200),
      tool: clip(step.toolId || step.title, 200) || 'tool',
      decision: approval.decision,
      ...(reason ? { reason } : {}),
    });
  }
  return decisions;
}

/**
 * Extrae una ruta de workspace de una cabecera `---`/`+++`. Descarta
 * `/dev/null`, rutas absolutas y cualquier ruta que escape del proyecto.
 */
function patchPath(raw: string): string | null {
  let value = String(raw).split('\t')[0].trim();
  if (!value || value === '/dev/null') return null;
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  if (value.startsWith('a/') || value.startsWith('b/')) value = value.slice(2);
  value = value.replace(/\\/g, '/');
  if (!value || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return null;
  if (value.split('/').includes('..')) return null;
  return value;
}

/** Archivos que el patch declara, en el orden en que aparecen. */
export function filesFromVerificationPatch(patch: string): string[] {
  const files = new Set<string>();
  for (const line of String(patch ?? '').split(/\r?\n/)) {
    if (!line.startsWith('--- ') && !line.startsWith('+++ ')) continue;
    const file = patchPath(line.slice(4));
    if (file) files.add(file);
  }
  return [...files];
}

/**
 * Construye el diff aplicado de la corrida.
 *
 * Sólo entran aprobaciones `allow`/`allow-session` cuyo paso terminó
 * `completed`: una denegación o una tool fallida no cambia archivos. El patch
 * se conserva tal cual vino en la solicitud; varios cambios se concatenan.
 */
export function buildVerificationDiff(
  input: VerificationSectionsInput
): VerificationDiff | undefined {
  const approvals = new Map<string, ApprovalPatchSource>();
  for (const approval of input.approvals ?? []) {
    if (approval?.id && !approvals.has(approval.id)) approvals.set(approval.id, approval);
  }

  const patches: string[] = [];
  const seen = new Set<string>();
  for (const step of input.steps) {
    const recorded = step.approval;
    if (!recorded || recorded.decision === 'deny') continue;
    if (step.status !== 'completed') continue;
    if (seen.has(recorded.id)) continue;
    seen.add(recorded.id);
    const patch = approvals.get(recorded.id)?.diff;
    if (typeof patch !== 'string' || !patch.trim()) continue;
    patches.push(patch);
  }

  if (patches.length === 0) return undefined;
  const patch = patches.join('\n');
  const base = clip(input.base, 200);
  const head = clip(input.head, 200);
  return {
    patch,
    files: filesFromVerificationPatch(patch),
    ...(base ? { base } : {}),
    ...(head ? { head } : {}),
  };
}

export function buildVerificationSections(
  input: VerificationSectionsInput
): VerificationSections {
  const decisions = buildVerificationDecisions(input.steps);
  const diff = buildVerificationDiff(input);
  return { decisions, ...(diff ? { diff } : {}) };
}

/**
 * Aplica las secciones al artifact sin mutarlo. Un artifact sin cambios
 * pierde cualquier diff previo: no se conserva un parche que ya no
 * corresponde a esta corrida.
 */
export function withVerificationSections(
  artifact: VerificationArtifact,
  input: VerificationSectionsInput
): VerificationArtifact {
  const next: VerificationArtifact = {
    ...artifact,
    decisions: buildVerificationDecisions(input.steps),
  };
  const diff = buildVerificationDiff(input);
  if (diff) next.diff = diff;
  else delete next.diff;
  return next;
}
