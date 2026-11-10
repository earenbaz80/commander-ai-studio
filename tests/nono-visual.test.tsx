/**
 * Tests de regresión visual de Nono (asistente flotante).
 * Verifica que las expresiones, los ojos cuadrados, los tapones y la sombra
 * vectorial se mantengan estables.
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

/** Extrae la posición de los ojos cuadrados de la variante clásica. */
const getSquareEyePositions = (markup: string): Array<{ x: number; y: number }> => {
  const eyes: Array<{ x: number; y: number }> = [];
  for (const tag of markup.match(/<rect[^>]*class="nono-eye-square(?:\s[^"]*)?"[^>]*>/g) || []) {
    const x = /\bx="([\d.-]+)"/.exec(tag);
    const y = /\by="([\d.-]+)"/.exec(tag);
    if (x && y) eyes.push({ x: parseFloat(x[1]), y: parseFloat(y[1]) });
  }
  return eyes;
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

test('NonoHead: ojos cuadrados sin pupilas negras', () => {
  const squareEyeExpressions: NonoExpression[] = ['neutral', 'surprised', 'thinking', 'watch', 'curious'];

  for (const exp of squareEyeExpressions) {
    const markup = renderToStaticMarkup(
      <NonoHead expression={exp} eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
    );
    const eyes = getSquareEyePositions(markup);
    assert.strictEqual(eyes.length, 2, `Expresión ${exp} debe tener 2 ojos cuadrados`);
    assert.ok(!markup.includes('fill="#000000"'), `Expresión ${exp} no debe tener pupilas negras`);
  }
});

test('NonoHead: los ojos cuadrados se mueven horizontalmente', () => {
  const center = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
  );
  const right = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 1, y: 0 }} blink={false} size={64} />
  );

  const centerEyes = getSquareEyePositions(center);
  const rightEyes = getSquareEyePositions(right);

  assert.strictEqual(centerEyes.length, 2);
  assert.strictEqual(rightEyes.length, 2);
  for (let i = 0; i < centerEyes.length; i++) {
    assert.ok(
      rightEyes[i].x > centerEyes[i].x,
      `Ojo ${i} debe moverse a la derecha cuando eyeOffset.x cambia`
    );
  }
});

test('NonoHead: los ojos cuadrados se mueven verticalmente', () => {
  const top = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: -1 }} blink={false} size={64} />
  );
  const bottom = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 1 }} blink={false} size={64} />
  );

  const topEyes = getSquareEyePositions(top);
  const bottomEyes = getSquareEyePositions(bottom);

  assert.strictEqual(topEyes.length, 2);
  assert.strictEqual(bottomEyes.length, 2);
  for (let i = 0; i < topEyes.length; i++) {
    assert.ok(
      topEyes[i].y < bottomEyes[i].y,
      `Ojo ${i} debe estar más arriba cuando eyeOffset.y es negativo`
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

test('NonoHead: el parpadeo recoge los ojos cuadrados como una persiana', () => {
  const squareEyeExpressions: NonoExpression[] = ['neutral', 'surprised', 'thinking', 'watch', 'curious'];

  for (const exp of squareEyeExpressions) {
    const blink = renderToStaticMarkup(
      <NonoHead expression={exp} eyeOffset={{ x: 0, y: 0 }} blink={true} size={64} />
    );
    const shutterEyes = blink.match(/<rect[^>]*class="nono-eye-square nono-eye-shutter"[^>]*>/g) || [];
    assert.strictEqual(
      getSquareEyePositions(blink).length,
      2,
      `Al parpadear ${exp} debe conservar sus dos ojos cuadrados`
    );
    assert.strictEqual(
      shutterEyes.length,
      2,
      `Al parpadear ${exp} los ojos deben recogerse con la persiana`
    );
  }
});

test('NonoHead: las expresiones de trazo conservan el parpadeo de línea', () => {
  const blink = renderToStaticMarkup(
    <NonoHead expression="happy" eyeOffset={{ x: 0, y: 0 }} blink={true} size={64} />
  );

  assert.ok(!blink.includes('nono-eye-square'), 'Las expresiones de trazo no usan ojos cuadrados');
  assert.ok(
    blink.includes('x1="14" y1="38" x2="26" y2="38"'),
    'Las expresiones de trazo mantienen su cierre de línea'
  );
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

test('NonoHead: el orbe procesando mira arriba, asiente y no usa el binario del clásico', () => {
  const busy = renderToStaticMarkup(
    <NonoHead expression="thinking" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant="orb" busy />
  );
  const idle = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant="orb" />
  );
  const failed = renderToStaticMarkup(
    <NonoHead expression="error" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant="orb" busy />
  );

  assert.ok(busy.includes('nono-orb-busy-face'), 'Procesando debe pintar la cara satisfecha');
  assert.ok(busy.includes('data-look="up"'), 'La cara mira hacia el chat');
  assert.ok(busy.includes('nono-orb-affirm'), 'La cara puede asentir');
  assert.ok(!busy.includes('M27 39 Q32 43 37 39'), 'El orbe no debe mostrar boca');
  assert.ok(!busy.includes('nono-orb-processing'), 'Procesando ya no gira');
  assert.ok(!busy.includes('nono-orb-rotor'), 'No debe quedar el rotor');
  assert.ok(!busy.includes('nono-orb-latitudes'), 'No debe quedar la superficie 3D');
  assert.ok(!busy.includes('nono-orb-eyes'), 'La cara de proceso sustituye a los ojos normales');
  assert.ok(!busy.includes('nono-binary-column'), 'El orbe no usa la pantalla de binario');
  assert.ok(failed.includes('nono-orb-eyes'), 'Un error recupera los ojos del orbe');
  assert.ok(!failed.includes('nono-orb-busy-face'), 'Un error no muestra la cara satisfecha');
  assert.ok(!idle.includes('nono-orb-processing'), 'En reposo no hay rotor');
  assert.ok(!idle.includes('nono-orb-rotor'), 'En reposo no se pinta el rotor');
});

test('NonoHead: el orbe no dibuja boca en ninguna expresión', () => {
  const expressions: NonoExpression[] = [
    'neutral', 'happy', 'sad', 'surprised', 'angry',
    'wink', 'sleepy', 'thinking', 'error', 'love', 'cool', 'watch', 'curious',
  ];

  for (const expression of expressions) {
    for (const busy of [false, true]) {
      const markup = renderToStaticMarkup(
        <NonoHead
          expression={expression}
          eyeOffset={{ x: 0, y: 0 }}
          blink={false}
          size={64}
          variant="orb"
          busy={busy}
        />
      );
      assert.ok(
        !markup.includes('M27 39 Q32 43 37 39'),
        `El orbe no debe dibujar boca en ${expression}${busy ? ' (procesando)' : ''}`
      );
      assert.ok(
        !markup.includes('data-testid="nono-face-mouth"'),
        `El orbe no debe incluir la boca clásica en ${expression}${busy ? ' (procesando)' : ''}`
      );
    }
  }
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

test('NonoHead: la clásica lleva dos tapones laterales y el orbe no', () => {
  const classic = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
  );
  const orb = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant="orb" />
  );

  assert.ok(classic.includes('data-testid="nono-side-caps"'), 'La clásica debe tener tapones');
  assert.strictEqual(
    (classic.match(/class="nono-side-cap"/g) || []).length,
    2,
    'Debe haber un tapón a cada lado'
  );
  assert.ok(!orb.includes('nono-side-caps'), 'El orbe no lleva tapones');
});

test('NonoHead: los tapones laterales son cortos y quedan centrados', () => {
  const markup = renderToStaticMarkup(
    <NonoHead expression="neutral" eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} />
  );
  const caps = [...markup.matchAll(/<rect class="nono-side-cap"[^>]*>/g)].map(([tag]) => ({
    x: Number(/\bx="([\d.]+)"/.exec(tag)?.[1]),
    y: Number(/\by="([\d.]+)"/.exec(tag)?.[1]),
    width: Number(/\bwidth="([\d.]+)"/.exec(tag)?.[1]),
    height: Number(/\bheight="([\d.]+)"/.exec(tag)?.[1]),
  }));

  assert.strictEqual(caps.length, 2, 'Debe haber un tapón a cada lado');
  for (const cap of caps) {
    assert.strictEqual(cap.height, 9, 'Los tapones deben ser más cortos que la carcasa');
    assert.strictEqual(cap.y, 29.5, 'Los tapones deben quedar centrados verticalmente');
    assert.ok(cap.y >= 12 && cap.y + cap.height <= 56, 'Los tapones no deben salir de la cabeza');
  }

  const [left, right] = caps.sort((a, b) => a.x - b.x);
  assert.strictEqual(left.width, right.width, 'Los tapones deben medir lo mismo');
  assert.strictEqual(left.height, right.height, 'Los tapones deben medir lo mismo');
  assert.strictEqual(left.y, right.y, 'Los tapones deben estar a la misma altura');
  assert.strictEqual(64 - (right.x + right.width), left.x, 'Los tapones deben quedar simétricos');
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

test('NonoHead: ninguna variante dibuja cejas', () => {
  // Trayectos que dibujaban cejas en watch y curious. Ninguna expresión, en
  // ninguna variante, puede volver a incluirlos.
  const eyebrowPaths = [
    'M14 29 Q20 26.5 26 29',
    'M38 29 Q44 26.5 50 29',
    'M20.5 26.5 Q24 24.5 27.5 26.5',
    'M34.5 26.5 Q38 24.5 41.5 26.5',
    'M34.5 22.5 Q38 20.5 42 21.5',
  ];
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
    for (const expression of expressions) {
      const markup = renderToStaticMarkup(
        <NonoHead expression={expression} eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant={variant} />
      );
      for (const d of eyebrowPaths) {
        assert.ok(
          !markup.includes(d),
          `La expresión ${expression} (${variant}) volvió a dibujar una ceja: ${d}`
        );
      }
    }
  }

  // En watch y curious los ojos son círculos o barras; en la clásica la boca
  // es una línea o elipse. Cualquier <path> nuevo en esas caras sería una ceja.
  for (const variant of ['classic', 'orb'] as const) {
    for (const expression of ['watch', 'curious'] as const) {
      const markup = renderToStaticMarkup(
        <NonoHead expression={expression} eyeOffset={{ x: 0, y: 0 }} blink={false} size={64} variant={variant} />
      );
      assert.ok(
        !markup.includes('<path'),
        `La expresión ${expression} (${variant}) añadió un path: posible ceja`
      );
    }
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
