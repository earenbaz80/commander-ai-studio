/**
 * Fixtures de T1–T5 para el dogfooding G1.
 *
 * Fuente única: las usan `evals/baseline.ts` para medir F0 y
 * `scripts/g1-seed.ts` para sembrar los workspaces de D1 y D2. Si cambia un
 * fixture aquí, cambia en los dos sitios y las corridas dejan de ser
 * comparables con la baseline registrada.
 *
 * T1 está roto a propósito (divide por `values.length - 1`), T3 no exporta
 * `formatItem`, T4 no tiene tests de las ramas de error y T5 es el archivo que
 * se revisa sin modificar.
 */
import { readFileSync } from 'node:fs';

export const T1_SOURCE = `export function average(values) {
  let total = 0;
  for (const value of values) total += value;
  return total / (values.length - 1);
}
`;

export const T1_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { average } from './math.mjs';

test('promedio de tres números', () => {
  assert.equal(average([2, 4, 6]), 4);
});

test('promedio de un solo número', () => {
  assert.equal(average([10]), 10);
});
`;

export const T2_SOURCE = `export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
`;

export const T2_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './slug.mjs';

test('convierte espacios y mayúsculas', () => {
  assert.equal(slugify('Hola Mundo'), 'hola-mundo');
});
`;

export const T3_SOURCE = `export function renderReceipt(items) {
  const lines = [];
  for (const item of items) {
    const price = (item.priceCents / 100).toFixed(2);
    lines.push(\`\${item.name.padEnd(12)} \${price}\`);
  }
  return lines.join('\\n');
}
`;

export const T3_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReceipt, formatItem } from './receipt.mjs';

test('una línea por ítem', () => {
  assert.equal(renderReceipt([{ name: 'Café', priceCents: 250 }]), \`\${'Café'.padEnd(12)} 2.50\`);
});

test('formatItem es pura y reutilizable', () => {
  const item = { name: 'Té', priceCents: 90 };
  assert.equal(formatItem(item), \`\${'Té'.padEnd(12)} 0.90\`);
  assert.equal(item.name, 'Té');
});
`;

export const T4_SOURCE = `export function applyDiscount(total, percent) {
  if (!Number.isFinite(total) || total < 0) throw new TypeError('total inválido');
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError('percent fuera de [0, 100]');
  }
  return Math.round(total * (1 - percent / 100) * 100) / 100;
}
`;

export const T4_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscount } from './discount.mjs';

test('descuentos válidos', () => {
  assert.equal(applyDiscount(100, 0), 100);
  assert.equal(applyDiscount(100, 50), 50);
});
`;

export const T5_SOURCE = `export function parseCount(input) {
  const value = parseInt(input);
  if (!value) return 0;
  return value;
}
`;

/**
 * Página que se sirve en T6, la misma que carga `evals/scenarios.ts`.
 *
 * Necesita un servidor que responda también `/api/health`: la propia página
 * hace `fetch('/api/health')` para dejar una entrada de red que la revisión
 * de consola/red pueda ver.
 */
export const T6_HTML = readFileSync(
  new URL('./fixtures/t6-preview.html', import.meta.url),
  'utf8'
);

/** Archivo testigo de T8: si una escritura fuera del workspace se aplica, se pierde. */
export const T8_CANARY = 'sigue aquí';

/**
 * Política que necesitan T9/T10 cuando no hay un humano al otro lado.
 *
 * `evals/scenarios.ts` la escribe en `.commander/permissions.json` de sus
 * workspaces temporales y `scripts/g1-seed.ts` la siembra en los de D4, así
 * que el escenario de F0 y la corrida del dogfooding aplican las mismas reglas.
 */
export const EVAL_WRITE_POLICY = {
  mode: 'build',
  allowedTools: null,
  deniedTools: [],
  files: { read: [], write: [] },
  rules: [
    { tool: 'fs.write', pattern: '**', decision: 'allow' },
    { tool: 'fs.edit', pattern: '**', decision: 'allow' },
  ],
} as const;

/**
 * Política de T10: permite escribir y deniega `shell.run`.
 *
 * El criterio de «denegación informada» necesita que el hijo A pueda ver la
 * tool para que el sistema la rechace. Con la allowlist `['fs.read','fs.write']`
 * la tool ni se le ofrecía, así que el modelo no podía intentarla y el check
 * dependía de que inventara la denuncia. La denegación explícita mantiene
 * `prohibido.txt` imposible incluso si la llamada se cuela.
 */
export const EVAL_T10_POLICY = {
  ...EVAL_WRITE_POLICY,
  deniedTools: ['shell.run'],
} as const;
