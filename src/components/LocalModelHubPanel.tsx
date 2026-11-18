import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { DownloadedLocalModel } from '../types/studio';
import type {
  LocalDownloadJob,
  LocalGgufFile,
  LocalModelRecord,
} from '../lib/localModelHub';
import type { LocalRuntimeStatus, LocalRuntimeTuning } from '../lib/localLlamaRuntime';
import type {
  LocalRuntimeProposal,
  LocalRuntimeProposedTuning,
} from '../lib/localRuntimeProposal';
import { splitGgufParts } from '../lib/ggufName';

interface HubModel {
  id: string;
  downloads: number;
  likes: number;
  pipelineTag: string;
  tags: string[];
  lastModified?: string;
}

type HubFile = LocalGgufFile;
type DownloadJob = LocalDownloadJob;
type RuntimeStatus = LocalRuntimeStatus & {
  availability?: { available: boolean; server?: string; cli?: string };
};

type RuntimeProposal = LocalRuntimeProposal & {
  /** Ajustes guardados en disco que prevalecen sobre la propuesta derivada. */
  saved?: LocalRuntimeTuning;
  profile?: { moe?: boolean } | null;
  hardware?: {
    vramTotalMb?: number;
    vramFreeMb?: number;
    ramTotalGb?: number;
    gpuName?: string;
  };
};

interface LocalModelHubPanelProps {
  selectedModel: string;
  onSelectModel: (id: string) => void;
  onAddDownloadedModel: (model: DownloadedLocalModel) => void;
  onRemoveDownloadedModel: (modelId: string) => void;
  /** Mantiene la cabecera del playground sincronizada con el disco real. */
  onLibraryChange?: (stats: { count: number; sizeMb: number }) => void;
  /** Refleja en la cabecera si llama-server está instalado. */
  onRuntimeStatusChange?: (available: boolean) => void;
  lang?: 'es' | 'en' | 'de';
}

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

const formatSpeed = (bytes: number): string =>
  bytes > 0 ? `${formatBytes(bytes)}/s` : '—';

const formatEta = (seconds: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  return `${Math.round(seconds)} s`;
};

export const LocalModelHubPanel: React.FC<LocalModelHubPanelProps> = ({
  selectedModel,
  onSelectModel,
  onAddDownloadedModel,
  onRemoveDownloadedModel,
  onLibraryChange,
  onRuntimeStatusChange,
  lang = 'es',
}) => {
  const L = (es: string, en: string) => (lang === 'es' ? es : en);
  const [query, setQuery] = useState('qwen');
  const [models, setModels] = useState<HubModel[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [filesRepo, setFilesRepo] = useState<string | null>(null);
  const [files, setFiles] = useState<HubFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [installed, setInstalled] = useState<LocalModelRecord[]>([]);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [context, setContext] = useState('8192');
  const [gpuLayers, setGpuLayers] = useState('99');
  const [runtimeModel, setRuntimeModel] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [jinja, setJinja] = useState(true);
  const [flashAttention, setFlashAttention] = useState(true);
  const [cpuMoeLayers, setCpuMoeLayers] = useState('');
  const [cacheTypeK, setCacheTypeK] = useState('');
  const [cacheTypeV, setCacheTypeV] = useState('');
  const [tensorSplit, setTensorSplit] = useState('');
  const [proposal, setProposal] = useState<RuntimeProposal | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeDownloadBusy, setRuntimeDownloadBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const seenCompleted = useRef<Set<string>>(new Set());

  const refreshLibrary = useCallback(async () => {
    try {
      const res = await fetch('/api/local-models');
      const data = await res.json().catch(() => ({}));
      if (data.success && Array.isArray(data.library)) {
        setInstalled(data.library);
        setRuntimeModel((current) => current || data.library[0]?.filename || '');
        onLibraryChange?.({
          count: data.library.length,
          sizeMb: data.library.reduce(
            (sum: number, model: LocalModelRecord) => sum + (Number(model.sizeMb) || 0),
            0
          ),
        });
      }
      if (data.success && data.downloads) setJobs(data.downloads);
    } catch {
      /* la biblioteca se reintenta al terminar una descarga */
    }
  }, [onLibraryChange]);

  const refreshRuntime = useCallback(async () => {
    try {
      const res = await fetch('/api/local-models/runtime');
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setRuntime(data);
        onRuntimeStatusChange?.(Boolean(data.availability?.available));
      }
    } catch {
      /* estado opcional */
    }
  }, [onRuntimeStatusChange]);

  /** Vuelca una propuesta en los campos editables del runtime. */
  const applyProposed = useCallback((proposed: Partial<LocalRuntimeProposedTuning>) => {
    setContext(String(proposed.context ?? 8192));
    setGpuLayers(String(proposed.gpuLayers ?? 99));
    setCpuMoeLayers(proposed.cpuMoeLayers == null ? '' : String(proposed.cpuMoeLayers));
    setCacheTypeK(proposed.cacheTypeK || '');
    setCacheTypeV(proposed.cacheTypeV || '');
    setJinja(proposed.jinja !== false);
    setFlashAttention(proposed.flashAttention !== false);
    setTensorSplit(proposed.tensorSplit || '');
  }, []);

  const search = useCallback(async (value = query) => {
    setSearching(true);
    setSearchError('');
    try {
      const res = await fetch(`/api/local-models/hub/search?q=${encodeURIComponent(value)}&limit=24`);
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || 'No se pudo buscar en Hugging Face');
      setModels(Array.isArray(data.models) ? data.models : []);
    } catch (e: any) {
      setSearchError(e?.message || 'No se pudo buscar en Hugging Face');
    } finally {
      setSearching(false);
    }
  }, [query]);

  useEffect(() => {
    void search('qwen');
    void refreshLibrary();
    void refreshRuntime();
    // Sólo al entrar al panel; después se refresca con acciones explícitas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al elegir un modelo, Commander lee su cabecera GGUF y la memoria de la
  // máquina, y deja los campos con los valores propuestos antes de arrancar.
  useEffect(() => {
    if (!runtimeModel) {
      setProposal(null);
      return;
    }
    let alive = true;
    setProposalLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/local-models/runtime/proposal?model=${encodeURIComponent(runtimeModel)}`
        );
        const data = await res.json().catch(() => ({}));
        if (!alive || !data.success) return;
        setProposal(data as RuntimeProposal);
        // Los ajustes guardados ganan: si el usuario apagó jinja o fijó un
        // reparto MoE, el reinicio no debe volver a los valores por defecto.
        applyProposed({
          ...((data.proposed || {}) as Partial<LocalRuntimeProposedTuning>),
          ...((data.saved || {}) as LocalRuntimeTuning),
        });
      } catch {
        /* la propuesta es opcional: quedan los valores por defecto */
      } finally {
        if (alive) setProposalLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [runtimeModel, applyProposed]);

  useEffect(() => {
    let alive = true;
    const timer = window.setInterval(() => {
      if (!alive) return;
      void (async () => {
        try {
          const res = await fetch('/api/local-models/jobs');
          const data = await res.json().catch(() => ({}));
          if (!alive || !data.success || !Array.isArray(data.jobs)) return;
          setJobs(data.jobs);
          let completed = false;
          for (const job of data.jobs as DownloadJob[]) {
            if (job.status !== 'completed' || seenCompleted.current.has(job.id)) continue;
            seenCompleted.current.add(job.id);
            completed = true;
            onAddDownloadedModel({
              id: `local/${job.filename}`,
              name: job.filename,
              hfRepoId: `local/${job.filename}`,
              sizeMb: Math.round((job.totalBytes || job.downloadedBytes) / 1024 / 1024),
              downloadDate: new Date().toISOString().slice(0, 10),
              pipelineTag: 'gguf',
              quantization: job.quantization || 'GGUF',
              status: 'ready',
              progress: 100,
            });
          }
          if (completed) {
            setNotice('Modelo descargado. Ya puedes arrancar el runtime y usarlo en Commander.');
            await refreshLibrary();
          }
        } catch {
          /* siguiente tick */
        }
      })();
    }, 1200);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [onAddDownloadedModel, refreshLibrary]);

  const openFiles = async (repoId: string) => {
    setFilesRepo(repoId);
    setFiles([]);
    setFilesLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/local-models/hub/files?repoId=${encodeURIComponent(repoId)}`);
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || 'No se pudieron leer los archivos');
      setFiles(Array.isArray(data.files) ? data.files : []);
      if (!data.files?.length) setError('Ese repositorio no publica archivos GGUF.');
    } catch (e: any) {
      setError(e?.message || 'No se pudieron leer los archivos');
    } finally {
      setFilesLoading(false);
    }
  };

  const download = async (repoId: string, file: HubFile) => {
    setError('');
    setNotice('');
    const parts = file.parts?.length ? file.parts : [file];
    const started: DownloadJob[] = [];
    try {
      for (const part of parts) {
        const res = await fetch('/api/local-models/hub/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repoId,
            filename: part.filename,
            sizeBytes: part.sizeBytes,
            quantization: file.quantization,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!data.success) {
          // Un reintento de la misma descarga no debe abortar las demás partes.
          if (/ya está instalado/i.test(String(data.error || ''))) continue;
          throw new Error(data.error || 'No se pudo iniciar la descarga');
        }
        started.push(data.job);
      }
      setJobs((current) => [
        ...started,
        ...current.filter((job) => !started.some((item) => item.id === job.id)),
      ]);
      setNotice(
        parts.length > 1
          ? `Descarga iniciada: ${file.filename} (${parts.length} partes)`
          : `Descarga iniciada: ${file.filename}`
      );
    } catch (e: any) {
      setError(e?.message || 'No se pudo iniciar la descarga');
    }
  };

  const jobAction = async (job: DownloadJob, action: 'pause' | 'resume' | 'cancel' | 'retry') => {
    try {
      const res = await fetch(`/api/local-models/jobs/${encodeURIComponent(job.id)}/${action}`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || `No se pudo ${action}`);
      setJobs((current) => current.map((item) => (item.id === data.job.id ? data.job : item)));
    } catch (e: any) {
      setError(e?.message || `No se pudo ${action}`);
    }
  };

  const remove = async (filename: string) => {
    if (!window.confirm(`¿Borrar ${filename} del disco?`)) return;
    try {
      const res = await fetch(`/api/local-models/file/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || 'No se pudo borrar');
      onRemoveDownloadedModel(`local/${filename}`);
      setInstalled((current) => current.filter((model) => model.filename !== filename));
      if (runtime?.model === filename) setRuntime(null);
      await refreshLibrary();
      await refreshRuntime();
    } catch (e: any) {
      setError(e?.message || 'No se pudo borrar el modelo');
    }
  };

  const startRuntime = async () => {
    if (!runtimeModel) return;
    setRuntimeBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/local-models/runtime/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: runtimeModel,
          context: Number(context) || 8192,
          gpuLayers: Number(gpuLayers),
          jinja,
          flashAttention,
          cpuMoeLayers,
          cacheTypeK,
          cacheTypeV,
          tensorSplit,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo arrancar llama.cpp');
      setRuntime(data);
      setNotice(`Runtime listo: ${data.model || runtimeModel}`);
      onSelectModel(`local/${runtimeModel}`);
    } catch (e: any) {
      setError(e?.message || 'No se pudo arrancar llama.cpp');
    } finally {
      setRuntimeBusy(false);
    }
  };

  const stopRuntime = async () => {
    setRuntimeBusy(true);
    try {
      const res = await fetch('/api/local-models/runtime/stop', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo detener llama.cpp');
      setRuntime(data);
    } catch (e: any) {
      setError(e?.message || 'No se pudo detener llama.cpp');
    } finally {
      setRuntimeBusy(false);
    }
  };

  const downloadRuntime = async () => {
    setRuntimeDownloadBusy(true);
    setError('');
    try {
      const infoRes = await fetch('/api/local-models/runtime-release-info');
      const info = await infoRes.json().catch(() => ({}));
      if (!info.success || !info.url || !info.filename) {
        throw new Error(info.error || 'No hay un runtime compatible para este sistema');
      }
      const ok = window.confirm(
        `Descargar runtime de llama.cpp?\n\n${info.filename}\n${info.url}\n\nSe instalará en runtime/llama.`
      );
      if (!ok) return;
      // El binario CUDA no arranca sin las DLLs de cudart: se bajan juntos.
      const downloads = [
        { url: String(info.url), filename: String(info.filename) },
        ...(info.cudartUrl && info.cudartFilename
          ? [{ url: String(info.cudartUrl), filename: String(info.cudartFilename) }]
          : []),
      ];
      let last: any = null;
      for (const item of downloads) {
        const res = await fetch('/api/local-models/download-runtime', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true, url: item.url, filename: item.filename }),
        });
        last = await res.json().catch(() => ({}));
        if (!last.success) throw new Error(last.error || 'No se pudo descargar el runtime');
      }
      setNotice(last?.extracted ? 'Runtime de llama.cpp instalado.' : 'Runtime descargado; extrae el archivo manualmente.');
      await refreshRuntime();
    } catch (e: any) {
      setError(e?.message || 'No se pudo descargar el runtime');
    } finally {
      setRuntimeDownloadBusy(false);
    }
  };

  const activeJobs = jobs.filter((job) => ['queued', 'downloading', 'paused', 'error'].includes(job.status));

  return (
    <div className="space-y-3 font-mono text-[11px]" data-testid="local-model-hub-panel">
      <div className="space-y-2 border-2 border-[var(--nc-text-accent)] bg-[var(--nc-bg-panel)] p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-bold text-[var(--nc-text-accent)]">
              {L('DESCARGA NATIVA DE GGUF', 'NATIVE GGUF DOWNLOAD')}
            </div>
            <div className="text-[10px] text-[var(--nc-text-dim)]">
              {L(
                'Hugging Face → disco local → llama.cpp. Sin Ollama, LM Studio ni Strata.',
                'Hugging Face → local disk → llama.cpp. No Ollama, LM Studio or Strata.'
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void search()}
            disabled={searching}
            className="flex shrink-0 items-center gap-1 border border-[var(--nc-text-accent)] px-2 py-1 text-[10px] font-bold text-[var(--nc-text-accent)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${searching ? 'animate-spin' : ''}`} />
            BUSCAR
          </button>
        </div>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-[var(--nc-text-dim)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void search();
              }}
              placeholder={L('Qwen, Llama, Gemma, DeepSeek… o pega org/repo', 'Qwen, Llama, Gemma, DeepSeek… or paste org/repo')}
              className="w-full border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] py-1.5 pl-7 pr-2 text-[11px] text-white outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void search()}
            disabled={searching}
            className="bg-[var(--nc-active-bg)] px-3 py-1 text-[10px] font-bold text-black disabled:opacity-50"
          >
            {searching ? 'BUSCANDO…' : 'BUSCAR'}
          </button>
        </div>
        {searchError && <div className="text-[10px] text-red-300">{searchError}</div>}
      </div>

      {(notice || error) && (
        <div
          className={`flex items-start gap-2 border p-2 text-[10px] ${
            error
              ? 'border-red-400/60 bg-red-950/30 text-red-200'
              : 'border-emerald-400/60 bg-emerald-950/20 text-emerald-200'
          }`}
        >
          {error ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          <span className="flex-1">{error || notice}</span>
          <button type="button" onClick={() => { setError(''); setNotice(''); }} aria-label={L('Cerrar aviso', 'Close notice')}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {activeJobs.length > 0 && (
        <div className="border border-[var(--nc-border-light)] bg-[var(--nc-bg-deep)] p-2 space-y-2">
          <div className="font-bold text-[var(--nc-text-accent)]">{L('DESCARGAS', 'DOWNLOADS')}</div>
          {activeJobs.map((job) => (
            <div key={job.id} className="border border-[var(--nc-border-light)]/40 p-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-bold text-white" title={job.filename}>{job.filename}</span>
                <span className="shrink-0 text-[10px] text-[var(--nc-text-accent)]">
                  {job.progress.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)]">
                <div className="h-full bg-[var(--nc-active-bg)] transition-all" style={{ width: `${job.progress}%` }} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[9px] text-[var(--nc-text-dim)]">
                <span>
                  {formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)} · {formatSpeed(job.speedBytesPerSecond)} · ETA {formatEta(job.etaSeconds)}
                </span>
                <span className="flex gap-1">
                  {job.status === 'downloading' && (
                    <button type="button" onClick={() => void jobAction(job, 'pause')} className="border border-amber-400/60 px-1.5 py-0.5 text-amber-200">
                      <Pause className="h-3 w-3" />
                    </button>
                  )}
                  {(job.status === 'paused' || job.status === 'error') && (
                    <button type="button" onClick={() => void jobAction(job, job.status === 'error' ? 'retry' : 'resume')} className="border border-emerald-400/60 px-1.5 py-0.5 text-emerald-200">
                      <Play className="h-3 w-3" />
                    </button>
                  )}
                  <button type="button" onClick={() => void jobAction(job, 'cancel')} className="border border-red-400/60 px-1.5 py-0.5 text-red-200">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              </div>
              {job.error && <div className="text-[9px] text-red-300">{job.error}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="min-w-0 space-y-2 border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] p-2">
          <div className="bg-[var(--nc-header-bg)] px-2 py-0.5 font-bold text-black">
            {L('MODELOS GGUF EN HUGGING FACE', 'GGUF MODELS ON HUGGING FACE')}
          </div>
          {models.length === 0 ? (
            <div className="p-3 text-center text-[10px] text-[var(--nc-text-dim)]">
              {searching ? L('Buscando modelos…', 'Searching models…') : L('Sin resultados.', 'No results.')}
            </div>
          ) : (
            <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
              {models.map((model) => (
                <div key={model.id} className="border border-[var(--nc-border-light)]/40 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-bold text-[var(--nc-text-accent)]" title={model.id}>
                      {model.id}
                    </span>
                    <span className="shrink-0 text-[9px] text-[var(--nc-text-dim)]">
                      {model.downloads.toLocaleString()} desc.
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-[9px] text-[var(--nc-text-dim)]">{model.pipelineTag}</span>
                    <button
                      type="button"
                      onClick={() => void openFiles(model.id)}
                      className="border border-[var(--nc-text-accent)] px-2 py-0.5 text-[9px] font-bold text-[var(--nc-text-accent)]"
                    >
                      {L('VER GGUF', 'VIEW GGUF')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-2 border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] p-2">
          <div
            className="truncate bg-[var(--nc-header-bg)] px-2 py-0.5 font-bold text-black"
            title={filesRepo || undefined}
          >
            {filesRepo ? `${L('ARCHIVOS', 'FILES')} · ${filesRepo}` : L('ELIGE UN REPOSITORIO', 'CHOOSE A REPOSITORY')}
          </div>
          {filesLoading ? (
            <div className="flex items-center gap-2 p-3 text-[10px] text-[var(--nc-text-dim)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {L('Leyendo variantes…', 'Reading variants…')}
            </div>
          ) : !filesRepo ? (
            <div className="p-3 text-[10px] text-[var(--nc-text-dim)]">
              {L('Pulsa «VER GGUF» para elegir cuantización y descargar el archivo real.', 'Press “VIEW GGUF” to choose a quantization and download the real file.')}
            </div>
          ) : files.length === 0 ? (
            <div className="p-3 text-[10px] text-[var(--nc-text-dim)]">{L('Sin archivos GGUF en este repositorio.', 'No GGUF files in this repository.')}</div>
          ) : (
            <div className="space-y-1">
              {files.map((file) => (
                <div key={file.filename} className="border border-[var(--nc-border-light)]/40 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex-1 break-all font-bold text-white">{file.filename}</span>
                    <span className="shrink-0 text-[9px] text-[var(--nc-text-accent)]">{file.quantization}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="flex-1 text-[9px] text-[var(--nc-text-dim)]">
                      {formatBytes(file.sizeBytes)}
                      {file.splitTotal ? ` · ${file.splitTotal} partes` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => void download(filesRepo, file)}
                      className="flex items-center gap-1 bg-[var(--nc-active-bg)] px-2 py-0.5 text-[9px] font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
                      title={L('Descargar', 'Download')}
                    >
                      <Download className="h-3 w-3" />
                      {file.parts && file.parts.length > 1
                        ? `${L('DESCARGAR', 'DOWNLOAD')} (${file.parts.length})`
                        : L('DESCARGAR', 'DOWNLOAD')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2 border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-bold text-[var(--nc-text-accent)]">
            <Cpu className="h-3.5 w-3.5" /> {L('RUNTIME NATIVO · llama.cpp', 'NATIVE RUNTIME · llama.cpp')}
          </div>
          <span className={`text-[9px] font-bold ${runtime?.state === 'running' ? 'text-emerald-300' : 'text-[var(--nc-text-dim)]'}`}>
            {runtime?.state?.toUpperCase() || 'DESCONOCIDO'}
          </span>
        </div>
        {runtime?.availability && !runtime.availability.available && (
          <div className="flex flex-wrap items-center justify-between gap-2 border border-amber-400/40 p-2 text-[10px] text-amber-200">
            <span>{L('Falta llama-server. Descarga el runtime para ejecutar GGUF sin dependencias externas.', 'llama-server is missing. Download the runtime to run GGUF without external dependencies.')}</span>
            <button
              type="button"
              onClick={() => void downloadRuntime()}
              disabled={runtimeDownloadBusy}
              className="flex items-center gap-1 border border-amber-300 px-2 py-0.5 font-bold disabled:opacity-50"
            >
              {runtimeDownloadBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              {L('DESCARGAR RUNTIME', 'DOWNLOAD RUNTIME')}
            </button>
          </div>
        )}
        {proposalLoading && (
          <div className="flex items-center gap-1 text-[9px] text-[var(--nc-text-dim)]">
            <Loader2 className="h-3 w-3 animate-spin" />{' '}
            {L('Leyendo el GGUF y la memoria disponible…', 'Reading GGUF and available memory…')}
          </div>
        )}
        {proposal && !proposalLoading && (
          <div className="space-y-1 border border-[var(--nc-text-accent)]/60 bg-[var(--nc-bg-deep)] p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-bold text-[var(--nc-text-accent)]">
                {L('PROPUESTA AUTOMÁTICA', 'AUTOMATIC PROPOSAL')}
                {proposal.profile?.moe ? ' · MoE' : ''}
              </span>
              <button
                type="button"
                onClick={() => applyProposed(proposal.proposed)}
                className="border border-[var(--nc-text-accent)] px-2 py-0.5 text-[9px] font-bold text-[var(--nc-text-accent)]"
              >
                {L('USAR PROPUESTA', 'USE PROPOSAL')}
              </button>
            </div>
            <div className="break-all text-[9px] text-white">
              {proposal.proposed.context} ctx · {proposal.proposed.gpuLayers}{' '}
              {L('capas GPU', 'GPU layers')}
              {proposal.proposed.cpuMoeLayers
                ? ` · --n-cpu-moe ${proposal.proposed.cpuMoeLayers}`
                : ''}
              {proposal.proposed.cacheTypeK ? ` · KV ${proposal.proposed.cacheTypeK}` : ''}
              {proposal.proposed.tensorSplit ? ` · split ${proposal.proposed.tensorSplit}` : ''}
            </div>
            {proposal.hardware?.vramTotalMb ? (
              <div className="text-[9px] text-[var(--nc-text-dim)]">
                {L('VRAM', 'VRAM')}{' '}
                {Math.round(proposal.hardware.vramFreeMb ?? proposal.hardware.vramTotalMb)}/
                {Math.round(proposal.hardware.vramTotalMb)} MB
                {proposal.hardware.gpuName ? ` · ${proposal.hardware.gpuName}` : ''}
                {proposal.hardware.ramTotalGb ? ` · RAM ${proposal.hardware.ramTotalGb} GB` : ''}
              </div>
            ) : (
              <div className="text-[9px] text-amber-200">
                {L(
                  'Sin VRAM detectada (nvidia-smi no responde): el reparto de expertos queda a mano.',
                  'No VRAM detected (nvidia-smi unavailable): expert split stays manual.'
                )}
              </div>
            )}
            {proposal.notes.map((note) => (
              <div key={note} className="break-words text-[9px] text-[var(--nc-text-dim)]">
                · {note}
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_auto]">
          <select
            value={runtimeModel}
            onChange={(event) => setRuntimeModel(event.target.value)}
            className="min-w-0 border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] px-2 py-1 text-[10px] text-white outline-none"
          >
            <option value="">{L('Selecciona un modelo instalado', 'Select an installed model')}</option>
            {installed.map((model) => (
              <option key={model.filename} value={model.filename}>
                {model.filename}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-[9px] text-[var(--nc-text-dim)]">
            CTX
            <input
              value={context}
              onChange={(event) => setContext(event.target.value)}
              inputMode="numeric"
              className="min-w-0 w-full border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] px-1 py-1 text-[10px] text-white outline-none"
            />
          </label>
          <label className="flex items-center gap-1 text-[9px] text-[var(--nc-text-dim)]">
            GPU
            <input
              value={gpuLayers}
              onChange={(event) => setGpuLayers(event.target.value)}
              inputMode="numeric"
              className="min-w-0 w-full border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] px-1 py-1 text-[10px] text-white outline-none"
            />
          </label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => void (runtime?.state === 'running' ? stopRuntime() : startRuntime())}
              disabled={runtimeBusy || (!runtimeModel && runtime?.state !== 'running')}
              className="flex items-center gap-1 border border-[var(--nc-text-accent)] px-2 py-1 text-[10px] font-bold text-[var(--nc-text-accent)] disabled:opacity-40"
            >
              {runtimeBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : runtime?.state === 'running' ? (
                <Square className="h-3 w-3" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              {runtime?.state === 'running' ? 'STOP' : 'START'}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAdvanced((value) => !value)}
          className="border border-[var(--nc-border-light)] px-2 py-0.5 text-[9px] font-bold text-[var(--nc-text-accent)]"
        >
          {advanced
            ? L('OCULTAR AJUSTES', 'HIDE SETTINGS')
            : L('AJUSTES DE MODELO GRANDE', 'LARGE MODEL SETTINGS')}
        </button>
        {advanced && (
          <div className="space-y-2 border border-[var(--nc-border-light)]/60 p-2">
            <div className="text-[9px] text-[var(--nc-text-dim)]">
              {L(
                'Los modelos grandes de Strata corren aquí, sin conectar con Strata: expertos MoE en RAM, capas densas en GPU y caché KV cuantizada.',
                'Strata’s large models run here, without connecting to Strata: MoE experts in RAM, dense layers on GPU and quantized KV cache.'
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-1 text-[9px] text-[var(--nc-text-dim)]">
                <input
                  type="checkbox"
                  checked={jinja}
                  onChange={(event) => setJinja(event.target.checked)}
                />
                JINJA (tool calling)
              </label>
              <label className="flex items-center gap-1 text-[9px] text-[var(--nc-text-dim)]">
                <input
                  type="checkbox"
                  checked={flashAttention}
                  onChange={(event) => setFlashAttention(event.target.checked)}
                />
                FLASH-ATTN
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-1 text-[9px] text-[var(--nc-text-dim)]">
                MoE CPU
                <input
                  value={cpuMoeLayers}
                  onChange={(event) => setCpuMoeLayers(event.target.value)}
                  inputMode="numeric"
                  placeholder="24"
                  title={L(
                    'Capas de expertos que quedan en RAM (--n-cpu-moe). Permite un MoE grande con poca VRAM.',
                    'Expert layers kept in RAM (--n-cpu-moe). Lets a large MoE run with little VRAM.'
                  )}
                  className="min-w-0 w-full border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] px-1 py-1 text-[10px] text-white outline-none"
                />
              </label>
              <label className="flex items-center gap-1 text-[9px] text-[var(--nc-text-dim)]">
                SPLIT GPU
                <input
                  value={tensorSplit}
                  onChange={(event) => setTensorSplit(event.target.value)}
                  placeholder="1,1"
                  title={L(
                    'Proporción por GPU (--tensor-split), por ejemplo 1,1 con dos GPU.',
                    'Share per GPU (--tensor-split), for example 1,1 with two GPUs.'
                  )}
                  className="min-w-0 w-full border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] px-1 py-1 text-[10px] text-white outline-none"
                />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-1 text-[9px] text-[var(--nc-text-dim)]">
                KV K
                <select
                  value={cacheTypeK}
                  onChange={(event) => setCacheTypeK(event.target.value)}
                  title={L(
                    'Tipo de la caché KV de claves (--cache-type-k); q8_0 ahorra VRAM con contexto grande.',
                    'Key KV cache type (--cache-type-k); q8_0 saves VRAM with a large context.'
                  )}
                  className="min-w-0 w-full border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] px-1 py-1 text-[10px] text-white outline-none"
                >
                  <option value="">auto</option>
                  <option value="f16">f16</option>
                  <option value="f8_e4m3">f8_e4m3</option>
                  <option value="q8_0">q8_0</option>
                  <option value="q5_1">q5_1</option>
                  <option value="q4_1">q4_1</option>
                </select>
              </label>
              <label className="flex items-center gap-1 text-[9px] text-[var(--nc-text-dim)]">
                KV V
                <select
                  value={cacheTypeV}
                  onChange={(event) => setCacheTypeV(event.target.value)}
                  title={L(
                    'Tipo de la caché KV de valores (--cache-type-v).',
                    'Value KV cache type (--cache-type-v).'
                  )}
                  className="min-w-0 w-full border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] px-1 py-1 text-[10px] text-white outline-none"
                >
                  <option value="">auto</option>
                  <option value="f16">f16</option>
                  <option value="f8_e4m3">f8_e4m3</option>
                  <option value="q8_0">q8_0</option>
                  <option value="q5_1">q5_1</option>
                  <option value="q4_1">q4_1</option>
                </select>
              </label>
            </div>
          </div>
        )}
        {runtime?.state === 'running' && (
          <div className="break-all text-[9px] text-emerald-200">
            {runtime.model} · {runtime.context} ctx · {runtime.gpuLayers} {L('capas GPU', 'GPU layers')}
            {runtime.cpuMoeLayers
              ? ` · ${runtime.cpuMoeLayers} ${L('capas MoE en CPU', 'MoE layers on CPU')}`
              : ''}
            {runtime.cacheTypeK || runtime.cacheTypeV
              ? ` · KV ${runtime.cacheTypeK || 'auto'}/${runtime.cacheTypeV || 'auto'}`
              : ''}
            {runtime.tensorSplit ? ` · split ${runtime.tensorSplit}` : ''} · {runtime.baseUrl}
          </div>
        )}
        {runtime?.error && <div className="text-[9px] text-red-300">{runtime.error}</div>}
      </div>

      <div className="space-y-2 border border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] p-2">
        <div className="flex items-center gap-1.5 bg-[var(--nc-header-bg)] px-2 py-0.5 font-bold text-black">
          <HardDrive className="h-3.5 w-3.5" /> {L('BIBLIOTECA LOCAL', 'LOCAL LIBRARY')} ({installed.length})
        </div>
        {installed.length === 0 ? (
          <div className="p-3 text-[10px] text-[var(--nc-text-dim)]">{L('Aún no hay GGUF descargados.', 'No GGUF downloaded yet.')}</div>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {installed.map((model) => (
              <div key={model.filename} className="min-w-0 border border-[var(--nc-border-light)]/40 p-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate font-bold text-white" title={model.filename}>{model.filename}</span>
                  <span className="shrink-0 text-[9px] text-[var(--nc-text-accent)]">{model.quantization}</span>
                </div>
                <div className="mt-0.5 break-all text-[9px] text-[var(--nc-text-dim)]">
                  {formatBytes(model.sizeBytes)} · {model.repoId || 'local'}
                </div>
                <div className="mt-1 flex gap-1">
                  {(() => {
                    const split = splitGgufParts(model.filename);
                    const runnable = !split || split.index === 1;
                    return runnable ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRuntimeModel(model.filename);
                          onSelectModel(`local/${model.filename}`);
                        }}
                        className="flex-1 border border-[var(--nc-text-accent)] px-2 py-0.5 text-[9px] font-bold text-[var(--nc-text-accent)]"
                      >
                        {L('USAR', 'USE')}
                      </button>
                    ) : (
                      <span className="flex-1 border border-[var(--nc-border-light)] px-2 py-0.5 text-center text-[9px] text-[var(--nc-text-dim)]">
                        {L('PARTE', 'PART')} {split?.index}
                      </span>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => void remove(model.filename)}
                    className="border border-red-400/60 px-2 py-0.5 text-[9px] font-bold text-red-200"
                    aria-label={`Borrar ${model.filename}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedModel.startsWith('local/') && (
        <div className="text-[9px] text-[var(--nc-text-dim)]">
          {L('Modelo activo en Commander:', 'Active model in Commander:')}{' '}
          <span className="break-all text-[var(--nc-text-accent)]">{selectedModel}</span>
        </div>
      )}
    </div>
  );
};
