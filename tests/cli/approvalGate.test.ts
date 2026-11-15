import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../../src/cli/agentClient.js';
import {
  createSessionState,
  type ApprovalRequestV2,
  type CliEventV2,
  type SessionStateV2,
  type SessionStepV2,
} from '../../src/agent/sessionTypes.js';
import { startFakeAgentServer } from '../helpers/fakeAgentServer.js';
import { Tui } from '../../src/cli/tui.js';

const TASK = 'SCENARIO:tool-denied Escribe salida.txt.';

type FakeAgentServer = Awaited<ReturnType<typeof startFakeAgentServer>>;

/** Cuenta sólo las ejecuciones reales de `shell.run` que llegaron al servidor. */
function countShellRuns(fake: FakeAgentServer): number {
  return fake.requests.filter(
    (request) => request.path === '/api/agent/run-tool' && request.body?.toolId === 'shell.run'
  ).length;
}

/** Paso persistido de resultado, para sembrar una sesión antes de `--resume`. */
function resultStep(
  id: string,
  toolId: string,
  approval: SessionStepV2['approval'] | undefined,
  overrides: Partial<SessionStepV2> = {}
): SessionStepV2 {
  return {
    id,
    type: 'tool_result',
    toolId,
    title: toolId,
    content: 'ok',
    status: 'completed',
    ts: Date.now(),
    ...(approval === undefined ? {} : { approval }),
    ...overrides,
  };
}

/** Estado tal como lo tiene el servidor: lo que verían `attach` y el escritorio. */
async function serverState(baseUrl: string, sessionId: string): Promise<SessionStateV2> {
  const res = await fetch(`${baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}`);
  const body = (await res.json()) as { state?: SessionStateV2 };
  assert.ok(body.state, 'el servidor devuelve el estado de la sesión');
  return body.state as SessionStateV2;
}

/** Espera acotada y activa: sin `sleep` fijo y con el último estado en el error. */
async function waitForServerState(
  baseUrl: string,
  sessionId: string,
  done: (state: SessionStateV2) => boolean,
  label: string
): Promise<SessionStateV2> {
  const deadline = Date.now() + 2_000;
  let last: SessionStateV2 | null = null;
  while (Date.now() < deadline) {
    last = await serverState(baseUrl, sessionId);
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`${label}: ${JSON.stringify(last?.pendingApproval ?? null)}`);
}

/** Id de la sesión, del primer evento `session` (se emite antes de progresar). */
async function sessionIdOf(events: CliEventV2[]): Promise<string> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const event = events.find((candidate) => candidate.type === 'session');
    if (event && event.type === 'session') return event.session.id;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('el CLI no emitió el evento session');
}

describe('aprobación de tools mutantes en el CLI', () => {
  test('sin callback deniega la tool y no llama a run-tool', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: TASK,
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      sessionId: 'sess_approval_denied',
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(
      fake.requests.some((request) => request.path === '/api/agent/run-tool'),
      false,
      'sin decisión la tool mutante no se ejecuta'
    );
    const request = events.find((event) => event.type === 'approval_request');
    assert.ok(request, 'se emite approval_request');
    const decision = events.find((event) => event.type === 'approval_result');
    assert.equal(decision?.type, 'approval_result');
    if (decision?.type === 'approval_result') {
      assert.equal(decision.decision, 'deny');
      assert.match(decision.reason || '', /terminal interactiva/);
    }
  });

  test('con callback allow ejecuta la tool después de la decisión', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    let approvals = 0;

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: TASK,
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      sessionId: 'sess_approval_allowed',
      requestApproval: async () => {
        approvals += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return 'allow';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(approvals, 1);
    assert.equal(
      fake.requests.some((request) => request.path === '/api/agent/run-tool'),
      true,
      'la decisión allow deja ejecutar la tool'
    );
    const decision = events.find((event) => event.type === 'approval_result');
    assert.equal(decision?.type, 'approval_result');
    if (decision?.type === 'approval_result') {
      assert.equal(decision.decision, 'allow');
      assert.equal(typeof decision.latencyMs, 'number');
      assert.ok((decision.latencyMs ?? 0) >= 20, 'la latencia incluye la espera de la decisión');
    }
  });

  test('la latencia desde la primera tecla de lectura viaja con la aprobación', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:tool-denied Escribe salida.txt.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      sessionId: 'sess_approval_first_key',
      requestApproval: async (request) => {
        request.noticeAt = Date.now();
        // 40 ms con el prompt abierto y nadie delante, luego 30 ms de lectura
        // real desde la primera tecla: es el reparto que `latencyMs` no sabía
        // separar y que CAL2 midió como dispersión de 2 s a 65 s.
        await new Promise((resolve) => setTimeout(resolve, 40));
        request.promptStartedAt = Date.now();
        request.render = { diffShown: true, diffTruncated: false, detailOpened: false };
        await new Promise((resolve) => setTimeout(resolve, 10));
        request.promptPaintedAt = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 10));
        request.firstInputAt = Date.now();
        request.firstKeyAt = request.firstInputAt;
        request.firstNonDecisionKeyAt = Date.now();
        request.quarantinedKeys = 2;
        request.quarantinedDecision = true;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return 'allow';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    const decision = events.find((event) => event.type === 'approval_result');
    assert.equal(decision?.type, 'approval_result');
    if (decision?.type !== 'approval_result') return;
    assert.ok(
      (decision.decisionMs ?? -1) >= 25,
      `decisionMs mide desde la primera tecla no decisoria (${decision.decisionMs})`
    );
    assert.equal(typeof decision.promptPaintedAt, 'number', 'el instante del pintado viaja con el resultado');
    assert.equal(typeof decision.firstInputAt, 'number', 'el primer input viaja con el resultado');
    assert.equal(typeof decision.firstNonDecisionKeyAt, 'number', 'la tecla de lectura viaja con el resultado');
    assert.equal(typeof decision.decisionAt, 'number', 'el instante de la decisión viaja con el resultado');
    assert.equal(decision.quarantinedKeys, 2, 'las teclas descartadas viajan con el resultado');
    assert.equal(decision.quarantinedDecision, true, 'la decisión descartada viaja con el resultado');
    assert.ok((decision.latencyMs ?? 0) >= 80, `latencyMs sigue midiendo desde el pedido (${decision.latencyMs})`);
    assert.ok(
      (decision.latencyMs ?? 0) - (decision.decisionMs ?? 0) >= 30,
      'los 40 ms sin nadie delante quedan fuera de decisionMs'
    );

    assert.equal(typeof decision.pendingInStateAt, 'number', 'el estado pendiente deja su instante');
    assert.equal(typeof decision.promptStartedAt, 'number', 'el inicio del prompt viaja con el resultado');
    assert.equal(decision.queueDepth, 0, 'el bucle local no tiene otra aprobación delante');
    assert.equal(typeof decision.stateMs, 'number', 'la aparición en el estado se mide');
    assert.equal(decision.stateWithin250Ms, true, 'el estado aparece dentro de 250 ms');
    assert.equal(typeof decision.noticeAt, 'number', 'el aviso deja su instante');
    assert.equal(typeof decision.noticeMs, 'number', 'la aparición en la TUI se mide');
    assert.equal(decision.noticeWithin250Ms, true, 'la TUI aparece dentro de 250 ms');
    assert.equal(
      decision.queueMs,
      (decision.promptStartedAt ?? 0) - (decision.pendingInStateAt ?? 0),
      'queueMs mide de pendingInStateAt a promptStartedAt'
    );
    assert.ok((decision.queueMs ?? -1) >= 35, `queueMs separa la espera de la cola (${decision.queueMs})`);
    assert.equal(
      decision.paintMs,
      (decision.promptPaintedAt ?? 0) - (decision.promptStartedAt ?? 0),
      'paintMs mide de promptStartedAt a promptPaintedAt'
    );
    assert.ok((decision.paintMs ?? -1) >= 5, `paintMs mide sólo el pintado (${decision.paintMs})`);
    assert.ok(
      (decision.paintMs ?? 0) < (decision.queueMs ?? 0),
      'la cola y el pintado quedan separados'
    );
    assert.equal(
      decision.attentionMs,
      (decision.firstInputAt ?? 0) - (decision.promptPaintedAt ?? 0),
      'attentionMs mide de promptPaintedAt a firstInputAt'
    );
    assert.ok((decision.attentionMs ?? -1) >= 5, `attentionMs separa el primer input (${decision.attentionMs})`);
    assert.equal(
      decision.readMs,
      (decision.decisionAt ?? 0) - (decision.firstNonDecisionKeyAt ?? 0),
      'readMs mide de firstNonDecisionKeyAt a decisionAt'
    );
    assert.equal(decision.readMs, decision.decisionMs, 'readMs y decisionMs describen el mismo tramo');
    assert.ok((decision.readMs ?? -1) >= 25, `readMs conserva la lectura real (${decision.readMs})`);
  });

  test('una decisión directa no inventa decisionMs', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:tool-denied Escribe salida.txt.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      sessionId: 'sess_approval_direct',
      requestApproval: async (request) => {
        request.promptStartedAt = Date.now();
        request.promptPaintedAt = Date.now();
        request.firstInputAt = Date.now();
        request.firstKeyAt = request.firstInputAt;
        request.directDecision = true;
        return 'allow';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    const decision = events.find((event) => event.type === 'approval_result');
    assert.equal(decision?.type, 'approval_result');
    if (decision?.type !== 'approval_result') return;
    assert.equal(decision.decisionMs, undefined, 'sin lectura previa no hay decisionMs');
    assert.equal(decision.readMs, undefined, 'sin lectura previa no hay readMs');
    assert.equal(decision.directDecision, true);
    assert.equal(typeof decision.queueMs, 'number', 'la espera en estado sí se mide');
    assert.equal(typeof decision.paintMs, 'number', 'el tiempo de pintado sí se mide');
    assert.equal(typeof decision.attentionMs, 'number', 'el primer input sí se mide');
    assert.equal(typeof decision.decisionAt, 'number');
  });

  test('el 100 % de los shell.run aparece en estado y TUI dentro de 250 ms', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    const tui = new Tui({ interactive: false, color: false });
    let approvals = 0;

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      sessionId: 'sess_shell_visibility',
      requestApproval: async (request) => {
        approvals += 1;
        // El mismo aviso que pinta el CLI: el primer anuncio fecha el aviso
        // visible, no el callback del test.
        tui.approvalAlert(request);
        assert.equal(typeof request.noticeAt, 'number', 'el aviso real deja su instante');
        return 'allow';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(approvals, 2, 'se confirmaron los dos shell.run');

    const requests = events.filter(
      (event): event is Extract<CliEventV2, { type: 'approval_request' }> =>
        event.type === 'approval_request' && event.approval.tool === 'shell.run'
    );
    const results = new Map(
      events
        .filter(
          (event): event is Extract<CliEventV2, { type: 'approval_result' }> =>
            event.type === 'approval_result'
        )
        .map((event) => [event.approvalId, event])
    );

    assert.equal(requests.length, 2, 'los dos shell.run generaron aviso');
    for (const request of requests) {
      const decision = results.get(request.approval.id);
      assert.ok(decision, `el shell.run ${request.approval.id} tiene resultado`);
      assert.equal(decision.stateWithin250Ms, true, 'aparece en el estado dentro de 250 ms');
      assert.equal(decision.noticeWithin250Ms, true, 'aparece en la TUI dentro de 250 ms');
      assert.ok((decision.stateMs ?? Number.POSITIVE_INFINITY) <= 250);
      assert.ok((decision.noticeMs ?? Number.POSITIVE_INFINITY) <= 250);
    }
  });

  test('no repite una mutación idéntica ya completada', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    let approvals = 0;

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:tool-edit-same-twice Edita la misma salida dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      sessionId: 'sess_approval_duplicate',
      requestApproval: async () => {
        approvals += 1;
        return 'allow';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(approvals, 1, 'la segunda llamada idéntica no vuelve a pedir aprobación');
    assert.equal(
      fake.requests.filter((request) => request.path === '/api/agent/run-tool').length,
      1,
      'la segunda llamada idéntica no se ejecuta'
    );
    const duplicate = events.find(
      (event) =>
        event.type === 'tool_result' && /ya se aplicó con el mismo input/.test(event.summary)
    );
    assert.ok(duplicate, 'se informa que la mutación ya estaba aplicada');
  });

  // CAL2-R02/R03: el modelo reemitió la misma edición una y otra vez después de
  // aplicarla. La guarda lo tomaba por bucle y cerraba la sesión como `failed`
  // («Sin respuesta final»), así que la tarea nunca llegaba a verificar. Ahora
  // la repetición se responde como no-op con instrucción y la sesión sigue.
  test('una edición idéntica repetida tres veces no tumba la sesión', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:tool-edit-same-three Edita la misma salida tres veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 6,
      stream: false,
      sessionId: 'sess_approval_duplicate_three',
      requestApproval: async () => 'allow',
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.', 'la sesión termina con respuesta, no en bucle');
    assert.equal(
      fake.requests.filter((request) => request.path === '/api/agent/run-tool').length,
      1,
      'sólo la primera edición se ejecuta'
    );
    const summaries = events.flatMap((event) =>
      event.type === 'tool_result' ? [event.summary] : []
    );
    assert.ok(
      summaries.some((summary) => /No repitas la edición/.test(summary)),
      'la primera repetición avisa al modelo en vez de devolver un éxito mudo'
    );
    assert.ok(
      summaries.some((summary) => /bucle de fs\.edit/.test(summary)),
      'la segunda repetición se marca como fallo explícito'
    );
    assert.equal(
      events.some((event) => event.type === 'error' && /Bucle detectado/.test(event.text)),
      false,
      'la sesión no se aborta por una repetición idéntica'
    );
  });

  // CAL2-R19: seis repeticiones de la misma edición agotaron los 24 pasos sin que
  // el modelo verificara nada. Ahora la tercera repetición corta la corrida y deja
  // el motivo escrito, en vez de consumir el presupuesto hasta el final.
  test('una edición idéntica repetida seis veces corta la corrida con motivo', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:tool-edit-same-six Edita la misma salida seis veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 24,
      stream: false,
      // Sin `sessionId`: `persistSession` crea la sesión para poder leer el
      // `loopCut` del estado, no sólo del PTY.
      persistSession: true,
      requestApproval: async () => 'allow',
      onEvent: (event) => events.push(event),
    });

    assert.match(result.answer, /Bucle de fs\.edit/, 'el cierre dice por qué se detuvo');
    assert.ok(result.steps <= 6, `corta mucho antes de maxSteps (paró en ${result.steps})`);
    assert.equal(
      fake.requests.filter((request) => request.path === '/api/agent/run-tool').length,
      1,
      'sólo la primera edición llega al servidor'
    );
    const error = events.find((event) => event.type === 'error');
    assert.ok(error, 'emite un error visible, no un éxito mudo');
    if (error?.type === 'error') assert.match(error.text, /4 llamadas idénticas/);
    const state = await serverState(fake.baseUrl, result.sessionId);
    assert.deepEqual(
      state.loopCut,
      { guard: 'mutations', tool: 'fs.edit', attempts: 4 },
      'el corte de mutaciones queda medible en el estado del servidor'
    );
    assert.ok(
      events.some((event) => event.type === 'answer' && /Bucle de fs\.edit/.test(event.text)),
      'el motivo llega como respuesta final, no como «sin respuesta final»'
    );
  });

  // P1 #6: una repetición idéntica no reutiliza la aprobación anterior ni se
  // auto-permite, ni siquiera con `allow-session`. La confirmación explícita sí
  // puede ejecutarla una vez más.
  test('un shell.run idéntico repetido exige confirmación explícita', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    const requests: ApprovalRequestV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      sessionId: 'sess_shell_same_twice',
      requestApproval: async (request) => {
        requests.push(request);
        // La primera aprobación es de sesión; aun así la repetición vuelve a
        // preguntar. Elegir sesión otra vez no crea una regla nueva: sólo vale
        // para esta confirmación y se normaliza a `allow`.
        return 'allow-session';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(requests.length, 2, 'la repetición pide una confirmación explícita');
    assert.equal(requests[1]?.repeatOf, requests[0]?.id, 'la confirmación identifica la ejecución previa');
    assert.equal(
      countShellRuns(fake),
      2,
      'tras confirmar, el mismo comando se ejecuta una vez más'
    );
    const approvalEvents = events.filter((event) => event.type === 'approval_request');
    assert.equal(approvalEvents.length, 2, 'no reutiliza la aprobación de sesión');
    assert.equal(
      approvalEvents[1]?.type === 'approval_request' ? approvalEvents[1].approval.repeatOf : undefined,
      requests[0]?.id,
      'el segundo pedido viaja marcado como repetición'
    );
    const secondResult = events.filter((event) => event.type === 'approval_result')[1];
    assert.equal(
      secondResult?.type === 'approval_result' ? secondResult.decision : undefined,
      'allow',
      'allow-session en una repetición no se guarda como permiso de sesión'
    );
  });

  test('--resume reconstruye la huella de shell.run idéntico', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const seeded = createSessionState({
      id: 'sess_resume_shell_duplicate',
      goal: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
    });
    seeded.steps.push(
      resultStep(
        'step_previous_shell',
        'shell.run',
        { id: 'apr_seed', decision: 'allow', latencyMs: 10 },
        { input: { command: 'node --test math.test.mjs' }, ts: Date.now() - 1_000 }
      )
    );
    fake.seedSession(seeded);

    const requests: ApprovalRequestV2[] = [];
    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      resumeFrom: seeded,
      requestApproval: async (request) => {
        requests.push(request);
        return requests.length === 1 ? 'allow' : 'deny';
      },
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(requests.length, 2, 'el resume exige confirmación para la repetición');
    assert.equal(requests[0]?.repeatOf, 'apr_seed', 'la huella viene del paso persistido');
    assert.equal(requests[1]?.repeatOf, requests[0]?.id, 'la segunda también se marca');
    assert.equal(
      countShellRuns(fake),
      1,
      'la repetición denegada tras el resume no se ejecuta'
    );
  });

  test('--resume no conserva una huella anterior a una edición', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const seeded = createSessionState({
      id: 'sess_resume_shell_edited',
      goal: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
    });
    seeded.steps.push(
      resultStep(
        'step_previous_shell',
        'shell.run',
        { id: 'apr_seed', decision: 'allow', latencyMs: 10 },
        { input: { command: 'node --test math.test.mjs' }, ts: Date.now() - 2_000 }
      ),
      resultStep(
        'step_previous_edit',
        'fs.edit',
        { id: 'apr_edit', decision: 'allow', latencyMs: 10 },
        { content: 'editado', input: { path: 'math.test.mjs' }, ts: Date.now() - 1_000 }
      )
    );
    fake.seedSession(seeded);

    const requests: ApprovalRequestV2[] = [];
    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      resumeFrom: seeded,
      requestApproval: async (request) => {
        requests.push(request);
        return 'allow';
      },
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(requests[0]?.repeatOf, undefined, 'la edición posterior limpia la huella al reanudar');
    assert.equal(requests[1]?.repeatOf, requests[0]?.id, 'la repetición nueva sí se marca');
    assert.equal(
      countShellRuns(fake),
      2,
      'la primera verificación tras la edición se ejecuta normal'
    );
  });

  test('--resume no reconstruye un shell.run que fue denegado', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const seeded = createSessionState({
      id: 'sess_resume_shell_denied',
      goal: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
    });
    seeded.steps.push(
      resultStep(
        'step_previous_denied',
        'shell.run',
        { id: 'apr_denied', decision: 'deny', latencyMs: 10 },
        { input: { command: 'node --test math.test.mjs' }, status: 'failed', ts: Date.now() - 1_000 }
      )
    );
    fake.seedSession(seeded);

    const requests: ApprovalRequestV2[] = [];
    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      resumeFrom: seeded,
      requestApproval: async (request) => {
        requests.push(request);
        return 'allow';
      },
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(requests[0]?.repeatOf, undefined, 'un deny no ejecutó la tool y no deja huella');
    assert.equal(requests[1]?.repeatOf, requests[0]?.id, 'la repetición real sí se marca');
    assert.equal(countShellRuns(fake), 2, 'sin huella previa, la primera ejecución es normal');
  });

  test('--resume reconstruye un shell.run completado sin approval', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const seeded = createSessionState({
      id: 'sess_resume_shell_legacy',
      goal: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
    });
    seeded.steps.push(
      resultStep(
        'step_previous_legacy',
        'shell.run',
        undefined,
        { input: { command: 'node --test math.test.mjs' }, status: 'completed', ts: Date.now() - 1_000 }
      )
    );
    fake.seedSession(seeded);

    const requests: ApprovalRequestV2[] = [];
    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      resumeFrom: seeded,
      requestApproval: async (request) => {
        requests.push(request);
        return requests.length === 1 ? 'allow' : 'deny';
      },
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(requests[0]?.repeatOf, 'session', 'un paso legado completado cuenta como ejecución');
    assert.equal(requests.length, 2, 'la repetición vuelve a pedir confirmación');
    assert.equal(countShellRuns(fake), 1, 'la repetición denegada no se ejecuta');
  });

  test('--resume reconstruye un shell.run allow aunque el resultado fallara', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const seeded = createSessionState({
      id: 'sess_resume_shell_failed',
      goal: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
    });
    seeded.steps.push(
      resultStep(
        'step_previous_failed',
        'shell.run',
        { id: 'apr_failed', decision: 'allow', latencyMs: 10 },
        { input: { command: 'node --test math.test.mjs' }, status: 'failed', ts: Date.now() - 1_000 }
      )
    );
    fake.seedSession(seeded);

    const requests: ApprovalRequestV2[] = [];
    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      resumeFrom: seeded,
      requestApproval: async (request) => {
        requests.push(request);
        return 'allow';
      },
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(requests[0]?.repeatOf, 'apr_failed', 'un allow ejecutado cuenta aunque falle el comando');
    assert.equal(requests[1]?.repeatOf, requests[0]?.id, 'la repetición posterior también se marca');
    assert.equal(countShellRuns(fake), 2, 'ambas ejecuciones confirmadas llegan al servidor');
  });

  test('una repetición de shell.run no se ejecuta sin confirmación', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const requests: ApprovalRequestV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:shell-same-twice Corre el mismo test dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      sessionId: 'sess_shell_same_twice_denied',
      requestApproval: async (request) => {
        requests.push(request);
        return requests.length === 1 ? 'allow' : 'deny';
      },
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(requests.length, 2, 'la repetición se pregunta, no se auto-permite');
    assert.equal(
      countShellRuns(fake),
      1,
      'sin confirmación explícita la repetición no llega al servidor'
    );
  });

  // Re-correr la misma verificación después de editar es el bucle normal de
  // trabajo, no un bucle de tool: el guardia no debe saltársela por input.
  test('repetir el mismo shell.run tras editar sí ejecuta la verificación', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    let shellApprovals = 0;

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:rerun-same-command Edita y verifica dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 8,
      stream: false,
      sessionId: 'sess_rerun_same_command',
      requestApproval: async (request) => {
        if (request.tool === 'shell.run') shellApprovals += 1;
        return 'allow';
      },
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(shellApprovals, 2, 'la edición intermedia limpia la huella de la repetición');
    assert.equal(
      countShellRuns(fake),
      2,
      'la segunda verificación no se salta como «sin cambios»'
    );
  });

  test('una mutación fallida no limpia la huella de shell.run', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    const requests: ApprovalRequestV2[] = [];
    let shellApprovals = 0;

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:shell-same-after-failed-edit Corre, edita y repite.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 6,
      stream: false,
      sessionId: 'sess_shell_failed_edit_keeps_fingerprint',
      requestApproval: async (request) => {
        requests.push(request);
        // La primera ejecución deja permiso de sesión para shell.run. Si la
        // edición fallida borrara la huella, la repetición se auto-permitiría
        // con ese permiso y no habría una segunda solicitud.
        if (request.tool === 'shell.run' && ++shellApprovals === 1) return 'allow-session';
        return 'allow';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    const shellRequests = requests.filter((request) => request.tool === 'shell.run');
    assert.equal(shellRequests[0]?.repeatOf, undefined, 'la primera ejecución no es una repetición');
    const firstShellResult = events.find(
      (event) => event.type === 'approval_result' && event.approvalId === shellRequests[0]?.id
    );
    assert.equal(
      firstShellResult?.type === 'approval_result' ? firstShellResult.decision : undefined,
      'allow-session',
      'la primera ejecución deja permiso de sesión para shell.run'
    );
    assert.equal(shellRequests.length, 2, 'el shell.run repetido vuelve a pedir confirmación');
    assert.equal(
      shellRequests[1]?.repeatOf,
      shellRequests[0]?.id,
      'una edición fallida no borra la huella del comando ya ejecutado'
    );
    assert.ok(requests.some((request) => request.tool === 'fs.edit'), 'la edición pasó por aprobación');
    assert.ok(
      events.some(
        (event) => event.type === 'tool_result' && event.tool === 'fs.edit' && event.ok === false
      ),
      'la edición falló sin cambiar el workspace'
    );
    assert.equal(countShellRuns(fake), 2, 'la repetición confirmada sí llega al servidor');
  });

  test('repetir browser snapshot con el mismo input no cuenta como bucle', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:browser-snapshot-twice Relee la página dos veces.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      sessionId: 'sess_browser_snapshot_twice',
      requestApproval: async () => 'allow',
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.', 'la sesión no se aborta');
    assert.equal(
      fake.requests.filter(
        (request) => request.path === '/api/agent/run-tool' && request.body?.toolId === 'browser'
      ).length,
      2,
      'las dos lecturas se ejecutan'
    );
    const summaries = events.flatMap((event) =>
      event.type === 'tool_result' ? [event.summary] : []
    );
    assert.equal(
      summaries.some((summary) => /ya se aplicó|Bucle detectado/.test(summary)),
      false,
      'una lectura repetida no se marca como duplicada ni como bucle'
    );
    assert.equal(
      events.some((event) => event.type === 'error' && /Bucle detectado/.test(event.text)),
      false,
      'no hay error de bucle'
    );
  });

  test('abortar durante la aprobación cancela sin ejecutar la tool', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    const controller = new AbortController();

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: TASK,
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      sessionId: 'sess_approval_aborted',
      signal: controller.signal,
      requestApproval: async () => {
        controller.abort();
        return 'deny';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.cancelled, true, 'la corrida queda cancelada');
    assert.equal(
      fake.requests.some((request) => request.path === '/api/agent/run-tool'),
      false,
      'abortar no ejecuta la tool'
    );
    assert.ok(events.some((event) => event.type === 'error' && /cancelado/i.test(event.text)));
  });

  test('allow-session no vuelve a preguntar para la misma tool y objetivo', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    let approvals = 0;

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:tool-write-twice Escribe dos salidas.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 5,
      stream: false,
      sessionId: 'sess_approval_session',
      requestApproval: async () => {
        approvals += 1;
        return 'allow-session';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    assert.equal(approvals, 1, 'la segunda escritura reutiliza la decisión de la sesión');
    assert.equal(
      fake.requests.filter((request) => request.path === '/api/agent/run-tool').length,
      2,
      'las dos escrituras se ejecutaron'
    );
    assert.equal(
      events.filter((event) => event.type === 'approval_request').length,
      1,
      'sólo se pidió aprobación para la primera escritura'
    );
    const decision = events.find((event) => event.type === 'approval_result');
    assert.equal(decision?.type, 'approval_result');
    if (decision?.type === 'approval_result') {
      assert.equal(decision.decision, 'allow-session');
    }
  });

  test('spawn_agents viaja con el id de la sesión padre que inyecta el CLI', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:spawn-agents Lanza dos subagentes.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      sessionId: 'sess_spawn_parent',
      requestApproval: async () => 'allow',
    });

    assert.equal(result.answer, 'Listo: dos hijos.');
    const request = fake.requests.find(
      (entry) => entry.path === '/api/agent/run-tool' && entry.body?.toolId === 'spawn_agents'
    );
    assert.ok(request, 'se ejecutó spawn_agents');
    assert.equal(
      request?.body?.input?.parentSessionId,
      'sess_spawn_parent',
      'el servidor recibe la sesión padre (el modelo no la manda)'
    );
    assert.equal(request?.body?.input?.agents?.length, 2, 'los dos hijos llegan intactos');
  });

  test('git.worktree list corre sin aprobación; add y remove la piden', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    const approvalTools: string[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: 'SCENARIO:git-worktree-actions Lista, crea y quita un worktree.',
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 6,
      stream: false,
      sessionId: 'sess_git_worktree_actions',
      requestApproval: async (request) => {
        approvalTools.push(request.tool);
        return 'allow';
      },
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.answer, 'Listo: el faro funciona.');
    const calls = fake.requests.filter((request) => request.path === '/api/agent/run-tool');
    assert.deepEqual(
      calls.map((request) => [request.body?.toolId, request.body?.input?.action]),
      [
        ['git.worktree', 'list'],
        ['git.worktree', 'add'],
        ['git.worktree', 'remove'],
      ],
      'las tres acciones llegan al servidor'
    );
    assert.deepEqual(
      approvalTools,
      ['git.worktree', 'git.worktree'],
      'sólo add y remove pasan por el prompt: el listado no pide permiso'
    );
    assert.equal(
      events.filter((event) => event.type === 'approval_request').length,
      2,
      'dos prompts para tres llamadas'
    );
    const firstApproval = events.findIndex((event) => event.type === 'approval_request');
    const listResult = events.findIndex(
      (event) => event.type === 'tool_result' && event.tool === 'git.worktree'
    );
    assert.ok(listResult >= 0, 'el listado devuelve resultado');
    assert.ok(
      listResult < firstApproval,
      'el listado se ejecuta antes de cualquier prompt de aprobación'
    );
  });

  test('una aprobación caducada queda como deny «expired» y cancela la sesión', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];

    const result = await runAgent({
      serverUrl: fake.baseUrl,
      task: TASK,
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      // Sin `sessionId` para que `persistSession` cree el estado en el servidor falso.
      persistSession: true,
      runLabel: 'CAL2-R01',
      // Lo que hace el prompt al pasar de `expiresAt`: lo anota y no decide nada.
      // Devuelve `allow` a propósito: ni una tecla tardía puede aprobar lo caducado.
      requestApproval: async (request) => {
        request.render = { diffShown: true, diffTruncated: false, detailOpened: false, expired: true };
        request.promptStartedAt = Date.now();
        request.promptPaintedAt = Date.now();
        return 'allow';
      },
      onEvent: (event) => events.push(event),
    });

    const decision = events.find((event) => event.type === 'approval_result');
    assert.ok(decision && decision.type === 'approval_result', 'se emite approval_result');
    const approvalId = decision?.type === 'approval_result' ? decision.approvalId : '';
    if (decision.type === 'approval_result') {
      assert.equal(decision.decision, 'deny');
      assert.equal(decision.reason, 'expired');
      assert.equal(decision.render?.expired, true, 'el motivo viaja en la evidencia de render');
      assert.equal(typeof decision.queueMs, 'number', 'el estado pendiente deja queueMs');
      assert.equal(typeof decision.paintMs, 'number', 'el prompt pintado deja paintMs');
      assert.equal(decision.attentionMs, undefined, 'sin input no se inventa atención');
      assert.equal(decision.readMs, undefined, 'sin lectura no se inventa readMs');
      assert.equal(typeof decision.decisionAt, 'number');
    }
    assert.equal(
      fake.requests.some((request) => request.path === '/api/agent/run-tool'),
      false,
      'caducar no ejecuta la tool'
    );
    assert.equal(result.cancelled, true, 'la corrida no sigue esperando otro intento');
    assert.equal(result.state?.status, 'cancelled');
    assert.match(result.state?.error ?? '', /caducada/i);
    assert.match(result.state?.error ?? '', /CAL2-R01b/, 'el error anuncia la etiqueta nueva');
    assert.deepEqual(result.invalid, {
      reason: 'approval_expired',
      approvalId,
      retryLabel: 'CAL2-R01b',
    });
    assert.deepEqual(result.state?.invalid, result.invalid, 'la invalidez viaja en el estado');
    const persisted = await serverState(fake.baseUrl, result.sessionId);
    assert.deepEqual(persisted.invalid, result.invalid, 'el servidor conserva la invalidez');
    const step = result.state?.steps.find((candidate) => candidate.approval);
    assert.equal(step?.approval?.reason, 'expired', 'el motivo queda en el estado');
    assert.equal(step?.approval?.render?.expired, true);
  });

  test('el estado del servidor anuncia la aprobación pendiente y la borra al decidir', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    let decide!: (decision: 'allow') => void;
    const waiting = new Promise<'allow'>((resolve) => { decide = resolve; });

    const running = runAgent({
      serverUrl: fake.baseUrl,
      task: TASK,
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      // Sin `sessionId`: `persistSession` crea la sesión en el servidor falso.
      persistSession: true,
      requestApproval: () => waiting,
      onEvent: (event) => events.push(event),
    });

    const sessionId = await sessionIdOf(events);
    // G1-D4-05: el prompt estuvo 801 s abierto sin que nadie lo supiera porque
    // el estado no lo anunciaba. Ahora se lee del servidor, no del proceso local.
    const announced = await waitForServerState(
      fake.baseUrl,
      sessionId,
      (state) => state.pendingApproval !== null,
      'el estado del servidor no anuncia la aprobación pendiente'
    );
    const request = events.find((event) => event.type === 'approval_request');
    assert.ok(request && request.type === 'approval_request', 'se emite approval_request');
    assert.equal(announced.pendingApproval?.id, request.approval.id, 'es la misma aprobación');
    assert.equal(announced.pendingApproval?.tool, 'fs.write');
    assert.equal(announced.status, 'running', 'se anuncia mientras la sesión corre');
    assert.equal(announced.pendingApprovals, undefined, 'una sola pendiente no duplica la lista');

    decide('allow');
    const result = await running;
    assert.equal(result.answer, 'Listo: el faro funciona.');
    const after = await serverState(fake.baseUrl, sessionId);
    assert.equal(after.pendingApproval, null, 'decidida deja de estar pendiente');
    assert.equal(after.pendingApprovals, undefined);
  });

  test('una aprobación caducada deja de estar anunciada en el servidor', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    let expire!: () => void;
    const waiting = new Promise<void>((resolve) => { expire = resolve; });

    const running = runAgent({
      serverUrl: fake.baseUrl,
      task: TASK,
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      persistSession: true,
      requestApproval: async (request) => {
        await waiting;
        // Lo que hace el prompt al pasar `expiresAt`: lo anota y no decide nada.
        request.render = { diffShown: true, diffTruncated: false, detailOpened: false, expired: true };
        return 'allow';
      },
      onEvent: (event) => events.push(event),
    });

    const sessionId = await sessionIdOf(events);
    await waitForServerState(
      fake.baseUrl,
      sessionId,
      (state) => state.pendingApproval !== null,
      'la aprobación no llegó a anunciarse'
    );

    expire();
    const result = await running;
    assert.equal(result.state?.status, 'cancelled');
    const after = await serverState(fake.baseUrl, sessionId);
    assert.equal(after.pendingApproval, null, 'caducada no sigue anunciada');
    assert.equal(after.status, 'cancelled');
  });

  test('abortar con el prompt abierto retira la aprobación del estado', async (t) => {
    const fake = await startFakeAgentServer();
    t.after(() => fake.close());
    const events: CliEventV2[] = [];
    const controller = new AbortController();

    const running = runAgent({
      serverUrl: fake.baseUrl,
      task: TASK,
      cwd: '/workspace/demo',
      model: 'gemini-2.5-flash',
      maxSteps: 4,
      stream: false,
      persistSession: true,
      signal: controller.signal,
      // El prompt real se cierra al abortar; aquí se imita devolviendo la decisión
      // para que el bucle llegue a su comprobación de `signal.aborted`.
      requestApproval: () =>
        new Promise<'deny'>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve('deny'), { once: true });
        }),
      onEvent: (event) => events.push(event),
    });

    const sessionId = await sessionIdOf(events);
    await waitForServerState(
      fake.baseUrl,
      sessionId,
      (state) => state.pendingApproval !== null,
      'la aprobación no llegó a anunciarse'
    );

    controller.abort();
    const result = await running;
    assert.equal(result.cancelled, true);
    const after = await serverState(fake.baseUrl, sessionId);
    assert.equal(after.pendingApproval, null, 'abortar no deja el prompt anunciado');
    assert.equal(after.status, 'cancelled');
  });
});
