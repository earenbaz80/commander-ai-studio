/**
 * Pruebas del guardia de limpieza de escenarios.
 *
 * El fake devuelve una lista distinta antes y después del escenario; así se
 * comprueba que el guardia detecta la sesión nueva sin necesitar un servidor
 * real ni Chromium. También simula el `cwd` de una sesión de otro archivo para
 * verificar que el filtro por workspace evita falsos positivos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerHarness } from './helpers/serverHarness.js';
import {
  assertNoLingeringSessions,
  snapshotSessions,
} from './helpers/sessionAssertions.js';

interface Sessions {
  agents: any[];
  browsers: any[];
}

const evalRoot = 'C:/tmp/eval';

function fixture(before: Sessions, after: Sessions) {
  let current = before;
  const srv: Pick<ServerHarness, 'request'> = {
    request: async (_method: string, route: string) => {
      if (route === '/api/agent/sessions') {
        return { status: 200, body: { success: true, sessions: current.agents }, raw: '' };
      }
      if (route === '/api/browser/sessions') {
        return { status: 200, body: { success: true, sessions: current.browsers }, raw: '' };
      }
      if (route.startsWith('/api/agent/sessions/')) {
        const id = decodeURIComponent(route.slice('/api/agent/sessions/'.length));
        const session = current.agents.find((candidate) => candidate.id === id);
        return session
          ? { status: 200, body: { success: true, state: session }, raw: '' }
          : { status: 404, body: { success: false }, raw: '' };
      }
      throw new Error(`ruta inesperada: ${route}`);
    },
  };
  return {
    srv,
    markAfter: () => { current = after; },
  };
}

test('sessionAssertions · falla si el escenario deja una sesión de agente', async () => {
  const baseAgent = { id: 'sess_base', goal: 'sesión previa', cwd: `${evalRoot}/base` };
  const baseBrowser = { id: 'browser_base', root: `${evalRoot}/base` };
  const extraAgent = { id: 'sess_extra', goal: 'T6: fuga de agente', cwd: `${evalRoot}/T6-fuga` };
  const fx = fixture(
    { agents: [baseAgent], browsers: [baseBrowser] },
    { agents: [baseAgent, extraAgent], browsers: [baseBrowser] }
  );

  const before = await snapshotSessions(fx.srv);
  fx.markAfter();

  await assert.rejects(
    () => assertNoLingeringSessions(fx.srv, before, 'T6', { rootPrefix: evalRoot }),
    /dejó sesiones vivas[\s\S]*sess_extra[\s\S]*T6: fuga de agente/
  );
});

test('sessionAssertions · falla si el escenario deja una sesión de Playwright', async () => {
  const baseAgent = { id: 'sess_base', goal: 'sesión previa', cwd: `${evalRoot}/base` };
  const baseBrowser = { id: 'browser_base', root: `${evalRoot}/base` };
  const extraBrowser = { id: 'browser_extra', root: `${evalRoot}/T6-fuga` };
  const fx = fixture(
    { agents: [baseAgent], browsers: [baseBrowser] },
    { agents: [baseAgent], browsers: [baseBrowser, extraBrowser] }
  );

  const before = await snapshotSessions(fx.srv);
  fx.markAfter();

  await assert.rejects(
    () => assertNoLingeringSessions(fx.srv, before, 'T6', { rootPrefix: evalRoot }),
    /dejó sesiones vivas[\s\S]*Playwright: browser_extra[\s\S]*T6-fuga/
  );
});

test('sessionAssertions · ignora sesiones nuevas fuera del workspace del escenario', async () => {
  const baseAgent = { id: 'sess_base', goal: 'sesión previa', cwd: `${evalRoot}/base` };
  const baseBrowser = { id: 'browser_base', root: `${evalRoot}/base` };
  const otrasSesiones = [
    { id: 'sess_otra', goal: 'Prueba de otro archivo', cwd: 'C:/tmp/otro' },
  ];
  const otrosNavegadores = [
    { id: 'browser_otra', root: 'C:/tmp/otro' },
  ];
  const fx = fixture(
    { agents: [baseAgent], browsers: [baseBrowser] },
    {
      agents: [baseAgent, ...otrasSesiones],
      browsers: [baseBrowser, ...otrosNavegadores],
    }
  );

  const before = await snapshotSessions(fx.srv);
  fx.markAfter();

  await assert.doesNotReject(
    () => assertNoLingeringSessions(fx.srv, before, 'T6', { rootPrefix: evalRoot })
  );
});
