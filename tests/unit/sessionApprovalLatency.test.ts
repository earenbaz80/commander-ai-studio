import { describe, expect, it } from 'vitest';
import {
  createSessionState,
  decodeSessionState,
  encodeSessionState,
  type SessionStepV2,
} from '../../src/agent/sessionTypes';

/** Paso de resultado de tool con la aprobación que lo permitió. */
function approvedStep(id: string, approval: Record<string, unknown>): SessionStepV2 {
  return {
    id,
    type: 'tool_result',
    toolId: 'fs.edit',
    title: 'fs.edit',
    content: 'ok',
    status: 'completed',
    ts: 1_700_000_000_000,
    approval: approval as SessionStepV2['approval'],
  };
}

function roundTrip(steps: SessionStepV2[]): SessionStepV2[] {
  const state = createSessionState({ id: 's1', goal: 'arreglar', cwd: '/tmp' });
  state.steps = steps;
  const decoded = decodeSessionState(encodeSessionState(state));
  expect(decoded).not.toBeNull();
  return decoded?.steps ?? [];
}

describe('aprobación persistida', () => {
  it('conserva latencyMs junto a id, decisión y motivo', () => {
    const [step] = roundTrip([
      approvedStep('st1', { id: 'apr_1', decision: 'deny', reason: 'no es la ruta', latencyMs: 20_391 }),
    ]);

    expect(step?.approval).toEqual({
      id: 'apr_1',
      decision: 'deny',
      reason: 'no es la ruta',
      latencyMs: 20_391,
    });
  });

  it('conserva repeatOf y descarta el valor vacío', () => {
    const [withRepeat, empty] = roundTrip([
      approvedStep('st1', { id: 'apr_2', decision: 'allow', repeatOf: 'apr_1' }),
      approvedStep('st2', { id: 'apr_3', decision: 'allow', repeatOf: '' }),
    ]);

    expect(withRepeat?.approval).toEqual({ id: 'apr_2', decision: 'allow', repeatOf: 'apr_1' });
    expect(empty?.approval).toEqual({ id: 'apr_3', decision: 'allow' });
  });

  it('conserva decisionMs junto a latencyMs', () => {
    const [step] = roundTrip([
      approvedStep('st1', { id: 'apr_1', decision: 'allow', latencyMs: 20_391, decisionMs: 1_204 }),
    ]);

    expect(step?.approval).toEqual({
      id: 'apr_1',
      decision: 'allow',
      latencyMs: 20_391,
      decisionMs: 1_204,
    });
  });

  it('acepta decisionMs = 0 y descarta los valores que no son medida', () => {
    const steps = roundTrip([
      approvedStep('st1', { id: 'apr_1', decision: 'allow', decisionMs: 0 }),
      approvedStep('st2', { id: 'apr_2', decision: 'allow', decisionMs: -1 }),
      approvedStep('st3', { id: 'apr_3', decision: 'allow', decisionMs: '900' }),
    ]);

    expect(steps[0]?.approval?.decisionMs).toBe(0);
    expect('decisionMs' in (steps[1]?.approval ?? {})).toBe(false);
    expect('decisionMs' in (steps[2]?.approval ?? {})).toBe(false);
  });

  it('conserva la instrumentación de pintado y lectura, y marca la decisión directa', () => {
    const [step] = roundTrip([
      approvedStep('st1', {
        id: 'apr_1',
        decision: 'allow',
        latencyMs: 20_391,
        decisionMs: 1_204,
        pendingInStateAt: 1_700_000_000_050,
        promptStartedAt: 1_700_000_000_100,
        promptPaintedAt: 1_700_000_000_150,
        queueDepth: 2,
        queueMs: 50,
        firstInputAt: 1_700_000_000_900,
        firstNonDecisionKeyAt: 1_700_000_001_000,
        decisionAt: 1_700_000_002_204,
        paintMs: 50,
        attentionMs: 750,
        readMs: 1_204,
        directDecision: true,
        quarantinedKeys: 1,
        quarantinedDecision: true,
      }),
    ]);

    expect(step?.approval).toEqual({
      id: 'apr_1',
      decision: 'allow',
      latencyMs: 20_391,
      decisionMs: 1_204,
      pendingInStateAt: 1_700_000_000_050,
      promptStartedAt: 1_700_000_000_100,
      promptPaintedAt: 1_700_000_000_150,
      queueDepth: 2,
      queueMs: 50,
      firstInputAt: 1_700_000_000_900,
      firstNonDecisionKeyAt: 1_700_000_001_000,
      decisionAt: 1_700_000_002_204,
      paintMs: 50,
      attentionMs: 750,
      readMs: 1_204,
      directDecision: true,
      quarantinedKeys: 1,
      quarantinedDecision: true,
    });
  });

  it('conserva la medición del aviso y la marca de presupuesto', () => {
    const [step] = roundTrip([
      approvedStep('st1', {
        id: 'apr_1',
        decision: 'allow',
        pendingInStateAt: 1_700_000_000_020,
        stateMs: 20,
        queueDepth: 1,
        noticeAt: 1_700_000_000_040,
        noticeMs: 40,
        stateWithin250Ms: true,
        noticeWithin250Ms: true,
      }),
    ]);

    expect(step?.approval).toEqual({
      id: 'apr_1',
      decision: 'allow',
      pendingInStateAt: 1_700_000_000_020,
      stateMs: 20,
      queueDepth: 1,
      noticeAt: 1_700_000_000_040,
      noticeMs: 40,
      stateWithin250Ms: true,
      noticeWithin250Ms: true,
    });
  });

  it('conserva la marca falsa y descarta una medición inválida', () => {
    const [late, invalid] = roundTrip([
      approvedStep('st1', {
        id: 'apr_1',
        decision: 'allow',
        noticeAt: 1_700_000_000_400,
        noticeMs: 400,
        noticeWithin250Ms: false,
      }),
      approvedStep('st2', {
        id: 'apr_2',
        decision: 'allow',
        noticeAt: -1,
        noticeMs: -1,
        stateWithin250Ms: 'sí',
      }),
    ]);

    expect(late?.approval).toEqual({
      id: 'apr_1',
      decision: 'allow',
      noticeAt: 1_700_000_000_400,
      noticeMs: 400,
      noticeWithin250Ms: false,
    });
    expect(invalid?.approval).toEqual({ id: 'apr_2', decision: 'allow' });
  });

  it('acepta la bitácora en 0 y la descarta cuando no es una medida', () => {
    const [zero, invalid, legacy] = roundTrip([
      approvedStep('st1', {
        id: 'apr_1',
        decision: 'allow',
        pendingInStateAt: 1_700_000_000_100,
        promptStartedAt: 1_700_000_000_100,
        promptPaintedAt: 1_700_000_000_100,
        queueDepth: 0,
        queueMs: 0,
        firstInputAt: 1_700_000_000_100,
        firstNonDecisionKeyAt: 1_700_000_000_100,
        decisionAt: 1_700_000_000_100,
        paintMs: 0,
        attentionMs: 0,
        readMs: 0,
      }),
      approvedStep('st2', {
        id: 'apr_2',
        decision: 'allow',
        pendingInStateAt: -1,
        promptStartedAt: '1700000000100',
        queueDepth: 1.5,
        queueMs: -1,
        paintMs: -1,
        attentionMs: '800',
        readMs: Number.NaN,
        firstInputAt: -1,
      }),
      approvedStep('st3', {
        id: 'apr_3',
        decision: 'allow',
        firstKeyAt: 1_700_000_000_900,
      }),
    ]);

    expect(zero?.approval).toEqual({
      id: 'apr_1',
      decision: 'allow',
      pendingInStateAt: 1_700_000_000_100,
      promptStartedAt: 1_700_000_000_100,
      promptPaintedAt: 1_700_000_000_100,
      queueDepth: 0,
      queueMs: 0,
      firstInputAt: 1_700_000_000_100,
      firstNonDecisionKeyAt: 1_700_000_000_100,
      decisionAt: 1_700_000_000_100,
      paintMs: 0,
      attentionMs: 0,
      readMs: 0,
    });
    expect(invalid?.approval).toEqual({ id: 'apr_2', decision: 'allow' });
    expect(legacy?.approval).toEqual({
      id: 'apr_3',
      decision: 'allow',
      firstInputAt: 1_700_000_000_900,
    });
  });

  it('descarta la instrumentación que no es una medida o un contador válido', () => {
    const [step] = roundTrip([
      approvedStep('st1', {
        id: 'apr_1',
        decision: 'allow',
        pendingInStateAt: -1,
        promptStartedAt: '1700000000100',
        promptPaintedAt: -1,
        queueDepth: 1.5,
        queueMs: -1,
        firstInputAt: '1700000000900',
        firstNonDecisionKeyAt: '1700000001000',
        decisionAt: -1,
        paintMs: -1,
        attentionMs: '800',
        readMs: Number.NaN,
        quarantinedKeys: 1.5,
        quarantinedDecision: 'sí',
      }),
    ]);

    expect(step?.approval).toEqual({ id: 'apr_1', decision: 'allow' });
  });

  it('acepta 0 como medida y no lo confunde con ausencia', () => {
    const [step] = roundTrip([approvedStep('st1', { id: 'apr_1', decision: 'allow-session', latencyMs: 0 })]);

    expect(step?.approval?.latencyMs).toBe(0);
    expect('latencyMs' in (step?.approval ?? {})).toBe(true);
  });

  it('omite la latencia cuando no está o no es una medida válida', () => {
    const steps = roundTrip([
      approvedStep('st1', { id: 'apr_1', decision: 'allow' }),
      approvedStep('st2', { id: 'apr_2', decision: 'allow', latencyMs: -5 }),
      approvedStep('st3', { id: 'apr_3', decision: 'allow', latencyMs: '1200' }),
      approvedStep('st4', { id: 'apr_4', decision: 'allow', latencyMs: Number.NaN }),
    ]);

    expect(steps.map((step) => step.approval?.id)).toEqual(['apr_1', 'apr_2', 'apr_3', 'apr_4']);
    for (const step of steps) expect('latencyMs' in (step.approval ?? {})).toBe(false);
  });

  it('conserva la marca del estado y la cola al rehidratar una pendiente', () => {
    const state = createSessionState({ id: 's1', goal: 'arreglar', cwd: '/tmp' });
    state.pendingApproval = {
      id: 'apr_pendiente',
      sessionId: 's1',
      tool: 'shell.run',
      input: { command: 'node --test' },
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_000_300_000,
      pendingInStateAt: 1_700_000_000_050,
      promptStartedAt: 1_700_000_000_100,
      queueDepth: 2,
      noticeAt: 1_700_000_000_030,
    };

    const decoded = decodeSessionState(encodeSessionState(state));
    expect(decoded?.pendingApproval?.pendingInStateAt).toBe(1_700_000_000_050);
    expect(decoded?.pendingApproval?.promptStartedAt).toBe(1_700_000_000_100);
    expect(decoded?.pendingApproval?.queueDepth).toBe(2);
    expect(decoded?.pendingApproval?.noticeAt).toBe(1_700_000_000_030);
  });

  it('no toca la latencia de los pasos sin aprobación', () => {
    const [step] = roundTrip([
      { id: 'st1', type: 'thought', title: '', content: 'pensando', status: 'completed', ts: 1 },
    ]);

    expect(step?.approval).toBeUndefined();
  });
});
