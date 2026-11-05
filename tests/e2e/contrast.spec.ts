import { test, expect, type Page } from '@playwright/test';

/**
 * Auditoría de contraste real.
 *
 * A diferencia de `tests/unit/themeContrast.test.ts` (que valida los tokens),
 * esto mide el color computado en el DOM: pilla clases literales, remaps que
 * no aplican y fondos que tapan la cabecera. Recorre las superficies donde más
 * texto hay y falla si algún texto baja de 4,5:1 (o 3:1 si es grande).
 */

interface Falla {
  ratio: number;
  need: number;
  tag: string;
  cls: string;
  text: string;
  fg: string;
  bg: string;
}

interface Resultado {
  checked: number;
  fallos: Falla[];
}

/**
 * Se ejecuta dentro del navegador. Convierte OKLCH a sRGB porque Chromium
 * serializa los colores de Tailwind así y un parser sólo de rgb los ignoraría.
 */
function medirContrasteDom(): Resultado {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));

  const desdeHex = (h: string) => {
    let limpio = h.replace('#', '');
    if (limpio.length === 3) limpio = [...limpio].map((c) => c + c).join('');
    return {
      r: parseInt(limpio.slice(0, 2), 16),
      g: parseInt(limpio.slice(2, 4), 16),
      b: parseInt(limpio.slice(4, 6), 16),
      a: 1,
    };
  };

  const oklchARgb = (L: number, C: number, grados: number, a: number) => {
    const h = (grados * Math.PI) / 180;
    const l_ = L + 0.3963377774 * C * Math.cos(h) + 0.2158037573 * C * Math.sin(h);
    const m_ = L - 0.1055613458 * C * Math.cos(h) - 0.0638541728 * C * Math.sin(h);
    const s_ = L - 0.0894841775 * C * Math.cos(h) - 1.291485548 * C * Math.sin(h);
    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;
    const lineales = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    const [r, g, b] = lineales.map(
      (v) => clamp(v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255
    );
    return { r, g, b, a };
  };

  const parsear = (color: string) => {
    const c = (color || '').trim();
    if (c.startsWith('#')) return desdeHex(c);

    let m = /^rgba?\(([^)]+)\)/.exec(c);
    if (m) {
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    }

    m = /^oklch\(([^)]+)\)/.exec(c);
    if (m) {
      const p = m[1].split(/[ ,/]+/).filter(Boolean);
      const L = p[0].endsWith('%') ? parseFloat(p[0]) / 100 : parseFloat(p[0]);
      const C = parseFloat(p[1]);
      const h = parseFloat(p[2]);
      const a = p[3] === undefined ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
      return oklchARgb(L, C, h, a);
    }

    m = /^color\(srgb ([^)]+)\)/.exec(c);
    if (m) {
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p[3] === undefined ? 1 : p[3] };
    }

    return null;
  };

  const luminancia = ({ r, g, b }: { r: number; g: number; b: number }) => {
    const lineal = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
  };

  const ratio = (
    a: { r: number; g: number; b: number },
    b: { r: number; g: number; b: number }
  ) => {
    const la = luminancia(a);
    const lb = luminancia(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const fondoDe = (el: Element) => {
    let nodo: Element | null = el;
    while (nodo && nodo !== document.documentElement) {
      const estilo = getComputedStyle(nodo);
      const color = parsear(estilo.backgroundColor);
      if (color && color.a > 0.5) return color;
      if (estilo.backgroundImage !== 'none' && !/none|initial/.test(estilo.backgroundImage)) {
        return null;
      }
      nodo = nodo.parentElement;
    }
    return parsear(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  };

  const vistos = new Set<string>();
  const fallos: Falla[] = [];
  let checked = 0;

  for (const el of document.querySelectorAll('body *')) {
    const texto = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent?.trim() ?? '')
      .join(' ')
      .trim();
    if (!texto) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;

    const estilo = getComputedStyle(el);
    if (estilo.visibility === 'hidden' || estilo.display === 'none' || Number(estilo.opacity) < 0.1) {
      continue;
    }

    const frente = parsear(estilo.color);
    if (!frente || frente.a < 0.5) continue;

    const fondo = fondoDe(el);
    if (!fondo) continue;

    const tamano = parseFloat(estilo.fontSize);
    const negrita = Number(estilo.fontWeight) >= 700;
    const minimo = tamano >= 24 || (negrita && tamano >= 18.66) ? 3 : 4.5;
    const valor = ratio(frente, fondo);
    checked += 1;

    if (valor < minimo) {
      const clave = String(el.className) + texto.slice(0, 20);
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      fallos.push({
        ratio: Math.round(valor * 100) / 100,
        need: minimo,
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 110),
        text: texto.slice(0, 60),
        fg: estilo.color,
        bg: `rgb(${Math.round(fondo.r)},${Math.round(fondo.g)},${Math.round(fondo.b)})`,
      });
    }
  }

  fallos.sort((a, b) => a.ratio - b.ratio);
  return { checked, fallos };
}

async function descartarInvitado(page: Page) {
  const invitado = page.locator('button:has-text("ENTRAR COMO INVITADO")');
  if (await invitado.isVisible({ timeout: 3000 }).catch(() => false)) {
    await invitado.click();
    await page.waitForTimeout(500);
  }
}

async function abrirApp(page: Page, tema: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="app-root"], .nc-header', { timeout: 45000 });
  await descartarInvitado(page);

  await page.evaluate((t) => localStorage.setItem('ai_studio_theme', JSON.stringify(t)), tema);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.nc-header', { timeout: 45000 });
  await descartarInvitado(page);
  // Norton es el tema por defecto: `applyThemeToDOM` no le pone clase. Se
  // comprueba que no queda ninguna clase de otro tema, que es lo observable.
  if (tema === 'norton') {
    await expect(page.locator('html')).not.toHaveClass(/theme-(matrix|amber|dos|light|solarized)/);
  } else {
    await expect(page.locator('html')).toHaveClass(new RegExp(`theme-${tema}`));
  }
  await page.waitForTimeout(600);
}

async function auditar(page: Page, superficie: string) {
  const resultado = await page.evaluate(medirContrasteDom);

  expect(resultado.checked, `${superficie}: no se midió ningún texto`).toBeGreaterThan(10);

  const detalle = resultado.fallos
    .map(
      (f) =>
        `${f.ratio}:1 (mínimo ${f.need}:1) · ${f.text} · ${f.tag}.${f.cls} · ${f.fg} sobre ${f.bg}`
    )
    .join('\n');

  expect(detalle, `${superficie}: ${resultado.fallos.length} textos por debajo del mínimo`).toBe('');
}

test.describe('Contraste de los temas', () => {
  // El contraste no depende del motor: el resto de la suite ya ejerce Firefox
  // y móvil. Repetirlo seis veces sólo añade minutos al job.
  test.skip(({ browserName }) => browserName !== 'chromium', 'El contraste se mide sólo en Chromium');

  test.setTimeout(150000);

  // Norton es el tema por defecto: si sólo se miden los claros, el que más se
  // usa queda sin red.
  for (const tema of ['norton', 'light', 'solarized']) {
    test(`chat, paleta, preferencias y agente legibles en ${tema}`, async ({ page }) => {
      await abrirApp(page, tema);
      await auditar(page, `chat (${tema})`);

      await page.keyboard.press('Control+K');
      await expect(page.locator('[data-command-palette]')).toBeVisible();
      await page.waitForTimeout(200);
      await auditar(page, `paleta (${tema})`);

      const entradaPaleta = page.locator('[data-command-palette] input');
      await entradaPaleta.fill('configuración');
      await page
        .locator('[data-command-palette] button[role="option"]', {
          hasText: 'Configuración',
        })
        .first()
        .click();
      await expect(page.getByText('Apariencia e idioma')).toBeVisible();
      await page.waitForTimeout(300);
      await auditar(page, `configuración (${tema})`);

      // exact: el Header también tiene «Cerrar aplicación», que cerraría la app.
      await page.getByRole('button', { name: 'Cerrar', exact: true }).first().click();
      await page.waitForTimeout(200);

      await page.keyboard.press('Control+K');
      await expect(page.locator('[data-command-palette]')).toBeVisible();
      await page.locator('[data-command-palette] input').fill('agente');
      await page
        .locator('[data-command-palette] button[role="option"]', { hasText: 'Agente autónomo' })
        .first()
        .click();
      await expect(page.getByText('MODO AGENTE')).toBeVisible();
      await page.waitForTimeout(300);
      await auditar(page, `agente (${tema})`);
    });
  }
});
