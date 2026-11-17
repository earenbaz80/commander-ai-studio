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

test('un turno vacío se reintenta y, si el segundo trae respuesta, el hijo completa', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const objetivo = `hijo-con-turno-vacio-${Date.now()}`;
  const padre = createSession({ goal: 'padre de la prueba de turno vacío', cwd: dir });
  let llamadas = 0;

  globalThis.fetch = (async () => {
    llamadas += 1;
    if (llamadas === 1) {
      // El turno que se vio en G1-D5-07: ni pensamiento ni llamadas. Antes se
      // cerraba con el relleno «Objetivo completado.» y el hijo contaba como ok.
      return { ok: true, status: 200, json: async () => ({ functionCalls: [] }) } as any;
    }
    return { ok: true, status: 200, json: async () => ({ text: 'listo', functionCalls: [] }) } as any;
  }) as any;

  try {
    const res: any = await executeAgentTool('task', {
      root: dir,
      parentSessionId: padre.id,
      goal: objetivo,
    });

    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 400));
    assert.equal(res.answer, 'listo', 'la respuesta es la del turno real, no el relleno');
    assert.equal(llamadas, 2, 'el turno vacío se reintenta una vez');

    const [fila] = listSubAgents(padre.id);
    assert.equal(fila.status, 'completed');
    assert.equal(fila.answer, 'listo');
    assert.ok(
      fila.stepTitles?.includes('Turno vacío'),
      `el reintento queda visible en la fila: ${JSON.stringify(fila.stepTitles)}`
    );
    assert.equal(fila.stepTitles?.at(-1), 'Finalizado', 'cerró con una respuesta de verdad');
  } finally {
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});

test('si el turno sigue vacío tras el reintento, el hijo queda fallido en vez de «Objetivo completado.»', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const objetivo = `hijo-sin-turno-${Date.now()}`;
  const padre = createSession({ goal: 'padre de la prueba de turno vacío persistente', cwd: dir });
  let llamadas = 0;

  globalThis.fetch = (async () => {
    llamadas += 1;
    return { ok: true, status: 200, json: async () => ({ functionCalls: [] }) } as any;
  }) as any;

  try {
    const res: any = await executeAgentTool('task', {
      root: dir,
      parentSessionId: padre.id,
      goal: objetivo,
    });

    assert.equal(res.ok, false, 'un hijo sin respuesta ni llamadas no puede darse por bueno');
    assert.match(String(res.error), /turnos vacíos/i);
    assert.equal(llamadas, 2, 'reintenta una vez y no entra en bucle');

    const [fila] = listSubAgents(padre.id);
    assert.equal(fila.status, 'failed');
    assert.equal(fila.answer, undefined, 'no se inventa «Objetivo completado.»');
    assert.match(String(fila.error), /turnos vacíos/i);
    assert.deepEqual(
      fila.stepTitles,
      ['Inicio', 'Turno vacío', 'Finalizado sin respuesta'],
      'la fila dice por qué cerró: un turno vacío y luego la rendición'
    );
    assert.deepEqual(fila.calls, [], 'no hubo ninguna tool que anotar');
  } finally {
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});

test('un hijo que termina en `done` sin `Finalizado` queda incompleto, no con una respuesta inventada', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const objetivo = `hijo-sin-cierre-${Date.now()}`;
  const padre = createSession({ goal: 'padre de la prueba de cierre ausente', cwd: dir });
  let llamadas = 0;

  globalThis.fetch = (async () => {
    llamadas += 1;
    return { ok: true, status: 200, json: async () => ({ text: 'nunca llega', functionCalls: [] }) } as any;
  }) as any;

  try {
    // `maxSteps: 1` se agota antes del primer turno: la sesión cierra en `done`
    // con el paso `Límite` y sin `Finalizado`, que es el caso que se colaba como
    // `ok:true` con «Subagente completado sin respuesta explícita».
    const res: any = await executeAgentTool('task', {
      root: dir,
      parentSessionId: padre.id,
      goal: objetivo,
      maxSteps: 1,
    });

    assert.equal(llamadas, 0, 'el límite se alcanza antes de pedir ningún turno');
    assert.equal(res.ok, false, 'un `done` sin respuesta no puede darse por bueno');
    assert.match(String(res.error), /sin respuesta final/i);
    assert.equal(res.answer, undefined, 'no se inventa una respuesta');

    const [fila] = listSubAgents(padre.id);
    assert.equal(fila.status, 'failed');
    assert.match(String(fila.error), /sin respuesta final/i);
    assert.equal(fila.answer, undefined);
    assert.deepEqual(fila.stepTitles, ['Inicio', 'Límite'], 'la fila deja ver por qué cerró sin responder');
    assert.deepEqual(fila.calls, []);
  } finally {
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});

test('si los hijos fallan dos tandas seguidas, el padre se detiene e informa, sin relanzar en bucle', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const padre = createSession({ goal: 'padre que relanza spawn_agents', cwd: dir });
  let spawnCalls = 0;
  let turnosDeHijos = 0;

  const stopApprovals = setInterval(() => {
    for (const approval of padre.getPendingApprovals()) padre.resolveApproval(approval.id, 'allow');
  }, 10);

  globalThis.fetch = (async () => {
    // Un hijo en curso tiene goal `hijo-*`: ese turno llega vacío, que es lo que
    // en G1-D5-08 hizo fallar a los seis hijos. El padre nunca llega aquí con un
    // hijo corriendo, así que siempre recibe la orden de lanzarlos.
    const hijoCorriendo = listSessions().some((s) => s.goal.startsWith('hijo-') && s.status === 'running');
    if (hijoCorriendo) {
      turnosDeHijos += 1;
      return { ok: true, status: 200, json: async () => ({ functionCalls: [] }) } as any;
    }
    spawnCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        functionCalls: [{
          name: 'spawn_agents',
          args: { agents: [{ goal: 'hijo-a' }, { goal: 'hijo-b' }] },
        }],
      }),
    } as any;
  }) as any;

  try {
    const terminado = new Promise<{ answer: string; error?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('la sesión padre no cerró')), 20_000);
      padre.addListener((evt) => {
        if (evt.type === 'finish') { clearTimeout(timer); resolve({ answer: evt.answer }); }
        if (evt.type === 'error') { clearTimeout(timer); resolve({ answer: '', error: evt.error }); }
      });
    });
    void padre.start();
    const cierre = await terminado;

    assert.equal(cierre.error, undefined, `no debe acabar en error: ${cierre.error}`);
    assert.match(cierre.answer, /No completé la tarea/, 'cierra diciendo que no completó la tarea');
    assert.match(cierre.answer, /subagentes fallaron en dos tandas seguidas/);
    assert.match(cierre.answer, /turnos vacíos/i, 'el motivo del fallo de los hijos viaja en la respuesta');

    assert.equal(spawnCalls, 2, 'no vuelve a lanzar el spawn después de la segunda tanda fallida');
    assert.equal(turnosDeHijos, 8, 'cuatro hijos × (turno vacío + reintento), en dos tandas');
    assert.equal(padre.getStatus(), 'done');
    const ultimo = padre.getSteps().filter((s) => s.title === 'Finalizado').at(-1);
    assert.match(String(ultimo?.content ?? ''), /No completé la tarea/);
    // Los `tool_call` sólo se emiten; lo que queda anotado es el resultado.
    assert.equal(
      padre.getSteps().filter((s) => s.type === 'tool_result' && s.toolId === 'spawn_agents').length,
      2,
      'dos resultados de spawn anotados, ni uno más'
    );
  } finally {
    clearInterval(stopApprovals);
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});

test('si falla un solo hijo dos tandas seguidas, el padre cierra e informa del parcial', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const padre = createSession({ goal: 'padre con un hijo parcialmente fallido', cwd: dir });
  let spawnCalls = 0;

  const stopApprovals = setInterval(() => {
    for (const approval of padre.getPendingApprovals()) padre.resolveApproval(approval.id, 'allow');
  }, 10);

  globalThis.fetch = (async () => {
    // G1-D5-10: A no produce turno y B cierra bien. El padre relanzaba la tanda
    // porque la guarda sólo contaba las tandas en las que fallaban todos.
    const hijo = listSessions().find((s) => s.goal.startsWith('hijo-') && s.status === 'running');
    if (hijo) {
      if (hijo.goal === 'hijo-a') {
        return { ok: true, status: 200, json: async () => ({ functionCalls: [] }) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ text: 'listo', functionCalls: [] }) } as any;
    }
    spawnCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        functionCalls: [{
          name: 'spawn_agents',
          args: { agents: [{ goal: 'hijo-a' }, { goal: 'hijo-b' }] },
        }],
      }),
    } as any;
  }) as any;

  try {
    const terminado = new Promise<{ answer: string; error?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('la sesión padre no cerró')), 20_000);
      padre.addListener((evt) => {
        if (evt.type === 'finish') { clearTimeout(timer); resolve({ answer: evt.answer }); }
        if (evt.type === 'error') { clearTimeout(timer); resolve({ answer: '', error: evt.error }); }
      });
    });
    void padre.start();
    const cierre = await terminado;

    assert.equal(cierre.error, undefined, `no debe acabar en error: ${cierre.error}`);
    assert.match(cierre.answer, /No completé la tarea/);
    assert.match(cierre.answer, /hubo subagentes fallidos en dos tandas seguidas/);
    assert.match(cierre.answer, /turnos vacíos/i, 'el motivo del hijo A viaja en la respuesta');
    assert.equal(spawnCalls, 2, 'no relanza una tercera tanda por el fallo parcial');

    // Dos tandas × dos hijos: A falla en las dos, B cierra bien en las dos.
    const filas = listSubAgents(padre.id);
    assert.equal(filas.length, 4);
    assert.equal(filas.filter((fila) => fila.status === 'failed').length, 2);
    assert.equal(filas.filter((fila) => fila.status === 'completed').length, 2);
    assert.equal(
      padre.getSteps().filter((s) => s.type === 'tool_result' && s.toolId === 'spawn_agents').length,
      2,
      'dos resultados de spawn anotados, ni uno más'
    );
    const ultimo = padre.getSteps().filter((s) => s.title === 'Finalizado').at(-1);
    assert.match(String(ultimo?.content ?? ''), /hubo subagentes fallidos/);
    assert.equal(padre.getStatus(), 'done');
  } finally {
    clearInterval(stopApprovals);
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});

test('un turno truncado por max_tokens llega como error del servidor y el hijo no lo toma por cierre', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const objetivo = `hijo-truncado-${Date.now()}`;
  const padre = createSession({ goal: 'padre de la prueba de truncado', cwd: dir });
  let llamadas = 0;

  globalThis.fetch = (async () => {
    llamadas += 1;
    // Lo que ahora responde el servidor cuando el proveedor corta el turno:
    // `finish_reason: length` con contenido vacío ya no viaja como `success:true`.
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: false, ok: false, error: 'respuesta truncada por max_tokens (finish_reason: length); max_tokens=4096' }),
    } as any;
  }) as any;

  try {
    const res: any = await executeAgentTool('task', {
      root: dir,
      parentSessionId: padre.id,
      goal: objetivo,
    });

    assert.equal(res.ok, false, 'el truncado no puede darse por bueno');
    assert.match(String(res.error), /truncada por max_tokens/i);
    assert.equal(res.answer, undefined);
    assert.equal(llamadas, 1, 'no reintenta en modo JSON: volvería a cortarse');

    const [fila] = listSubAgents(padre.id);
    assert.equal(fila.status, 'failed');
    assert.match(String(fila.error), /truncada por max_tokens/i);
    assert.deepEqual(fila.stepTitles, ['Inicio', 'Respuesta truncada'], 'la fila dice que el turno se cortó');
    assert.deepEqual(fila.calls, []);
  } finally {
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
