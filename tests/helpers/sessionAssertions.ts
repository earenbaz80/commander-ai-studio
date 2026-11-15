/**
 * Guardia de limpieza para pruebas de escenarios.
 *
 * El servidor compartido puede tener sesiones de otros archivos, así que no
 * basta con exigir que la lista global esté vacía. Se toma una foto antes del
 * escenario y se comparan los ids después: sólo falla si el escenario dejó una
 * sesión nueva de agente o de Playwright.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import type { ServerHarness } from './serverHarness.js';

type SessionServer = Pick<ServerHarness, 'request'>;

export interface SessionSnapshot {
  agentIds: Set<string>;
  browserIds: Set<string>;
}

export interface SessionCheckOptions {
  /** Si se indica, sólo cuentan las sesiones cuyo workspace cae dentro. */
  rootPrefix?: string;
}

async function listSessions(
  srv: SessionServer,
  route: string,
  key: string
): Promise<any[]> {
  const res = await srv.request('GET', route);
  assert.equal(
    res.status,
    200,
    `${route} respondió HTTP ${res.status}: ${String(res.raw).slice(0, 300)}`
  );
  const sessions = res.body?.[key];
  assert.ok(Array.isArray(sessions), `${route} no devolvió un array en ${key}`);
  return sessions;
}

function idsOf(sessions: any[]): Set<string> {
  return new Set(
    sessions
      .map((session) => String(session?.id ?? '').trim())
      .filter(Boolean)
  );
}

function normalizePath(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const normalized = path.resolve(text).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithinRoot(value: unknown, rootPrefix: string): boolean {
  const candidate = normalizePath(value);
  const root = normalizePath(rootPrefix);
  if (!candidate || !root) return false;
  return candidate === root || candidate.startsWith(`${root}/`);
}

/** Una sesión de agente sólo cuenta si su `cwd` está bajo el ámbito pedido. */
async function agentsInRoot(
  srv: SessionServer,
  agents: any[],
  rootPrefix?: string
): Promise<any[]> {
  if (!rootPrefix) return agents;
  const checked = await Promise.all(
    agents.map(async (session) => {
      const id = String(session?.id ?? '').trim();
      if (!id) return null;
      const res = await srv.request(
        'GET',
        `/api/agent/sessions/${encodeURIComponent(id)}`
      );
      // La sesión pudo desaparecer entre el listado y la consulta.
      if (res.status === 404) return null;
      assert.equal(
        res.status,
        200,
        `GET /api/agent/sessions/${id} respondió HTTP ${res.status}: ${String(res.raw).slice(0, 300)}`
      );
      return isWithinRoot(res.body?.state?.cwd, rootPrefix) ? session : null;
    })
  );
  return checked.filter(Boolean) as any[];
}

/** Foto de las sesiones que ya existían antes de un escenario. */
export async function snapshotSessions(srv: SessionServer): Promise<SessionSnapshot> {
  const [agents, browsers] = await Promise.all([
    listSessions(srv, '/api/agent/sessions', 'sessions'),
    listSessions(srv, '/api/browser/sessions', 'sessions'),
  ]);
  return {
    agentIds: idsOf(agents),
    browserIds: idsOf(browsers),
  };
}

function summarizeAgent(session: any): string {
  const goal = String(session?.goal ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return `${String(session?.id ?? 'sin id')}${goal ? ` (${goal})` : ''}`;
}

function summarizeBrowser(session: any): string {
  const root = String(session?.root ?? '').trim().slice(0, 160);
  return `${String(session?.id ?? 'sin id')}${root ? ` (${root})` : ''}`;
}

/** Falla si el escenario creó y no cerró una sesión de agente o de Playwright. */
export async function assertNoLingeringSessions(
  srv: SessionServer,
  before: SessionSnapshot,
  label = 'el escenario',
  options: SessionCheckOptions = {}
): Promise<void> {
  const [agents, browsers] = await Promise.all([
    listSessions(srv, '/api/agent/sessions', 'sessions'),
    listSessions(srv, '/api/browser/sessions', 'sessions'),
  ]);
  const newAgentCandidates = agents.filter(
    (session) => !before.agentIds.has(String(session?.id ?? '').trim())
  );
  const newAgents = await agentsInRoot(srv, newAgentCandidates, options.rootPrefix);
  const newBrowsers = browsers
    .filter((session) => !before.browserIds.has(String(session?.id ?? '').trim()))
    .filter((session) => !options.rootPrefix || isWithinRoot(session?.root, options.rootPrefix));

  if (newAgents.length === 0 && newBrowsers.length === 0) return;

  const details = [
    newAgents.length > 0 ? `agente: ${newAgents.map(summarizeAgent).join(', ')}` : '',
    newBrowsers.length > 0 ? `Playwright: ${newBrowsers.map(summarizeBrowser).join(', ')}` : '',
  ].filter(Boolean).join('; ');

  assert.fail(`${label} dejó sesiones vivas — ${details}`);
}
