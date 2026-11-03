/**
 * Contraste de las paletas.
 *
 * Lee los tokens de `src/index.css` y comprueba los pares texto/fondo que usa
 * la interfaz. No sustituye al e2e de contraste real (`tests/e2e/contrast.spec.ts`),
 * pero cubre las seis paletas en milisegundos y detecta un token que se aclara
 * o se oscurece de más antes de que llegue al navegador.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');

/** Selector CSS donde vive cada paleta. Norton usa `:root`. */
const SELECTORES: Record<string, string> = {
  norton: ':root',
  matrix: '.theme-matrix',
  amber: '.theme-amber',
  dos: '.theme-dos',
  light: '.theme-light',
  solarized: '.theme-solarized',
};

/** Mínimo WCAG AA para texto normal. */
const MINIMO = 4.5;

/**
 * Pares que deben leerse bien. Se incluyen los fondos donde de verdad se pinta
 * texto: principal, panel, profundo y hover.
 */
const PARES: Array<[string, string]> = [
  ['--nc-text', '--nc-bg-main'],
  ['--nc-text', '--nc-bg-panel'],
  ['--nc-text', '--nc-bg-deep'],
  ['--nc-text', '--nc-bg-hover'],
  ['--nc-text-dim', '--nc-bg-main'],
  ['--nc-text-dim', '--nc-bg-panel'],
  ['--nc-text-accent', '--nc-bg-main'],
  ['--nc-text-accent', '--nc-bg-panel'],
  ['--nc-active-text', '--nc-active-bg'],
  ['--nc-header-text', '--nc-header-bg'],
  ['--nc-danger', '--nc-bg-main'],
  ['--nc-danger', '--nc-bg-panel'],
  ['--nc-success', '--nc-bg-main'],
  ['--nc-success', '--nc-bg-panel'],
];

function tokensDe(selector: string): Record<string, string> {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bloque = new RegExp(`${escapado}\\s*\\{([\\s\\S]*?)\\}`).exec(CSS);
  if (!bloque) throw new Error(`No encuentro el bloque CSS de ${selector}`);

  const tokens: Record<string, string> = {};
  for (const match of bloque[1].matchAll(/(--nc-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) {
    tokens[match[1]] = match[2];
  }
  return tokens;
}

function canales(hex: string): [number, number, number] {
  const limpio = hex.replace('#', '');
  const completo = limpio.length === 3 ? [...limpio].map((c) => c + c).join('') : limpio;
  return [0, 2, 4].map((i) => parseInt(completo.slice(i, i + 2), 16)) as [number, number, number];
}

function luminancia(hex: string): number {
  const [r, g, b] = canales(hex);
  const lineal = (valor: number) => {
    const c = valor / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
}

function contraste(frente: string, fondo: string): number {
  const a = luminancia(frente);
  const b = luminancia(fondo);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('contraste de las paletas', () => {
  for (const [tema, selector] of Object.entries(SELECTORES)) {
    describe(tema, () => {
      const tokens = tokensDe(selector);

      for (const [frente, fondo] of PARES) {
        it(`${frente} sobre ${fondo}`, () => {
          expect(tokens[frente], `${tema} no define ${frente}`).toBeTruthy();
          expect(tokens[fondo], `${tema} no define ${fondo}`).toBeTruthy();
          expect(
            contraste(tokens[frente], tokens[fondo]),
            `${tema}: ${frente} (${tokens[frente]}) sobre ${fondo} (${tokens[fondo]})`
          ).toBeGreaterThanOrEqual(MINIMO);
        });
      }
    });
  }
});
