/**
 * Informe local de un artifact de verificación.
 *
 * Markdown es el formato canónico; HTML es una representación autocontenida
 * para abrir desde disco. No hay plantillas remotas, recursos externos ni
 * scripts: todo el CSS va inline y todo texto no confiable se escapa.
 */
import type {
  VerificationArtifact,
  VerificationReport,
  VerificationStatus,
  VerificationTestStatus,
} from './types';
import { redactSecrets } from './testEvidence';

export type ReportFormat = VerificationReport['format'];

export interface ReportOptions {
  format?: ReportFormat;
  generatedAt?: number;
}

const FALLBACK = '—';

/**
 * Un artifact puede venir de una sesión con tests inconsistentes. El informe
 * nunca debe mostrar verde si alguna evidencia dice `failed` o `not-run`.
 */
export function effectiveVerificationStatus(
  artifact: VerificationArtifact
): VerificationStatus {
  const tests = Array.isArray(artifact.tests) ? artifact.tests : [];
  if (artifact.status === 'failed') return 'failed';
  if (tests.some((test) => test.status === 'failed' || test.timedOut === true)) {
    return 'failed';
  }
  if (artifact.status === 'passed' && tests.some((test) => test.status === 'not-run')) {
    return 'incomplete';
  }
  return artifact.status;
}

function sanitizeText(value: unknown): string {
  return redactSecrets(String(value ?? ''))
    .replace(/[^\s"'`]*\.env(?:\.[A-Za-z0-9_-]+)?/gi, '[archivo de entorno]')
    .replace(/(^|[\s"'`(])([^\s"'`)]*\.\.[^\s"'`)]*)/gm, '$1[ruta fuera del proyecto]')
    .replace(/\u0000/g, '');
}

function escapeHtml(value: unknown): string {
  return sanitizeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mdInline(value: unknown): string {
  return sanitizeText(value)
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}[\]()#+\-.!|>~<])/g, '\\$1')
    .replace(/\r?\n/g, ' ');
}

function mdCode(value: unknown): string {
  const text = sanitizeText(value).replace(/\r?\n/g, ' ');
  const longest = Math.max(
    0,
    ...Array.from(text.matchAll(/`+/g), (match) => match[0].length)
  );
  const fence = '`'.repeat(longest + 1);
  return `${fence}${text || ' '}${fence}`;
}

function mdFence(value: unknown, language = 'text'): string {
  const text = sanitizeText(value).replace(/\r\n/g, '\n');
  const longest = Math.max(
    2,
    ...Array.from(text.matchAll(/`+/g), (match) => match[0].length)
  );
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) return FALLBACK;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? FALLBACK : date.toISOString();
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return FALLBACK;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function statusLabel(status: VerificationStatus): string {
  if (status === 'passed') return 'APROBADO';
  if (status === 'failed') return 'FALLÓ';
  return 'INCOMPLETO';
}

function statusClass(status: VerificationStatus): string {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  return 'incomplete';
}

function testStatusLabel(status: VerificationTestStatus): string {
  if (status === 'passed') return 'PASÓ';
  if (status === 'failed') return 'FALLÓ';
  return 'NO EJECUTADO';
}

function testStatusClass(status: VerificationTestStatus): string {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  return 'not-run';
}

function planStatusLabel(status: string | undefined, done: boolean): string {
  const value = String(status ?? '').toLowerCase();
  if (done || value === 'done') return 'HECHO';
  if (value === 'in_progress' || value === 'running') return 'EN CURSO';
  if (value === 'blocked') return 'BLOQUEADO';
  if (value === 'pending') return 'PENDIENTE';
  return value ? mdInline(value).toUpperCase() : 'PENDIENTE';
}

function decisionLabel(decision: string): string {
  if (decision === 'allow') return 'PERMITIDA';
  if (decision === 'deny') return 'DENEGADA';
  if (decision === 'allow-session') return 'PERMITIDA PARA LA SESIÓN';
  return mdInline(decision).toUpperCase();
}

function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^[\\/]/.test(value);
}

function normalizedParts(value: string): string[] {
  const parts = value.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

function projectLabel(projectPath: string): string {
  const parts = normalizedParts(String(projectPath ?? ''));
  const last = parts[parts.length - 1];
  return last && last !== '.' && last !== '..' ? last : 'proyecto';
}

function relativePath(projectPath: string, value: unknown): string {
  const clean = sanitizeText(value).trim();
  if (!clean) return FALLBACK;
  // `/dev/null` es una ruta especial del diff (archivo nuevo o borrado), no
  // una ruta del workspace que deba ocultarse.
  if (clean === '/dev/null') return '/dev/null';
  const root = normalizedParts(String(projectPath ?? ''));
  const target = normalizedParts(clean);
  const rootLower = root.map((part) => part.toLowerCase());
  const targetLower = target.map((part) => part.toLowerCase());
  if (
    root.length > 0 &&
    target.length >= root.length &&
    rootLower.every((part, index) => part === targetLower[index])
  ) {
    return target.slice(root.length).join('/') || '.';
  }
  if (!isAbsolutePath(clean) && !clean.split(/[\\/]/).includes('..')) {
    return clean.replace(/\\/g, '/');
  }
  return '[ruta fuera del proyecto]';
}

function relativeFiles(projectPath: string, files: string[] | undefined): string[] {
  return (files ?? []).map((file) => relativePath(projectPath, file));
}

function sanitizePatch(patch: string, projectPath: string): string {
  return sanitizeText(patch)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (!/^(diff --git|--- |\+\+\+ )/.test(line)) return line;
      return line.replace(
        /(^|\s)([A-Za-z]:[\\/][^\s]+|\/[^\s]+)/g,
        (whole, lead: string, candidate: string) => {
          const relative = relativePath(projectPath, candidate);
          return relative === '[ruta fuera del proyecto]'
            ? `${lead}${relative}`
            : whole;
        }
      );
    })
    .join('\n');
}

function environment(artifact: VerificationArtifact) {
  return (
    artifact.environment ?? {
      node: 'desconocido',
      os: 'desconocido',
    }
  );
}

function renderPlanHtml(artifact: VerificationArtifact): string {
  const plan = Array.isArray(artifact.plan) ? artifact.plan : [];
  if (plan.length === 0) return '<p class="muted">Sin plan registrado.</p>';
  return `<ol class="plan">${plan
    .map((item) => {
      const files = relativeFiles(artifact.projectPath, item.files);
      return `<li class="plan__item">
        <div><span class="badge badge--incomplete">${escapeHtml(
          planStatusLabel(item.status, item.done)
        )}</span> <strong>${escapeHtml(item.text)}</strong> <code>${escapeHtml(
        item.id
      )}</code></div>
        ${
          files.length > 0
            ? `<div class="meta">Archivos: ${files
                .map((file) => `<code>${escapeHtml(file)}</code>`)
                .join(', ')}</div>`
            : ''
        }
        ${
          item.criteria
            ? `<div class="meta">Criterio: ${escapeHtml(item.criteria)}</div>`
            : ''
        }
      </li>`;
    })
    .join('')}</ol>`;
}

function renderDecisionsHtml(artifact: VerificationArtifact): string {
  const decisions = Array.isArray(artifact.decisions) ? artifact.decisions : [];
  if (decisions.length === 0) {
    return '<p class="muted">Sin decisiones registradas.</p>';
  }
  return `<ul class="decisions">${decisions
    .map(
      (decision) => `<li>
        <span class="badge badge--${decision.decision === 'deny' ? 'failed' : 'passed'}">${escapeHtml(
          decisionLabel(decision.decision)
        )}</span>
        <strong>${escapeHtml(decision.tool)}</strong>
        <code>${escapeHtml(decision.stepId)}</code>
        ${decision.reason ? `<div class="meta">Motivo: ${escapeHtml(decision.reason)}</div>` : ''}
      </li>`
    )
    .join('')}</ul>`;
}

function renderTestsHtml(artifact: VerificationArtifact): string {
  const tests = Array.isArray(artifact.tests) ? artifact.tests : [];
  if (tests.length === 0) {
    return '<p class="muted">Sin evidencia de tests.</p>';
  }
  return `<div class="tests">${tests
    .map((test) => {
      const duration = formatDuration(test.durationMs);
      return `<article class="test test--${testStatusClass(test.status)}">
        <h3>${escapeHtml(test.id)} <span class="badge badge--${testStatusClass(
          test.status
        )}">${escapeHtml(testStatusLabel(test.status))}</span>${
          test.timedOut ? ' <span class="badge badge--failed">TIMEOUT</span>' : ''
        }</h3>
        <dl class="facts">
          <dt>Comando</dt><dd><code>${escapeHtml(test.command)}</code></dd>
          <dt>cwd</dt><dd><code>${escapeHtml(relativePath(artifact.projectPath, test.cwd))}</code></dd>
          <dt>exitCode</dt><dd>${test.exitCode === null ? 'null' : escapeHtml(test.exitCode)}</dd>
          <dt>Duración</dt><dd>${escapeHtml(duration)}</dd>
          <dt>Timeout</dt><dd>${test.timedOut ? 'Sí' : 'No'}</dd>
        </dl>
        ${
          test.stdoutTail
            ? `<h4>stdout</h4><pre>${escapeHtml(test.stdoutTail)}</pre>`
            : ''
        }
        ${
          test.stderrTail
            ? `<h4>stderr</h4><pre>${escapeHtml(test.stderrTail)}</pre>`
            : ''
        }
      </article>`;
    })
    .join('')}</div>`;
}

function renderDiffHtml(artifact: VerificationArtifact): string {
  if (!artifact.diff) return '<p class="muted">Sin diff registrado.</p>';
  const files = relativeFiles(artifact.projectPath, artifact.diff.files);
  return `<div class="diff">
    <p><strong>Archivos:</strong> ${
      files.length > 0
        ? files.map((file) => `<code>${escapeHtml(file)}</code>`).join(', ')
        : '<span class="muted">Sin archivos listados.</span>'
    }</p>
    ${
      artifact.diff.base || artifact.diff.head
        ? `<p class="muted">Base: ${escapeHtml(artifact.diff.base ?? FALLBACK)} · Head: ${escapeHtml(
            artifact.diff.head ?? FALLBACK
          )}</p>`
        : ''
    }
    ${
      artifact.diff.patch
        ? `<pre class="diff">${escapeHtml(
            sanitizePatch(artifact.diff.patch, artifact.projectPath)
          )}</pre>`
        : '<p class="muted">Sin patch registrado.</p>'
    }
  </div>`;
}

function renderEnvironmentHtml(artifact: VerificationArtifact): string {
  const env = environment(artifact);
  return `<dl class="facts">
    <dt>Node</dt><dd>${escapeHtml(env.node)}</dd>
    <dt>SO</dt><dd>${escapeHtml(env.os)}</dd>
    ${env.commit ? `<dt>Commit</dt><dd><code>${escapeHtml(env.commit)}</code></dd>` : ''}
    ${env.branch ? `<dt>Rama</dt><dd><code>${escapeHtml(env.branch)}</code></dd>` : ''}
  </dl>`;
}

function renderRecordingHtml(artifact: VerificationArtifact): string {
  return artifact.browserRecordingId
    ? `<p>Grabación local: <code>${escapeHtml(artifact.browserRecordingId)}</code></p>`
    : '<p class="muted">Sin grabación vinculada.</p>';
}

export function renderHtmlReport(
  artifact: VerificationArtifact,
  generatedAt: number = Date.now()
): string {
  const status = effectiveVerificationStatus(artifact);
  const title = sanitizeText(artifact.title) || 'Verificación';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Commander AI Studio">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>Verificación — ${escapeHtml(title)}</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#f6f7fb;color:#18202b;font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 20px 56px}
header{border-bottom:3px solid #000080;padding-bottom:16px;margin-bottom:24px}
.eyebrow{margin:0 0 4px;color:#52606f;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
h1{font-size:28px;line-height:1.2;margin:0 0 12px;color:#000080}
h2{font-size:20px;border-bottom:1px solid #cbd5e1;padding-bottom:6px;margin:32px 0 14px}
h3{font-size:16px;margin:0 0 8px}
h4{margin:14px 0 6px;font-size:13px;color:#52606f;text-transform:uppercase;letter-spacing:.04em}
.badge{display:inline-block;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:700;letter-spacing:.04em}
.badge--passed{background:#e6f4ea;color:#0a6b35;border:1px solid #9fd3ae}
.badge--failed{background:#fdecec;color:#a00018;border:1px solid #efb0b8}
.badge--incomplete{background:#fff7db;color:#6b5200;border:1px solid #e8d48a}
.badge--not-run{background:#fff7db;color:#6b5200;border:1px solid #e8d48a}
.muted{color:#5b6775}
.meta{margin-top:5px;color:#52606f;font-size:13px}
.facts{display:grid;grid-template-columns:120px minmax(0,1fr);gap:4px 12px;margin:0 0 12px}
.facts dt{color:#52606f;font-weight:600}
.facts dd{margin:0;min-width:0;overflow-wrap:anywhere}
.test{border-left:4px solid #cbd5e1;padding:12px 14px;margin:14px 0;background:#fff;border-radius:0 6px 6px 0}
.test--passed{border-left-color:#2e8b57}
.test--failed{border-left-color:#b00020}
.test--failed h3{color:#b00020}
.test--not-run{border-left-color:#c49a00}
pre{background:#0f172a;color:#e2e8f0;padding:12px;border-radius:6px;overflow:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.92em;overflow-wrap:anywhere}
.plan,.decisions{padding-left:22px}
.plan__item,.decisions li{margin:10px 0}
.diff{margin-top:8px}
footer{margin-top:36px;border-top:1px solid #cbd5e1;padding-top:12px;color:#5b6775;font-size:12px}
@media print{body{background:#fff}main{padding:0}.test{break-inside:avoid}}
</style>
</head>
<body>
<main>
<header>
<p class="eyebrow">Commander AI Studio · Informe local</p>
<h1>Verificación — ${escapeHtml(title)}</h1>
<p><span class="badge badge--${statusClass(status)}">${escapeHtml(
    statusLabel(status)
  )}</span> <span class="muted">Artifact <code>${escapeHtml(
    artifact.id
  )}</code> · Sesión <code>${escapeHtml(artifact.sessionId)}</code> · Proyecto <code>${escapeHtml(
    projectLabel(artifact.projectPath)
  )}</code></span></p>
<p class="muted">Creado: ${escapeHtml(formatDate(artifact.createdAt))} · Generado: ${escapeHtml(
    formatDate(generatedAt)
  )}</p>
</header>

<section>
<h2>Plan</h2>
${renderPlanHtml(artifact)}
</section>

<section>
<h2>Decisiones</h2>
${renderDecisionsHtml(artifact)}
</section>

<section>
<h2>Diff</h2>
${renderDiffHtml(artifact)}
</section>

<section>
<h2>Tests</h2>
${renderTestsHtml(artifact)}
</section>

<section>
<h2>Entorno</h2>
${renderEnvironmentHtml(artifact)}
</section>

<section>
<h2>Grabación</h2>
${renderRecordingHtml(artifact)}
</section>

<footer>Informe local y autocontenido. No requiere red, cuenta ni recursos externos.</footer>
</main>
</body>
</html>`;
}

function renderPlanMarkdown(artifact: VerificationArtifact): string {
  const plan = Array.isArray(artifact.plan) ? artifact.plan : [];
  if (plan.length === 0) return '_Sin plan registrado._';
  return plan
    .map((item) => {
      const lines = [
        `- **${planStatusLabel(item.status, item.done)}** — ${mdInline(
          item.text
        )} (${mdCode(item.id)})`,
      ];
      const files = relativeFiles(artifact.projectPath, item.files);
      if (files.length > 0) {
        lines.push(`  - Archivos: ${files.map((file) => mdCode(file)).join(', ')}`);
      }
      if (item.criteria) lines.push(`  - Criterio: ${mdInline(item.criteria)}`);
      return lines.join('\n');
    })
    .join('\n');
}

function renderDecisionsMarkdown(artifact: VerificationArtifact): string {
  const decisions = Array.isArray(artifact.decisions) ? artifact.decisions : [];
  if (decisions.length === 0) return '_Sin decisiones registradas._';
  return decisions
    .map(
      (decision) =>
        `- **${decisionLabel(decision.decision)}** — ${mdInline(
          decision.tool
        )} (${mdCode(decision.stepId)})${
          decision.reason ? `\n  - Motivo: ${mdInline(decision.reason)}` : ''
        }`
    )
    .join('\n');
}

function renderTestsMarkdown(artifact: VerificationArtifact): string {
  const tests = Array.isArray(artifact.tests) ? artifact.tests : [];
  if (tests.length === 0) return '_Sin evidencia de tests._';
  return tests
    .map((test) => {
      const lines = [
        `### ${mdInline(test.id)} — ${testStatusLabel(test.status)}`,
        `- **Comando:** ${mdCode(test.command)}`,
        `- **cwd:** ${mdCode(relativePath(artifact.projectPath, test.cwd))}`,
        `- **exitCode:** ${test.exitCode === null ? '`null`' : mdCode(String(test.exitCode))}`,
        `- **Duración:** ${formatDuration(test.durationMs)}`,
        `- **Timeout:** ${test.timedOut ? 'Sí' : 'No'}`,
      ];
      if (test.stdoutTail) {
        lines.push('', '**stdout**', '', mdFence(test.stdoutTail));
      }
      if (test.stderrTail) {
        lines.push('', '**stderr**', '', mdFence(test.stderrTail));
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

function renderDiffMarkdown(artifact: VerificationArtifact): string {
  if (!artifact.diff) return '_Sin diff registrado._';
  const files = relativeFiles(artifact.projectPath, artifact.diff.files);
  const lines = [
    `- **Archivos:** ${
      files.length > 0 ? files.map((file) => mdCode(file)).join(', ') : '_Sin archivos listados._'
    }`,
  ];
  if (artifact.diff.base || artifact.diff.head) {
    lines.push(
      `- **Base:** ${mdInline(artifact.diff.base ?? FALLBACK)} · **Head:** ${mdInline(
        artifact.diff.head ?? FALLBACK
      )}`
    );
  }
  if (artifact.diff.patch) {
    lines.push('', mdFence(sanitizePatch(artifact.diff.patch, artifact.projectPath), 'diff'));
  } else {
    lines.push('', '_Sin patch registrado._');
  }
  return lines.join('\n');
}

export function renderMarkdownReport(
  artifact: VerificationArtifact,
  generatedAt: number = Date.now()
): string {
  const status = effectiveVerificationStatus(artifact);
  const env = environment(artifact);
  return `# Verificación — ${mdInline(artifact.title) || 'Verificación'}

- **Estado:** **${statusLabel(status)}**
- **Artifact:** ${mdCode(artifact.id)}
- **Sesión:** ${mdCode(artifact.sessionId)}
- **Proyecto:** ${mdInline(projectLabel(artifact.projectPath))}
- **Creado:** ${formatDate(artifact.createdAt)}
- **Generado:** ${formatDate(generatedAt)}

## Plan

${renderPlanMarkdown(artifact)}

## Decisiones

${renderDecisionsMarkdown(artifact)}

## Diff

${renderDiffMarkdown(artifact)}

## Tests

${renderTestsMarkdown(artifact)}

## Entorno

- **Node:** ${mdInline(env.node)}
- **SO:** ${mdInline(env.os)}
${env.commit ? `- **Commit:** ${mdCode(env.commit)}\n` : ''}${
    env.branch ? `- **Rama:** ${mdCode(env.branch)}\n` : ''
  }
## Grabación

${
  artifact.browserRecordingId
    ? `Referencia local: ${mdCode(artifact.browserRecordingId)}`
    : '_Sin grabación vinculada._'
}

---

_Informe local y autocontenido. No requiere red, cuenta ni recursos externos._
`;
}

export function buildVerificationReport(
  artifact: VerificationArtifact,
  options: ReportOptions = {}
): VerificationReport {
  const generatedAt = Number.isFinite(options.generatedAt)
    ? (options.generatedAt as number)
    : Date.now();
  const format = options.format ?? 'markdown';
  return {
    format,
    content:
      format === 'html'
        ? renderHtmlReport(artifact, generatedAt)
        : renderMarkdownReport(artifact, generatedAt),
    generatedAt,
  };
}

/** Devuelve una copia con el informe listo para guardar en el artifact/store. */
export function withVerificationReport(
  artifact: VerificationArtifact,
  options: ReportOptions = {}
): VerificationArtifact {
  return {
    ...artifact,
    report: buildVerificationReport(artifact, options),
  };
}
