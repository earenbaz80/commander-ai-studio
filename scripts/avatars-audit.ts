/**
 * Genera una auditoría visual estática de los 12 avatares integrados.
 *
 *   npm run avatars:audit
 *
 * El HTML resultante vive en `.commander/avatar-audit.html` (ignorado por git)
 * y se puede abrir directamente en el navegador. No usa React ni un servidor:
 * renderiza los mismos píxeles que `UserAvatar` con SVG inline y muestra, por
 * cada tema, los tamaños reales 18/32/40, zooms nearest-neighbor y las
 * variantes en escala de grises.
 *
 * Los tokens de tema se leen de `src/index.css` para que la auditoría use los
 * colores reales de la app y no una copia que se quede desactualizada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AVATAR_VIEWBOX, getAvatarPixels, USER_AVATARS } from '../src/features/user/avatarCatalog';

type BuiltinAvatar = (typeof USER_AVATARS)[number];

interface ThemeSpec {
  id: string;
  label: string;
  selector: string;
}

interface Theme extends ThemeSpec {
  tokens: Record<string, string>;
}

const ROOT = process.cwd();
const CSS_PATH = path.join(ROOT, 'src', 'index.css');
const OUT_DIR = path.join(ROOT, '.commander');
const OUT_FILE = path.join(OUT_DIR, 'avatar-audit.html');

const THEME_SPECS: ThemeSpec[] = [
  { id: 'norton', label: 'Norton Retro', selector: ':root' },
  { id: 'matrix', label: 'Matrix Green', selector: '.theme-matrix' },
  { id: 'amber', label: 'Amber Terminal', selector: '.theme-amber' },
  { id: 'dos', label: 'DOS Retro', selector: '.theme-dos' },
  { id: 'light', label: 'Claro (papel)', selector: '.theme-light' },
  { id: 'solarized', label: 'Solarizado (oscuro)', selector: '.theme-solarized' },
];

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readThemeBlock(css: string, selector: string): Record<string, string> {
  const match = new RegExp(`${escapeRegExp(selector)}\\s*\\{([\\s\\S]*?)\\}`).exec(css);
  if (!match) throw new Error(`[avatars:audit] no se encontró ${selector} en ${CSS_PATH}`);

  const tokens: Record<string, string> = {};
  for (const declaration of match[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens[declaration[1]] = declaration[2].trim();
  }
  return tokens;
}

function themeCss(themes: Theme[]): string {
  return themes
    .map((theme) => {
      const declarations = Object.entries(theme.tokens)
        .filter(([name]) => name.startsWith('--nc-'))
        .map(([name, value]) => `  ${name}: ${value};`)
        .join('\n');
      return `.audit-theme-${theme.id} {\n${declarations}\n}`;
    })
    .join('\n\n');
}

function renderSymbol(avatar: BuiltinAvatar): string {
  const pixels = getAvatarPixels(avatar)
    .map(
      ({ x, y, color }) =>
        `<rect x="${x}" y="${y}" width="1" height="1" fill="${escapeHtml(color)}" />`
    )
    .join('');

  return `<symbol id="avatar-symbol-${escapeHtml(avatar.id)}" viewBox="${AVATAR_VIEWBOX}" shape-rendering="crispEdges">${pixels}</symbol>`;
}

function renderCell(
  avatar: BuiltinAvatar,
  size: number,
  zoom = 1,
  grayscale = false
): string {
  const rendered = size * zoom;
  const description = `${avatar.label.es} · ${size} px${zoom > 1 ? ` ×${zoom}` : ''}${
    grayscale ? ' · escala de grises' : ''
  }`;

  return `<div class="cell${grayscale ? ' is-gray' : ''}" data-avatar-id="${escapeHtml(
    avatar.id
  )}" data-size="${size}" data-zoom="${zoom}" data-grayscale="${grayscale}" title="${escapeHtml(
    description
  )}"><svg viewBox="${AVATAR_VIEWBOX}" width="${rendered}" height="${rendered}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><use href="#avatar-symbol-${escapeHtml(
    avatar.id
  )}"></use></svg></div>`;
}

const MATRIX_HEADER = `<div class="matrix-row head">
  <div class="name">Avatar</div>
  <div>18 px</div>
  <div>32 px</div>
  <div>40 px</div>
  <div>18 px ×8</div>
  <div>40 px ×3</div>
  <div>18 gris</div>
  <div>32 gris</div>
  <div>40 gris</div>
</div>`;

function renderAvatarRow(avatar: BuiltinAvatar): string {
  return `<div class="matrix-row">
  <div class="name"><strong>${escapeHtml(avatar.label.es)}</strong><code>${escapeHtml(
    avatar.id
  )}</code></div>
  ${renderCell(avatar, 18)}
  ${renderCell(avatar, 32)}
  ${renderCell(avatar, 40)}
  ${renderCell(avatar, 18, 8)}
  ${renderCell(avatar, 40, 3)}
  ${renderCell(avatar, 18, 1, true)}
  ${renderCell(avatar, 32, 1, true)}
  ${renderCell(avatar, 40, 1, true)}
</div>`;
}

const themes: Theme[] = (() => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const rootTokens = readThemeBlock(css, ':root');

  return THEME_SPECS.map((spec) => {
    const tokens =
      spec.selector === ':root'
        ? rootTokens
        : { ...rootTokens, ...readThemeBlock(css, spec.selector) };
    return { ...spec, tokens };
  });
})();

const sprite = `<svg class="avatar-sprite" aria-hidden="true" focusable="false" width="0" height="0">${USER_AVATARS.map(
  renderSymbol
).join('')}</svg>`;

const avatarRows = USER_AVATARS.map(renderAvatarRow).join('\n');

const themeTabs = [
  ...THEME_SPECS.map(
    (theme) =>
      `<button type="button" class="theme-tab" data-theme-tab="${theme.id}" aria-pressed="false">${escapeHtml(
        theme.label
      )}</button>`
  ),
  '<button type="button" class="theme-tab" data-theme-tab="all" aria-pressed="false">Todos los temas</button>',
].join('\n');

const themeSections = themes
  .map(
    (theme) => `<section class="theme-section audit-theme-${theme.id}" data-theme-panel="${
      theme.id
    }" aria-labelledby="theme-${theme.id}">
  <div class="section-head">
    <div>
      <h2 id="theme-${theme.id}">${escapeHtml(theme.label)}</h2>
      <p class="theme-note">Tokens de <code>src/index.css</code> · fondo ${escapeHtml(
        theme.tokens['--nc-bg-main'] ?? 'desconocido'
      )}</p>
    </div>
    <span class="theme-swatch" aria-hidden="true"><i style="background:${escapeHtml(
      theme.tokens['--nc-bg-panel'] ?? 'transparent'
    )}"></i><i style="background:${escapeHtml(
      theme.tokens['--nc-text-accent'] ?? 'transparent'
    )}"></i></span>
  </div>
  <div class="matrix">
    ${MATRIX_HEADER}
    ${avatarRows}
  </div>
</section>`
  )
  .join('\n');

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Auditoría visual de avatares · Commander AI Studio</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body {
  margin: 0;
  padding: 28px;
  background: #0b0b0b;
  color: #e8e8e8;
  font-family: "JetBrains Mono", "Cascadia Mono", "Courier New", monospace;
}
.page { max-width: 1500px; margin: 0 auto; }
.eyebrow {
  margin: 0 0 8px;
  color: #ffff55;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
h1 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.4rem); line-height: 1.1; }
h2 { margin: 0; color: var(--nc-text-accent); font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; }
.lead { max-width: 980px; margin: 12px 0 0; color: #c8c8c8; font-size: 13px; line-height: 1.65; }
.lead code, .theme-note code, .page-foot code { color: #ffffaa; }
.howto { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; margin: 22px 0; }
.howto p { margin: 0; padding: 10px 12px; border: 1px solid #333; background: #151515; color: #cfcfcf; font-size: 11px; line-height: 1.55; }
.howto strong { color: #ffff55; }
.theme-picker { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 14px; padding: 10px 0; background: #0b0b0b; border-bottom: 1px solid #333; }
.theme-picker > span { margin-right: 4px; color: #888; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; }
.theme-tab { padding: 5px 9px; border: 1px solid #555; background: #171717; color: #ddd; font: inherit; font-size: 10px; cursor: pointer; }
.theme-tab:hover { background: #292929; }
.theme-tab.is-active { border-color: #ffff55; background: #ffff55; color: #111; font-weight: 700; }
.theme-section { margin: 0 0 24px; padding: 12px; border: 2px solid var(--nc-border-dark); background: var(--nc-bg-main); color: var(--nc-text); overflow-x: auto; }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid var(--nc-border-dark); }
.theme-note { margin: 5px 0 0; color: var(--nc-text-dim); font-size: 9px; }
.theme-swatch { display: inline-flex; gap: 4px; padding-top: 3px; }
.theme-swatch i { display: block; width: 16px; height: 16px; border: 1px solid var(--nc-border-light); }
.matrix { width: max-content; min-width: 968px; }
.matrix-row { display: grid; grid-template-columns: 180px 52px 52px 52px 152px 128px 52px 52px 52px; gap: 4px 12px; align-items: center; padding: 6px 0; border-top: 1px solid var(--nc-border-dark); }
.matrix-row.head { padding-top: 0; border-top: 0; color: var(--nc-text-dim); font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; }
.matrix-row.head > div { text-align: center; white-space: nowrap; }
.matrix-row.head .name { text-align: left; }
.matrix-row.head .name { text-align: left; }
.name { display: flex; flex-direction: column; gap: 2px; justify-self: start; font-size: 11px; line-height: 1.2; }
.name code { color: var(--nc-text-dim); font-size: 9px; }
.cell { display: flex; align-items: center; justify-content: center; justify-self: center; min-height: 152px; }
.cell svg { display: block; image-rendering: pixelated; }
.cell.is-gray svg { filter: grayscale(1); }
.avatar-sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
.page-foot { margin: 28px 0 8px; padding-top: 12px; border-top: 1px solid #333; color: #888; font-size: 10px; line-height: 1.6; }
@media (max-width: 760px) {
  body { padding: 14px; }
  .theme-section { padding: 8px; }
  .matrix { min-width: 968px; }
}
@media print {
  body { padding: 0; background: #fff; color: #000; }
  .theme-picker, .howto { display: none; }
  .theme-section { break-inside: avoid; }
  .theme-section[hidden] { display: block !important; }
}
${themeCss(themes)}
</style>
</head>
<body data-audit="avatars">
${sprite}
<main class="page">
  <header>
    <p class="eyebrow">Commander AI Studio / Avatares</p>
    <h1>Auditoría visual de avatares</h1>
    <p class="lead">Los 12 avatares integrados, a tamaños reales. Los SVG no llevan fondo: el fondo es el del tema. Esta página es una herramienta de revisión, no una pantalla de producción.</p>
  </header>
  <div class="howto">
    <p><strong>18 px es el objetivo.</strong> Compara cada avatar con su ampliación 18&nbsp;px&nbsp;×8; si un rasgo no aparece en el zoom, no existe en los datos.</p>
    <p><strong>Busca ojos, nariz/boca y orejas.</strong> La ampliación es nearest-neighbor: cada celda del zoom mide 12&nbsp;px y no hay interpolación.</p>
    <p><strong>Gris y tema claro.</strong> La escala de grises revela dependencia del color; Claro (papel) es el caso más exigente para los avatares blancos.</p>
  </div>
  <nav class="theme-picker" aria-label="Temas de la auditoría">
    <span>Tema</span>
    ${themeTabs}
  </nav>
  ${themeSections}
  <footer class="page-foot">Generado por <code>npm run avatars:audit</code> desde <code>src/features/user/avatarCatalog.ts</code> · ${USER_AVATARS.length} avatares · ${THEME_SPECS.length} temas.</footer>
</main>
<script>
(() => {
  const tabs = Array.from(document.querySelectorAll('[data-theme-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-theme-panel]'));

  const select = (id) => {
    const all = id === 'all';
    for (const panel of panels) panel.hidden = !all && panel.dataset.themePanel !== id;
    for (const tab of tabs) {
      const active = tab.dataset.themeTab === id;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-pressed', String(active));
    }
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab.dataset.themeTab));
  }

  select('norton');
})();
</script>
</body>
</html>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html, 'utf8');
console.log(
  `[avatars:audit] ${USER_AVATARS.length} avatares × ${themes.length} temas → ${path.relative(
    ROOT,
    OUT_FILE
  )}`
);
console.log(`[avatars:audit] abre ${path.relative(ROOT, OUT_FILE)} en el navegador`);
