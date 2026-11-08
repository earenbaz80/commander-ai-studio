/**
 * Artefactos locales del workspace.
 *
 * Una grabación de navegador es una secuencia de frames JPEG con sus
 * timestamps. No es un vídeo codificado: el visor reproduce los frames reales
 * que entregó Playwright y ancla los comentarios a un instante y a una posición
 * normalizada dentro del fotograma.
 */

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

/** Tipos futuros (capturas, diffs, logs) se suman a esta unión. */
export type Artifact = BrowserRecordingArtifact;
