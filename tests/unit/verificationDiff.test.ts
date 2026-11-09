import { describe, expect, test } from 'vitest';
import type { SessionStepV2 } from '../../src/agent/sessionTypes';
import type { VerificationArtifact } from '../../src/artifacts/types';
import {
  buildVerificationDecisions,
  buildVerificationDiff,
  buildVerificationSections,
  filesFromVerificationPatch,
  withVerificationSections,
} from '../../src/artifacts/verificationDiff';
import { renderMarkdownReport } from '../../src/artifacts/report';

const PATCH = `--- a/src/checkout.ts
+++ b/src/checkout.ts
@@ -1,2 +1,2 @@
-export const total = 2;
+export const total = 3;
 export const currency = 'EUR';
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1 +1 @@
-const items = 0;
+const items = 1;`;

const FIXED_AT = Date.UTC(2026, 10, 9, 12, 30, 0);

type StepApproval = NonNullable<SessionStepV2['approval']>;

function approval(
  id: string,
  decision: StepApproval['decision'],
  reason?: string
): StepApproval {
  return { id, decision, ...(reason ? { reason } : {}) };
}

function step(overrides: Partial<SessionStepV2> = {}): SessionStepV2 {
  return {
    id: 'step-1',
    type: 'tool_result',
    toolId: 'fs.edit',
    title: 'fs.edit',
    content: '',
    status: 'completed',
    ts: 1_700_000_000_000,
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<VerificationArtifact> = {}): VerificationArtifact {
  return {
    id: 'ver-1',
    kind: 'verification',
    schemaVersion: 1,
    projectPath: 'C:/tmp/checkout',
    title: 'Verificación de checkout',
    createdAt: 1_700_000_000_000,
    sessionId: 's1',
    status: 'passed',
    plan: [],
    decisions: [],
    tests: [],
    environment: { node: 'v22.0.0', os: 'win32-x64' },
    ...overrides,
  };
}

describe('diff de la sesión', () => {
  test('conserva el patch aprobado tal cual, sin regenerarlo', () => {
    const diff = buildVerificationDiff({
      steps: [step({ approval: approval('apr-1', 'allow') })],
      approvals: [{ id: 'apr-1', tool: 'fs.edit', diff: PATCH }],
    });

    expect(diff?.patch).toBe(PATCH);
    expect(diff?.files).toEqual(['src/checkout.ts', 'src/cart.ts']);
  });

  test('incluye base y head sólo cuando vienen informados', () => {
    const withMeta = buildVerificationDiff({
      steps: [step({ approval: approval('apr-1', 'allow') })],
      approvals: [{ id: 'apr-1', tool: 'fs.edit', diff: PATCH }],
      base: 'main',
      head: 'fix/cart',
    });
    const withoutMeta = buildVerificationDiff({
      steps: [step({ approval: approval('apr-1', 'allow') })],
      approvals: [{ id: 'apr-1', tool: 'fs.edit', diff: PATCH }],
      base: '',
      head: '   ',
    });

    expect(withMeta).toMatchObject({ base: 'main', head: 'fix/cart' });
    expect(withoutMeta?.base).toBeUndefined();
    expect(withoutMeta?.head).toBeUndefined();
  });

  test('allow-session también produce diff', () => {
    const diff = buildVerificationDiff({
      steps: [step({ approval: approval('apr-1', 'allow-session') })],
      approvals: [{ id: 'apr-1', tool: 'fs.edit', diff: PATCH }],
    });
    expect(diff?.patch).toBe(PATCH);
  });

  test('una denegación se registra pero no produce diff aplicado', () => {
    const steps = [
      step({ approval: approval('apr-1', 'deny', 'no tocar el checkout') }),
    ];
    const diff = buildVerificationDiff({
      steps,
      approvals: [{ id: 'apr-1', tool: 'fs.edit', diff: PATCH }],
    });

    expect(diff).toBeUndefined();
    expect(buildVerificationDecisions(steps)).toEqual([
      {
        stepId: 'step-1',
        tool: 'fs.edit',
        decision: 'deny',
        reason: 'no tocar el checkout',
      },
    ]);
  });

  test('una tool fallida no aporta un diff aunque se haya aprobado', () => {
    const diff = buildVerificationDiff({
      steps: [step({ status: 'failed', approval: approval('apr-1', 'allow') })],
      approvals: [{ id: 'apr-1', tool: 'fs.edit', diff: PATCH }],
    });
    expect(diff).toBeUndefined();
  });

  test('sin patch aprobado no inventa un diff vacío', () => {
    expect(
      buildVerificationDiff({
        steps: [step({ approval: approval('apr-1', 'allow') })],
        approvals: [{ id: 'apr-1', tool: 'fs.edit', diff: '   ' }],
      })
    ).toBeUndefined();
    expect(buildVerificationDiff({ steps: [] })).toBeUndefined();
  });

  test('toma los archivos del patch, no del input de la tool', () => {
    const diff = buildVerificationDiff({
      steps: [
        step({
          input: { path: 'src/otro.ts' },
          approval: approval('apr-1', 'allow'),
        }),
      ],
      approvals: [{ id: 'apr-1', tool: 'fs.edit', diff: PATCH }],
    });
    expect(diff?.files).toEqual(['src/checkout.ts', 'src/cart.ts']);
  });

  test('concatena varios patches en orden de pasos', () => {
    const second = `--- a/src/new.ts
+++ b/src/new.ts
@@ -1 +1 @@
-a
+b`;
    const diff = buildVerificationDiff({
      steps: [
        step({ id: 's1', approval: approval('apr-1', 'allow') }),
        step({ id: 's2', approval: approval('apr-2', 'allow') }),
      ],
      approvals: [
        { id: 'apr-1', tool: 'fs.edit', diff: PATCH },
        { id: 'apr-2', tool: 'fs.write', diff: second },
      ],
    });

    expect(diff?.patch).toBe(`${PATCH}\n${second}`);
    expect(diff?.files).toEqual(['src/checkout.ts', 'src/cart.ts', 'src/new.ts']);
  });

  test('una misma aprobación no duplica el patch ni la decisión', () => {
    const input = {
      steps: [
        step({ id: 's1', approval: approval('apr-1', 'allow') }),
        step({ id: 's2', approval: approval('apr-1', 'allow') }),
      ],
      approvals: [{ id: 'apr-1', tool: 'fs.edit', diff: PATCH }],
    };
    expect(buildVerificationDiff(input)?.patch).toBe(PATCH);
    expect(buildVerificationDecisions(input.steps)).toHaveLength(1);
  });
});

describe('archivos del patch', () => {
  test('acepta archivos nuevos con /dev/null y rutas entre comillas', () => {
    const patch = [
      '--- /dev/null',
      '+++ "b/src/new file.ts"',
      '@@ -0,0 +1 @@',
      '+hola',
    ].join('\n');
    expect(filesFromVerificationPatch(patch)).toEqual(['src/new file.ts']);
  });

  test('acepta archivos borrados', () => {
    const patch = ['--- a/src/gone.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-x'].join('\n');
    expect(filesFromVerificationPatch(patch)).toEqual(['src/gone.ts']);
  });

  test('ignora rutas absolutas o que salen del workspace', () => {
    const patch = [
      '--- a/../../etc/passwd',
      '+++ b/../../etc/passwd',
      '--- a/C:/tmp/x.ts',
      '+++ b/C:/tmp/x.ts',
      '--- a/src/ok.ts',
      '+++ b/src/ok.ts',
    ].join('\n');
    expect(filesFromVerificationPatch(patch)).toEqual(['src/ok.ts']);
  });
});

describe('decisiones de la sesión', () => {
  test('conserva orden, tool y motivo acotado', () => {
    const decisions = buildVerificationDecisions([
      step({
        id: 's1',
        toolId: undefined,
        title: 'fs.write',
        approval: approval('a1', 'allow'),
      }),
      step({
        id: 's2',
        toolId: 'shell.run',
        approval: approval('a2', 'deny', 'x'.repeat(600)),
      }),
    ]);

    expect(decisions[0]).toEqual({
      stepId: 's1',
      tool: 'fs.write',
      decision: 'allow',
    });
    expect(decisions[1]).toMatchObject({
      stepId: 's2',
      tool: 'shell.run',
      decision: 'deny',
    });
    expect(decisions[1]?.reason).toHaveLength(500);
  });

  test('un paso sin aprobación no genera una decisión inventada', () => {
    expect(buildVerificationDecisions([step()])).toEqual([]);
  });
});

describe('integración con el artifact y el informe', () => {
  test('buildVerificationSections devuelve decisiones y diff', () => {
    const sections = buildVerificationSections({
      steps: [step({ approval: approval('apr-1', 'allow') })],
      approvals: [{ id: 'apr-1', tool: 'fs.edit', diff: PATCH }],
    });

    expect(sections.decisions).toHaveLength(1);
    expect(sections.diff?.patch).toBe(PATCH);
  });

  test('withVerificationSections no muta el artifact y reemplaza el diff', () => {
    const artifact = makeArtifact({
      diff: { patch: 'patch viejo', files: ['viejo.ts'] },
    });
    const next = withVerificationSections(artifact, {
      steps: [step({ approval: approval('apr-1', 'allow') })],
      approvals: [{ id: 'apr-1', tool: 'fs.edit', diff: PATCH }],
    });

    expect(artifact.diff?.patch).toBe('patch viejo');
    expect(next.diff?.patch).toBe(PATCH);
    expect(next.decisions).toHaveLength(1);
    expect(next).not.toBe(artifact);
  });

  test('sin cambios elimina un diff previo en vez de conservarlo', () => {
    const artifact = makeArtifact({
      diff: { patch: 'patch viejo', files: ['viejo.ts'] },
    });
    const next = withVerificationSections(artifact, { steps: [] });

    expect(next.diff).toBeUndefined();
    expect('diff' in next).toBe(false);
    expect(next.decisions).toEqual([]);
  });

  test('el informe muestra el diff y la decisión resultantes', () => {
    const artifact = withVerificationSections(makeArtifact(), {
      steps: [
        step({
          approval: approval('apr-1', 'allow', 'revisado por el usuario'),
        }),
      ],
      approvals: [{ id: 'apr-1', tool: 'fs.edit', diff: PATCH }],
    });
    const markdown = renderMarkdownReport(artifact, FIXED_AT);

    expect(markdown).toContain('+export const total = 3;');
    expect(markdown).toContain('src/checkout.ts');
    expect(markdown).toContain('revisado por el usuario');
  });
});
