/**
 * Marca de corrida en curso.
 *
 * Dos veces (2026-11-21) el runner de T10 murió con código 1 a mitad de una
 * corrida, sin traza de JS y sin línea en el JSONL. La marca se escribe antes
 * de cada corrida y se borra al registrar el resultado: si el runner muere,
 * queda en disco y la siguiente ejecución dice qué corrida quedó a medias y
 * con qué pid. No explica la causa, pero convierte un hueco silencioso en un
 * diagnóstico con nombre, hora y proceso.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface RunMarker {
  runId: string;
  taskId: string;
  run: number;
  pid: number;
  startedAt: string;
}

/** Ruta por defecto: `evals/traces/`, ignorada por git como los volcados. */
export const DEFAULT_MARKER_DIR = path.join(process.cwd(), 'evals', 'traces');

function markerPath(dir: string): string {
  return path.join(dir, 'runner-en-curso.json');
}

/** Deja constancia de la corrida que empieza. */
export function armRun(marker: RunMarker, dir = DEFAULT_MARKER_DIR): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(markerPath(dir), JSON.stringify(marker, null, 2), 'utf8');
}

/** La corrida terminó y su resultado ya está en el JSONL. */
export function disarmRun(dir = DEFAULT_MARKER_DIR): void {
  try {
    fs.rmSync(markerPath(dir), { force: true });
  } catch {
    /* si no se puede borrar, la próxima ejecución avisará de una marca vieja */
  }
}

/** ¿Quedó una corrida sin cerrar? Devuelve su marca o `null`. */
export function readAbandonedRun(dir = DEFAULT_MARKER_DIR): RunMarker | null {
  try {
    const raw = fs.readFileSync(markerPath(dir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.runId !== 'string' || typeof parsed.pid !== 'number') return null;
    return parsed as RunMarker;
  } catch {
    return null;
  }
}

/** Texto para la advertencia de arranque; `null` si no hay nada que contar. */
export function abandonedRunWarning(marker: RunMarker | null): string | null {
  if (!marker) return null;
  return (
    `⚠ la corrida ${marker.runId} quedó a medias: el runner anterior (pid ${marker.pid}) ` +
    `murió sin cerrarla (inicio ${marker.startedAt}). Esa corrida no tiene línea en el JSONL; ` +
    'el proceso terminó sin traza de JS, así que se registra como aborto, no como resultado.'
  );
}
