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

/** Simula al cliente que aprueba la escritura del subagente. */
function autoApprove(goal: string): () => void {
  const timer = setInterval(() => {
    for (const summary of listSessions()) {
      if (summary.goal !== goal) continue;
      const child = getSession(summary.id);
      if (!child) continue;
      for (const approval of child.getPendingApprovals()) {
        child.resolveApproval(approval.id, 'allow');
      }
    }
  }, 10);
  return () => clearInterval(timer);
}

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

test('un nombre con guion bajo del proveedor se ejecuta como la tool real', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const padre = createSession({ goal: 'padre de la prueba de mapeo', cwd: dir });
  const stopApprovals = autoApprove('escribir salida.txt');
  let llamadas = 0;

  globalThis.fetch = (async () => {
    llamadas += 1;
    if (llamadas === 1) {
      // El proveedor nombra las tools con guion bajo (`fs_write`); el registro
      // usa ids con punto (`fs.write`). Sin la traducción este turno se veía
      // como «sin salida» y la sesión cerraba sin escribir nada.
      return {
        ok: true,
        status: 200,
        json: async () => ({ functionCalls: [{ name: 'fs_write', args: { path: 'salida.txt', content: 'hola' } }] }),
      } as any;
    }
    return { ok: true, status: 200, json: async () => ({ text: 'listo', functionCalls: [] }) } as any;
  }) as any;

  try {
    const res: any = await executeAgentTool('task', {
      root: dir,
      parentSessionId: padre.id,
      goal: 'escribir salida.txt',
      mode: 'build',
    });

    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 400));
    assert.equal(res.answer, 'listo', 'el segundo turno cierra la tarea');
    assert.equal(llamadas, 2, 'un turno para la tool y otro para cerrar');
    assert.equal(fs.readFileSync(path.join(dir, 'salida.txt'), 'utf8'), 'hola', 'la tool se ejecutó de verdad');
  } finally {
    stopApprovals();
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});

test('un turno que sólo actualiza el plan no se toma por respuesta final', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const padre = createSession({ goal: 'padre de la prueba de plan', cwd: dir });
  const stopApprovals = autoApprove('planificar y escribir');
  let llamadas = 0;

  globalThis.fetch = (async () => {
    llamadas += 1;
    if (llamadas === 1) {
      // `update_plan` es pseudo-tool: sin consumirla, este turno se daba por
      // terminado («Objetivo completado.») sin tocar el workspace.
      return {
        ok: true,
        status: 200,
        json: async () => ({ functionCalls: [{ name: 'update_plan', args: { items: [{ id: 'p1', text: 'escribir', done: false }] } }] }),
      } as any;
    }
    if (llamadas === 2) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ functionCalls: [{ name: 'fs_write', args: { path: 'plan.txt', content: 'ok' } }] }),
      } as any;
    }
    return { ok: true, status: 200, json: async () => ({ text: 'hecho', functionCalls: [] }) } as any;
  }) as any;

  try {
    const res: any = await executeAgentTool('task', {
      root: dir,
      parentSessionId: padre.id,
      goal: 'planificar y escribir',
      mode: 'build',
    });

    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 400));
    assert.equal(res.answer, 'hecho');
    assert.equal(llamadas, 3, 'planificar no cierra la sesión: siguen el trabajo y el cierre');
    assert.equal(fs.readFileSync(path.join(dir, 'plan.txt'), 'utf8'), 'ok', 'el trabajo se hizo después del plan');
  } finally {
    stopApprovals();
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});
