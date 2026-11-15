/**
 * Tests de regresión visual de Nono (asistente flotante).
 * La variante clásica es una cara SVG pura: cada expresión cambia sólo los ojos.
 * El orbe y la variante de solo ojos conservan su propia geometría.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { NonoHead, type NonoExpression } from '../src/components/FloatingAssistant';
import { loadNonoPosition, saveNonoPosition, clearNonoPosition, type NonoPosition } from '../src/utils/nonoStorage';
import { readNonoMemory, NONO_MEMORY_KEY } from '../src/features/nono/nonoMemoryStore';

// Mock mínimo de localStorage para Node
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

const renderClassic = (
  expression: NonoExpression = 'neutral',
  options: { blink?: boolean; busy?: boolean; eyeOffset?: { x: number; y: number }; idleGaze?: boolean } = {}
) =>
  renderToStaticMarkup(
    <NonoHead
      expression={expression}
      eyeOffset={options.eyeOffset ?? { x: 0, y: 0 }}
      blink={options.blink ?? false}
      busy={options.busy ?? false}
      idleGaze={options.idleGaze ?? false}
      size={64}
    />
  );

const renderOrb = (
  expression: NonoExpression = 'neutral',
  options: { blink?: boolean; busy?: boolean; eyeOffset?: { x: number; y: number }; idleGaze?: boolean } = {}
) =>
  renderToStaticMarkup(
    <NonoHead
      variant="orb"
      expression={expression}
      eyeOffset={options.eyeOffset ?? { x: 0, y: 0 }}
      blink={options.blink ?? false}
      busy={options.busy ?? false}
      idleGaze={options.idleGaze ?? false}
      size={64}
    />
  );

/** Extrae el grupo que desplaza los ojos del orbe con el puntero. */
const orbGazeOf = (markup: string) => {
  const tag = /<g[^>]*data-testid="nono-orb-gaze"[^>]*>/.exec(markup)?.[0] ?? '';
  const style = /style="([^"]*)"/.exec(tag)?.[1] ?? '';
  const match = /transform:\s*translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(style);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
};

test('NonoHead clásico: usa una cara SVG pura sin gif', () => {
  const markup = renderClassic();

  assert.ok(markup.includes('data-testid="nono-classic-face"'), 'Debe dibujar la cara clásica en SVG');
  assert.ok(markup.includes('data-testid="nono-bothead"'), 'Debe marcar el contenedor del bot');
  assert.ok(markup.includes('data-variant="classic"'), 'Debe conservar la variante clásica');
  assert.ok(markup.includes('viewBox="0 0 64 64"'), 'Debe usar el lienzo propio de la cara');
  assert.ok(markup.includes('data-testid="nono-classic-brackets"'), 'Debe dibujar los corchetes del GIF');
  assert.ok(markup.includes('data-testid="nono-classic-eyes"'), 'Debe dibujar los ojos');
  assert.ok(!markup.includes('nono-classic-mouth'), 'No debe dibujar boca');
  assert.ok(!markup.includes('data-mouth-style'), 'No debe haber estilos de boca');
  // Coordenadas medidas sobre el fotograma del GIF: dos puntos circulares
  // separados y centrados entre los corchetes.
  assert.ok(markup.includes('cx="22.4" cy="31.8" r="3.5"'), 'El ojo izquierdo debe ocupar su posición del GIF');
  assert.ok(markup.includes('cx="41.5" cy="31.8" r="3.5"'), 'El ojo derecho debe ocupar su posición del GIF');
  assert.ok(!markup.includes('bothead2.gif'), 'No debe cargar el gif antiguo');
  assert.ok(!markup.includes('<image'), 'No debe incrustar una imagen como cara');
  assert.ok(!markup.includes('feColorMatrix'), 'No debe depender del filtro de transparencia del gif');

  for (const stale of [
    '/nono-bothead.gif',
    '/nono-bothead.png',
    '/nono-faces/',
    'nono-antenna-led',
    'nono-expression-face',
    'nono-expression-overlay',
    'nono-bothead__expression-layer',
    'nono-bothead__scan',
  ]) {
    assert.ok(!markup.includes(stale), `No debe conservar la capa antigua ${stale}`);
  }
  assert.doesNotMatch(markup, /perspective\(|rotateX\(|rotateY\(|translate3d\(/);
});

test('NonoHead clásico: cada expresión cambia sólo los ojos', () => {
  const expressions = [
    'neutral',
    'happy',
    'love',
    'sad',
    'surprised',
    'angry',
    'wink',
    'sleepy',
    'thinking',
    'watch',
    'curious',
    'error',
    'cool',
  ] as const;
  const eyes = new Set<string>();

  for (const expression of expressions) {
    const markup = renderClassic(expression);
    assert.ok(markup.includes(`data-eye-style="${expression}"`), `${expression} debe tener ojos propios`);
    assert.ok(!markup.includes('data-mouth-style'), `${expression} no debe añadir boca`);
    const eyeMarkup =
      /<g[^>]*data-testid="nono-classic-eyes"[^>]*>([\s\S]*?)<\/g>/.exec(markup)?.[1] ?? '';
    assert.ok(eyeMarkup.length > 0, `${expression} debe dibujar sus ojos`);
    eyes.add(eyeMarkup);
  }

  assert.equal(eyes.size, expressions.length, 'Cada expresión debe tener ojos distintos');
});

test('NonoHead clásico: pensando y procesando muestran tres puntos', () => {
  for (const markup of [renderClassic('thinking'), renderClassic('neutral', { busy: true })]) {
    assert.ok(markup.includes('data-testid="nono-thinking-dots"'), 'Debe mostrar los puntos de proceso');
    assert.equal((markup.match(/class="nono-thinking-dot"/g) ?? []).length, 3, 'Deben ser tres puntos');
    assert.ok(markup.includes('data-eye-style="thinking"'));
    assert.ok(!markup.includes('data-mouth-style'), 'Los puntos no añaden boca');
  }

  assert.ok(!renderClassic('error', { busy: true }).includes('nono-thinking-dots'), 'El error no se tapa con puntos');
});

test('NonoHead clásico: microanimaciones de una sola vez por expresión', () => {
  const motions = [
    ['surprised', 'pop'],
    ['curious', 'tilt'],
    ['angry', 'squeeze'],
    ['error', 'shake'],
  ] as const;

  for (const [expression, motion] of motions) {
    const markup = renderClassic(expression);
    assert.ok(markup.includes(`data-eye-motion="${motion}"`), `${expression} debe usar ${motion}`);
    assert.ok(!markup.includes('data-mouth-style'), `${expression} no debe añadir boca`);
    assert.ok(!markup.includes('data-testid="nono-brow'), `${expression} no debe añadir cejas`);
    assert.ok(!markup.includes('data-testid="nono-pupil'), `${expression} no debe añadir pupilas`);
  }

  for (const expression of ['neutral', 'happy', 'love', 'sad', 'wink', 'sleepy', 'thinking', 'watch', 'cool'] as const) {
    assert.ok(!renderClassic(expression).includes('data-eye-motion'), `${expression} no tiene microanimación`);
  }

  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  for (const motion of motions) {
    assert.ok(
      css.includes(`[data-eye-motion='${motion[1]}']`),
      `El CSS debe definir ${motion[1]} una sola vez`
    );
  }
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-eye-motion\][\s\S]*?nono-classic-eye-emphasis/
  );
});

test('NonoHead clásico: error en rojo y enfadado con medias lunas', () => {
  const eyesOf = (markup: string) =>
    /<g[^>]*data-testid="nono-classic-eyes"[^>]*>([\s\S]*?)<\/g>/.exec(markup)?.[1] ?? '';

  const error = eyesOf(renderClassic('error'));
  assert.equal(
    (error.match(/stroke="var\(--nono-danger\)"/g) ?? []).length,
    4,
    'Las dos X deben usar el token de error'
  );
  // El token conserva el rojo del GIF: pasar de literal a token no cambia el color.
  const palette = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(palette, /--nono-danger:\s*#ff5555\b/i, 'El token de error debe ser rojo');

  const angry = eyesOf(renderClassic('angry'));
  assert.equal((angry.match(/<path/g) ?? []).length, 2, 'Cada ojo enfadado es una forma');
  assert.ok(angry.includes('Z'), 'Las medias lunas deben ser formas cerradas');
  assert.ok(!angry.includes('stroke='), 'Los ojos enfadados no deben ser simples rayas');

  const love = renderClassic('love');
  assert.ok(love.includes('class="nono-heart"'), 'El corazón izquierdo debe latir');
  assert.ok(love.includes('nono-heart-right'), 'El corazón derecho debe latir desfasado');
});

test('NonoHead clásico: el párpado conserva los ojos y no tapa error ni proceso', () => {
  const busy = renderClassic('thinking', { busy: true });
  const idle = renderClassic('neutral', { idleGaze: true });
  const blink = renderClassic('happy', { blink: true });
  const right = renderClassic('neutral', { eyeOffset: { x: 1, y: 1 } });

  assert.ok(busy.includes('nono-bothead--busy'));
  assert.ok(busy.includes('nono-bothead--thinking'));
  assert.ok(busy.includes('data-eye-style="thinking"'));
  assert.ok(!busy.includes('nono-face-process'));
  assert.ok(!busy.includes('nono-bothead__scan'));
  assert.ok(idle.includes('nono-bothead--idle'));

  // El párpado recorta los ojos de la expresión, no los sustituye por arcos.
  assert.ok(blink.includes('data-testid="nono-classic-eyelid"'), 'Debe dibujar el párpado');
  assert.ok(blink.includes('data-eyelid="true"'));
  assert.ok(blink.includes('data-eye-style="happy"'), 'La expresión sigue debajo del párpado');
  assert.ok(!blink.includes('data-eye-style="blink"'), 'No debe cambiar los ojos por arcos');
  assert.ok(blink.includes('M18.8 33 Q22.4 28.4 26 33'), 'Los ojos felices siguen dibujados');
  assert.ok(!blink.includes('data-mouth-style'), 'Parpadear no añade boca');

  const loveBlink = renderClassic('love', { blink: true });
  assert.ok(loveBlink.includes('nono-heart'), 'El corazón sigue presente durante el parpadeo');
  assert.ok(loveBlink.includes('nono-heart-right'), 'El segundo corazón sigue presente');

  const errorBlink = renderClassic('error', { blink: true });
  assert.ok(!errorBlink.includes('nono-classic-eyelid'), 'El error no parpadea');
  assert.equal(
    (errorBlink.match(/stroke="var\(--nono-danger\)"/g) ?? []).length,
    4,
    'Las X rojas siguen visibles'
  );

  const busyBlink = renderClassic('neutral', { blink: true, busy: true });
  assert.ok(busyBlink.includes('nono-thinking-dots'), 'Procesando siguen los puntos');
  assert.ok(!busyBlink.includes('nono-classic-eyelid'), 'Procesando no parpadea');

  assert.ok(
    !renderClassic('sleepy', { blink: true }).includes('nono-classic-eyelid'),
    'Dormido ya tiene los ojos cerrados'
  );
  assert.ok(right.includes('translate(1.8px, 1.2px)'), 'La mirada desplaza el grupo de ojos');
});

test('NonoHead orbe: la mirada se aplica a barras y curvas', () => {
  // El grupo de mirada envuelve todas las expresiones; con una de barras y
  // otra de curvas basta para detectar que no se vuelva a mover por expresión.
  for (const expression of ['neutral', 'happy'] as const) {
    const gaze = orbGazeOf(renderOrb(expression, { eyeOffset: { x: 1, y: 1 } }));
    assert.deepEqual(gaze, { x: 6, y: 4 }, `La expresión ${expression} debe seguir el puntero`);
  }
});

test('NonoHead orbe: en reposo centra la mirada y al procesar mira arriba', () => {
  const idle = orbGazeOf(renderOrb('happy', { eyeOffset: { x: 1, y: 1 }, idleGaze: true }));
  const busy = orbGazeOf(renderOrb('neutral', { busy: true, eyeOffset: { x: 1, y: 1 } }));
  const busyError = orbGazeOf(renderOrb('error', { busy: true, eyeOffset: { x: 1, y: 1 } }));

  assert.deepEqual(idle, { x: 0, y: 0 }, 'El barrido automático debe partir del centro');
  assert.deepEqual(busy, { x: 0, y: -3 }, 'Procesando mira hacia el chat');
  assert.deepEqual(busyError, { x: 6, y: 4 }, 'El error no oculta la mirada del puntero');
});

// ==================
// Tests de almacenamiento
// ==================

test('saveNonoPosition + loadNonoPosition roundtrip', () => {
  store.clear();
  const pos: NonoPosition = { x: 150, y: 300 };
  saveNonoPosition(pos);

  const loaded = loadNonoPosition();
  assert.deepStrictEqual(loaded, pos, 'Debe cargar la posición guardada');
});

test('loadNonoPosition devuelve null cuando no hay nada guardado', () => {
  store.clear();
  const loaded = loadNonoPosition();
  assert.strictEqual(loaded, null);
});

test('loadNonoPosition rechaza JSON corrupto', () => {
  store.clear();
  store.set('nono-position-v1', 'esto no es json válido');
  const loaded = loadNonoPosition();
  assert.strictEqual(loaded, null, 'Debe devolver null ante datos corruptos');
});

test('loadNonoPosition rechaza coordenadas no numéricas', () => {
  store.clear();
  store.set('nono-position-v1', JSON.stringify({ x: 'izquierda', y: 'abajo' }));
  const loaded = loadNonoPosition();
  assert.strictEqual(loaded, null);
});

test('clearNonoPosition elimina la posición guardada', () => {
  store.clear();
  saveNonoPosition({ x: 10, y: 20 });
  clearNonoPosition();
  const loaded = loadNonoPosition();
  assert.strictEqual(loaded, null, 'Tras limpiar no debe quedar posición');
});

test('readNonoMemory migra el antiguo color de antena a eyesColor', () => {
  store.clear();
  store.set(NONO_MEMORY_KEY, JSON.stringify({ ui: { classicAccent: '#ffcc00' } }));

  const memory = readNonoMemory();
  assert.equal(memory.ui.eyesColor, '#ffcc00', 'La variante Ojos conserva el color guardado');
  assert.ok(!('classicAccent' in memory.ui), 'El campo de la antena no debe sobrevivir en memoria');
});
