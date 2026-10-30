/**
 * Integración del executor de subagentes del servidor (tool `task`).
 *
 * Se ejercita el código real del servidor (`executeAgentTool`, el mismo que
 * atiende `POST /api/agent/run-tool`), no una copia: se crea la sesión padre,
 * se lanza un subagente y se comprueba qué pasa con la sesión hija. La única
 * pieza falsa es el transporte HTTP hacia el LLM; sin eso el subagente pediría
 * una API key real y el test dependería de la red, que es justo lo que no debe
 * pasar en CI.
 *
 * El subagente corre en el proceso del test (el executor es in-process), así que
 * el stub de `fetch` sí lo alcanza. Un test contra el server del arnés no podría:
 * allí el subagente vive en otro proceso y hablaría con el LLM de verdad.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeAgentTool } from '../agentTools.js';
import { createSession, getSession, listSessions, removeSession } from '../agentSession.js';
import { clearSubAgents, listSubAgents } from '../subAgents.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

test('task ejecuta un subagente real, lo registra mientras corre y lo limpia al terminar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const objetivo = `revisar-el-cambio-${Date.now()}`;
  const padre = createSession({ goal: 'padre de la prueba de task', cwd: dir });

  let llamadas = 0;
  let hijoId = '';
  let hijoStatus = '';
  // Se copian los campos, no el objeto: el registro se muta al terminar.
  let visibleGoal = '';
  let visibleStatus = '';
  globalThis.fetch = (async () => {
    llamadas += 1;
    // La sesión hija ya existe cuando el subagente pide su primer turno: es el
    // momento de comprobar que se registró de verdad.
    const hijo = listSessions().find((s) => s.goal === objetivo);
    if (hijo) { hijoId = hijo.id; hijoStatus = hijo.status; }
    // El panel de la UI lee de este registro, no del de sesiones.
    const visible = listSubAgents(padre.id).find((r) => r.goal === objetivo);
    if (visible) { visibleGoal = visible.goal; visibleStatus = visible.status; }
    // Dialecto nativo (Gemini): sin toolCalls la sesión considera el objetivo
    // cumplido y devuelve ese texto como respuesta final.
    return { ok: true, status: 200, json: async () => ({ text: 'revisado', functionCalls: [] }) } as any;
  }) as any;

  try {
    const res: any = await executeAgentTool('task', {
      root: dir,
      parentSessionId: padre.id,
      goal: objetivo,
    });

    assert.equal(res.ok, true, `el subagente debe completar: ${JSON.stringify(res).slice(0, 400)}`);
    assert.equal(res.answer, 'revisado', 'la respuesta del subagente llega tal cual');
    assert.equal(llamadas, 1, 'un solo turno del LLM: el stub contestó con el objetivo cumplido');

    assert.ok(hijoId, 'la sesión hija aparece en el registro mientras corre');
    assert.equal(hijoStatus, 'running', 'y se anuncia como corriendo, no como idle');
    assert.equal(getSession(hijoId), undefined, 'y se limpia al terminar');

    // Observabilidad: la UI ve el hijo mientras corre y luego su resultado.
    assert.equal(visibleGoal, objetivo, 'el subagente se expone mientras corre');
    assert.equal(visibleStatus, 'running');
    const [terminado] = listSubAgents(padre.id);
    assert.equal(terminado.status, 'completed');
    assert.equal(terminado.answer, 'revisado');
    assert.equal(terminado.goal, objetivo);
    assert.ok(terminado.steps > 0, 'los pasos dados quedan anotados');

    // El padre no se toca: sigue en reposo para los siguientes subagentes.
    assert.equal(getSession(padre.id)?.getStatus(), 'idle');
    assert.deepEqual(
      listSessions().filter((s) => s.goal === objetivo),
      [],
      'no queda ninguna sesión hija acumulada'
    );
  } finally {
    // Limpieza del test: el padre lo crea el test, no la tool.
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }

  assert.equal(getSession(padre.id), undefined);
});
