/**
 * Descarga y biblioteca nativa de modelos GGUF.
 *
 * Este módulo no depende de Ollama, LM Studio, Bionic ni Strata: descarga los
 * archivos desde Hugging Face, los guarda en `local_models/` y deja un sidecar
 * con los metadatos que necesita el runtime de llama.cpp. Los trabajos viven en
 * memoria y el archivo `.part` permite reanudar tras pausar o reiniciar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { safeFetch } from '../../ssrf';
import { quantizationFromFilename, splitGgufParts } from './ggufName';

export { quantizationFromFilename, splitGgufParts };

export interface LocalGgufFile {
  filename: string;
  sizeBytes: number;
  quantization: string;
  downloadUrl: string;
  splitIndex?: number;
  splitTotal?: number;
  /** Todas las partes de un GGUF multiparte, en orden. */
  parts?: Array<{ filename: string; sizeBytes: number; downloadUrl: string }>;
}

export interface LocalModelRecord {
  id: string;
  name: string;
  filename: string;
  repoId: string;
  sizeBytes: number;
  sizeMb: number;
  quantization: string;
  downloadedAt: string;
  sha256?: string;
}

export type LocalDownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface LocalDownloadJob {
  id: string;
  repoId: string;
  filename: string;
  quantization: string;
  status: LocalDownloadStatus;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface InternalJob extends LocalDownloadJob {
  url: string;
  targetPath: string;
  partPath: string;
  controller?: AbortController;
  lastSampleAt: number;
  lastSampleBytes: number;
}

const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isValidRepoId(value: unknown): boolean {
  const repo = String(value || '').trim();
  return REPO_RE.test(repo) && !repo.includes('..');
}

/** Nombre seguro de archivo: plano, `.gguf` y sin rutas relativas. */
export function sanitizeGgufFilename(value: unknown): string | null {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  const base = path.basename(raw);
  if (!base || base === '.' || base === '..' || base.length > 180) return null;
  if (!/\.gguf$/i.test(base) || base.includes('..')) return null;
  return base;
}

export function hubDownloadUrl(repoId: string, filename: string): string {
  const repo = repoId.split('/').map(encodeURIComponent).join('/');
  return `https://huggingface.co/${repo}/resolve/main/${filename
    .split('/')
    .map(encodeURIComponent)
    .join('/')}?download=true`;
}

/** Archivos GGUF de la respuesta `?blobs=true` de Hugging Face. */
export function parseHubGgufFiles(payload: unknown, repoId: string): LocalGgufFile[] {
  const record = payload as { siblings?: unknown; files?: unknown } | null;
  const siblings = Array.isArray(record?.siblings)
    ? record.siblings
    : Array.isArray(record?.files)
      ? record.files
      : [];
  // Los GGUF multiparte se agrupan por su nombre base: una fila representa el
  // modelo completo y `parts` enumera todo lo que hay que descargar para que
  // llama.cpp pueda abrir la primera parte.
  const groups = new Map<string, LocalGgufFile[]>();
  for (const entry of siblings) {
    const item = entry as Record<string, any>;
    const filename = String(item?.rfilename || item?.filename || item?.path || '').trim();
    if (!filename || !/\.gguf$/i.test(filename)) continue;
    const split = splitGgufParts(filename);
    const key = split ? filename.replace(/-\d{5}-of-\d{5}\.gguf$/i, '') : filename;
    const sizeBytes = Math.max(
      0,
      Number(item?.size ?? item?.lfs?.size ?? item?.sizeBytes ?? 0) || 0
    );
    const file: LocalGgufFile = {
      filename,
      sizeBytes,
      quantization: quantizationFromFilename(filename),
      downloadUrl: hubDownloadUrl(repoId, filename),
      ...(split ? { splitIndex: split.index, splitTotal: split.total } : {}),
    };
    const list = groups.get(key) || [];
    list.push(file);
    groups.set(key, list);
  }

  const out: LocalGgufFile[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => (a.splitIndex || 0) - (b.splitIndex || 0));
    const first = list[0];
    if (list.length > 1) {
      out.push({
        ...first,
        sizeBytes: list.reduce((sum, file) => sum + file.sizeBytes, 0),
        parts: list.map((file) => ({
          filename: file.filename,
          sizeBytes: file.sizeBytes,
          downloadUrl: file.downloadUrl,
        })),
      });
    } else {
      out.push(first);
    }
  }
  return out.sort((a, b) => a.sizeBytes - b.sizeBytes);
}

export function parseHubSearchResults(payload: unknown): Array<{
  id: string;
  downloads: number;
  likes: number;
  pipelineTag: string;
  tags: string[];
  lastModified?: string;
}> {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { models?: unknown } | null)?.models)
      ? (payload as { models: unknown[] }).models
      : [];
  return list
    .map((entry) => {
      const item = entry as Record<string, any>;
      const id = String(item?.id || item?.modelId || '').trim();
      if (!id) return null;
      return {
        id,
        downloads: Number(item?.downloads) || 0,
        likes: Number(item?.likes) || 0,
        pipelineTag: String(item?.pipeline_tag || 'text-generation'),
        tags: Array.isArray(item?.tags) ? item.tags.map(String) : [],
        ...(item?.lastModified ? { lastModified: String(item.lastModified) } : {}),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => b.downloads - a.downloads);
}

function sidecarPath(targetPath: string): string {
  return `${targetPath}.json`;
}

export function listLocalModelRecords(dir: string): LocalModelRecord[] {
  if (!fs.existsSync(dir)) return [];
  const records: LocalModelRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.gguf$/i.test(name)) continue;
    const target = path.join(dir, name);
    try {
      const stat = fs.statSync(target);
      let sidecar: Partial<LocalModelRecord> = {};
      try {
        sidecar = JSON.parse(fs.readFileSync(sidecarPath(target), 'utf8'));
      } catch {
        /* sin sidecar: se usa lo que se puede inferir del archivo */
      }
      records.push({
        id: `local/${name}`,
        name,
        filename: name,
        repoId: String(sidecar.repoId || `local/${name}`),
        sizeBytes: stat.size,
        sizeMb: Math.round(stat.size / 1024 / 1024),
        quantization: String(sidecar.quantization || quantizationFromFilename(name)),
        downloadedAt: String(sidecar.downloadedAt || stat.mtime.toISOString()),
        ...(sidecar.sha256 ? { sha256: String(sidecar.sha256) } : {}),
      });
    } catch {
      /* archivo ilegible: no se lista */
    }
  }
  return records.sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
}

export class LocalModelDownloadManager {
  private readonly dir: string;
  private readonly jobs = new Map<string, InternalJob>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    dir: string,
    deps: { fetchImpl?: typeof fetch; now?: () => number } = {}
  ) {
    this.dir = dir;
    this.fetchImpl = deps.fetchImpl || (safeFetch as typeof fetch);
    this.now = deps.now || (() => Date.now());
    fs.mkdirSync(this.dir, { recursive: true });
  }

  list(): LocalDownloadJob[] {
    return [...this.jobs.values()]
      .map((job) => this.snapshot(job))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): LocalDownloadJob | null {
    const job = this.jobs.get(id);
    return job ? this.snapshot(job) : null;
  }

  start(input: {
    repoId: string;
    filename: string;
    sizeBytes?: number;
    quantization?: string;
  }): LocalDownloadJob {
    const repoId = String(input.repoId || '').trim();
    if (!isValidRepoId(repoId)) throw new Error('repoId inválido');
    const filename = sanitizeGgufFilename(input.filename);
    if (!filename) throw new Error('filename GGUF inválido');

    const active = [...this.jobs.values()].find(
      (job) =>
        job.filename === filename &&
        ['queued', 'downloading', 'paused'].includes(job.status)
    );
    if (active) return this.snapshot(active);

    const targetPath = path.join(this.dir, filename);
    if (fs.existsSync(targetPath)) throw new Error('El modelo ya está instalado');

    const partPath = `${targetPath}.part`;
    const downloadedBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    const now = new Date(this.now()).toISOString();
    const job: InternalJob = {
      id: randomUUID(),
      repoId,
      filename,
      quantization: String(input.quantization || quantizationFromFilename(filename)),
      status: 'queued',
      downloadedBytes,
      totalBytes: Math.max(0, Number(input.sizeBytes) || 0),
      progress: 0,
      speedBytesPerSecond: 0,
      etaSeconds: null,
      url: hubDownloadUrl(repoId, filename),
      targetPath,
      partPath,
      createdAt: now,
      updatedAt: now,
      lastSampleAt: this.now(),
      lastSampleBytes: downloadedBytes,
    };
    job.progress = job.totalBytes > 0 ? Math.min(100, (downloadedBytes / job.totalBytes) * 100) : 0;
    this.jobs.set(job.id, job);
    void this.run(job);
    return this.snapshot(job);
  }

  pause(id: string): LocalDownloadJob | null {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'downloading') return job ? this.snapshot(job) : null;
    job.status = 'paused';
    job.updatedAt = new Date(this.now()).toISOString();
    job.controller?.abort();
    return this.snapshot(job);
  }

  resume(id: string): LocalDownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === 'downloading' || job.status === 'completed') return this.snapshot(job);
    if (job.status === 'cancelled') return this.snapshot(job);
    void this.run(job);
    return this.snapshot(job);
  }

  cancel(id: string): LocalDownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === 'completed') return this.snapshot(job);
    job.status = 'cancelled';
    job.updatedAt = new Date(this.now()).toISOString();
    job.controller?.abort();
    // En Windows el stream abortado puede seguir abierto un instante: borrar
    // el .part de inmediato falla y deja basura. Se difiere y, si aún falla,
    // el siguiente start/retry lo reutiliza o lo sobrescribe.
    const timer = setTimeout(() => {
      try {
        fs.rmSync(job.partPath, { force: true });
      } catch {
        /* el archivo puede estar cerrándose; se ignora */
      }
    }, 500);
    timer.unref?.();
    return this.snapshot(job);
  }

  retry(id: string): LocalDownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === 'completed' || job.status === 'downloading') return this.snapshot(job);
    if (job.status === 'cancelled') {
      job.status = 'queued';
    }
    void this.run(job);
    return this.snapshot(job);
  }

  private snapshot(job: InternalJob): LocalDownloadJob {
    const { url: _url, targetPath: _target, partPath: _part, controller: _controller, lastSampleAt: _lastAt, lastSampleBytes: _lastBytes, ...publicJob } = job;
    return { ...publicJob };
  }

  private async run(job: InternalJob): Promise<void> {
    if (job.status === 'downloading' || job.status === 'completed' || job.status === 'cancelled') return;
    const controller = new AbortController();
    job.controller = controller;
    job.status = 'downloading';
    job.error = undefined;
    job.updatedAt = new Date(this.now()).toISOString();
    job.lastSampleAt = this.now();
    job.lastSampleBytes = job.downloadedBytes;

    let output: fs.WriteStream | null = null;
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'CommanderAIStudio/2.5',
        Accept: 'application/octet-stream',
      };
      if (job.downloadedBytes > 0) headers.Range = `bytes=${job.downloadedBytes}-`;
      const response = await this.fetchImpl(job.url, {
        headers,
        signal: controller.signal,
      });

      if (response.status === 416 && job.totalBytes > 0 && job.downloadedBytes >= job.totalBytes) {
        this.finalize(job);
        return;
      }
      if (!response.ok || !response.body) {
        throw new Error(`Hugging Face HTTP ${response.status}`);
      }

      let startAt = job.downloadedBytes;
      if (response.status === 200 && job.downloadedBytes > 0) {
        startAt = 0;
        job.downloadedBytes = 0;
        fs.rmSync(job.partPath, { force: true });
      }
      const remaining = Number(response.headers.get('content-length')) || 0;
      if (job.totalBytes <= 0 && remaining > 0) job.totalBytes = startAt + remaining;
      if (job.totalBytes > 0) {
        job.progress = Math.min(100, (job.downloadedBytes / job.totalBytes) * 100);
      }

      output = fs.createWriteStream(job.partPath, { flags: startAt > 0 ? 'a' : 'w' });
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        job.downloadedBytes += value.length;
        this.updateProgress(job);
        if (!output.write(value)) await once(output, 'drain');
      }
      output.end();
      await once(output, 'finish');
      output = null;
      this.finalize(job);
    } catch (error: any) {
      // pause()/cancel() cambian el estado y abortan mientras este bucle está
      // suspendido; el narrowing de TS no ve esa mutación asíncrona.
      const currentStatus = job.status as LocalDownloadStatus;
      if (currentStatus === 'paused' || currentStatus === 'cancelled') return;
      job.status = 'error';
      job.error = error?.name === 'AbortError' ? 'Descarga interrumpida' : error?.message || 'Descarga fallida';
      job.updatedAt = new Date(this.now()).toISOString();
    } finally {
      if (output) {
        output.end();
        try {
          await once(output, 'finish');
        } catch {
          /* ya cerrado */
        }
      }
      job.controller = undefined;
    }
  }

  private updateProgress(job: InternalJob): void {
    const now = this.now();
    const elapsed = Math.max(1, now - job.lastSampleAt);
    const delta = job.downloadedBytes - job.lastSampleBytes;
    if (elapsed >= 500 || delta > 0) {
      job.speedBytesPerSecond = Math.max(0, (delta / elapsed) * 1000);
      job.lastSampleAt = now;
      job.lastSampleBytes = job.downloadedBytes;
    }
    job.progress = job.totalBytes > 0 ? Math.min(100, (job.downloadedBytes / job.totalBytes) * 100) : 0;
    job.etaSeconds =
      job.speedBytesPerSecond > 0 && job.totalBytes > job.downloadedBytes
        ? Math.ceil((job.totalBytes - job.downloadedBytes) / job.speedBytesPerSecond)
        : null;
    job.updatedAt = new Date(now).toISOString();
  }

  private finalize(job: InternalJob): void {
    if (job.totalBytes > 0 && job.downloadedBytes < job.totalBytes) {
      throw new Error('La descarga terminó incompleta');
    }
    if (!fs.existsSync(job.partPath)) throw new Error('No se encontró el archivo parcial');
    if (fs.existsSync(job.targetPath)) fs.rmSync(job.targetPath, { force: true });
    fs.renameSync(job.partPath, job.targetPath);
    const record: LocalModelRecord = {
      id: `local/${job.filename}`,
      name: job.filename,
      filename: job.filename,
      repoId: job.repoId,
      sizeBytes: job.downloadedBytes,
      sizeMb: Math.round(job.downloadedBytes / 1024 / 1024),
      quantization: job.quantization,
      downloadedAt: new Date(this.now()).toISOString(),
    };
    fs.writeFileSync(sidecarPath(job.targetPath), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    job.totalBytes = Math.max(job.totalBytes, job.downloadedBytes);
    job.progress = 100;
    job.speedBytesPerSecond = 0;
    job.etaSeconds = 0;
    job.status = 'completed';
    job.updatedAt = new Date(this.now()).toISOString();
  }
}

export function removeLocalModel(dir: string, filename: unknown): boolean {
  const safe = sanitizeGgufFilename(filename);
  if (!safe) return false;
  const target = path.join(dir, safe);
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { force: true });
  fs.rmSync(`${target}.json`, { force: true });
  fs.rmSync(`${target}.part`, { force: true });
  return true;
}
