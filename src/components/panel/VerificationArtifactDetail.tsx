/**
 * Detalle de un artifact de verificación (F2-05).
 *
 * Es una vista local: no hace peticiones de red, no renderiza HTML del informe
 * y no interpreta el patch. Muestra el contenido tal como quedó guardado para
 * que el usuario pueda revisarlo o descargarlo.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Download,
  FileText,
  Film,
  FolderOpen,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { Language } from '../../i18n/translations';
import { deText } from '../../i18n/de';
import { saveArtifact } from '../../artifacts/store';
import { effectiveVerificationStatus, withVerificationReport } from '../../artifacts/report';
import type {
  BrowserRecordingArtifact,
  VerificationArtifact,
  VerificationStatus,
  VerificationTestStatus,
} from '../../artifacts/types';

interface VerificationArtifactDetailProps {
  artifact: VerificationArtifact;
  lang?: Language;
  /** Grabación resuelta por id; ausente si fue borrada o no existe. */
  recording?: BrowserRecordingArtifact;
  onOpenRecording?: (recordingId: string) => void;
  onUpdated?: (artifact: VerificationArtifact) => void;
  onDelete?: () => void | Promise<void>;
}

function t(lang: Language, es: string, en: string): string {
  if (lang === 'es') return es;
  if (lang === 'de') return deText(en);
  return en;
}

function formatDateTime(ts: number, lang: Language): string {
  try {
    return new Date(ts).toLocaleString(
      lang === 'es' ? 'es-ES' : lang === 'de' ? 'de-DE' : 'en-US',
      { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    );
  } catch {
    return String(ts);
  }
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function statusLabel(status: VerificationStatus): string {
  if (status === 'passed') return 'APROBADO';
  if (status === 'failed') return 'FALLÓ';
  return 'INCOMPLETO';
}

function statusClass(status: VerificationStatus): string {
  if (status === 'passed') return 'text-[var(--nc-success)] border-[var(--nc-success)]';
  if (status === 'failed') return 'text-red-300 border-red-400/60';
  return 'text-yellow-300 border-yellow-400/60';
}

const PLAN_LABEL: Record<string, string> = {
  done: 'HECHO',
  in_progress: 'EN CURSO',
  blocked: 'BLOQUEADO',
  pending: 'PENDIENTE',
};

function planLabel(status: string, done: boolean): string {
  if (done || status === 'done') return PLAN_LABEL.done;
  return PLAN_LABEL[status] ?? String(status || 'pendiente').toUpperCase();
}

const DECISION_LABEL: Record<string, string> = {
  allow: 'PERMITIDA',
  deny: 'DENEGADA',
  'allow-session': 'PERMITIDA PARA LA SESIÓN',
};

const TEST_LABEL: Record<VerificationTestStatus, string> = {
  passed: 'PASÓ',
  failed: 'FALLÓ',
  'not-run': 'NO EJECUTADO',
};

function testClass(status: VerificationTestStatus): string {
  if (status === 'passed') return 'text-[var(--nc-success)] border-[var(--nc-success)]';
  if (status === 'failed') return 'text-red-300 border-red-400/60';
  return 'text-yellow-300 border-yellow-400/60';
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)]/30">
      <h3 className="px-2 py-1 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] text-[10px] font-bold uppercase tracking-wide text-[var(--nc-text)]">
        {title}
      </h3>
      <div className="p-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[10px] text-white/45">{children}</p>;
}

export function VerificationArtifactDetail({
  artifact,
  lang = 'es',
  recording,
  onOpenRecording,
  onUpdated,
  onDelete,
}: VerificationArtifactDetailProps) {
  const [report, setReport] = useState<VerificationArtifact['report']>(artifact.report);
  const [reportError, setReportError] = useState('');
  const [folderStatus, setFolderStatus] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setReport(artifact.report);
    setConfirmDelete(false);
  }, [artifact]);

  const status = effectiveVerificationStatus(artifact);
  // `useAutoUpdater` declara su propia ventana global con otra forma de
  // `electronAPI`; se consulta el puente con un cast local, igual que LSP.
  const bridge =
    typeof window !== 'undefined'
      ? (window as unknown as {
          electronAPI?: {
            app?: {
              openFolder?: (
                folderPath: string
              ) => Promise<{ success: boolean; error?: string }>;
            };
          };
        }).electronAPI
      : undefined;
  const openFolder = bridge?.app?.openFolder;
  const canOpenNative = typeof openFolder === 'function';

  const revealFolder = async () => {
    setFolderStatus('');
    if (openFolder) {
      try {
        const result = await openFolder(artifact.projectPath);
        if (result?.success !== false) {
          setFolderStatus(t(lang, 'Carpeta abierta', 'Folder opened'));
          return;
        }
      } catch {
        // Sin puente nativo se cae al portapapeles.
      }
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('portapapeles no disponible');
      await navigator.clipboard.writeText(artifact.projectPath);
      setFolderStatus(t(lang, 'Ruta copiada', 'Path copied'));
    } catch {
      setFolderStatus(t(lang, 'No se pudo abrir la carpeta', 'Could not open the folder'));
    }
  };

  const generateReport = async () => {
    setReportError('');
    try {
      const next = withVerificationReport(artifact, { format: 'markdown' });
      await saveArtifact(next);
      setReport(next.report);
      onUpdated?.(next);
    } catch (e: any) {
      setReportError(String(e?.message || e).slice(0, 300));
    }
  };

  const downloadReport = () => {
    if (!report) return;
    setReportError('');
    try {
      if (typeof URL.createObjectURL !== 'function') throw new Error('descarga no disponible');
      const mime = report.format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8';
      const ext = report.format === 'html' ? 'html' : 'md';
      const safeId = artifact.id.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80) || 'verificacion';
      const objectUrl = URL.createObjectURL(new Blob([report.content], { type: mime }));
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `verificacion-${safeId}.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL?.(objectUrl), 1_000);
    } catch (e: any) {
      setReportError(String(e?.message || e).slice(0, 300));
    }
  };

  const env = artifact.environment;

  return (
    <div className="p-2 space-y-2" data-testid="verification-detail">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-[var(--nc-text-accent)]" />
            <h2 className="truncate text-[12px] font-bold text-[var(--nc-text-accent)]" title={artifact.title}>
              {artifact.title}
            </h2>
            <span className={`px-1 text-[9px] font-bold border ${statusClass(status)}`}>
              {statusLabel(status)}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-white/45">
            <span>{formatDateTime(artifact.createdAt, lang)}</span>
            <span>· {artifact.plan.length} {t(lang, 'pasos', 'steps')}</span>
            <span>· {artifact.decisions.length} {t(lang, 'decisiones', 'decisions')}</span>
            <span>· {artifact.tests.length} tests</span>
            <span>· {t(lang, 'sesión', 'session')} {artifact.sessionId}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-white/45">
            <code className="max-w-full truncate border border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] px-1 py-0.5" title={artifact.projectPath}>
              {artifact.projectPath}
            </code>
            <button
              type="button"
              data-testid="verification-open-folder"
              onClick={() => void revealFolder()}
              className="nc-button flex items-center gap-1 px-1.5 py-0.5 text-[9px]"
            >
              <FolderOpen className="w-3 h-3" />
              {canOpenNative
                ? t(lang, 'Abrir carpeta', 'Open folder')
                : t(lang, 'Copiar ruta', 'Copy path')}
            </button>
            {folderStatus && (
              <span data-testid="verification-folder-status" className="text-[9px] text-[var(--nc-text-accent)]">
                {folderStatus}
              </span>
            )}
          </div>
        </div>
        {confirmDelete ? (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[9px] text-red-300">{t(lang, '¿Eliminar?', 'Delete?')}</span>
            <button
              type="button"
              onClick={() => void onDelete?.()}
              className="nc-button px-1.5 py-0.5 text-[9px] text-red-300"
            >
              {t(lang, 'Sí', 'Yes')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="nc-button px-1.5 py-0.5 text-[9px]"
            >
              {t(lang, 'No', 'No')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-testid="verification-delete"
            onClick={() => setConfirmDelete(true)}
            className="p-1 shrink-0 text-white/40 hover:text-red-300"
            title={t(lang, 'Eliminar artifact', 'Delete artifact')}
            aria-label={t(lang, 'Eliminar artifact', 'Delete artifact')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <Section title="Plan">
        {artifact.plan.length === 0 ? (
          <Empty>{t(lang, 'Sin plan registrado.', 'No plan recorded.')}</Empty>
        ) : (
          <ol className="space-y-1.5">
            {artifact.plan.map((item) => (
              <li key={item.id} className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)]/40 p-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 border border-[var(--nc-border-light)]/50 px-1 text-[9px] text-[var(--nc-text)]">
                    {planLabel(item.status, item.done)}
                  </span>
                  <span className="min-w-0 break-words text-[11px] text-[var(--nc-text)]">{item.text}</span>
                  <code className="ml-auto shrink-0 text-[9px] text-white/35">{item.id}</code>
                </div>
                {item.files && item.files.length > 0 && (
                  <div className="mt-0.5 break-all text-[9px] text-white/45">
                    {t(lang, 'Archivos:', 'Files:')} {item.files.join(', ')}
                  </div>
                )}
                {item.criteria && (
                  <div className="mt-0.5 break-words text-[9px] text-white/45">
                    {t(lang, 'Criterio:', 'Criteria:')} {item.criteria}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={t(lang, 'Decisiones', 'Decisions')}>
        {artifact.decisions.length === 0 ? (
          <Empty>{t(lang, 'Sin decisiones registradas.', 'No decisions recorded.')}</Empty>
        ) : (
          <ul className="space-y-1.5">
            {artifact.decisions.map((decision) => (
              <li key={`${decision.stepId}-${decision.tool}`} className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)]/40 p-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`border px-1 text-[9px] font-bold ${
                    decision.decision === 'deny'
                      ? 'text-red-300 border-red-400/60'
                      : 'text-[var(--nc-success)] border-[var(--nc-success)]'
                  }`}>
                    {DECISION_LABEL[decision.decision] ?? decision.decision.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-[var(--nc-text)]">{decision.tool}</span>
                  <code className="text-[9px] text-white/35">{decision.stepId}</code>
                </div>
                {decision.reason && (
                  <div className="mt-0.5 break-words text-[9px] text-white/45">
                    {t(lang, 'Motivo:', 'Reason:')} {decision.reason}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Diff">
        {!artifact.diff ? (
          <Empty>{t(lang, 'Sin diff registrado.', 'No diff recorded.')}</Empty>
        ) : (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-1">
              {artifact.diff.files.length === 0 ? (
                <span className="text-[9px] text-white/45">
                  {t(lang, 'Sin archivos listados.', 'No files listed.')}
                </span>
              ) : (
                artifact.diff.files.map((file) => (
                  <code key={file} className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] px-1 py-0.5 text-[9px] text-[var(--nc-text)]">
                    {file}
                  </code>
                ))
              )}
            </div>
            {(artifact.diff.base || artifact.diff.head) && (
              <p className="text-[9px] text-white/45">
                {artifact.diff.base ? `Base: ${artifact.diff.base}` : ''}
                {artifact.diff.base && artifact.diff.head ? ' · ' : ''}
                {artifact.diff.head ? `Head: ${artifact.diff.head}` : ''}
              </p>
            )}
            {artifact.diff.patch ? (
              <pre
                data-testid="verification-diff"
                className="max-h-[260px] overflow-auto whitespace-pre border border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] p-1.5 text-[10px] leading-relaxed text-white/75"
              >
                {artifact.diff.patch}
              </pre>
            ) : (
              <Empty>{t(lang, 'Sin patch registrado.', 'No patch recorded.')}</Empty>
            )}
          </div>
        )}
      </Section>

      <Section title={`Tests (${artifact.tests.length})`}>
        {artifact.tests.length === 0 ? (
          <Empty>{t(lang, 'Sin evidencia de tests.', 'No test evidence.')}</Empty>
        ) : (
          <div className="space-y-1.5">
            {artifact.tests.map((test) => (
              <article
                key={test.id}
                data-testid={`verification-test-${test.id}`}
                className="border-l-2 border-[var(--nc-border-light)]/50 bg-[var(--nc-bg-panel)]/40 py-1 pl-2 pr-1"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`border px-1 text-[9px] font-bold ${testClass(test.status)}`}>
                    {TEST_LABEL[test.status]}
                  </span>
                  {test.timedOut && (
                    <span className="border border-red-400/60 px-1 text-[9px] font-bold text-red-300">
                      TIMEOUT
                    </span>
                  )}
                  <code className="text-[10px] text-[var(--nc-text)]">{test.id}</code>
                  <span className="ml-auto text-[9px] text-white/45">
                    exitCode: {test.exitCode === null ? 'null' : test.exitCode}
                  </span>
                </div>
                <div className="mt-0.5 break-all font-mono text-[10px] text-white/70">{test.command}</div>
                <div className="text-[9px] text-white/35">
                  cwd: {test.cwd} · {formatDuration(test.durationMs)}
                </div>
                {test.stdoutTail && (
                  <pre className="mt-1 max-h-[140px] overflow-auto whitespace-pre-wrap break-words border border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] p-1 text-[9px] text-white/70">
                    {test.stdoutTail}
                  </pre>
                )}
                {test.stderrTail && (
                  <pre className="mt-1 max-h-[140px] overflow-auto whitespace-pre-wrap break-words border border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] p-1 text-[9px] text-red-200/80">
                    {test.stderrTail}
                  </pre>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section title={t(lang, 'Entorno', 'Environment')}>
        <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[10px]">
          <dt className="text-white/45">Node</dt>
          <dd className="break-all text-[var(--nc-text)]">{env.node}</dd>
          <dt className="text-white/45">{t(lang, 'SO', 'OS')}</dt>
          <dd className="break-all text-[var(--nc-text)]">{env.os}</dd>
          {env.commit && (
            <>
              <dt className="text-white/45">Commit</dt>
              <dd className="break-all text-[var(--nc-text)]">{env.commit}</dd>
            </>
          )}
          {env.branch && (
            <>
              <dt className="text-white/45">{t(lang, 'Rama', 'Branch')}</dt>
              <dd className="break-all text-[var(--nc-text)]">{env.branch}</dd>
            </>
          )}
        </dl>
      </Section>

      <Section title={t(lang, 'Grabación', 'Recording')}>
        {!artifact.browserRecordingId ? (
          <Empty>{t(lang, 'Sin grabación vinculada.', 'No linked recording.')}</Empty>
        ) : !recording ? (
          <div data-testid="verification-recording-missing" className="space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="border border-yellow-400/60 px-1 text-[9px] font-bold text-yellow-300">
                {t(lang, 'Grabación no disponible', 'Recording unavailable')}
              </span>
              <code className="text-[9px] text-white/45">{artifact.browserRecordingId}</code>
            </div>
            <p className="text-[9px] text-white/45">
              {t(
                lang,
                'La evidencia visual fue eliminada, pero el artifact y su informe se conservan.',
                'The visual evidence was deleted, but the artifact and its report are preserved.'
              )}
            </p>
          </div>
        ) : (
          <div data-testid="verification-recording" className="flex items-center gap-2">
            <Film className="w-5 h-5 shrink-0 text-[var(--nc-text-accent)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] text-[var(--nc-text)]" title={recording.title}>
                {recording.title}
              </div>
              <div className="text-[9px] text-white/45">
                {recording.frames.length} frames · {formatDuration(recording.durationMs)} ·{' '}
                {formatDateTime(recording.createdAt, lang)} ·{' '}
                <code data-testid="verification-recording-id">{recording.id}</code>
              </div>
            </div>
            {onOpenRecording && (
              <button
                type="button"
                data-testid="verification-open-recording"
                onClick={() => onOpenRecording(recording.id)}
                className="nc-button shrink-0 px-1.5 py-0.5 text-[9px]"
              >
                {t(lang, 'Ver grabación', 'View recording')}
              </button>
            )}
          </div>
        )}
      </Section>

      <Section title={t(lang, 'Informe', 'Report')}>
        {report ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-white/45">
              <FileText className="w-3 h-3 text-[var(--nc-text)]" />
              <span className="border border-[var(--nc-border-dark)] px-1 uppercase">{report.format}</span>
              <span>
                {t(lang, 'Generado', 'Generated')} {formatDateTime(report.generatedAt, lang)}
              </span>
              <button
                type="button"
                onClick={downloadReport}
                className="nc-button ml-auto flex items-center gap-1 px-1.5 py-0.5 text-[9px]"
              >
                <Download className="w-3 h-3" />
                {t(lang, 'Descargar', 'Download')}
              </button>
              {recording && onOpenRecording && (
                <button
                  type="button"
                  data-testid="verification-report-recording"
                  onClick={() => onOpenRecording(recording.id)}
                  className="nc-button flex items-center gap-1 px-1.5 py-0.5 text-[9px]"
                >
                  <Film className="w-3 h-3" />
                  {t(lang, 'Ver grabación', 'View recording')}
                </button>
              )}
            </div>
            <pre
              data-testid="verification-report"
              className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words border border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] p-1.5 text-[10px] text-white/80"
            >
              {report.content}
            </pre>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Empty>{t(lang, 'Sin informe generado.', 'No report generated.')}</Empty>
            <button
              type="button"
              data-testid="verification-generate-report"
              onClick={() => void generateReport()}
              className="nc-button px-2 py-0.5 text-[9px]"
            >
              {t(lang, 'Generar Markdown', 'Generate Markdown')}
            </button>
          </div>
        )}
        {reportError && <p className="mt-1 text-[9px] text-red-300">{reportError}</p>}
      </Section>
    </div>
  );
}
