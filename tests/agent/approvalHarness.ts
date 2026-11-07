/**
 * Utilidades de las suites F1-04.
 *
 * El proveedor falso es OpenAI-compatible y devuelve un guion de tool_calls;
 * así se ejercita el bucle real del servidor sin claves ni red externa. Las
 * sesiones se crean con un `cwd` temporal fuera del repo para que una escritura
 * denegada no pueda tocar archivos de trabajo.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ServerHarness } from '../helpers/serverHarness.js';
import type { ApprovalRequestV2 } from '../../src/agent/sessionTypes.js';

export interface ScriptedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export type ScriptStep =
  | { tool: string; args: Record<string, unknown> }
  | { tools: ScriptedToolCall[] }
  | { text: string };

export interface FakeProvider {
  baseUrl: string;
  requests: () => number;
  close: () => Promise<void>;
}

function toolCallsFor(step: ScriptStep | undefined): ScriptedToolCall[] {
  if (!step) return [];
  if ('tools' in step) return step.tools;
  if ('tool' in step) return [{ tool: step.tool, args: step.args }];
  return [];
}

/** Proveedor local que responde con el siguiente paso del guion. */
export async function startScriptedProvider(script: ScriptStep[]): Promise<FakeProvider> {
  let requests = 0;
  let index = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requests += 1;
      const step = script[Math.min(index, Math.max(0, script.length - 1))];
      index += 1;
      const calls = toolCallsFor(step);
      const message: Record<string, unknown> = {
        role: 'assistant',
        content: calls.length > 0 ? '' : (step && 'text' in step ? step.text : 'Listo.'),
      };
      if (calls.length > 0) {
        message.tool_calls = calls.map((call, i) => ({
          id: `call_${requests}_${i}`,
          type: 'function',
          function: {
            name: call.tool.replace(/\./g, '_'),
            arguments: JSON.stringify(call.args),
          },
        }));
      }
      const body = JSON.stringify({
        id: `chatcmpl-f1-04-${requests}`,
        object: 'chat.completion',
        choices: [{
          index: 0,
          message,
          finish_reason: calls.length > 0 ? 'tool_calls' : 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      });
      res.end(body);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests: () => requests,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

export interface ApprovalSession {
  id: string;
  cwd: string;
  /** Estado devuelto al crear la sesión. */
  state: any;
}

/** Crea una sesión ejecutable con el proveedor falso y un cwd temporal. */
export async function createApprovalSession(
  srv: ServerHarness,
  provider: FakeProvider,
  extra: Record<string, unknown> = {}
): Promise<ApprovalSession> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-f1-04-'));
  const res = await srv.request('POST', '/api/agent/sessions', {
    goal: 'Prueba F1-04 del canal de aprobaciones',
    model: 'custom/test',
    cwd,
    run: true,
    maxSteps: 20,
    keys: {
      CUSTOM_BASE_URL: provider.baseUrl,
      CUSTOM_API_KEY: 'clave-falsa',
      CUSTOM_MODEL: 'modelo-falso',
    },
    ...extra,
  });
  if (res.status !== 200 || res.body?.success !== true) {
    cleanupDir(cwd);
    throw new Error(`no se creó la sesión (${res.status}): ${res.raw}`);
  }
  return { id: String(res.body.session.id), cwd, state: res.body.state };
}

export async function getState(srv: ServerHarness, id: string): Promise<any> {
  const res = await srv.request('GET', `/api/agent/sessions/${id}`);
  if (res.status !== 200) throw new Error(`GET sesión ${res.status}: ${res.raw}`);
  return res.body.state;
}

export async function waitForState(
  srv: ServerHarness,
  id: string,
  statuses: string[],
  timeoutMs = 15_000
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    last = await getState(srv, id);
    if (statuses.includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`la sesión ${id} no llegó a ${statuses.join('/')} (último: ${JSON.stringify(last)})`);
}

/** Espera la primera aprobación pendiente, o una distinta de `notId`. */
export async function waitForApproval(
  srv: ServerHarness,
  id: string,
  options: { timeoutMs?: number; notId?: string } = {}
): Promise<ApprovalRequestV2> {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  let last: any = null;
  while (Date.now() < deadline) {
    last = await getState(srv, id);
    const pending = last.pendingApproval as ApprovalRequestV2 | null;
    if (pending && pending.id !== options.notId) return pending;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`la sesión ${id} no pidió aprobación (último: ${JSON.stringify(last)})`);
}

export async function resolveApproval(
  srv: ServerHarness,
  sessionId: string,
  approvalId: string,
  decision: 'allow' | 'deny' | 'allow-session',
  reason?: string
) {
  return srv.request(
    'POST',
    `/api/agent/sessions/${sessionId}/approvals/${encodeURIComponent(approvalId)}`,
    { decision, ...(reason !== undefined ? { reason } : {}) }
  );
}

export interface ApprovalDecisionEvent {
  approvalId: string;
  decision: string;
  reason?: string;
}

/** Lee los `approval_request` del SSE; sirve para probar varias pendientes. */
export async function collectApprovals(
  srv: ServerHarness,
  sessionId: string,
  count: number,
  timeoutMs = 5_000
): Promise<ApprovalRequestV2[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text = '';
  try {
    const res = await fetch(
      `${srv.baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/stream?after=0`,
      { signal: controller.signal, headers: { Accept: 'text/event-stream' } }
    );
    const reader = res.body?.getReader();
    if (!reader) throw new Error('el stream no devolvió cuerpo');
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const found = parseApprovalRequests(text);
      if (found.length >= count) return found.slice(0, count);
    }
    const found = parseApprovalRequests(text);
    if (found.length >= count) return found.slice(0, count);
    throw new Error(`el stream no emitió ${count} approval_request: ${text.slice(-500)}`);
  } catch (error: any) {
    if (error?.name !== 'AbortError') throw error;
    const found = parseApprovalRequests(text);
    if (found.length >= count) return found.slice(0, count);
    throw new Error(`timeout esperando ${count} approval_request: ${text.slice(-500)}`);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function parseApprovalRequests(text: string): ApprovalRequestV2[] {
  const requests: ApprovalRequestV2[] = [];
  for (const block of text.split('\n\n')) {
    let event = '';
    let data = '';
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (event !== 'approval_request' || !data) continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed?.type === 'approval_request' && parsed.approval?.id) {
        requests.push(parsed.approval as ApprovalRequestV2);
      }
    } catch { /* bloque incompleto */ }
  }
  return requests;
}

export async function collectApprovalResults(
  srv: ServerHarness,
  sessionId: string,
  timeoutMs = 5_000
): Promise<ApprovalDecisionEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text = '';
  try {
    const res = await fetch(
      `${srv.baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/stream?after=0`,
      { signal: controller.signal, headers: { Accept: 'text/event-stream' } }
    );
    const reader = res.body?.getReader();
    if (!reader) throw new Error('el stream no devolvió cuerpo');
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const found = parseApprovalResults(text);
      if (found.length > 0) return found;
    }
    return parseApprovalResults(text);
  } catch (error: any) {
    if (error?.name === 'AbortError') return parseApprovalResults(text);
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function parseApprovalResults(text: string): ApprovalDecisionEvent[] {
  const results: ApprovalDecisionEvent[] = [];
  for (const block of text.split('\n\n')) {
    let event = '';
    let data = '';
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (event !== 'approval_result' || !data) continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed?.type === 'approval_result' && parsed.approvalId) {
        results.push({
          approvalId: parsed.approvalId,
          decision: parsed.decision,
          ...(parsed.reason ? { reason: parsed.reason } : {}),
        });
      }
    } catch { /* bloque incompleto */ }
  }
  return results;
}

/** Hash estable de todo el árbol: detecta una escritura aunque sea de un byte. */
export function treeFingerprint(dir: string): string {
  const hash = createHash('sha256');
  const walk = (relative: string) => {
    const abs = path.join(dir, relative);
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      hash.update(`${entry.isDirectory() ? 'd' : entry.isFile() ? 'f' : 'o'}:${next}\n`);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) hash.update(fs.readFileSync(path.join(dir, next)));
    }
  };
  if (fs.existsSync(dir)) walk('');
  return hash.digest('hex');
}

export function cleanupDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ya no está */ }
}
