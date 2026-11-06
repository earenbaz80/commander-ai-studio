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

test('NonoHead: la cara es una pantalla y al procesar sólo muestra binario', () => {
  const idle = renderToStaticMarkup(
    <NonoHead expression="thinking" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
  );
  const busy = renderToStaticMarkup(
    <NonoHead expression="thinking" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} busy />
  );

  assert.ok(idle.includes('nono-face-screen'), 'La pantalla debe existir siempre');
  assert.ok(idle.includes('nonoScanlines'), 'La pantalla debe incluir scanlines');
  assert.ok(idle.includes('nono-face-eyes'), 'Sin proceso deben verse los ojos');
  assert.ok(idle.includes('nono-face-mouth'), 'Sin proceso debe verse la boca');
  assert.ok(!idle.includes('nono-face-process'), 'Sin proceso no debe haber binario');
  assert.ok(busy.includes('nono-face-process'), 'Con proceso debe aparecer la pantalla de trabajo');
  assert.ok(busy.includes('nono-binary-column'), 'El proceso debe mostrar columnas de binario');
  assert.ok(!busy.includes('nono-face-eyes'), 'Procesando no deben verse los ojos');
  assert.ok(!busy.includes('nono-face-mouth'), 'Procesando no debe verse la boca');
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

test('NonoHead: la variante orbe pinta esfera y ojos de barra', () => {
  const orb = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant="orb" />
  );

  assert.ok(orb.includes('data-variant="orb"'), 'Debe marcar la variante orbe');
  assert.ok(orb.includes('nonoOrbBody'), 'Debe usar el degradado turquesa→verde');
  assert.ok(orb.includes('nono-orb-eyes'), 'Debe incluir el grupo de ojos del orbe');
  assert.ok(!orb.includes('nono-antenna-led'), 'El orbe no lleva antena');

  const bars = orb.match(/<rect[^>]*rx="2.5"[^>]*fill="#ffffff"/g) || [];
  assert.ok(bars.length >= 2, `Debe haber dos ojos de barra: ${bars.length}`);
});

test('NonoHead: el orbe parpadea y cambia de expresión', () => {
  const open = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant="orb" />
  );
  const blink = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={true} size={64} variant="orb" />
  );
  const happy = renderToStaticMarkup(
    <NonoHead expression="happy" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant="orb" />
  );
  const angry = renderToStaticMarkup(
    <NonoHead expression="angry" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant="orb" />
  );

  assert.notStrictEqual(open, blink, 'Al parpadear los ojos deben cerrarse');
  assert.ok(blink.includes('height="2.5"'), 'El parpadeo usa barras finas');
  assert.notStrictEqual(happy, angry, 'Las expresiones deben cambiar los ojos');
});

test('NonoHead: la variante clásica sigue siendo el valor por defecto', () => {
  const classic = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
  );
  const orb = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant="orb" />
  );

  assert.ok(classic.includes('data-variant="classic"'));
  assert.ok(classic.includes('nono-antenna-led'), 'La clásica conserva su antena');
  assert.notStrictEqual(classic, orb);
});

test('NonoHead: acepta paletas y acento propios', () => {
  const orb = renderToStaticMarkup(
    <NonoHead
      expression="neutral"
      eyeOffset={{ x: 0, y: 0 }}
      blink={false}
      size={64}
      variant="orb"
      orbColors={{ top: '#112233', mid: '#445566', bottom: '#778899', eyes: '#abcdef' }}
    />
  );
  assert.ok(
    orb.includes('#112233') && orb.includes('#445566') && orb.includes('#778899'),
    'El degradado usa la paleta elegida'
  );
  assert.ok(orb.includes('#abcdef'), 'Los ojos usan el color elegido');

  const classic = renderToStaticMarkup(
    <NonoHead
      expression="neutral"
      eyeOffset={{ x: 0, y: 0 }}
      blink={false}
      size={64}
      classicAccent="#ffcc00"
    />
  );
  assert.ok(classic.includes('#ffcc00'), 'El clásico usa su acento');
});

test('NonoHead: el orbe distingue observación y curiosidad', () => {
  const render = (expression: 'neutral' | 'watch' | 'curious') =>
    renderToStaticMarkup(
      <NonoHead expression={expression} eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant="orb" />
    );

  const neutral = render('neutral');
  const watch = render('watch');
  const curious = render('curious');

  // Antes ambas expresiones caían en la cara neutral y el orbe parecía no mirar.
  assert.notStrictEqual(watch, neutral, 'watch debe cambiar los ojos del orbe');
  assert.notStrictEqual(curious, neutral, 'curious debe cambiar los ojos del orbe');
  assert.notStrictEqual(curious, watch, 'curious y watch deben ser distintos');
});

test('NonoHead: las 13 expresiones se ven distintas en ambas variantes', () => {
  const expressions = [
    'neutral',
    'happy',
    'sad',
    'surprised',
    'angry',
    'wink',
    'sleepy',
    'thinking',
    'error',
    'love',
    'cool',
    'watch',
    'curious',
  ] as const;

  for (const variant of ['classic', 'orb'] as const) {
    const rendered = expressions.map((expression) =>
      renderToStaticMarkup(
        <NonoHead
          expression={expression}
          eyeOffset={{ x: 0, y: 0 }}
          blink={false}
          size={64}
          variant={variant}
        />
      )
    );
    assert.strictEqual(
      new Set(rendered).size,
      expressions.length,
      `Las 13 expresiones deben tener cara propia en la variante ${variant}`
    );
  }
});

test('NonoHead: love y watch llevan su propia animación', () => {
  const render = (expression: 'love' | 'watch', variant: 'classic' | 'orb') =>
    renderToStaticMarkup(
      <NonoHead expression={expression} eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant={variant} />
    );

  for (const variant of ['classic', 'orb'] as const) {
    assert.ok(render('love', variant).includes('nono-heart'), `love late en ${variant}`);
    assert.ok(
      render('watch', variant).includes('nono-watch-eyes'),
      `watch parpadea en ${variant}`
    );
  }
});

test('NonoHead: el orbe mira a los lados en reposo', () => {
  const idle = renderToStaticMarkup(
    <NonoHead
      expression="neutral"
      eyeOffset={{ x: 0, y: 0 }}
      blink={false}
      size={64}
      variant="orb"
      idleGaze
    />
  );
  const active = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant="orb" />
  );

  assert.ok(idle.includes('nono-orb-gaze'), 'En reposo el orbe barre la mirada');
  assert.ok(!active.includes('nono-orb-gaze'), 'Con el puntero activo no se añade el barrido');
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
