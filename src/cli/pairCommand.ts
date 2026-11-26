/**
 * `commander pair` — emite el enlace de emparejamiento contra el servidor local
 * y administra el registro de dispositivos.
 *
 * El comando no guarda estado ni conoce tokens de antemano: pide la emisión a
 * `POST /api/pair/issue` (sólo loopback) y arma el enlace con el token en el
 * fragmento. El token en claro no se imprime aparte del enlace ni se registra:
 * si el operador no lo usa en 5 minutos, genera otro.
 *
 * `--devices` y `--revoke <id>` reutilizan las rutas del host: `GET
 * /api/pair/devices` y `DELETE /api/pair/devices/:id`. La baja manda el
 * `Origin` del propio servidor porque es una mutación de pair; el CLI corre en
 * la máquina host, así que el server lo acepta por loopback.
 */
import { buildPairLink } from '../pair/pairLink.js';
import type { PairDevice } from '../pair/pairDevices.js';

export interface PairCommandOptions {
  serverUrl: string;
  sessionId?: string;
  json?: boolean;
  /** Lista el registro de dispositivos en vez de emitir un enlace. */
  devices?: boolean;
  /** Revoca el dispositivo indicado (id `dev_…`) en vez de emitir un enlace. */
  revoke?: string;
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

export interface PairDevicesCommandResult {
  devices: PairDevice[];
  maxDevices: number;
}

export interface PairRevokeCommandResult {
  device: PairDevice;
}

function minutesOf(ttlMs: number): number {
  return Math.max(1, Math.round(ttlMs / 60_000));
}

function when(at: number | null): string {
  if (typeof at !== 'number' || !Number.isFinite(at)) return '—';
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().replace('.000Z', 'Z');
}

interface JsonCall {
  response: Response;
  body: any;
}

/** Una llamada al server; `null` si ni siquiera hubo respuesta. */
async function callJson(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  base: string,
  err: (line: string) => void
): Promise<JsonCall | null> {
  let response: Response;
  try {
    response = await doFetch(url, init);
  } catch (e: any) {
    err(
      `[commander] no pude hablar con el servidor en ${base}: ${e?.message || e}. ` +
        'Arrancalo con `commander serve` o pasá --server <url>'
    );
    return null;
  }
  const body = await response.json().catch(() => null);
  return { response, body };
}

/** `commander pair --devices`: el registro tal como lo ve el host. */
async function listDevices(
  options: PairCommandOptions,
  base: string,
  doFetch: typeof fetch,
  out: (line: string) => void,
  err: (line: string) => void
): Promise<number> {
  const call = await callJson(doFetch, `${base}/api/pair/devices`, { method: 'GET' }, base, err);
  if (!call) return 1;
  const { response, body } = call;
  if (!response.ok || !body?.success || !Array.isArray(body.devices)) {
    err(`[commander] no pude leer los dispositivos (HTTP ${response.status}): ${body?.error ?? 'sin detalle'}`);
    return 1;
  }

  const result: PairDevicesCommandResult = {
    devices: body.devices as PairDevice[],
    maxDevices: Number(body.maxDevices) > 0 ? Number(body.maxDevices) : 0,
  };
  if (options.json) {
    out(JSON.stringify(result, null, 2));
    return 0;
  }

  const active = result.devices.filter((device) => device.revokedAt === null).length;
  out(
    `Dispositivos emparejados (${result.devices.length} registrados, ${active} activos` +
      (result.maxDevices > 0 ? ` de ${result.maxDevices}` : '') +
      '):'
  );
  if (result.devices.length === 0) {
    out('  (ninguno)');
    return 0;
  }
  for (const device of result.devices) {
    const state = device.revokedAt === null ? 'activo' : 'revocado';
    out(
      `  ${device.id}  ${state.padEnd(8)}  creado ${when(device.createdAt)}  ` +
        `expira ${when(device.expiresAt)}` +
        (device.revokedAt === null ? '' : `  revocado ${when(device.revokedAt)}`)
    );
  }
  return 0;
}

/** `commander pair --revoke <id>`: la baja que el server ya expone al host. */
async function revokeDevice(
  options: PairCommandOptions,
  base: string,
  doFetch: typeof fetch,
  out: (line: string) => void,
  err: (line: string) => void
): Promise<number> {
  const id = String(options.revoke ?? '').trim();
  if (!id) {
    err('[commander] --revoke necesita el id de un dispositivo (dev_…)');
    return 1;
  }
  const call = await callJson(
    doFetch,
    `${base}/api/pair/devices/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: { Origin: base } },
    base,
    err
  );
  if (!call) return 1;
  const { response, body } = call;
  if (!response.ok || !body?.success || !body?.device?.id) {
    err(`[commander] no pude revocar ${id} (HTTP ${response.status}): ${body?.error ?? 'sin detalle'}`);
    return 1;
  }

  const result: PairRevokeCommandResult = { device: body.device as PairDevice };
  if (options.json) {
    out(JSON.stringify(result, null, 2));
    return 0;
  }
  out(`Dispositivo ${result.device.id} revocado. El control vuelve al escritorio.`);
  return 0;
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
  if (options.devices && options.revoke !== undefined) {
    err('[commander] --devices y --revoke no se combinan: elegí uno');
    return 1;
  }
  if (options.devices) return listDevices(options, base, doFetch, out, err);
  if (options.revoke !== undefined) return revokeDevice(options, base, doFetch, out, err);

  const call = await callJson(
    doFetch,
    `${base}/api/pair/issue`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.sessionId ? { sessionId: options.sessionId } : {}),
    },
    base,
    err
  );
  if (!call) return 1;
  const { response, body } = call;
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
