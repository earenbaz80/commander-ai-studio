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

test('un hijo que agota maxSteps antes del primer turno gasta igualmente su turno sin tools', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const objetivo = `hijo-limite-antes-de-turnos-${Date.now()}`;
  const padre = createSession({ goal: 'padre de la prueba de límite en seco', cwd: dir });
  let turnos = 0;
  let turnosSinTools = 0;

  globalThis.fetch = (async (_url: any, init?: any) => {
    const body = JSON.parse(String(init?.body || '{}'));
    turnos += 1;
    if (!body.tools) turnosSinTools += 1;
    return { ok: true, status: 200, json: async () => ({ text: 'Archivos: ninguno\nDenegado: ninguna', functionCalls: [] }) } as any;
  }) as any;

  try {
    // `maxSteps: 1` se agota antes del primer turno con tools. Antes cerraba en
    // `done` con `Límite` y sin `Finalizado`, y el padre lo contaba como hijo
    // fallido aunque el hijo no había hecho nada mal.
    const res: any = await executeAgentTool('task', {
      root: dir,
      parentSessionId: padre.id,
      goal: objetivo,
      maxSteps: 1,
    });

    assert.equal(turnos, 1, 'pide el cierre aunque el presupuesto de pasos ya esté agotado');
    assert.equal(turnosSinTools, 1, 'ese turno no lleva tools');
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 400));
    assert.match(String(res.answer), /Archivos: ninguno/);

    const [fila] = listSubAgents(padre.id);
    assert.equal(fila.status, 'completed');
    assert.equal(fila.answer, res.answer);
    assert.deepEqual(fila.stepTitles, ['Inicio', 'Finalizado'], 'cierra con `Finalizado`, no con `Límite`');
    assert.deepEqual(fila.calls, []);
  } finally {
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});

test('un hijo que agota maxSteps tras trabajar gasta un turno sin tools y termina en `Finalizado`', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const objetivo = `hijo-agota-maxsteps-${Date.now()}`;
  const padre = createSession({ goal: 'padre de la prueba de límite tras trabajar', cwd: dir });
  const stopApprovals = autoApprove(objetivo);
  let turnosConTools = 0;
  let turnosFinales = 0;

  globalThis.fetch = (async (_url: any, init?: any) => {
    const body = JSON.parse(String(init?.body || '{}'));
    if (!body.tools) {
      turnosFinales += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          text: 'Archivos: hijo-max.txt\nDenegado: fs.list por allowlist. listo',
          functionCalls: [],
        }),
      } as any;
    }

    turnosConTools += 1;
    const call = (name: string, args: Record<string, unknown>) => ({
      ok: true,
      status: 200,
      json: async () => ({ text: 'trabajando', functionCalls: [{ name, args }] }),
    } as any);

    if (turnosConTools === 1) return call('fs_list', { path: dir });
    if (turnosConTools === 2) return call('fs_write', { path: 'hijo-max.txt', content: 'hecho' });
    throw new Error(`llamada con tools inesperada: ${turnosConTools}`);
  }) as any;

  try {
    // Inicio (1) + turno denegado (razonamiento, resultado y aviso: 3) + turno
    // con la escritura (razonamiento y resultado: 2) = 6. Con el tope justo ahí,
    // el bucle entra al guard de `maxSteps` y no al del presupuesto de tools.
    // Ése es el camino que en G1-T10-05 moría en `Límite` sin `Finalizado`.
    const res: any = await executeAgentTool('task', {
      root: dir,
      parentSessionId: padre.id,
      goal: objetivo,
      allowedTools: ['fs.write'],
      maxSteps: 6,
    });

    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 400));
    assert.match(String(res.answer), /listo/i);
    assert.match(String(res.answer), /Denegado:.*fs\.list/i);
    assert.equal(fs.readFileSync(path.join(dir, 'hijo-max.txt'), 'utf8'), 'hecho');
    assert.equal(turnosConTools, 2, 'trabaja con tools hasta el tope de pasos');
    assert.equal(turnosFinales, 1, 'al agotar maxSteps gasta exactamente un turno sin tools');

    const [fila] = listSubAgents(padre.id);
    assert.equal(fila.status, 'completed');
    assert.equal(fila.answer, res.answer);
    assert.equal(fila.stepTitles?.at(-1), 'Finalizado', 'la fila termina en el cierre real');
    assert.ok(
      !fila.stepTitles?.includes('Límite'),
      `no muere en el paso de límite: ${JSON.stringify(fila.stepTitles)}`
    );
  } finally {
    stopApprovals();
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

test('un hijo con tools denegadas escribe y gasta su turno final en `Finalizado`', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const objetivo = `hijo-cierre-con-denegadas-${Date.now()}`;
  const padre = createSession({ goal: 'padre de la prueba de cierre reservado', cwd: dir });
  const stopApprovals = autoApprove(objetivo);
  let turnosConTools = 0;
  let turnosFinales = 0;

  globalThis.fetch = (async (_url: any, init?: any) => {
    const body = JSON.parse(String(init?.body || '{}'));
    // El turno reservado para cerrar se reconoce porque no lleva tools.
    if (!body.tools) {
      turnosFinales += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          text: 'Archivos: hijo-a.txt\nDenegado: fs.list y fs.glob por allowlist. listo',
          functionCalls: [],
        }),
      } as any;
    }

    turnosConTools += 1;
    const call = (name: string, args: Record<string, unknown>) => ({
      ok: true,
      status: 200,
      json: async () => ({ functionCalls: [{ name, args }] }),
    } as any);

    if (turnosConTools === 1) return call('fs_list', { path: dir });
    if (turnosConTools === 2) return call('fs_glob', { pattern: '*' });
    if (turnosConTools === 3) return call('fs_write', { path: 'hijo-a.txt', content: 'hola' });
    if (turnosConTools === 4) return call('fs_read', { path: 'hijo-a.txt' });
    throw new Error(`llamada con tools inesperada: ${turnosConTools}`);
  }) as any;

  try {
    const res: any = await executeAgentTool('task', {
      root: dir,
      parentSessionId: padre.id,
      goal: objetivo,
      allowedTools: ['fs.read', 'fs.write'],
      maxSteps: 8,
    });

    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 400));
    assert.match(String(res.answer), /listo/i);
    assert.match(String(res.answer), /Denegado:.*fs\.list/i);
    assert.equal(fs.readFileSync(path.join(dir, 'hijo-a.txt'), 'utf8'), 'hola');
    assert.equal(turnosConTools, 4, 'no pide un turno con tools cuando ya no queda presupuesto');
    assert.equal(turnosFinales, 1, 'usa exactamente un turno sin tools para cerrar');

    const [fila] = listSubAgents(padre.id);
    assert.equal(fila.status, 'completed');
    assert.equal(fila.answer, res.answer);
    assert.equal(fila.stepTitles?.at(-1), 'Finalizado', 'la fila termina en el cierre real');
    assert.ok(
      fila.calls?.some((c) => c.tool === 'fs.write' && c.ok === true),
      `la escritura quedó registrada: ${JSON.stringify(fila.calls)}`
    );
    assert.ok(
      fila.calls?.some((c) => c.tool === 'fs.list' && c.ok === false),
      `la denegación quedó registrada: ${JSON.stringify(fila.calls)}`
    );
  } finally {
    stopApprovals();
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});
test('el catálogo del hijo respeta allowedTools: no le ofrece fs.list, fs.glob, git.status ni shell.run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const padre = createSession({ goal: 'padre de la prueba de catálogo', cwd: dir });
  const objetivo = `catalogo-${Date.now()}`;
  const pedidos: any[] = [];

  // El hijo no llama tools: interesa el sobre que se le manda al proveedor.
  globalThis.fetch = (async (_url: any, init: any) => {
    pedidos.push(JSON.parse(String(init?.body ?? '{}')));
    return { ok: true, status: 200, json: async () => ({ text: 'Archivos: ninguno\nDenegado: ninguna', functionCalls: [] }) } as any;
  }) as any;

  try {
    const res: any = await executeAgentTool('task', {
      root: dir,
      parentSessionId: padre.id,
      goal: objetivo,
      allowedTools: ['fs.read', 'fs.write'],
    });
    assert.equal(res.ok, true, `el subagente debe completar: ${JSON.stringify(res).slice(0, 400)}`);

    const pedido = pedidos[0];
    assert.ok(pedido, 'el hijo pidió al menos un turno');
    const prompt = String(pedido.contents ?? pedido.prompt ?? '');
    assert.ok(prompt.includes('TOOLS:'), 'el prompt lleva la sección de tools');
    const catalogo = prompt.slice(prompt.indexOf('TOOLS:'));

    for (const permitida of ['fs.read', 'fs.write']) {
      assert.match(catalogo, new RegExp(permitida.replace('.', '\\.')), `el catálogo debe ofrecer ${permitida}`);
    }
    for (const denegada of ['fs.list', 'fs.glob', 'shell.run', 'git.status']) {
      assert.doesNotMatch(catalogo, new RegExp(denegada.replace('.', '\\.')), `el catálogo no debe ofrecer ${denegada}`);
    }

    const declaradas: string[] = (pedido.tools?.[0]?.functionDeclarations ?? []).map((d: any) => String(d.name));
    assert.ok(declaradas.includes('fs_read') && declaradas.includes('fs_write'), 'las declaraciones nativas siguen la allowlist');
    for (const fuera of ['fs_list', 'fs_glob', 'shell_run', 'git_status']) {
      assert.equal(declaradas.includes(fuera), false, `no se declara ${fuera} al proveedor`);
    }
  } finally {
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});

test('sin allowlist el hijo sigue viendo el catálogo completo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const padre = createSession({ goal: 'padre de la prueba de catálogo completo', cwd: dir });
  const objetivo = `catalogo-completo-${Date.now()}`;
  let prompt = '';

  globalThis.fetch = (async (_url: any, init: any) => {
    const pedido = JSON.parse(String(init?.body ?? '{}'));
    prompt = String(pedido.contents ?? pedido.prompt ?? '');
    return { ok: true, status: 200, json: async () => ({ text: 'Archivos: ninguno\nDenegado: ninguna', functionCalls: [] }) } as any;
  }) as any;

  try {
    const res: any = await executeAgentTool('task', { root: dir, parentSessionId: padre.id, goal: objetivo });
    assert.equal(res.ok, true, `el subagente debe completar: ${JSON.stringify(res).slice(0, 400)}`);
    const catalogo = prompt.slice(prompt.indexOf('TOOLS:'));
    for (const id of ['fs.read', 'fs.write', 'shell.run', 'fs.list']) {
      assert.match(catalogo, new RegExp(id.replace('.', '\\.')), `sin allowlist el catálogo mantiene ${id}`);
    }
  } finally {
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});

test('dos hijos en paralelo con dialecto JSON entregan su respuesta de cierre', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-task-'));
  const padre = createSession({ goal: 'padre con hijos json', cwd: dir });
  const modelo = 'lmstudio/deepseek/deepseek-r1';
  const respuestas: Record<string, string> = {
    'hijo-a': 'Archivos: hijo-a.txt\nDenegado: ninguna\nlisto (A)',
    'hijo-b': 'Archivos: hijo-b.txt\nDenegado: ninguna\nlisto (B)',
  };
  const turnos: Record<string, number> = { 'hijo-a': 0, 'hijo-b': 0 };
  const cierres: Record<string, number> = { 'hijo-a': 0, 'hijo-b': 0 };

  globalThis.fetch = (async (_url: any, init?: any) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const prompt = String(body.contents ?? body.prompt ?? '');
    const nombre = prompt.includes('hijo-a') ? 'hijo-a' : 'hijo-b';
    if (prompt.includes('ÚLTIMO TURNO')) {
      cierres[nombre] += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: JSON.stringify({ finish: true, answer: respuestas[nombre] }) }),
      } as any;
    }
    turnos[nombre] += 1;
    // Las dos formas de «no cerrar» que el bucle daba por terminadas y dejaban
    // al padre con «El subagente terminó sin respuesta final» (G1-D5-09):
    // `finish` sin texto (A) y un turno sin toolCalls ni finish (B).
    const cuerpo =
      nombre === 'hijo-a'
        ? { thought: 'trabajo hecho', finish: true }
        : { thought: 'pensando' };
    return { ok: true, status: 200, json: async () => ({ text: JSON.stringify(cuerpo) }) } as any;
  }) as any;

  try {
    const res: any = await executeAgentTool('spawn_agents', {
      root: dir,
      parentSessionId: padre.id,
      agents: [
        { goal: 'hijo-a', model: modelo },
        { goal: 'hijo-b', model: modelo },
      ],
    });

    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 400));
    const hijos = res.data?.results ?? [];
    assert.equal(hijos.length, 2, 'el padre recibe un resultado por hijo');
    for (const hijo of hijos) {
      assert.equal(hijo.ok, true, `el hijo ${hijo.index} cierra con respuesta: ${hijo.error}`);
      assert.match(String(hijo.answer), /Archivos:/);
      assert.match(String(hijo.answer), /listo/);
    }

    // Un turno normal por hijo y exactamente un turno de cierre: ninguno cerró
    // en `done` sin respuesta.
    assert.equal(turnos['hijo-a'], 1);
    assert.equal(turnos['hijo-b'], 1);
    assert.equal(cierres['hijo-a'], 1, 'un `finish` sin texto no cierra: se pide el turno final');
    assert.equal(cierres['hijo-b'], 1, 'un turno sin salida tampoco cierra: se pide el turno final');

    const filas = listSubAgents(padre.id);
    assert.equal(filas.length, 2);
    for (const fila of filas) {
      assert.equal(fila.status, 'completed');
      assert.match(String(fila.answer), /listo/);
      assert.equal(fila.stepTitles?.at(-1), 'Finalizado', 'la fila termina en el cierre real');
    }
  } finally {
    removeSession(padre.id);
    clearSubAgents(padre.id);
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});
