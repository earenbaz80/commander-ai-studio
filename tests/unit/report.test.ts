import { beforeEach, describe, expect, test } from 'vitest';
import { clearArtifacts, listArtifacts, saveArtifact } from '../../src/artifacts/store';
import {
  buildVerificationReport,
  effectiveVerificationStatus,
  renderHtmlReport,
  renderMarkdownReport,
  withVerificationReport,
} from '../../src/artifacts/report';
import type {
  VerificationArtifact,
  VerificationTestEvidence,
} from '../../src/artifacts/types';

const FIXED_AT = Date.UTC(2026, 10, 9, 12, 30, 0);
const CREATED_AT = Date.UTC(2026, 10, 9, 10, 0, 0);

function failedTest(overrides: Partial<VerificationTestEvidence> = {}): VerificationTestEvidence {
  return {
    id: 't-fail',
    command: 'npm test -- checkout',
    cwd: 'C:/tmp/checkout',
    status: 'failed',
    exitCode: 1,
    durationMs: 1_200,
    startedAt: CREATED_AT + 100,
    finishedAt: CREATED_AT + 1_300,
    stdoutTail: '1 failing',
    stderrTail: 'AssertionError: expected 2 to be 3',
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
    createdAt: CREATED_AT,
    sessionId: 's1',
    status: 'failed',
    plan: [
      {
        id: 'p1',
        text: 'Reproducir el fallo',
        status: 'done',
        done: true,
        files: ['src/checkout.ts'],
        criteria: 'test rojo',
      },
      {
        id: 'p2',
        text: 'Corregir el cálculo',
        status: 'in_progress',
        done: false,
      },
    ],
    decisions: [
      {
        stepId: 'step-1',
        tool: 'fs.edit',
        decision: 'allow',
        reason: 'cambio revisado',
      },
      {
        stepId: 'step-2',
        tool: 'shell.run',
        decision: 'deny',
      },
    ],
    diff: {
      patch: 'diff --git a/src/checkout.ts b/src/checkout.ts\n--- a/src/checkout.ts\n+++ b/src/checkout.ts\n@@ -1 +1 @@\n-2\n+3',
      files: ['src/checkout.ts'],
      base: 'main',
      head: 'fix/checkout',
    },
    tests: [failedTest()],
    browserRecordingId: 'rec-1',
    environment: {
      node: 'v22.0.0',
      os: 'win32-x64',
      commit: 'abc123',
      branch: 'fix/checkout',
    },
    ...overrides,
  };
}

describe('estado efectivo del artifact', () => {
  test('un artifact passed con un test failed se informa como failed', () => {
    const artifact = makeArtifact({
      status: 'passed',
      tests: [failedTest({ status: 'passed', exitCode: 0 }), failedTest()],
    });
    expect(effectiveVerificationStatus(artifact)).toBe('failed');
  });

  test('un artifact passed con un test not-run queda incomplete', () => {
    const artifact = makeArtifact({
      status: 'passed',
      tests: [
        failedTest({ status: 'passed', exitCode: 0 }),
        failedTest({ status: 'not-run', exitCode: null }),
      ],
    });
    expect(effectiveVerificationStatus(artifact)).toBe('incomplete');
  });

  test('un timeout cuenta como fallo aunque el artifact diga passed', () => {
    const artifact = makeArtifact({
      status: 'passed',
      tests: [failedTest({ timedOut: true })],
    });
    expect(effectiveVerificationStatus(artifact)).toBe('failed');
  });

  test('un artifact failed nunca se recupera a verde', () => {
    const artifact = makeArtifact({
      status: 'failed',
      tests: [failedTest({ status: 'passed', exitCode: 0 })],
    });
    expect(effectiveVerificationStatus(artifact)).toBe('failed');
  });

  test('sin incidencias conserva passed', () => {
    const artifact = makeArtifact({
      status: 'passed',
      tests: [failedTest({ status: 'passed', exitCode: 0 })],
    });
    expect(effectiveVerificationStatus(artifact)).toBe('passed');
  });
});

describe('informe Markdown', () => {
  test('incluye plan, decisiones, diff, tests, entorno, fecha y grabación', () => {
    const md = renderMarkdownReport(makeArtifact(), FIXED_AT);

    expect(md.startsWith('# Verificación')).toBe(true);
    expect(md).toContain('**Estado:** **FALLÓ**');
    expect(md).toContain('Reproducir el fallo');
    expect(md).toContain('HECHO');
    expect(md).toContain('EN CURSO');
    expect(md).toContain('fs\\.edit');
    expect(md).toContain('PERMITIDA');
    expect(md).toContain('DENEGADA');
    expect(md).toContain('src/checkout.ts');
    expect(md).toContain('diff --git');
    expect(md).toContain('npm test -- checkout');
    expect(md).toContain('v22\\.0\\.0');
    expect(md).toContain('abc123');
    expect(md).toContain('rec-1');
    expect(md).toContain('2026-11-09T12:30:00.000Z');
    expect(md).toContain('2026-11-09T10:00:00.000Z');
  });

  test('un test fallido muestra su exitCode y uno no ejecutado no se aprueba', () => {
    const artifact = makeArtifact({
      tests: [
        failedTest(),
        failedTest({
          id: 't-skip',
          status: 'not-run',
          exitCode: null,
          stdoutTail: '',
          stderrTail: '',
        }),
      ],
    });
    const md = renderMarkdownReport(artifact, FIXED_AT);

    expect(md).toContain('FALLÓ');
    expect(md).toContain('**exitCode:** `1`');
    expect(md).toContain('NO EJECUTADO');
    expect(md).toContain('**exitCode:** `null`');
    expect(md).not.toMatch(/### t-skip[^\n]*APROBADO/);
  });

  test('sin diff ni grabación lo dice explícitamente, sin inventarlos', () => {
    const artifact = makeArtifact({ diff: undefined, browserRecordingId: undefined });
    const md = renderMarkdownReport(artifact, FIXED_AT);

    expect(md).toContain('Sin diff registrado');
    expect(md).toContain('Sin grabación vinculada');
  });

  test('redacta tokens, archivos .env y rutas fuera del workspace', () => {
    const githubToken = `ghp_${'a'.repeat(30)}`;
    const skToken = `sk-${'b'.repeat(24)}`;
    const artifact = makeArtifact({
      tests: [
        failedTest({
          command: `npm test -- --token=${githubToken}`,
          cwd: 'C:/tmp/checkout/../secreto',
          stdoutTail: `OPENAI_API_KEY=${skToken}`,
          stderrTail: 'cat C:/tmp/checkout/.env',
        }),
      ],
    });

    for (const content of [
      renderMarkdownReport(artifact, FIXED_AT),
      renderHtmlReport(artifact, FIXED_AT),
    ]) {
      expect(content).not.toContain(githubToken);
      expect(content).not.toContain(skToken);
      expect(content).not.toContain('.env');
      expect(content).not.toContain('../secreto');
      expect(content).toContain('[REDACTED');
      expect(content).toContain('[ruta fuera del proyecto]');
      expect(content).toContain('[archivo de entorno]');
    }
  });

  test('redacta claves compuestas y Authorization Basic en ambos formatos', () => {
    const artifact = makeArtifact({
      tests: [
        failedTest({
          command: 'npm test -- --client_secret=client-secret-value',
          stdoutTail: 'OPENAI_API_KEY=openai-secret-value\naccess_token=access-secret-value',
          stderrTail: 'Authorization: Basic dXNlcjpwYXNzd29yZA==',
        }),
      ],
    });

    for (const content of [
      renderMarkdownReport(artifact, FIXED_AT),
      renderHtmlReport(artifact, FIXED_AT),
    ]) {
      expect(content).not.toContain('client-secret-value');
      expect(content).not.toContain('openai-secret-value');
      expect(content).not.toContain('access-secret-value');
      expect(content).not.toContain('dXNlcjpwYXNzd29yZA==');
      expect(content).toContain('[REDACTED]');
    }
  });

  test('preserva /dev/null como ruta especial del patch', () => {
    const artifact = makeArtifact({
      diff: {
        patch: [
          '--- /dev/null',
          '+++ b/src/nuevo.ts',
          '@@ -0,0 +1 @@',
          '+hola',
        ].join('\n'),
        files: ['src/nuevo.ts'],
      },
    });

    for (const content of [
      renderMarkdownReport(artifact, FIXED_AT),
      renderHtmlReport(artifact, FIXED_AT),
    ]) {
      expect(content).toContain('--- /dev/null');
      expect(content).not.toContain('--- [ruta fuera del proyecto]');
    }
  });

  test('es determinista cuando se fija generatedAt', () => {
    const artifact = makeArtifact();
    expect(renderMarkdownReport(artifact, FIXED_AT)).toBe(
      renderMarkdownReport(artifact, FIXED_AT)
    );
  });

  test('conserva la referencia correcta a la grabación sin incrustar frames', () => {
    const artifact = makeArtifact();
    const md = renderMarkdownReport(artifact, FIXED_AT);
    const html = renderHtmlReport(artifact, FIXED_AT);

    expect(md).toContain('Referencia local: `rec-1`');
    expect(html).toContain('<p>Grabación local: <code>rec-1</code></p>');
    expect(md).not.toContain('data:image');
    expect(html).not.toContain('data:image');
  });
});

describe('informe HTML', () => {
  test('escapa el contenido no confiable del modelo y del comando', () => {
    const artifact = makeArtifact({
      title: 'Checkout <script>alert("x")</script>',
      plan: [
        {
          id: 'p1',
          text: '<img src=x onerror=alert(1)>',
          status: 'pending',
          done: false,
        },
      ],
      tests: [failedTest({ command: 'npm test -- "<svg onload=alert(1)>"' })],
    });
    const html = renderHtmlReport(artifact, FIXED_AT);

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
  });

  test('es autocontenido: CSP estricta y sin recursos externos', () => {
    const html = renderHtmlReport(
      makeArtifact({ title: 'Ver https://ejemplo.test/x.png' }),
      FIXED_AT
    );

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/\b(?:src|href)=/i);
    expect(html).not.toContain('@import');
    expect(html).not.toContain('url(');
  });

  test('un test fallido se pinta en rojo con su exitCode', () => {
    const html = renderHtmlReport(makeArtifact(), FIXED_AT);

    expect(html).toContain('badge--failed');
    expect(html).toContain('FALLÓ');
    expect(html).toContain('<dt>exitCode</dt><dd>1</dd>');
    expect(html).toContain('test--failed');
  });

  test('un test no ejecutado no se pinta como aprobado', () => {
    const artifact = makeArtifact({
      status: 'passed',
      tests: [failedTest({ status: 'not-run', exitCode: null })],
    });
    const html = renderHtmlReport(artifact, FIXED_AT);

    expect(html).toContain('badge--incomplete');
    expect(html).toContain('INCOMPLETO');
    expect(html).toContain('badge--not-run');
    expect(html).toContain('NO EJECUTADO');
    expect(html).not.toContain('APROBADO');
  });

  test('sin grabación vinculada lo declara', () => {
    const html = renderHtmlReport(makeArtifact({ browserRecordingId: undefined }), FIXED_AT);
    expect(html).toContain('Sin grabación vinculada');
  });
});

describe('buildVerificationReport y persistencia', () => {
  beforeEach(async () => {
    await clearArtifacts();
  });

  test('elige el formato y conserva generatedAt', () => {
    const artifact = makeArtifact();
    const markdown = buildVerificationReport(artifact, { generatedAt: FIXED_AT });
    const html = buildVerificationReport(artifact, {
      format: 'html',
      generatedAt: FIXED_AT,
    });

    expect(markdown.format).toBe('markdown');
    expect(markdown.generatedAt).toBe(FIXED_AT);
    expect(markdown.content).toBe(renderMarkdownReport(artifact, FIXED_AT));
    expect(html.format).toBe('html');
    expect(html.content).toBe(renderHtmlReport(artifact, FIXED_AT));
  });

  test('withVerificationReport no muta el artifact original', () => {
    const artifact = makeArtifact();
    const withReport = withVerificationReport(artifact, { generatedAt: FIXED_AT });

    expect(artifact.report).toBeUndefined();
    expect(withReport.report?.format).toBe('markdown');
    expect(withReport.report?.generatedAt).toBe(FIXED_AT);
    expect(withReport.tests).toEqual(artifact.tests);
  });

  test('el informe vive en el store y sobrevive a la consulta', async () => {
    const artifact = withVerificationReport(makeArtifact(), { generatedAt: FIXED_AT });
    await saveArtifact(artifact);

    const stored = await listArtifacts('C:/tmp/checkout');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(artifact);
    expect(stored[0]?.kind).toBe('verification');
    if (stored[0]?.kind !== 'verification') throw new Error('artifact inesperado');
    expect(stored[0].report?.content).toContain('**Estado:** **FALLÓ**');
  });
});
