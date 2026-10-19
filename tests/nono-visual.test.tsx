/**
 * Tests de regresión visual de Nono (asistente flotante).
 * Verifica que las expresiones, pupilas y sombra vectorial se mantengan estables.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { NonoHead, type NonoExpression } from '../src/components/FloatingAssistant';
import { loadNonoPosition, saveNonoPosition, clearNonoPosition, type NonoPosition } from '../src/utils/nonoStorage';

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

// Helper para extraer los atributos cx de las pupilas negras
// React renderiza los elementos SVG con cierre </circle> (no self-closing)
const getPupilPositions = (markup: string): Array<{ cx: number; cy: number }> => {
  const pupils: Array<{ cx: number; cy: number }> = [];
  const circleRegex = /<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*fill="#000000"[^>]*><\/circle>/g;
  let match;
  while ((match = circleRegex.exec(markup)) !== null) {
    pupils.push({ cx: parseFloat(match[1]), cy: parseFloat(match[2]) });
  }
  return pupils;
};

test('NonoHead: renderiza con las expresiones correctas', () => {
  const expressions: NonoExpression[] = [
    'neutral', 'happy', 'sad', 'surprised', 'angry',
    'wink', 'sleepy', 'thinking', 'error', 'love', 'cool', 'watch'
  ];

  for (const exp of expressions) {
    const markup = renderToStaticMarkup(
      <NonoHead expression={exp} eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
    );
    assert.ok(markup.length > 0, `Expresión ${exp} no debe renderizarse vacía`);
    // Todas las expresiones deben contener al menos el contenedor SVG
    assert.ok(markup.includes('<svg'), `Expresión ${exp} debe contener svg root`);
  }
});

test('NonoHead: pupilas negras en las expresiones con ojos', () => {
  const pupilExpressions: NonoExpression[] = ['neutral', 'surprised', 'thinking', 'watch'];

  for (const exp of pupilExpressions) {
    const markup = renderToStaticMarkup(
      <NonoHead expression={exp} eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
    );
    const pupils = getPupilPositions(markup);
    assert.strictEqual(pupils.length, 2, `Expresión ${exp} debe tener 2 pupilas`);
    for (const p of pupils) {
      assert.ok(!isNaN(p.cx), `Pupila ${exp} debe tener cx numérico`);
      assert.ok(!isNaN(p.cy), `Pupila ${exp} debe tener cy numérico`);
    }
  }
});

test('NonoHead: pupilas se mueven horizontalmente con eyeOffset', () => {
  const center = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
  );
  const right = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 1, y: 0 }} blink={false} size={64} />
  );

  const pupilsCenter = getPupilPositions(center);
  const pupilsRight = getPupilPositions(right);

  assert.strictEqual(pupilsCenter.length, 2);
  assert.strictEqual(pupilsRight.length, 2);

  // Las pupilas deben moverse 1.5px a la derecha cuando eyeOffset.x = 1 (0.5 * 1.5? Revisar multiplier)
  // multiplier = 0.5 → 1 * 0.5 = 0.5; pero clamp permite max 3. Con 0.5 offset las pupilas se mueven 0.5px.
  // Verificamos que las posiciones cx cambien
  for (let i = 0; i < pupilsCenter.length; i++) {
    assert.ok(
      pupilsRight[i].cx !== pupilsCenter[i].cx,
      `Pupila ${i} debe moverse cuando eyeOffset.x cambia`
    );
  }
});

test('NonoHead: pupilas se mueven verticalmente con eyeOffset', () => {
  const top = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: -1 }} blink={false} size={64} />
  );
  const bottom = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 1 }} blink={false} size={64} />
  );

  const pupilsTop = getPupilPositions(top);
  const pupilsBottom = getPupilPositions(bottom);

  assert.strictEqual(pupilsTop.length, 2);
  assert.strictEqual(pupilsBottom.length, 2);

  for (let i = 0; i < pupilsTop.length; i++) {
    assert.ok(
      pupilsTop[i].cy < pupilsBottom[i].cy,
      `Pupila ${i} debe estar más arriba cuando eyeOffset.y es negativo`
    );
  }
});

test('NonoHead: incluye filtro de sombra vectorial feDropShadow', () => {
  const markup = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
  );
  assert.ok(markup.includes('feDropShadow'), 'Debe incluir el filtro de sombra SVG');
  assert.ok(markup.includes('nonoShadow'), 'Debe referenciar el filtro nonoShadow');
});

test('NonoHead: parpadeo cierra los ojos (sin pupilas)', () => {
  const blink = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={true} size={64} />
  );
  const pupils = getPupilPositions(blink);
  assert.strictEqual(pupils.length, 0, 'Al parpadear no debe haber pupilas visibles');
});

test('NonoHead: expresiones producen salidas distintas', () => {
  const happy = renderToStaticMarkup(
    <NonoHead expression="happy" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
  );
  const angry = renderToStaticMarkup(
    <NonoHead expression="angry" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
  );
  const error = renderToStaticMarkup(
    <NonoHead expression="error" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
  );

  assert.notStrictEqual(happy, angry, 'happy y angry deben renderizarse diferente');
  assert.notStrictEqual(happy, error, 'happy y error deben renderizarse diferente');
  assert.notStrictEqual(angry, error, 'angry y error deben renderizarse diferente');
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
