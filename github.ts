/**
 * Cliente mínimo de GitHub para el agente.
 *
 * Sin SDK: dos operaciones (leer un PR y comentarlo) sobre la API REST. El
 * token sale del entorno del servidor (`GITHUB_TOKEN`), nunca del modelo ni del
 * navegador, y no se registra en ningún sitio.
 */
export interface GithubRepoRef {
  owner: string;
  repo: string;
  number: number;
}

const TIMEOUT_MS = 15_000;
const MAX_BODY = 20_000;
const MAX_PATCH = 4_000;

const apiBase = () => (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');

/**
 * Acepta `owner/repo` + `number` o una URL de PR.
 * Devuelve `null` si falta algo o el formato no es seguro para la URL.
 */
export function parsePullRequest(input: {
  repo?: string;
  url?: string;
  number?: number;
}): GithubRepoRef | null {
  const url = String(input?.url || '').trim();
  const fromUrl = url.match(/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)/i);
  if (fromUrl) {
    return { owner: fromUrl[1], repo: fromUrl[2], number: Number(fromUrl[3]) };
  }

  const [owner, repo] = String(input?.repo || '').split('/');
  const number = Number(input?.number);
  if (!owner || !repo || !Number.isInteger(number) || number <= 0) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;
  return { owner, repo, number };
}

const clip = (value: unknown, max: number): string => {
  const text = String(value ?? '');
  return text.length <= max ? text : text.slice(0, max) + '\n… [recortado]';
};

async function github(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<{ res: Response; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Commander-AI-Studio',
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { res, body };
  } finally {
    clearTimeout(timer);
  }
}

function upstreamError(res: Response, body: any): string {
  const detail = typeof body?.message === 'string' ? `: ${body.message}` : '';
  return `GitHub respondió ${res.status}${detail}`;
}

/** Estado de un PR: metadatos, cuerpo y diff por archivo. */
export async function pullRequestData(
  ref: GithubRepoRef,
  token: string
): Promise<{ ok: boolean; data?: any; error?: string; status?: number }> {
  if (!token) {
    return {
      ok: false,
      error: 'GitHub no está conectado: usa Ajustes → Extensiones → Integraciones o define GITHUB_TOKEN.',
      status: 400,
    };
  }

  const pr = await github(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`, token);
  if (!pr.res.ok) return { ok: false, error: upstreamError(pr.res, pr.body), status: 502 };

  const files = await github(
    `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=100`,
    token
  );
  if (!files.res.ok) return { ok: false, error: upstreamError(files.res, files.body), status: 502 };

  const changed = Array.isArray(files.body) ? files.body : [];
  return {
    ok: true,
    data: {
      number: ref.number,
      title: String(pr.body?.title || ''),
      state: String(pr.body?.state || ''),
      draft: pr.body?.draft === true,
      author: String(pr.body?.user?.login || ''),
      url: String(pr.body?.html_url || ''),
      base: String(pr.body?.base?.ref || ''),
      head: String(pr.body?.head?.ref || ''),
      additions: Number(pr.body?.additions || 0),
      deletions: Number(pr.body?.deletions || 0),
      changedFiles: Number(pr.body?.changed_files || changed.length),
      body: clip(pr.body?.body, MAX_BODY),
      files: changed.slice(0, 100).map((file: any) => ({
        path: String(file?.filename || ''),
        status: String(file?.status || ''),
        additions: Number(file?.additions || 0),
        deletions: Number(file?.deletions || 0),
        patch: file?.patch ? clip(file.patch, MAX_PATCH) : '',
      })),
    },
  };
}

/** Publica un comentario en el PR. Requiere aprobación: escribe fuera del repo. */
export async function commentOnPullRequest(
  ref: GithubRepoRef,
  body: string,
  token: string
): Promise<{ ok: boolean; data?: any; error?: string; status?: number }> {
  const text = String(body ?? '').trim();
  if (!text) return { ok: false, error: 'El comentario está vacío', status: 400 };
  if (!token) {
    return {
      ok: false,
      error: 'GitHub no está conectado: usa Ajustes → Extensiones → Integraciones o define GITHUB_TOKEN.',
      status: 400,
    };
  }
  const res = await github(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: clip(text, MAX_BODY) }),
  });
  if (!res.res.ok) return { ok: false, error: upstreamError(res.res, res.body), status: 502 };
  return {
    ok: true,
    data: { id: res.body?.id, url: String(res.body?.html_url || ''), author: String(res.body?.user?.login || '') },
  };
}
