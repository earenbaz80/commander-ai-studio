/**
 * Artifacts — grabaciones de navegador con comentarios inline.
 *
 * La vista es deliberadamente local: lista las grabaciones del proyecto desde
 * IndexedDB, reproduce los frames capturados y permite anclar comentarios a un
 * instante y a un punto del fotograma. El botón de grabar lleva al panel
 * Navegador, donde se inicia la captura real de la sesión de Playwright.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  Camera,
  CheckCircle2,
  Circle,
  Clock3,
  Film,
  MessageSquare,
  MessageSquarePlus,
  MonitorPlay,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type { Language } from '../../i18n/translations';
import { deText } from '../../i18n/de';
import {
  deleteArtifact,
  listArtifacts,
  saveArtifact,
} from '../../artifacts/store';
import type {
  Artifact,
  ArtifactComment,
  ArtifactFrame,
} from '../../artifacts/types';
import { formatMediaTime, newArtifactId } from '../../artifacts/utils';

interface ArtifactsViewProps {
  projectPath: string;
  lang?: Language;
  onOpenBrowser?: () => void;
}

interface CommentAnchor {
  atMs: number;
  x: number;
  y: number;
}

function tr(lang: Language, es: string, en: string): string {
  if (lang === 'es') return es;
  if (lang === 'de') return deText(en);
  return en;
}

function formatDate(ts: number, lang: Language): string {
  try {
    return new Date(ts).toLocaleString(
      lang === 'es' ? 'es-ES' : lang === 'de' ? 'de-DE' : 'en-US',
      { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    );
  } catch {
    return String(ts);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function frameIndexAt(frames: ArtifactFrame[], ms: number): number {
  let index = 0;
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i].atMs <= ms) index = i;
    else break;
  }
  return index;
}

function frameSrc(frame: ArtifactFrame): string {
  return frame.data.startsWith('data:')
    ? frame.data
    : `data:${frame.mimeType};base64,${frame.data}`;
}

function thumbnailOf(artifact: Artifact): string {
  const first = artifact.frames[0];
  return first ? frameSrc(first) : '';
}

export function ArtifactsView({
  projectPath,
  lang = 'es',
  onOpenBrowser,
}: ArtifactsViewProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [focusedCommentId, setFocusedCommentId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const playFromRef = useRef(0);
  const playStartedAtRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listArtifacts(projectPath);
      setArtifacts(list);
      setSelectedId((current) =>
        current && list.some((artifact) => artifact.id === current)
          ? current
          : list[0]?.id || ''
      );
    } catch (e: any) {
      setError(String(e?.message || e).slice(0, 300));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onCreated = () => void load();
    window.addEventListener('commander:artifact-created', onCreated);
    return () => window.removeEventListener('commander:artifact-created', onCreated);
  }, [load]);

  const selected = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedId) ?? null,
    [artifacts, selectedId]
  );
  const frames = useMemo(() => selected?.frames ?? [], [selected]);
  const duration = Math.max(
    1,
    selected?.durationMs ?? 0,
    frames[frames.length - 1]?.atMs ?? 0
  );
  const currentIndex = useMemo(
    () => (frames.length ? frameIndexAt(frames, positionMs) : 0),
    [frames, positionMs]
  );
  const currentFrame = frames[currentIndex] ?? null;
  const currentFrameStart = currentFrame?.atMs ?? 0;
  const nextFrameStart = frames[currentIndex + 1]?.atMs ?? duration + 1;
  const comments = useMemo(
    () =>
      selected
        ? [...selected.comments].sort(
            (a, b) => a.atMs - b.atMs || a.createdAt - b.createdAt
          )
        : [],
    [selected]
  );
  const visibleComments = useMemo(
    () =>
      comments
        .map((comment, index) => ({ comment, index }))
        .filter(({ comment }) => {
          if (comment.resolved) return false;
          if (!frames.length) return true;
          return comment.atMs >= currentFrameStart && comment.atMs < nextFrameStart;
        }),
    [comments, frames.length, currentFrameStart, nextFrameStart]
  );

  useEffect(() => {
    setPositionMs(0);
    setPlaying(false);
    setPendingAnchor(null);
    setCommentDraft('');
    setFocusedCommentId('');
    setConfirmDelete(false);
  }, [selectedId]);

  useEffect(() => {
    if (!playing || !selectedId) return;
    let raf = 0;
    const tick = (now: number) => {
      const next = playFromRef.current + (now - playStartedAtRef.current);
      if (next >= duration) {
        setPositionMs(duration);
        setPlaying(false);
        return;
      }
      setPositionMs(next);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playing, selectedId, duration]);

  const openBrowser = () => {
    if (onOpenBrowser) {
      onOpenBrowser();
      return;
    }
    window.dispatchEvent(
      new CustomEvent('commander:open-workbench-tab', { detail: { tab: 'browser' } })
    );
  };

  const seek = (ms: number) => {
    setPlaying(false);
    setPositionMs(Math.max(0, Math.min(duration, ms)));
  };

  const togglePlay = () => {
    if (!selected) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    const from = positionMs >= duration ? 0 : positionMs;
    if (positionMs >= duration) setPositionMs(0);
    playFromRef.current = from;
    playStartedAtRef.current = performance.now();
    setPlaying(true);
  };

  const openComposer = (anchor: CommentAnchor) => {
    if (!selected) return;
    setPlaying(false);
    setPendingAnchor(anchor);
    setCommentDraft('');
    setFocusedCommentId('');
    window.setTimeout(() => composerRef.current?.focus(), 0);
  };

  const onFrameClick = (event: MouseEvent<HTMLImageElement>) => {
    if (!selected || !currentFrame) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.width > 0 ? clamp01((event.clientX - rect.left) / rect.width) : 0.5;
    const y = rect.height > 0 ? clamp01((event.clientY - rect.top) / rect.height) : 0.5;
    openComposer({ atMs: currentFrame.atMs, x, y });
  };

  const addCommentAtPlayhead = () => {
    if (!selected || !currentFrame) return;
    openComposer({ atMs: currentFrame.atMs, x: 0.5, y: 0.45 });
  };

  const submitComment = async () => {
    if (!selected || !pendingAnchor) return;
    const body = commentDraft.trim();
    if (!body) return;
    const comment: ArtifactComment = {
      id: newArtifactId('comment'),
      atMs: pendingAnchor.atMs,
      x: pendingAnchor.x,
      y: pendingAnchor.y,
      body,
      author: 'local',
      createdAt: Date.now(),
      resolved: false,
    };
    const next: Artifact = {
      ...selected,
      comments: [...selected.comments, comment],
    };
    setArtifacts((current) =>
      current.map((artifact) => (artifact.id === next.id ? next : artifact))
    );
    setPendingAnchor(null);
    setCommentDraft('');
    setFocusedCommentId(comment.id);
    try {
      await saveArtifact(next);
    } catch (e: any) {
      setError(String(e?.message || e).slice(0, 300));
    }
  };

  const replaceComments = async (nextComments: ArtifactComment[]) => {
    if (!selected) return;
    const next: Artifact = { ...selected, comments: nextComments };
    setArtifacts((current) =>
      current.map((artifact) => (artifact.id === next.id ? next : artifact))
    );
    try {
      await saveArtifact(next);
    } catch (e: any) {
      setError(String(e?.message || e).slice(0, 300));
    }
  };

  const toggleResolved = (commentId: string) => {
    if (!selected) return;
    void replaceComments(
      selected.comments.map((comment) =>
        comment.id === commentId ? { ...comment, resolved: !comment.resolved } : comment
      )
    );
  };

  const removeComment = (commentId: string) => {
    if (!selected) return;
    void replaceComments(selected.comments.filter((comment) => comment.id !== commentId));
  };

  const removeSelected = async () => {
    if (!selected) return;
    const remaining = artifacts.filter((artifact) => artifact.id !== selected.id);
    try {
      await deleteArtifact(selected.id);
      setArtifacts(remaining);
      setSelectedId(remaining[0]?.id || '');
      setConfirmDelete(false);
    } catch (e: any) {
      setError(String(e?.message || e).slice(0, 300));
    }
  };

  const header = (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] shrink-0">
      <Film className="w-3.5 h-3.5 text-[var(--nc-text)]" />
      <span className="font-bold text-[var(--nc-text)] uppercase tracking-wide">Artifacts</span>
      <span className="text-[9px] text-white/45">
        {artifacts.length} {tr(lang, 'grabaciones', 'recordings')}
      </span>
      <button
        type="button"
        onClick={() => void load()}
        className="ml-auto p-1 text-black/70 hover:text-[var(--nc-text)]"
        title={tr(lang, 'Refrescar artifacts', 'Refresh artifacts')}
        aria-label={tr(lang, 'Refrescar artifacts', 'Refresh artifacts')}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
      </button>
      <button
        type="button"
        onClick={openBrowser}
        className="nc-button flex items-center gap-1 px-1.5 py-0.5 text-[10px]"
        title={tr(lang, 'Grabar una sesión de navegador', 'Record a browser session')}
      >
        <MonitorPlay className="w-3.5 h-3.5" />
        {tr(lang, 'Grabar', 'Record')}
      </button>
    </div>
  );

  if (loading && artifacts.length === 0) {
    return (
      <div className="h-full min-h-0 flex flex-col text-[11px] font-mono" data-testid="artifacts-view">
        {header}
        <div className="flex-1 flex items-center justify-center text-[var(--nc-text)]/70">
          {tr(lang, 'Cargando grabaciones…', 'Loading recordings…')}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col text-[11px] font-mono bg-[var(--nc-bg-deep)]" data-testid="artifacts-view">
      {header}

      {error && (
        <div className="px-2 py-1 text-red-300 border-b border-[var(--nc-border-dark)] shrink-0">
          {error}
        </div>
      )}

      {artifacts.length === 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-3 px-6 py-8 text-center">
          <div className="w-14 h-14 border-2 border-dashed border-[var(--nc-border-light)]/50 flex items-center justify-center text-[var(--nc-text)]/60">
            <Camera className="w-7 h-7" />
          </div>
          <div className="text-[var(--nc-text-accent)] font-bold text-[12px]">
            {tr(lang, 'Todavía no hay artifacts', 'No artifacts yet')}
          </div>
          <p className="max-w-[300px] text-white/60 leading-relaxed">
            {tr(
              lang,
              'Abre el navegador, pulsa REC y navega. Al detener la grabación aparecerá aquí con sus frames y comentarios.',
              'Open the browser, press REC and navigate. Stop the recording and it will appear here with its frames and comments.'
            )}
          </p>
          <button type="button" onClick={openBrowser} className="nc-button flex items-center gap-1.5 px-3 py-1.5">
            <MonitorPlay className="w-3.5 h-3.5" />
            {tr(lang, 'Abrir navegador', 'Open browser')}
          </button>
          <p className="text-[9px] text-white/35">
            {tr(
              lang,
              'Los frames se guardan localmente, en este equipo.',
              'Frames are stored locally on this machine.'
            )}
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5 px-2 py-2 overflow-x-auto border-b border-[var(--nc-border-dark)] shrink-0">
            {artifacts.map((artifact) => {
              const thumb = thumbnailOf(artifact);
              const isSelected = artifact.id === selectedId;
              return (
                <button
                  type="button"
                  key={artifact.id}
                  data-testid={`artifact-card-${artifact.id}`}
                  onClick={() => setSelectedId(artifact.id)}
                  aria-pressed={isSelected}
                  className={`w-[132px] shrink-0 border text-left transition-colors ${
                    isSelected
                      ? 'border-[var(--nc-text-accent)] bg-[var(--nc-active-bg)]/25'
                      : 'border-[var(--nc-border-dark)] hover:border-[var(--nc-border-light)]/70'
                  }`}
                  title={artifact.title}
                >
                  <div className="relative aspect-video bg-black overflow-hidden">
                    {thumb ? (
                      <img src={thumb} alt="" className="w-full h-full object-cover opacity-90" draggable={false} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/30">
                        <Film className="w-5 h-5" />
                      </div>
                    )}
                    <span className="absolute right-0.5 bottom-0.5 px-1 bg-black/80 text-[9px] text-[var(--nc-text-accent)]">
                      {formatMediaTime(artifact.durationMs)}
                    </span>
                    {artifact.comments.length > 0 && (
                      <span className="absolute left-0.5 bottom-0.5 px-1 bg-black/80 text-[9px] text-white/80 flex items-center gap-0.5">
                        <MessageSquare className="w-2.5 h-2.5" />
                        {artifact.comments.length}
                      </span>
                    )}
                  </div>
                  <div className="p-1">
                    <div className="truncate text-[10px] text-[var(--nc-text)]">{artifact.title}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-[9px] text-white/40">
                      <Clock3 className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">{formatDate(artifact.createdAt, lang)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="p-2 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[12px] font-bold text-[var(--nc-text-accent)]" title={selected.title}>
                      {selected.title}
                    </h2>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-white/45">
                      <span>{formatDate(selected.createdAt, lang)}</span>
                      <span>· {selected.frames.length} frames</span>
                      <span>· {selected.viewport.width}×{selected.viewport.height}</span>
                      <span>· {selected.comments.length} {tr(lang, 'comentarios', 'comments')}</span>
                    </div>
                  </div>
                  {confirmDelete ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[9px] text-red-300">{tr(lang, '¿Eliminar?', 'Delete?')}</span>
                      <button type="button" onClick={() => void removeSelected()} className="nc-button px-1.5 py-0.5 text-[9px] text-red-300">
                        {tr(lang, 'Sí', 'Yes')}
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(false)} className="nc-button px-1.5 py-0.5 text-[9px]">
                        {tr(lang, 'No', 'No')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="p-1 shrink-0 text-white/40 hover:text-red-300"
                      title={tr(lang, 'Eliminar artifact', 'Delete artifact')}
                      aria-label={tr(lang, 'Eliminar artifact', 'Delete artifact')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="relative w-full overflow-hidden border border-[var(--nc-border-light)]/60 bg-black select-none">
                  <div className="relative w-full" style={{ aspectRatio: currentFrame ? `${currentFrame.width} / ${currentFrame.height}` : '16 / 9' }}>
                    {currentFrame ? (
                      <img
                        src={frameSrc(currentFrame)}
                        alt={tr(lang, 'Fotograma de la grabación', 'Recording frame')}
                        className="absolute inset-0 w-full h-full object-contain cursor-crosshair"
                        draggable={false}
                        onClick={onFrameClick}
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/30">
                        <Film className="w-6 h-6" />
                        <span className="text-[9px]">{tr(lang, 'Sin frames', 'No frames')}</span>
                      </div>
                    )}

                    <div className="absolute top-1 left-1 px-1 py-0.5 bg-black/75 text-[9px] text-white/70 pointer-events-none">
                      FRAME {frames.length ? currentIndex + 1 : 0}/{frames.length} · {formatMediaTime(currentFrameStart)}
                    </div>
                    {playing && (
                      <div className="absolute top-1 right-1 px-1 py-0.5 bg-[var(--nc-text-accent)] text-black text-[9px] font-bold pointer-events-none">
                        PLAY
                      </div>
                    )}

                    {visibleComments.map(({ comment, index }) => (
                      <button
                        type="button"
                        key={comment.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          seek(comment.atMs);
                          setFocusedCommentId(comment.id);
                        }}
                        className="absolute z-10 -translate-x-1/2 -translate-y-1/2 min-w-[20px] h-5 px-1 rounded-full bg-[var(--nc-text-accent)] text-black text-[9px] font-bold border border-black shadow-[0_0_0_1px_#ffff55]"
                        style={{ left: `${comment.x * 100}%`, top: `${comment.y * 100}%` }}
                        title={`${index + 1} · ${formatMediaTime(comment.atMs, true)} — ${comment.body}`}
                        aria-label={`${tr(lang, 'Comentario', 'Comment')} ${index + 1}: ${comment.body}`}
                      >
                        {index + 1}
                      </button>
                    ))}

                    {pendingAnchor && (
                      <div
                        className="absolute z-10 -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-dashed border-white/90 bg-black/70 text-[var(--nc-text-accent)] text-[11px] flex items-center justify-center pointer-events-none"
                        style={{ left: `${pendingAnchor.x * 100}%`, top: `${pendingAnchor.y * 100}%` }}
                      >
                        +
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="nc-button p-1"
                    title={playing ? tr(lang, 'Pausar', 'Pause') : tr(lang, 'Reproducir', 'Play')}
                    aria-label={playing ? tr(lang, 'Pausar', 'Pause') : tr(lang, 'Reproducir', 'Play')}
                    data-testid="artifact-play"
                  >
                    {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => seek(0)}
                    className="nc-button p-1"
                    title={tr(lang, 'Volver al inicio', 'Back to start')}
                    aria-label={tr(lang, 'Volver al inicio', 'Back to start')}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={addCommentAtPlayhead}
                    disabled={!currentFrame}
                    className="nc-button p-1 disabled:opacity-40"
                    title={tr(lang, 'Comentar en este fotograma', 'Comment on this frame')}
                    aria-label={tr(lang, 'Comentar en este fotograma', 'Comment on this frame')}
                    data-testid="artifact-add-comment"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <input
                      type="range"
                      min={0}
                      max={duration}
                      step={1}
                      value={Math.min(positionMs, duration)}
                      onChange={(event) => seek(Number(event.target.value))}
                      className="w-full accent-[var(--nc-text-accent)]"
                      aria-label={tr(lang, 'Línea de tiempo de la grabación', 'Recording timeline')}
                    />
                    <div className="relative h-2 -mt-0.5">
                      {comments.map((comment, index) => (
                        <button
                          type="button"
                          key={`marker-${comment.id}`}
                          onClick={() => {
                            seek(comment.atMs);
                            setFocusedCommentId(comment.id);
                          }}
                          className={`absolute top-0 w-1.5 h-1.5 -translate-x-1/2 rounded-full ${
                            comment.resolved ? 'bg-white/30' : 'bg-[var(--nc-text-accent)]'
                          }`}
                          style={{ left: `${clamp01(comment.atMs / duration) * 100}%` }}
                          title={`${index + 1} · ${formatMediaTime(comment.atMs, true)}`}
                          aria-label={`${tr(lang, 'Ir al comentario', 'Go to comment')} ${index + 1}`}
                        />
                      ))}
                    </div>
                  </div>
                  <span className="shrink-0 text-[9px] text-white/55 tabular-nums">
                    {formatMediaTime(positionMs)} / {formatMediaTime(selected.durationMs)}
                  </span>
                </div>

                <div className="border-t border-[var(--nc-border-dark)] pt-2">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-[var(--nc-text)]" />
                    <span className="font-bold text-[var(--nc-text)] uppercase tracking-wide">
                      {tr(lang, 'Comentarios inline', 'Inline comments')}
                    </span>
                    <span className="text-[9px] text-white/45">{comments.length}</span>
                    <span className="ml-auto text-[9px] text-white/35">
                      {tr(lang, 'anclados al fotograma', 'anchored to the frame')}
                    </span>
                  </div>

                  {pendingAnchor ? (
                    <div className="mt-1.5 border border-[var(--nc-text-accent)]/70 bg-[var(--nc-bg-panel)] p-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] text-[var(--nc-text-accent)]">
                        <MessageSquarePlus className="w-3 h-3" />
                        <span>
                          {tr(lang, 'Nuevo comentario', 'New comment')} · {formatMediaTime(pendingAnchor.atMs, true)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingAnchor(null);
                            setCommentDraft('');
                          }}
                          className="ml-auto p-0.5 text-white/50 hover:text-white"
                          title={tr(lang, 'Cancelar', 'Cancel')}
                          aria-label={tr(lang, 'Cancelar comentario', 'Cancel comment')}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <textarea
                        ref={composerRef}
                        value={commentDraft}
                        onChange={(event) => setCommentDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                            event.preventDefault();
                            void submitComment();
                          }
                        }}
                        rows={2}
                        className="mt-1 w-full resize-none bg-[var(--nc-bg-deep)] border border-[var(--nc-border-dark)] px-1.5 py-1 text-[11px] text-white outline-none focus:border-[var(--nc-text-accent)]"
                        placeholder={tr(
                          lang,
                          '¿Qué ves en este punto? Ctrl+Enter para publicar',
                          'What do you see here? Ctrl+Enter to post'
                        )}
                        aria-label={tr(lang, 'Texto del comentario', 'Comment text')}
                        data-testid="artifact-comment-input"
                      />
                      <div className="mt-1 flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setPendingAnchor(null);
                            setCommentDraft('');
                          }}
                          className="nc-button px-2 py-0.5 text-[10px]"
                        >
                          {tr(lang, 'Cancelar', 'Cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitComment()}
                          disabled={!commentDraft.trim()}
                          className="nc-button px-2 py-0.5 text-[10px] bg-[var(--nc-active-bg)] text-black font-bold disabled:opacity-40"
                          data-testid="artifact-comment-submit"
                        >
                          {tr(lang, 'Publicar', 'Post')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-[10px] text-white/45 leading-relaxed">
                      {tr(
                        lang,
                        'Pausa y haz clic sobre el fotograma para anclar un comentario en ese punto.',
                        'Pause and click on the frame to anchor a comment at that point.'
                      )}
                    </p>
                  )}

                  {comments.length === 0 ? (
                    <p className="mt-1.5 text-[10px] text-white/35">
                      {tr(lang, 'Sin comentarios todavía.', 'No comments yet.')}
                    </p>
                  ) : (
                    <div className="mt-1.5 space-y-1.5">
                      {comments.map((comment, index) => (
                        <div
                          key={comment.id}
                          data-testid={`artifact-comment-${comment.id}`}
                          className={`border p-1.5 transition-colors ${
                            focusedCommentId === comment.id
                              ? 'border-[var(--nc-text-accent)] bg-[var(--nc-active-bg)]/20'
                              : 'border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)]/50'
                          } ${comment.resolved ? 'opacity-55' : ''}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                seek(comment.atMs);
                                setFocusedCommentId(comment.id);
                              }}
                              className="px-1 bg-[var(--nc-text-accent)] text-black font-bold text-[9px]"
                              title={tr(lang, 'Ir a este instante', 'Go to this moment')}
                            >
                              {index + 1} · {formatMediaTime(comment.atMs, true)}
                            </button>
                            <span className="text-[9px] text-white/40">
                              {comment.author === 'local' ? tr(lang, 'Tú', 'You') : comment.author}
                            </span>
                            <div className="ml-auto flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => toggleResolved(comment.id)}
                                className={`p-0.5 ${comment.resolved ? 'text-[var(--nc-success)]' : 'text-white/45 hover:text-[var(--nc-text)]'}`}
                                title={comment.resolved ? tr(lang, 'Reabrir comentario', 'Reopen comment') : tr(lang, 'Resolver comentario', 'Resolve comment')}
                                aria-label={comment.resolved ? tr(lang, 'Reabrir comentario', 'Reopen comment') : tr(lang, 'Resolver comentario', 'Resolve comment')}
                              >
                                {comment.resolved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeComment(comment.id)}
                                className="p-0.5 text-white/40 hover:text-red-300"
                                title={tr(lang, 'Eliminar comentario', 'Delete comment')}
                                aria-label={tr(lang, 'Eliminar comentario', 'Delete comment')}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          <p className={`mt-1 whitespace-pre-wrap break-words text-[11px] ${comment.resolved ? 'line-through text-white/60' : 'text-[#d8d8d8]'}`}>
                            {comment.body}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
