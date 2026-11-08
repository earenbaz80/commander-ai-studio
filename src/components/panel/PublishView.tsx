import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language } from '../../i18n/translations';
import {
  AlertTriangle,
  ExternalLink,
  Package,
  RefreshCw,
  Rocket,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';

interface Release {
  id: string;
  createdAt: string;
  fileCount: number;
  bytes: number;
  outputDir: string;
  built: boolean;
  url: string;
  isPreview: boolean;
  isProduction: boolean;
}

interface EnvironmentRelease {
  id: string;
  createdAt: string;
  fileCount: number;
  bytes: number;
  outputDir: string;
  built: boolean;
  url: string;
}

interface Status {
  project: {
    root: string;
    name: string;
    slug: string;
    buildScript: boolean;
    detectedOutputDir: string | null;
  };
  preview: EnvironmentRelease | null;
  production: EnvironmentRelease | null;
  canRollback: boolean;
  releases: Release[];
}

interface RemoteDeployment {
  id: string;
  releaseId: string;
  environment: 'preview' | 'production';
  url: string;
  createdAt: string;
  status: string;
  provider: string;
}

interface RemoteStatus {
  provider: string;
  projectId: string;
  preview: RemoteDeployment | null;
  production: RemoteDeployment | null;
  canRollback: boolean;
  deployments: RemoteDeployment[];
}

interface PreflightIssue {
  file: string;
  code: string;
  message: string;
}

interface PreflightResult {
  ok: boolean;
  fileCount: number;
  bytes: number;
  issues: PreflightIssue[];
}

interface PublishViewProps {
  projectPath: string;
  lang?: Language;
}

function fmtDate(value: string, lang: Language): string {
  try {
    return new Date(value).toLocaleString(
      lang === 'es' ? 'es-ES' : lang === 'de' ? 'de-DE' : 'en-US',
      { dateStyle: 'short', timeStyle: 'short' }
    );
  } catch {
    return value;
  }
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ENV_LABEL = {
  preview: { es: 'Preview', en: 'Preview', de: 'Preview' },
  production: { es: 'Producción', en: 'Production', de: 'Produktion' },
} as const;

export function PublishView({ projectPath, lang = 'es' }: PublishViewProps) {
  const t = useCallback((es: string, en: string, de: string) => (lang === 'es' ? es : lang === 'de' ? de : en), [lang]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [buildLog, setBuildLog] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [buildFirst, setBuildFirst] = useState(true);
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null);
  const [remoteConfigured, setRemoteConfigured] = useState(false);
  const [remoteProvider, setRemoteProvider] = useState('vercel');
  const [remoteError, setRemoteError] = useState('');
  const [remoteLog, setRemoteLog] = useState('');
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState('');
  const userChangedOutput = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!projectPath) {
      setStatus(null);
      setRemoteStatus(null);
      setRemoteLog('');
      setError('');
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError('');
    setRemoteError('');
    setRemoteLog('');
    try {
      const res = await fetch(`/api/publish/status?root=${encodeURIComponent(projectPath)}`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || t('No se pudo leer el estado', 'Could not read status', 'Status konnte nicht gelesen werden'));
      }
      const next = data.status as Status;
      setStatus(next);
      if (!userChangedOutput.current) setOutputDir(next.project.detectedOutputDir || 'dist');
      if (!next.project.buildScript) setBuildFirst(false);

      try {
        const remoteRes = await fetch(`/api/deploy/status?root=${encodeURIComponent(projectPath)}`, {
          credentials: 'include',
        });
        const remoteData = await remoteRes.json().catch(() => ({}));
        const provider =
          typeof remoteData.provider === 'string' && remoteData.provider
            ? remoteData.provider
            : 'vercel';
        setRemoteProvider(provider);
        if (remoteRes.ok && remoteData.success !== false) {
          if (remoteData.configured === false) {
            setRemoteConfigured(false);
            setRemoteStatus(null);
            setRemoteError('');
          } else if (remoteData.status?.provider) {
            setRemoteConfigured(true);
            setRemoteStatus(remoteData.status as RemoteStatus);
            setRemoteError('');
          } else {
            setRemoteConfigured(false);
            setRemoteStatus(null);
            setRemoteError('');
          }
        } else {
          setRemoteConfigured(false);
          setRemoteStatus(null);
          setRemoteError(
            typeof remoteData.error === 'string' && remoteData.error
              ? remoteData.error
              : t(
                  'No se pudo leer el estado remoto',
                  'Could not read remote status',
                  'Remote-Status konnte nicht gelesen werden',
                ),
          );
        }
      } catch {
        setRemoteConfigured(false);
        setRemoteStatus(null);
        setRemoteError(
          t(
            'No se pudo leer el estado remoto',
            'Could not read remote status',
            'Remote-Status konnte nicht gelesen werden',
          ),
        );
      }
    } catch (e: any) {
      setError(e?.message || t('Error cargando publicación', 'Error loading publishing', 'Fehler beim Laden'));
    } finally {
      setLoading(false);
    }
  }, [projectPath, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const root = status?.project.root;
    const releaseId = status?.preview?.id;
    if (!root || !releaseId) {
      setPreflight(null);
      setPreflightError('');
      setPreflightLoading(false);
      return;
    }

    let cancelled = false;
    setPreflightLoading(true);
    setPreflightError('');
    const failMessage =
      lang === 'es'
        ? 'No se pudo revisar la release'
        : lang === 'de'
          ? 'Release konnte nicht geprüft werden'
          : 'Could not inspect the release';

    fetch(
      `/api/deploy/preflight?root=${encodeURIComponent(root)}&releaseId=${encodeURIComponent(releaseId)}`,
      { credentials: 'include' }
    )
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) {
          throw new Error(data.error || failMessage);
        }
        if (!data.preflight) throw new Error(failMessage);
        return data.preflight as PreflightResult;
      })
      .then((result) => {
        if (!cancelled) setPreflight(result);
      })
      .catch((e: any) => {
        if (!cancelled) {
          setPreflight(null);
          setPreflightError(e?.message || failMessage);
        }
      })
      .finally(() => {
        if (!cancelled) setPreflightLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [status?.project.root, status?.preview?.id, lang]);

  const action = async (kind: 'preview' | 'production' | 'rollback', body: Record<string, unknown>) => {
    if (!projectPath) return;
    setBusy(kind);
    setError('');
    setNotice('');
    setBuildLog('');
    try {
      const res = await fetch(`/api/publish/${kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: projectPath, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || t('La operación falló', 'Operation failed', 'Vorgang fehlgeschlagen'));
      }
      if (data.status) setStatus(data.status as Status);
      if (typeof data.buildLog === 'string') setBuildLog(data.buildLog);
      setNotice(
        kind === 'preview'
          ? t('Release publicada en preview', 'Release published to preview', 'Release in Preview veröffentlicht')
          : kind === 'production'
            ? t('Release promovida a producción', 'Release promoted to production', 'Release in Produktion befördert')
            : t('Rollback completado', 'Rollback complete', 'Rollback abgeschlossen')
      );
    } catch (e: any) {
      setError(e?.message || t('No se pudo publicar', 'Could not publish', 'Veröffentlichung fehlgeschlagen'));
    } finally {
      setBusy(null);
    }
  };

  const publishPreview = () =>
    action('preview', {
      outputDir: outputDir.trim() || undefined,
      build: buildFirst && status?.project.buildScript === true,
    });

  const promote = (releaseId: string) => action('production', { releaseId });
  const rollback = () => action('rollback', {});

  const remoteAction = async (
    kind: 'preview' | 'production' | 'rollback',
    body: Record<string, unknown> = {}
  ) => {
    if (!projectPath) return;
    setBusy(`remote-${kind}`);
    setError('');
    setNotice('');
    setRemoteError('');
    setRemoteLog('');
    try {
      const res = await fetch(`/api/deploy/${kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: projectPath, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || t('El despliegue falló', 'Deployment failed', 'Deployment fehlgeschlagen'));
      }
      if (data.status) setRemoteStatus(data.status as RemoteStatus);
      setNotice(
        kind === 'preview'
          ? t(
              `Preview desplegada en ${remoteStatus?.provider || remoteProvider}`,
              `Preview deployed to ${remoteStatus?.provider || remoteProvider}`,
              `Preview in ${remoteStatus?.provider || remoteProvider} bereitgestellt`,
            )
          : kind === 'production'
            ? t('Producción remota actualizada', 'Remote production updated', 'Remote-Produktion aktualisiert')
            : t('Rollback remoto completado', 'Remote rollback complete', 'Remote-Rollback abgeschlossen')
      );
    } catch (e: any) {
      setError(e?.message || t('No se pudo desplegar', 'Could not deploy', 'Deployment fehlgeschlagen'));
    } finally {
      setBusy(null);
    }
  };

  const showRemoteLog = async (deploymentId: string) => {
    if (!projectPath) return;
    setBusy('remote-log');
    setError('');
    setNotice('');
    setRemoteLog('');
    try {
      const res = await fetch(
        `/api/deploy/logs?root=${encodeURIComponent(projectPath)}&deploymentId=${encodeURIComponent(deploymentId)}`,
        { credentials: 'include' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || t('No se pudo leer el log', 'Could not read log', 'Log konnte nicht gelesen werden'));
      }
      setRemoteLog(typeof data.log === 'string' ? data.log : '');
    } catch (e: any) {
      setError(e?.message || t('No se pudo leer el log', 'Could not read log', 'Log konnte nicht gelesen werden'));
    } finally {
      setBusy(null);
    }
  };

  const deployRemotePreview = () => remoteAction('preview', { releaseId: status?.preview?.id });
  const promoteRemote = (deploymentId: string) => remoteAction('production', { deploymentId });
  const rollbackRemote = () => remoteAction('rollback');

  const canUse = Boolean(projectPath) && !busy;
  const preview = status?.preview || null;
  const production = status?.production || null;
  const remotePreview = remoteStatus?.preview || null;
  const remoteProduction = remoteStatus?.production || null;

  const envCard = (kind: 'preview' | 'production', item: EnvironmentRelease | null) => {
    const isProd = kind === 'production';
    return (
      <div className="border-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] p-2 flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-bold text-[var(--nc-text-accent)]">
            {isProd ? <ShieldCheck className="w-3.5 h-3.5" /> : <Rocket className="w-3.5 h-3.5" />}
            {ENV_LABEL[kind][lang]}
          </span>
          {item && (
            <button
              type="button"
              onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
              className="nc-button !px-1.5 !py-0.5 text-[9px] flex items-center gap-1"
              title={t('Abrir en una pestaña', 'Open in a tab', 'In neuem Tab öffnen')}
            >
              <ExternalLink className="w-3 h-3" />
              {t('Abrir', 'Open', 'Öffnen')}
            </button>
          )}
        </div>
        {item ? (
          <>
            <div className="text-[10px] text-[var(--nc-text)] truncate" title={item.id}>{item.id}</div>
            <div className="text-[9px] text-[var(--nc-text-dim)]">
              {fmtDate(item.createdAt, lang)} · {fmtBytes(item.bytes)} · {item.fileCount} {t('archivos', 'files', 'Dateien')}
            </div>
            <div className="text-[9px] text-[var(--nc-text-dim)] break-all select-all">{item.url}</div>
            {!isProd && (
              <button
                type="button"
                onClick={() => preview && promote(preview.id)}
                disabled={!canUse || !preview}
                className="nc-button mt-1 !py-1 text-[9px] flex items-center justify-center gap-1 disabled:opacity-50"
              >
                <UploadCloud className="w-3 h-3" />
                {t('Promover a producción', 'Promote to production', 'In Produktion befördern')}
              </button>
            )}
            {isProd && (
              <button
                type="button"
                onClick={rollback}
                disabled={!canUse || !status?.canRollback}
                className="nc-button mt-1 !py-1 text-[9px] flex items-center justify-center gap-1 disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                {t('Volver a la anterior', 'Roll back', 'Zurücksetzen')}
              </button>
            )}
          </>
        ) : (
          <div className="text-[10px] text-[var(--nc-text-dim)] py-2">
            {t('Sin publicar todavía', 'Not published yet', 'Noch nicht veröffentlicht')}
          </div>
        )}
      </div>
    );
  };

  const remoteCard = (kind: 'preview' | 'production', item: RemoteDeployment | null) => {
    const isProd = kind === 'production';
    return (
      <div className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] p-2 flex flex-col gap-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-[var(--nc-text-accent)]">
            {isProd
              ? t('Producción remota', 'Remote production', 'Remote-Produktion')
              : t('Preview remota', 'Remote preview', 'Remote-Preview')}
          </span>
          {item && <span className="text-[9px] text-[var(--nc-text-dim)]">{item.status}</span>}
        </div>
        {item ? (
          <>
            <div className="text-[10px] text-[var(--nc-text)] truncate" title={item.id}>{item.id}</div>
            <div className="text-[9px] text-[var(--nc-text-dim)]">
              release {item.releaseId} · {fmtDate(item.createdAt, lang)}
            </div>
            <div className="text-[9px] text-[var(--nc-text-dim)] break-all select-all">{item.url}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {!item.url.includes('.invalid') && (
                <button
                  type="button"
                  onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
                  className="nc-button !px-1.5 !py-0.5 text-[9px] flex items-center gap-1"
                  title={t('Abrir en una pestaña', 'Open in a tab', 'In neuem Tab öffnen')}
                >
                  <ExternalLink className="w-3 h-3" />
                  {t('Abrir', 'Open', 'Öffnen')}
                </button>
              )}
              {!isProd && (
                <button
                  type="button"
                  onClick={() => void promoteRemote(item.id)}
                  disabled={!canUse || !remoteConfigured || item.status !== 'ready'}
                  className="nc-button !px-1.5 !py-0.5 text-[9px] disabled:opacity-50"
                >
                  {t('Promover remoto', 'Promote remote', 'Remote befördern')}
                </button>
              )}
              {isProd && (
                <button
                  type="button"
                  onClick={() => void rollbackRemote()}
                  disabled={!canUse || !remoteConfigured || !remoteStatus?.canRollback || item.status !== 'ready'}
                  className="nc-button !px-1.5 !py-0.5 text-[9px] disabled:opacity-50"
                >
                  {t('Rollback remoto', 'Remote rollback', 'Remote-Rollback')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void showRemoteLog(item.id)}
                disabled={!canUse || !remoteConfigured}
                className="nc-button !px-1.5 !py-0.5 text-[9px] disabled:opacity-50"
              >
                {t('Log', 'Log', 'Log')}
              </button>
            </div>
          </>
        ) : (
          <div className="text-[10px] text-[var(--nc-text-dim)] py-1">
            {t('Sin deployment remoto', 'No remote deployment', 'Kein Remote-Deployment')}
          </div>
        )}
      </div>
    );
  };

  if (!projectPath) {
    return (
      <div className="p-3 font-mono text-xs text-[var(--nc-text)]">
        <div className="flex items-center gap-2 text-[var(--nc-text-accent)] font-bold">
          <AlertTriangle className="w-4 h-4" />
          {t('Sin proyecto activo', 'No active project', 'Kein aktives Projekt')}
        </div>
        <p className="mt-2 text-[10px] text-[var(--nc-text-dim)]">
          {t(
            'Abre una pestaña con un proyecto para publicar su build.',
            'Open a tab with a project to publish its build.',
            'Öffne einen Tab mit einem Projekt, um dessen Build zu veröffentlichen.'
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto p-2 gap-2 font-mono text-xs text-[var(--nc-text)]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-[var(--nc-text-accent)] flex items-center gap-1.5">
            <Package className="w-4 h-4" />
            {t('Publicar', 'Publish', 'Veröffentlichen')}
          </div>
          <div className="text-[9px] text-[var(--nc-text-dim)] truncate" title={projectPath}>
            {status?.project.name || projectPath}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || Boolean(busy)}
          className="nc-button !px-2 !py-1 text-[10px]"
          title={t('Actualizar estado', 'Refresh status', 'Status aktualisieren')}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="border border-[var(--nc-danger)] bg-[var(--nc-bg-panel)] px-2 py-1 text-[10px] text-[var(--nc-danger)]">
          {error}
        </div>
      )}
      {notice && (
        <div className="border border-[var(--nc-text-accent)] bg-[var(--nc-bg-panel)] px-2 py-1 text-[10px] text-[var(--nc-text-accent)]">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {envCard('preview', preview)}
        {envCard('production', production)}
      </div>

      <div className="border-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] p-2 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold text-[var(--nc-text-accent)] flex items-center gap-1.5">
              <UploadCloud className="w-4 h-4" />
              {t('Destino remoto', 'Remote target', 'Remote-Ziel')}
              <span className="text-[9px] px-1 bg-[var(--nc-active-bg)] text-black font-bold">
                {remoteStatus?.provider || remoteProvider}
              </span>
            </div>
            <div className="text-[9px] text-[var(--nc-text-dim)]">
              {remoteError
                ? remoteError
                : !remoteConfigured
                  ? t(
                      'Vercel no está configurado. Define VERCEL_TOKEN y VERCEL_PROJECT_ID en .env y reinicia Commander.',
                      'Vercel is not configured. Set VERCEL_TOKEN and VERCEL_PROJECT_ID in .env and restart Commander.',
                      'Vercel ist nicht konfiguriert. Setze VERCEL_TOKEN und VERCEL_PROJECT_ID in .env und starte Commander neu.'
                    )
                  : t(
                      'Vercel: la release se sube ya construida y el token vive sólo en el servidor.',
                      'Vercel: the prebuilt release is uploaded and the token stays on the server.',
                      'Vercel: Die fertige Release wird hochgeladen und das Token bleibt auf dem Server.'
                    )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void deployRemotePreview()}
            disabled={!canUse || !remoteConfigured || !status?.preview || !preflight?.ok || preflightLoading}
            className="nc-button !px-2 !py-1 text-[9px] flex items-center gap-1 disabled:opacity-50"
            title={t('Desplegar la release local de preview', 'Deploy the local preview release', 'Lokale Preview-Release bereitstellen')}
          >
            <UploadCloud className="w-3 h-3" />
            {busy === 'remote-preview'
              ? t('Desplegando…', 'Deploying…', 'Wird bereitgestellt…')
              : t('Desplegar preview', 'Deploy preview', 'Preview bereitstellen')}
          </button>
        </div>
        <div className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] p-2 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-[var(--nc-text-accent)] flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              {t('Preflight', 'Preflight', 'Preflight')}
            </span>
            {preflight && (
              <span className="text-[9px] text-[var(--nc-text-dim)]">
                {preflight.fileCount} {t('archivos', 'files', 'Dateien')} · {fmtBytes(preflight.bytes)}
              </span>
            )}
          </div>
          {preflightLoading && (
            <div className="text-[9px] text-[var(--nc-text-dim)]">
              {t('Revisando la release…', 'Inspecting the release…', 'Release wird geprüft…')}
            </div>
          )}
          {preflightError && (
            <div className="text-[9px] text-[var(--nc-danger)]">{preflightError}</div>
          )}
          {!status?.preview && (
            <div className="text-[9px] text-[var(--nc-text-dim)]">
              {t(
                'Crea una release local para revisarla antes de desplegar.',
                'Create a local release to inspect it before deploying.',
                'Erstelle eine lokale Release, um sie vor dem Deployment zu prüfen.'
              )}
            </div>
          )}
          {preflight?.ok && (
            <div className="text-[9px] text-[var(--nc-text)] flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-[var(--nc-text-accent)]" />
              {t(
                'Release lista para desplegar',
                'Release ready to deploy',
                'Release bereit zur Bereitstellung'
              )}
            </div>
          )}
          {preflight && !preflight.ok && (
            <div className="flex flex-col gap-1">
              <div className="text-[9px] text-[var(--nc-danger)] flex items-center gap-1 font-bold">
                <AlertTriangle className="w-3 h-3" />
                {t(
                  'La release tiene problemas',
                  'The release has problems',
                  'Die Release hat Probleme'
                )}
              </div>
              <ul className="space-y-0.5">
                {preflight.issues.slice(0, 6).map((issue) => (
                  <li
                    key={`${issue.code}:${issue.file}`}
                    className="text-[9px] text-[var(--nc-text-dim)] break-all"
                  >
                    {issue.message}
                  </li>
                ))}
              </ul>
              {preflight.issues.length > 6 && (
                <div className="text-[9px] text-[var(--nc-text-dim)]">
                  {t(
                    `+${preflight.issues.length - 6} más`,
                    `+${preflight.issues.length - 6} more`,
                    `+${preflight.issues.length - 6} weitere`
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2">
          {remoteCard('preview', remotePreview)}
          {remoteCard('production', remoteProduction)}
        </div>
        {remoteLog && (
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-[9px] text-[var(--nc-text-dim)] border border-[var(--nc-border-dark)] bg-black/20 p-1.5">
            {remoteLog}
          </pre>
        )}
      </div>

      <div className="border-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] p-2 flex flex-col gap-1.5">
        <div className="font-bold text-[var(--nc-text-accent)]">
          {t('Nueva release', 'New release', 'Neue Release')}
        </div>
        <label className="text-[9px] text-[var(--nc-text-dim)] flex flex-col gap-0.5">
          {t('Carpeta de salida', 'Output folder', 'Ausgabeordner')}
          <input
            value={outputDir}
            onChange={(e) => {
              userChangedOutput.current = true;
              setOutputDir(e.target.value);
            }}
            placeholder={status?.project.detectedOutputDir || 'dist'}
            className="bg-[var(--nc-bg-main)] border border-[var(--nc-border-dark)] px-1.5 py-1 text-[10px] text-[var(--nc-text)] outline-none focus:border-[var(--nc-border-light)]"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--nc-text)] cursor-pointer">
          <input
            type="checkbox"
            checked={buildFirst && status?.project.buildScript === true}
            disabled={!status?.project.buildScript || Boolean(busy)}
            onChange={(e) => setBuildFirst(e.target.checked)}
          />
          {t('Construir antes de publicar', 'Build before publishing', 'Vor dem Veröffentlichen bauen')}
          {status && !status.project.buildScript && (
            <span className="text-[9px] text-[var(--nc-text-dim)]">
              ({t('sin script build', 'no build script', 'kein Build-Skript')})
            </span>
          )}
        </label>
        <div className="text-[9px] text-[var(--nc-text-dim)]">
          {t(
            'La release se sirve en una URL local estable; promover no vuelve a copiar archivos.',
            'The release is served at a stable local URL; promoting does not copy files again.',
            'Die Release wird unter einer stabilen lokalen URL ausgeliefert; Befördern kopiert keine Dateien erneut.'
          )}
        </div>
        <button
          type="button"
          onClick={() => void publishPreview()}
          disabled={!canUse}
          className="nc-button !py-1.5 text-[10px] flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <UploadCloud className="w-3.5 h-3.5" />
          {busy === 'preview'
            ? t('Publicando…', 'Publishing…', 'Wird veröffentlicht…')
            : t('Publicar en preview', 'Publish to preview', 'In Preview veröffentlichen')}
        </button>
      </div>

      {buildLog && (
        <details className="border border-[var(--nc-border-dark)] bg-black/20 p-1.5">
          <summary className="cursor-pointer text-[9px] text-[var(--nc-text-dim)]">
            {t('Salida del build', 'Build output', 'Build-Ausgabe')}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[9px] text-[var(--nc-text-dim)]">
            {buildLog}
          </pre>
        </details>
      )}

      <div className="border-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)]">
        <div className="px-2 py-1 border-b border-[var(--nc-border-dark)] font-bold text-[var(--nc-text-accent)]">
          {t('Historial', 'History', 'Verlauf')}
        </div>
        {status && status.releases.length > 0 ? (
          <div className="overflow-auto">
            <table className="w-full text-[9px] border-collapse">
              <thead>
                <tr className="text-[var(--nc-text-dim)] border-b border-[var(--nc-border-dark)]">
                  <th className="text-left p-1">{t('Release', 'Release', 'Release')}</th>
                  <th className="text-left p-1">{t('Fecha', 'Date', 'Datum')}</th>
                  <th className="text-right p-1">{t('Tamaño', 'Size', 'Größe')}</th>
                  <th className="p-1"></th>
                </tr>
              </thead>
              <tbody>
                {status.releases.map((release) => (
                  <tr key={release.id} className="border-b border-[var(--nc-border-dark)]/60">
                    <td className="p-1">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="truncate max-w-[110px]" title={release.id}>{release.id}</span>
                        {release.isProduction && (
                          <span className="px-1 rounded-sm bg-[var(--nc-text-accent)] text-black font-bold">
                            {t('PROD', 'PROD', 'PROD')}
                          </span>
                        )}
                        {release.isPreview && (
                          <span className="px-1 rounded-sm bg-[var(--nc-active-bg)] text-black font-bold">
                            {t('PREV', 'PREV', 'PREV')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-1 text-[var(--nc-text-dim)]">{fmtDate(release.createdAt, lang)}</td>
                    <td className="p-1 text-right text-[var(--nc-text-dim)]">{fmtBytes(release.bytes)}</td>
                    <td className="p-1 text-right">
                      <button
                        type="button"
                        onClick={() => promote(release.id)}
                        disabled={!canUse}
                        className="nc-button !px-1 !py-0.5 disabled:opacity-50"
                        title={t('Promover a producción', 'Promote to production', 'In Produktion befördern')}
                      >
                        <UploadCloud className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-2 text-[10px] text-[var(--nc-text-dim)]">
            {loading ? t('Cargando…', 'Loading…', 'Lädt…') : t('Aún no hay releases', 'No releases yet', 'Noch keine Releases')}
          </div>
        )}
      </div>
    </div>
  );
}

export default PublishView;
