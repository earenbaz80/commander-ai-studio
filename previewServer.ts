/**
 * Preview de un dev server: arranca el comando en segundo plano (reutilizando
 * el registro de trabajos de `shellJobs`, con sus mismas reglas de parada por
 * PID) y espera a que alguna URL candidata conteste HTTP.
 *
 * "Listo" significa que el puerto responde, no que la app funcione: cualquier
 * código HTTP sirve, incluido un 500. Lo que importa es no devolver una URL a
 * la que el navegador no pueda conectarse.
 *
 * Las etapas del comando llegan YA validadas por la allowlist de `shell.run`
 * (`checkShellSegments` en agentTools.ts): aquí no se vuelve a interpretar nada.
 */

import { getJob, listJobs, readJobLog, startJob, stopJob } from './shellJobs';
import { assertSafeOutboundUrl } from './ssrf';
import { PROBE_TIMEOUT_MS, previewCandidates, readyTimeout } from './src/agent/previewTarget';

export interface Preview {
  jobId: string;
  /** URL que contestó (vacía si aún no responde). */
  url: string;
  candidates: string[];
  cwd: string;
  startedAt: number;
}

const previews = new Map<string, Preview>();
/** Máximo de previews recordados (no de procesos: eso lo limita shellJobs). */
export const MAX_PREVIEWS = 10;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Un GET con timeout corto. `null` = no contestó (puerto cerrado o colgado). */
async function probeOnce(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal, redirect: 'manual' });
    await res.body?.cancel().catch(() => {});
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Filtra los candidatos por la misma guardia anti-SSRF que usa `web.fetch`.
 * Se valida una vez por candidato (no en cada vuelta del sondeo): el bucle de
 * espera puede hacer cientos de peticiones y la validación resuelve DNS.
 */
async function filterCandidates(urls: string[]): Promise<{ allowed: string[]; rejected: { url: string; error: string }[] }> {
  const allowed: string[] = [];
  const rejected: { url: string; error: string }[] = [];
  for (const url of urls) {
    try {
      await assertSafeOutboundUrl(url);
      allowed.push(url);
    } catch (e: any) {
      rejected.push({ url, error: String(e?.message || e) });
    }
  }
  return { allowed, rejected };
}

export interface OpenPreviewInput {
  command: string;
  /** Etapas ya validadas por la allowlist de shell.run. */
  segments: string[];
  cwd: string;
  url?: unknown;
  port?: unknown;
  timeoutMs?: unknown;
}

/**
 * Arranca el comando y espera a que responda. Nunca lanza: devuelve
 * `ready: false` con el final del log para que el agente pueda diagnosticar.
 */
export async function openPreview(input: OpenPreviewInput) {
  const { command, segments } = input;
  if (!Array.isArray(segments) || segments.length === 0) {
    return { ok: false as const, error: 'Comando vacío' };
  }

  const pick = previewCandidates({ url: input.url, port: input.port });
  if (!pick.ok) return { ok: false as const, error: pick.error };
  const { allowed, rejected } = await filterCandidates(pick.urls);
  if (allowed.length === 0) {
    return { ok: false as const, error: rejected[0]?.error || 'Destino de preview bloqueado' };
  }

  if (previews.size >= MAX_PREVIEWS) {
    const oldest = [...previews.values()].sort((a, b) => a.startedAt - b.startedAt)[0];
    if (oldest) previews.delete(oldest.jobId);
  }

  const started = startJob(command, segments, input.cwd);
  if (!started.ok) return { ok: false as const, error: started.error };

  const jobId = started.job.id;
  previews.set(jobId, {
    jobId,
    url: '',
    candidates: allowed,
    cwd: input.cwd,
    startedAt: Date.now(),
  });

  const timeout = readyTimeout(input.timeoutMs);
  const deadline = Date.now() + timeout;
  const startedAt = Date.now();
  let hit: { url: string; status: number } | null = null;
  let died: { status: string; exitCode: number | null } | null = null;

  while (Date.now() < deadline) {
    const results = await Promise.all(allowed.map(async (url) => ({ url, status: await probeOnce(url) })));
    const found = results.find((r) => r.status !== null);
    if (found) {
      hit = { url: found.url, status: found.status as number };
      break;
    }
    // Si el proceso ya murió (comando malo, puerto ocupado) no tiene sentido
    // seguir esperando 30 s: se devuelve el log para que se vea el porqué.
    const job = getJob(jobId);
    if (job && job.status !== 'running') {
      died = { status: job.status, exitCode: job.exitCode };
      break;
    }
    await delay(400);
  }

  const tail = readJobLog(jobId, 30);
  const logTail = tail.ok ? tail.data.content : '';

  if (hit) {
    const preview = previews.get(jobId);
    if (preview) preview.url = hit.url;
    return {
      ok: true as const,
      data: {
        ...started.job,
        url: hit.url,
        httpStatus: hit.status,
        ready: true,
        readyMs: Date.now() - startedAt,
        candidates: allowed,
        hint: `Ya puedes abrirlo con browser { action: "navigate", url: "${hit.url}" }.`,
      },
    };
  }

  return {
    ok: true as const,
    data: {
      ...started.job,
      url: '',
      ready: false,
      waitedMs: Date.now() - startedAt,
      candidates: allowed,
      ...(died ? { exitedEarly: died } : {}),
      logTail: logTail.slice(-2000),
      hint: died
        ? 'El comando terminó sin abrir el puerto: revisa logTail (o shell.job logs).'
        : `Ningún candidato respondió en ${Math.round(timeout / 1000)}s. Prueba preview { action: "check", url } o lee el log con shell.job.`,
    },
  };
}

/** Comprueba una URL concreta sin arrancar nada. */
export async function checkPreview(url: unknown) {
  if (!String(url ?? '').trim()) return { ok: false as const, error: 'url requerida para check' };
  const pick = previewCandidates({ url });
  if (!pick.ok) return { ok: false as const, error: pick.error };
  const target = pick.urls[0];
  try {
    await assertSafeOutboundUrl(target);
  } catch (e: any) {
    return { ok: false as const, error: String(e?.message || e) };
  }
  const status = await probeOnce(target);
  return {
    ok: true as const,
    data: { url: target, ready: status !== null, ...(status !== null ? { httpStatus: status } : {}) },
  };
}

/** Preview(s) en marcha, con el estado real del trabajo y un sondeo en vivo. */
export async function listPreviews() {
  const jobs = new Map(listJobs().map((j) => [j.id, j]));
  const items = await Promise.all(
    [...previews.values()].map(async (preview) => {
      const job = jobs.get(preview.jobId);
      const urls = preview.url ? [preview.url] : preview.candidates;
      const probed = (await Promise.all(urls.map(async (u) => ({ url: u, status: await probeOnce(u) })))).find(
        (r) => r.status !== null,
      );
      if (probed) preview.url = probed.url;
      return {
        jobId: preview.jobId,
        url: preview.url,
        command: job?.command ?? '',
        status: job?.status ?? 'exited',
        exitCode: job?.exitCode ?? null,
        runningMs: job?.runningMs ?? Date.now() - preview.startedAt,
        ready: !!probed,
        ...(probed ? { httpStatus: probed.status } : {}),
        logPath: job?.logPath ?? '',
      };
    }),
  );
  return items.sort((a, b) => b.runningMs - a.runningMs);
}

/** Para el preview y olvida su entrada (el stop real lo hace shellJobs). */
export async function stopPreview(jobId: string, pid?: number) {
  previews.delete(jobId);
  return stopJob(jobId, pid);
}

/** URL conocida de un trabajo, si el preview la registró. */
export function previewUrlFor(jobId: string): string {
  return previews.get(jobId)?.url ?? '';
}

/** Solo para tests. */
export function _resetPreviews(): void {
  previews.clear();
}
