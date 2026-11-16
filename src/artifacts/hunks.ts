/**
 * Revisión por hunk de un patch de verificación (F2-08).
 *
 * El patch no se regenera ni se reescribe: se parsea para saber qué hunks
 * contiene, qué aprobación los aplicó y qué decidió el usuario. Las decisiones
 * se guardan por id estable (archivo + rango), así que sobreviven a recargar la
 * app y a regenerar el artifact mientras los hunks sigan siendo los mismos.
 *
 * Este módulo no toca disco, ni red, ni el motor de aprobaciones: recibe el
 * patch aprobado y devuelve copias.
 */
import type { ApprovalDecision } from '../agent/sessionTypes';
import type {
  VerificationArtifact,
  VerificationDiff,
  VerificationHunk,
  VerificationHunkAttribution,
  VerificationHunkDecision,
  VerificationHunkReview,
  VerificationHunkReviewer,
} from './types';

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Extrae una ruta de workspace de una cabecera `---`/`+++`. Descarta
 * `/dev/null`, rutas absolutas y cualquier ruta que escape del proyecto.
 */
export function patchPathFromHeader(raw: string): string | null {
  let value = String(raw ?? '').split('\t')[0].trim();
  if (!value || value === '/dev/null') return null;
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  if (value.startsWith('a/') || value.startsWith('b/')) value = value.slice(2);
  value = value.replace(/\\/g, '/');
  if (!value || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return null;
  if (value.split('/').includes('..')) return null;
  return value;
}

function headerLines(value: string | undefined): number {
  if (value === undefined) return 1;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 1;
}

function isHunkBody(line: string): boolean {
  return (
    line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\')
  );
}

/**
 * Parsea un patch unificado en hunks con posición y rango de líneas.
 *
 * Un patch sin `@@` no produce hunks: no hay nada que revisar por partes.
 */
export function parseVerificationHunks(patch: string): VerificationHunk[] {
  const source = String(patch ?? '').split(/\r?\n/);
  const hunks: VerificationHunk[] = [];
  const occurrences = new Map<string, number>();
  let file = '';
  let minusHeader = '';
  let current: VerificationHunk | null = null;

  const close = (endLine: number) => {
    if (!current) return;
    current.endLine = Math.max(current.headerLine + 1, endLine);
    hunks.push(current);
    current = null;
  };

  for (let index = 0; index < source.length; index += 1) {
    const line = source[index];

    // Un `diff --git` cierra el hunk anterior aunque su última línea parezca
    // contenido: es el único separador de archivos en un patch concatenado.
    if (line.startsWith('diff --git ')) {
      close(index);
      file = '';
      minusHeader = '';
      continue;
    }

    if (current && isHunkBody(line)) {
      current.lines.push(line);
      continue;
    }

    const match = HUNK_HEADER.exec(line);
    if (match) {
      close(index);
      const oldStart = Number(match[1]);
      const key = `${file || 'archivo'}@${oldStart}`;
      const seen = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, seen);
      current = {
        id: seen === 1 ? key : `${key}#${seen}`,
        file: file || 'archivo',
        header: line.trim(),
        oldStart,
        oldLines: headerLines(match[2]),
        newStart: Number(match[3]),
        newLines: headerLines(match[4]),
        lines: [line],
        headerLine: index,
        endLine: source.length,
        decision: 'pending',
      };
      minusHeader = '';
      continue;
    }

    // Sólo fuera de un hunk una cabecera `---`/`+++` es cabecera: dentro, una
    // línea de contenido que empieza por `-`/`+` no debe cortar el bloque.
    if (!current && line.startsWith('--- ')) {
      minusHeader = line;
      continue;
    }
    if (!current && line.startsWith('+++ ')) {
      const parsed = patchPathFromHeader(line.slice(4)) ?? patchPathFromHeader(minusHeader.slice(4));
      if (parsed) file = parsed;
      minusHeader = '';
    }
  }
  close(source.length);

  return hunks;
}

export interface VerificationHunkSummary {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
}

export interface VerificationHunkState {
  hunks: VerificationHunk[];
  summary: VerificationHunkSummary;
}

function emptySummary(): VerificationHunkSummary {
  return { total: 0, accepted: 0, rejected: 0, pending: 0 };
}

/**
 * Deriva los hunks del patch y les aplica revisiones y atribuciones guardadas.
 * Es la única forma de leer el estado de revisión: no hay copia duplicada.
 */
export function applyHunkReviewState(diff?: VerificationDiff): VerificationHunkState {
  const hunks = parseVerificationHunks(diff?.patch ?? '');
  if (hunks.length === 0) return { hunks, summary: emptySummary() };

  const reviews = new Map<string, VerificationHunkReview>();
  for (const review of diff?.reviews ?? []) {
    if (review?.hunkId && !reviews.has(review.hunkId)) reviews.set(review.hunkId, review);
  }
  const attributions = new Map<string, VerificationHunkAttribution>();
  for (const attribution of diff?.attributions ?? []) {
    if (attribution?.hunkId && !attributions.has(attribution.hunkId)) {
      attributions.set(attribution.hunkId, attribution);
    }
  }

  for (const hunk of hunks) {
    const review = reviews.get(hunk.id);
    if (review) {
      hunk.decision = review.decision;
      hunk.reviewedBy = review.reviewedBy;
      hunk.reviewedAt = review.reviewedAt;
      if (review.note) hunk.note = review.note;
    }
    const attribution = attributions.get(hunk.id);
    if (attribution) {
      hunk.appliedBy = {
        stepId: attribution.stepId,
        tool: attribution.tool,
        decision: attribution.decision,
      };
    }
  }

  const summary = hunks.reduce(
    (acc, hunk) => {
      acc.total += 1;
      if (hunk.decision === 'accepted') acc.accepted += 1;
      else if (hunk.decision === 'rejected') acc.rejected += 1;
      else acc.pending += 1;
      return acc;
    },
    emptySummary()
  );

  return { hunks, summary };
}

export interface HunkReviewOptions {
  reviewedBy?: VerificationHunkReviewer;
  reviewedAt?: number;
  note?: string;
}

/**
 * Registra (o retira, con `pending`) la revisión de un hunk. Devuelve una copia
 * del artifact: el llamador decide cuándo persistirla.
 */
export function reviewVerificationHunk(
  artifact: VerificationArtifact,
  hunkId: string,
  decision: VerificationHunkDecision,
  options: HunkReviewOptions = {}
): VerificationArtifact {
  if (!artifact.diff || !hunkId) return artifact;

  const reviews = (artifact.diff.reviews ?? []).filter((review) => review.hunkId !== hunkId);
  if (decision !== 'pending') {
    const note = String(options.note ?? '').trim();
    reviews.push({
      hunkId,
      decision,
      reviewedBy: options.reviewedBy ?? 'user',
      reviewedAt: Number.isFinite(options.reviewedAt as number)
        ? (options.reviewedAt as number)
        : Date.now(),
      ...(note ? { note: note.slice(0, 500) } : {}),
    });
  }

  return { ...artifact, diff: { ...artifact.diff, reviews } };
}

/** Reconstruye el patch con los hunks aceptados y sus cabeceras originales. */
export function filterPatchByAcceptedHunks(
  patch: string,
  acceptedHunkIds: readonly string[]
): string {
  const hunks = parseVerificationHunks(patch);
  if (hunks.length === 0) return '';
  const accepted = new Set(acceptedHunkIds);
  const acceptedFiles = new Set(
    hunks.filter((hunk) => accepted.has(hunk.id)).map((hunk) => hunk.file)
  );
  if (acceptedFiles.size === 0) return '';

  const lines = String(patch ?? '').split(/\r?\n/);
  const hunkAt = new Map<number, VerificationHunk>();
  for (const hunk of hunks) hunkAt.set(hunk.headerLine, hunk);

  const out: string[] = [];
  let blockFile = '';
  let header: string[] = [];

  const flushHeader = () => {
    if (header.length && blockFile && acceptedFiles.has(blockFile)) out.push(...header);
    header = [];
  };
  const resolveFile = (from: number): string => {
    for (let probe = from; probe < lines.length; probe += 1) {
      if (lines[probe].startsWith('+++ ')) {
        const parsed = patchPathFromHeader(lines[probe].slice(4));
        if (parsed) return parsed;
      }
      if (HUNK_HEADER.test(lines[probe])) break;
    }
    const nextHunk = hunks.find((hunk) => hunk.headerLine >= from);
    return nextHunk?.file ?? '';
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (hunkAt.has(index)) {
      const hunk = hunkAt.get(index) as VerificationHunk;
      if (!blockFile) blockFile = hunk.file;
      flushHeader();
      if (accepted.has(hunk.id)) out.push(...hunk.lines);
      continue;
    }

    if (line.startsWith('diff --git ')) {
      flushHeader();
      blockFile = resolveFile(index);
      header.push(line);
      continue;
    }
    if (line.startsWith('--- ')) {
      const parsed = patchPathFromHeader(line.slice(4));
      if (parsed) blockFile = parsed;
      header.push(line);
      continue;
    }
    if (/^(index |\+\+\+ |new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files )/.test(line)) {
      header.push(line);
      continue;
    }
    if (line === '') {
      flushHeader();
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
  }
  flushHeader();

  // Sin `trim()`: una línea de contexto puede terminar en espacios y el patch
  // exportado debe conservarla tal cual.
  return out.join('\n').replace(/\n+$/, '');
}

/** Aprobación mínima para atribuir hunks; sale del patch ya aprobado. */
export interface HunkAttributionSource {
  patch: string;
  stepId: string;
  tool: string;
  decision: ApprovalDecision;
}

/**
 * Atribuye cada hunk del patch concatenado a la aprobación que lo aportó.
 *
 * El patch final se forma concatenando los patches aprobados en orden, así que
 * el hunk N del patch completo pertenece a la misma fuente que el hunk N de esa
 * fuente. No se inventa atribución: una fuente sin hunks no aporta nada.
 */
export function attributeHunks(
  patch: string,
  sources: readonly HunkAttributionSource[]
): VerificationHunkAttribution[] {
  const all = parseVerificationHunks(patch);
  if (all.length === 0) return [];

  const attributions: VerificationHunkAttribution[] = [];
  let cursor = 0;
  for (const source of sources) {
    const count = parseVerificationHunks(source.patch).length;
    for (let offset = 0; offset < count && cursor < all.length; offset += 1) {
      attributions.push({
        hunkId: all[cursor].id,
        stepId: source.stepId,
        tool: source.tool,
        decision: source.decision,
      });
      cursor += 1;
    }
  }
  return attributions;
}

/** Conserva sólo las revisiones cuyos hunks siguen existiendo en el patch. */
export function carryHunkReviews(
  patch: string,
  reviews: readonly VerificationHunkReview[]
): VerificationHunkReview[] {
  const ids = new Set(parseVerificationHunks(patch).map((hunk) => hunk.id));
  return reviews.filter((review) => ids.has(review.hunkId));
}
