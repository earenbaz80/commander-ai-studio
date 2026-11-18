import { afterEach, describe, expect, it } from 'vitest';
import {
  finishSubAgent,
  listSubAgents,
  resetSubAgentsForTests,
  startSubAgent,
  summarizeCalls,
  summarizeStepTitles,
} from '../../subAgents';

afterEach(() => resetSubAgentsForTests());

describe('transcripción del subagente (G1-SUBAGENT-CLOSE)', () => {
  it('empareja cada resultado con su llamada y conserva la denegación', () => {
    const calls = summarizeCalls([
      { type: 'thought', toolId: undefined, output: undefined },
      { type: 'tool_call', toolId: 'shell.run' },
      { type: 'tool_result', toolId: 'shell.run', output: { ok: false, error: 'Tool deshabilitada por la configuración de permisos: shell.run' } },
      { type: 'tool_call', toolId: 'fs.write' },
      { type: 'tool_result', toolId: 'fs.write', output: { ok: true, data: { path: 'hijo-a.txt' } } },
      { type: 'tool_call', toolId: 'fs.read' },
    ]);

    expect(calls).toEqual([
      { tool: 'shell.run', ok: false, error: 'Tool deshabilitada por la configuración de permisos: shell.run' },
      { tool: 'fs.write', ok: true },
      { tool: 'fs.read', ok: null },
    ]);
  });

  it('conserva el fallo cuando el paso real guarda el error en `content`', () => {
    // Forma real de `AgentSession.addStep` para una tool denegada (G1-D5-10):
    // `output: r.data` queda `undefined` y el motivo viaja en `content`, con
    // `status: 'failed'`. Antes se leía sólo `output` y la denegación se perdía.
    const calls = summarizeCalls([
      { type: 'tool_call', toolId: 'shell.run' },
      {
        type: 'tool_result',
        toolId: 'shell.run',
        title: 'shell.run',
        content: 'Tool deshabilitada por la configuración de permisos: shell.run',
        input: { command: 'echo test' },
        output: undefined,
        status: 'failed',
      },
    ]);

    expect(calls).toEqual([
      {
        tool: 'shell.run',
        ok: false,
        error: 'Tool deshabilitada por la configuración de permisos: shell.run',
      },
    ]);
  });

  it('la lista que sirve el endpoint lleva las llamadas del hijo cerrado', () => {
    startSubAgent({ id: 'sess_hijo', parentSessionId: 'sess_padre', goal: 'hijo-a', model: 'm' });
    finishSubAgent('sess_hijo', {
      ok: true,
      answer: 'Archivos: hijo-a.txt. Denegado: shell.run.',
      steps: 4,
      calls: [
        { tool: 'shell.run', ok: false, error: 'Tool deshabilitada por la configuración de permisos: shell.run' },
        { tool: 'fs.write', ok: true },
      ],
    });

    // Exactamente el cuerpo de `GET /api/agent/sessions/:id/subagents`.
    const payload = JSON.parse(JSON.stringify({ success: true, subagents: listSubAgents('sess_padre') }));
    expect(payload.subagents).toHaveLength(1);
    expect(payload.subagents[0]).toMatchObject({
      id: 'sess_hijo',
      status: 'completed',
      answer: 'Archivos: hijo-a.txt. Denegado: shell.run.',
    });
    expect(payload.subagents[0].calls).toEqual([
      { tool: 'shell.run', ok: false, error: 'Tool deshabilitada por la configuración de permisos: shell.run' },
      { tool: 'fs.write', ok: true },
    ]);
  });

  it('distingue «cerró sin tools» de «turno vacío» por los títulos de paso', () => {
    // Cierre con razonamiento y decisión: el turno llegó y eligió no llamar nada.
    const decidio = summarizeStepTitles([
      { type: 'thought', title: 'Razonamiento' },
      { type: 'thought', title: 'Finalizado' },
    ]);
    // Turno vacío del proveedor: no hay razonamiento, sólo el cierre de relleno.
    const vacio = summarizeStepTitles([{ type: 'thought', title: 'Finalizado' }]);
    // Fallo de tool-use: el título lo delata en vez de parecer un cierre limpio.
    const fallo = summarizeStepTitles([
      { type: 'thought', title: 'Tool-use falló' },
      { type: 'thought', title: 'Finalizado' },
    ]);

    expect(decidio).toEqual(['Razonamiento', 'Finalizado']);
    expect(vacio).toEqual(['Finalizado']);
    expect(fallo).toEqual(['Tool-use falló', 'Finalizado']);
    expect(vacio).not.toEqual(decidio);
  });

  it('los títulos llegan a la fila de `/subagents`, con la tool como título', () => {
    startSubAgent({ id: 'sess_hijo', parentSessionId: 'sess_padre', goal: 'hijo-a', model: 'm' });
    finishSubAgent('sess_hijo', {
      ok: true,
      answer: 'Objetivo completado.',
      steps: 2,
      calls: [],
      stepTitles: summarizeStepTitles([
        { type: 'thought', title: 'Razonamiento' },
        { type: 'thought', title: 'Finalizado' },
      ]),
    });

    const payload = JSON.parse(JSON.stringify({ success: true, subagents: listSubAgents('sess_padre') }));
    expect(payload.subagents[0]).toMatchObject({
      id: 'sess_hijo',
      calls: [],
      stepTitles: ['Razonamiento', 'Finalizado'],
    });
  });

  it('no inventa llamadas cuando el hijo no usó herramientas', () => {
    startSubAgent({ id: 'sess_vacio', parentSessionId: 'sess_padre', goal: 'sin tools', model: 'm' });
    finishSubAgent('sess_vacio', { ok: false, error: 'turno vacío', steps: 1, calls: [] });

    const [row] = listSubAgents('sess_padre');
    expect(row.calls).toEqual([]);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('turno vacío');
  });
});
