/**
 * Captura una sesión de navegador en frames para convertirla en un artifact.
 *
 * El servidor ya entrega frames JPEG por SSE para el panel Navegador; este hook
 * se limita a guardar los que llegan mientras la grabación está activa. No
 * duplica la sesión de Playwright ni pide capturas extra.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserFrame, BrowserSessionInfo } from '../utils/browserSessionApi';
import { saveArtifact } from '../artifacts/store';
import { newArtifactId } from '../artifacts/utils';
import type { ArtifactFrame, BrowserRecordingArtifact } from '../artifacts/types';

export const MAX_RECORDING_FRAMES = 180;
export const MAX_RECORDING_MS = 120_000;

interface RecordingDraft {
  id: string;
  startedAt: number;
  projectPath: string;
  sessionId: string;
  title: string;
  viewport: { width: number; height: number };
  frames: ArtifactFrame[];
}

export interface BrowserRecordingState {
  recording: boolean;
  saving: boolean;
  elapsedMs: number;
  frameCount: number;
  savedId: string;
  error: string;
  start: () => void;
  stop: () => Promise<void>;
}

function toArtifactFrame(frame: BrowserFrame, firstTs: number): ArtifactFrame {
  return {
    seq: frame.seq,
    ts: frame.ts,
    atMs: Math.max(0, frame.ts - firstTs),
    mimeType: frame.mimeType,
    data: frame.data,
    width: frame.width,
    height: frame.height,
    url: frame.url,
    title: frame.title,
  };
}

function buildArtifact(draft: RecordingDraft): BrowserRecordingArtifact {
  const lastFrame = draft.frames[draft.frames.length - 1];
  return {
    id: draft.id,
    kind: 'browser-recording',
    projectPath: draft.projectPath,
    title: draft.title,
    createdAt: draft.startedAt,
    durationMs: Math.max(0, lastFrame?.atMs ?? 0),
    sessionId: draft.sessionId,
    viewport: draft.viewport,
    frames: draft.frames,
    comments: [],
  };
}

export function useBrowserRecording(
  projectPath: string,
  session: BrowserSessionInfo | null,
  frame: BrowserFrame | null
): BrowserRecordingState {
  const [draft, setDraft] = useState<RecordingDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [savedId, setSavedId] = useState('');
  const [error, setError] = useState('');
  const draftRef = useRef<RecordingDraft | null>(null);
  const frameRef = useRef<BrowserFrame | null>(frame);
  const sessionRef = useRef<BrowserSessionInfo | null>(session);
  frameRef.current = frame;
  sessionRef.current = session;

  const stop = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    draftRef.current = null;
    setDraft(null);
    setElapsedMs(0);

    if (current.frames.length === 0) {
      setError('No se capturó ningún frame. Espera a que el navegador pinte y vuelve a intentarlo.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const artifact = buildArtifact(current);
      await saveArtifact(artifact);
      setSavedId(artifact.id);
      window.dispatchEvent(new CustomEvent('commander:artifact-created', { detail: { id: artifact.id } }));
    } catch (e: any) {
      setError(String(e?.message || e).slice(0, 300));
    } finally {
      setSaving(false);
    }
  }, []);

  const start = useCallback(() => {
    if (draftRef.current || !sessionRef.current) return;
    const activeSession = sessionRef.current;
    const currentFrame = frameRef.current;
    const title = (activeSession.page.title || activeSession.page.url || 'Grabación de navegador').slice(0, 90);
    const next: RecordingDraft = {
      id: newArtifactId('recording'),
      startedAt: Date.now(),
      projectPath,
      sessionId: activeSession.id,
      title,
      viewport: activeSession.viewport,
      frames: currentFrame ? [toArtifactFrame(currentFrame, currentFrame.ts)] : [],
    };
    draftRef.current = next;
    setDraft(next);
    setElapsedMs(0);
    setSavedId('');
    setError('');
  }, [projectPath]);

  // Cada frame del SSE entra una sola vez. El límite de frames protege la
  // memoria y el de tiempo se revisa en el timer de abajo.
  useEffect(() => {
    const current = draftRef.current;
    if (!current || !frame) return;
    if (current.frames.some((item) => item.seq === frame.seq)) return;
    if (current.frames.length >= MAX_RECORDING_FRAMES) {
      void stop();
      return;
    }
    const firstTs = current.frames[0]?.ts ?? frame.ts;
    const next = {
      ...current,
      frames: [...current.frames, toArtifactFrame(frame, firstTs)],
    };
    draftRef.current = next;
    setDraft(next);
    setElapsedMs(Math.max(0, frame.ts - current.startedAt));
  }, [frame, stop]);

  // Si el usuario cambia de sesión, la grabación actual se cierra y se guarda.
  const sessionId = session?.id || '';
  useEffect(() => {
    if (draftRef.current && draftRef.current.sessionId !== sessionId) void stop();
  }, [sessionId, stop]);

  const startedAt = draft?.startedAt ?? 0;
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => {
      const current = draftRef.current;
      if (!current) return;
      const elapsed = Math.max(0, Date.now() - current.startedAt);
      setElapsedMs(elapsed);
      if (elapsed >= MAX_RECORDING_MS) void stop();
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [startedAt, stop]);

  // Si el panel Navegador se desmonta (cambio de pestaña o cierre del
  // Workbench) no se pierden los frames ya capturados: se guardan como artifact.
  useEffect(() => {
    return () => {
      const current = draftRef.current;
      if (!current || current.frames.length === 0) return;
      draftRef.current = null;
      const artifact = buildArtifact(current);
      void saveArtifact(artifact)
        .then(() => {
          window.dispatchEvent(
            new CustomEvent('commander:artifact-created', {
              detail: { id: artifact.id, open: false },
            })
          );
        })
        .catch(() => {
          /* el cierre del panel no debe romper la app */
        });
    };
  }, []);

  return {
    recording: Boolean(draft),
    saving,
    elapsedMs,
    frameCount: draft?.frames.length ?? 0,
    savedId,
    error,
    start,
    stop,
  };
}
