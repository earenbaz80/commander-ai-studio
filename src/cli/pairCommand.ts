/**
 * `commander pair` — emite el enlace de emparejamiento contra el servidor local.
 *
 * El comando no guarda estado ni conoce tokens de antemano: pide la emisión a
 * `POST /api/pair/issue` (sólo loopback) y arma el enlace con el token en el
 * fragmento. El token en claro no se imprime aparte del enlace ni se registra:
 * si el operador no lo usa en 5 minutos, genera otro.
 */
import { buildPairLink } from '../pair/pairLink.js';

export interface PairCommandOptions {
  serverUrl: string;
  sessionId?: string;
  json?: boolean;
  /** Inyectables para el test: sin red y sin consola. */
  fetchImpl?: typeof fetch;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export interface PairCommandResult {
  link: string;
  sessionId: string;
  expiresAt: number;
  ttlMs: number;
}

function minutesOf(ttlMs: number): number {
  return Math.max(1, Math.round(ttlMs / 60_000));
}

export async function runPairCommand(options: PairCommandOptions): Promise<number> {
  const out = options.out ?? ((line: string) => console.log(line));
  const err = options.err ?? ((line: string) => console.error(line));
  const doFetch = options.fetchImpl ?? fetch;
  const base = String(options.serverUrl || '').trim().replace(/\/+$/, '');
  if (!base) {
    err('[commander] falta la URL del servidor (--server)');
    return 1;
  }

  let response: any;
  try {
    response = await doFetch(`${base}/api/pair/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.sessionId ? { sessionId: options.sessionId } : {}),
    });
  } catch (e: any) {
    err(
      `[commander] no pude hablar con el servidor en ${base}: ${e?.message || e}. ` +
        'Arrancalo con `commander serve` o pasá --server <url>'
    );
    return 1;
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success || typeof body.token !== 'string') {
    err(`[commander] no se emitió el enlace (HTTP ${response.status}): ${body?.error ?? 'sin detalle'}`);
    return 1;
  }

  let link: string;
  try {
    link = buildPairLink(base, body.token);
  } catch (e: any) {
    err(`[commander] el servidor devolvió un token inutilizable: ${e?.message || e}`);
    return 1;
  }

  const ttlMs = Number(body.ttlMs) > 0 ? Number(body.ttlMs) : 5 * 60_000;
  const result: PairCommandResult = {
    link,
    sessionId: String(body.sessionId || ''),
    expiresAt: Number(body.expiresAt) || Date.now() + ttlMs,
    ttlMs,
  };

  if (options.json) {
    out(JSON.stringify(result, null, 2));
    return 0;
  }
  out(`Enlace de emparejamiento (un solo uso, caduca en ${minutesOf(ttlMs)} min):`);
  out(`  ${result.link}`);
  out(`Sesión: ${result.sessionId}`);
  return 0;
}
