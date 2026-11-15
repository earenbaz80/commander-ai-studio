import React from 'react';
import type { NonoExpression } from './content';
import { DEFAULT_ORB_COLORS, type NonoOrbColors } from '../../features/nono/orbPalette';
import { NonoClassicFace } from './NonoClassicFace';

/** Corazón 24×24 para los ojos de `love`. */
const HEART_PATH =
  'M12 21s-7-4.35-9.33-8.28C.6 9.36 2.6 5 6.5 5c2.2 0 3.6 1.2 4.5 2.5C11.9 6.2 13.3 5 15.5 5c3.9 0 5.9 4.36 3.83 7.72C19 16.65 12 21 12 21z';

/** Cabeza de Nono: cara SVG clásica, orbe o variante de solo ojos. */
export const NonoHead: React.FC<{
  expression: NonoExpression;
  eyeOffset: { x: number; y: number };
  blink: boolean;
  size?: number;
  /** El chat o el agente están procesando: la pantalla muestra actividad. */
  busy?: boolean;
  /** El orbe mira a los lados por su cuenta cuando el puntero está quieto. */
  idleGaze?: boolean;
  /**
   * Estilo visual. `classic` es la cara SVG con corchetes y ojos por expresión;
   * `orb` es la esfera con degradado turquesa→verde y ojos de barra; `eyes`
   * son dos rectángulos.
   */
  variant?: 'classic' | 'orb' | 'eyes';
  /** Colores del cuerpo y los ojos del orbe (por defecto, los del GIF). */
  orbColors?: Partial<NonoOrbColors>;
  /** Color de los ojos de la variante «Ojos». */
  eyesColor?: string;
}> = ({
  expression,
  eyeOffset,
  blink,
  size = 64,
  busy = false,
  idleGaze = false,
  variant = 'classic',
  orbColors,
  eyesColor = '#ffffff',
}) => {
  // IDs únicos por instancia: la vista previa de Configuración y la cabeza
  // flotante pueden convivir con paletas distintas sin pisarse los gradientes.
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const orbPalette = { ...DEFAULT_ORB_COLORS, ...orbColors };
  if (variant === 'classic') {
    // La cara clásica es SVG puro: no hay GIF ni capa de accesorios. Cada
    // expresión dibuja únicamente sus propios ojos dentro de la cabeza.
    return (
      <span
        data-variant="classic"
        data-expression={expression}
        data-blink={blink ? 'true' : 'false'}
        data-testid="nono-bothead"
        className={`nono-bothead nono-bothead--${expression}${busy ? ' nono-bothead--busy' : ''}${idleGaze ? ' nono-bothead--idle' : ''}`}
        style={{
          width: size,
          height: size,
        } as React.CSSProperties}
      >
        <NonoClassicFace
          expression={expression}
          eyeOffset={eyeOffset}
          blink={blink}
          busy={busy}
        />
      </span>
    );
  }

  if (variant === 'eyes') {
    // Variante «solo ojos»: dos rectángulos redondeados, sin cabeza, boca ni
    // antena. Cada expresión se resuelve con la geometría del rectángulo
    // (ancho, alto, inclinación y separación), sin curvas ni corazones.
    // Sin cabeza que ancle la mirada, el recorrido se amplía: ±7/±5 sobre el
    // viewBox de 64 se nota de verdad y sigue dejando los ojos dentro del lienzo.
    const dx = idleGaze ? 0 : Math.max(-7, Math.min(7, eyeOffset.x * 7));
    const dy = idleGaze ? 0 : Math.max(-5, Math.min(5, eyeOffset.y * 5));
    // El error es el único estado que cambia de color: rojo de alerta para
    // que se lea de un vistazo.
    const ink = expression === 'error' ? '#ff5555' : eyesColor;
    const centerX = { left: 22, right: 42 } as const;

    interface EyeRect {
      side: 'left' | 'right';
      w: number;
      h: number;
      y: number;
      tilt?: number;
      r?: number;
      className?: string;
    }

    // `tilt` positivo sube los extremos interiores (alegría); negativo los
    // hunde (enfado, pena).
    const eye = (side: EyeRect['side'], spec: Omit<EyeRect, 'side'>): EyeRect => ({ side, ...spec });

    const paint = (spec: EyeRect, key: string) => {
      const x = centerX[spec.side];
      return (
        <rect
          key={key}
          data-eye={spec.side}
          x={x - spec.w / 2}
          y={spec.y}
          width={spec.w}
          height={spec.h}
          rx={spec.r ?? Math.min(3, spec.w / 3)}
          fill={ink}
          className={spec.className}
          transform={
            spec.tilt
              ? `rotate(${spec.side === 'left' ? -spec.tilt : spec.tilt} ${x} ${spec.y + spec.h / 2})`
              : undefined
          }
        />
      );
    };

    const both = (spec: Omit<EyeRect, 'side'>) => (
      <>
        {paint(eye('left', spec), 'left')}
        {paint(eye('right', spec), 'right')}
      </>
    );

    const renderEyeRects = () => {
      if (blink) return both({ w: 12, h: 3, y: 30.5 });
      if (busy) return both({ w: 14, h: 4, y: 30 });
      switch (expression) {
        case 'happy':
          return both({ w: 14, h: 7, y: 27, tilt: 10 });
        case 'love':
          return (
            <>
              {paint(eye('left', { w: 12, h: 16, y: 24, className: 'nono-heart' }), 'left')}
              {paint(eye('right', { w: 12, h: 16, y: 24, className: 'nono-heart nono-heart-right' }), 'right')}
            </>
          );
        case 'sad':
          return both({ w: 14, h: 7, y: 34, tilt: -10 });
        case 'surprised':
          return both({ w: 13, h: 24, y: 20 });
        case 'angry':
          return both({ w: 13, h: 9, y: 27, tilt: -18 });
        case 'wink':
          return (
            <>
              {paint(eye('left', { w: 12, h: 4, y: 30 }), 'left')}
              {paint(eye('right', { w: 12, h: 18, y: 23 }), 'right')}
            </>
          );
        case 'sleepy':
          return both({ w: 12, h: 4, y: 30 });
        case 'thinking':
          return (
            <>
              {paint(eye('left', { w: 11, h: 12, y: 25 }), 'left')}
              {paint(eye('right', { w: 10, h: 8, y: 28 }), 'right')}
            </>
          );
        case 'watch':
          return <g className="nono-watch-eyes">{both({ w: 13, h: 16, y: 24 })}</g>;
        case 'curious':
          return (
            <>
              {paint(eye('left', { w: 12, h: 20, y: 21 }), 'left')}
              {paint(eye('right', { w: 12, h: 12, y: 27 }), 'right')}
            </>
          );
        case 'error':
          return (
            <>
              {(['left', 'right'] as const).flatMap((side) =>
                [45, -45].map((angle) => (
                  <rect
                    key={`${side}-${angle}`}
                    data-eye={side}
                    x={centerX[side] - 2}
                    y={23}
                    width={4}
                    height={18}
                    rx={1.5}
                    fill={ink}
                    transform={`rotate(${angle} ${centerX[side]} 32)`}
                  />
                )),
              )}
            </>
          );
        case 'cool':
          return (
            <>
              {both({ w: 16, h: 6, y: 28, r: 1.5 })}
              <rect data-eye="bridge" x={30} y={30.5} width={4} height={2} rx={1} fill={ink} />
            </>
          );
        default:
          return both({ w: 12, h: 18, y: 23 });
      }
    };

    return (
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        data-variant="eyes"
        data-expression={expression}
        data-blink={blink ? 'true' : 'false'}
      >
        <g
          data-testid="nono-eyes-gaze"
          className="nono-gaze-shift"
          style={{ transform: `translate(${dx}px, ${dy}px)` }}
        >
          <g data-testid="nono-eyes" className={!busy && idleGaze ? 'nono-orb-gaze' : undefined}>
            {renderEyeRects()}
          </g>
        </g>
      </svg>
    );
  }

  if (variant === 'orb') {
    // Ojos de barra blanca como el GIF: se desplazan con el puntero, parpadean
    // y conservan las expresiones que ya usa el resto de la app.
    // Procesando, el orbe levanta la mirada hacia el chat y asiente; ya no
    // gira sobre su eje. Si algo falla, la expresión de error manda y se
    // recuperan los ojos normales (la cara feliz no tapa el fallo).
    const busyLookingUp = busy && expression !== 'error';
    // El orbe se dibuja a 36–48 px sobre un viewBox de 64: ±6/±4 hace visible
    // el seguimiento sin sacar los ojos de la esfera. En reposo vuelve al
    // centro; procesando mira arriba. El desplazamiento va en un único grupo
    // para que también sigan las expresiones dibujadas con curvas o corazones.
    const dx = busyLookingUp || idleGaze ? 0 : Math.max(-6, Math.min(6, eyeOffset.x * 6));
    const dy = busyLookingUp ? -3 : idleGaze ? 0 : Math.max(-4, Math.min(4, eyeOffset.y * 4));
    const eye = orbPalette.eyes;
    const bar = (x: number) => (
      <rect x={x} y={27.5} width="5" height="9" rx="2.5" fill={eye} />
    );
    const renderOrbEyes = () => {
      if (blink) {
        return (
          <>
            <rect x={22.5} y={31} width="5" height="2.5" rx="1.25" fill={eye} />
            <rect x={36.5} y={31} width="5" height="2.5" rx="1.25" fill={eye} />
          </>
        );
      }
      switch (expression) {
        case 'happy':
          return (
            <>
              <path d="M21.5 30 Q26 25.5 30.5 30" fill="none" stroke={eye} strokeWidth="2.6" strokeLinecap="round" />
              <path d="M33.5 30 Q38 25.5 42.5 30" fill="none" stroke={eye} strokeWidth="2.6" strokeLinecap="round" />
            </>
          );
        case 'love':
          return (
            <>
              <g transform="translate(19 25) scale(0.5)">
                <path className="nono-heart" d={HEART_PATH} fill={eye} />
              </g>
              <g transform="translate(33 25) scale(0.5)">
                <path className="nono-heart nono-heart-right" d={HEART_PATH} fill={eye} />
              </g>
            </>
          );
        case 'sad':
          return (
            <>
              <path d="M21.5 33 Q26 37.5 30.5 33" fill="none" stroke={eye} strokeWidth="2.6" strokeLinecap="round" />
              <path d="M33.5 33 Q38 37.5 42.5 33" fill="none" stroke={eye} strokeWidth="2.6" strokeLinecap="round" />
            </>
          );
        case 'angry':
          return (
            <>
              <line x1="21" y1="27" x2="30" y2="31.5" stroke={eye} strokeWidth="2.6" strokeLinecap="round" />
              <line x1="43" y1="27" x2="34" y2="31.5" stroke={eye} strokeWidth="2.6" strokeLinecap="round" />
            </>
          );
        case 'wink':
          return (
            <>
              {bar(22.5)}
              <path d="M33.5 30 Q38 26 42.5 30" fill="none" stroke={eye} strokeWidth="2.6" strokeLinecap="round" />
            </>
          );
        case 'sleepy':
          return (
            <>
              <line x1="21.5" y1="32" x2="30.5" y2="32" stroke={eye} strokeWidth="2.4" strokeLinecap="round" />
              <line x1="33.5" y1="32" x2="42.5" y2="32" stroke={eye} strokeWidth="2.4" strokeLinecap="round" />
            </>
          );
        case 'surprised':
          return (
            <>
              <circle cx={25} cy={32} r="3.4" fill={eye} />
              <circle cx={39} cy={32} r="3.4" fill={eye} />
            </>
          );
        case 'error':
          return (
            <>
              <line x1="21.5" y1="28" x2="29.5" y2="36" stroke={eye} strokeWidth="2.2" strokeLinecap="round" />
              <line x1="29.5" y1="28" x2="21.5" y2="36" stroke={eye} strokeWidth="2.2" strokeLinecap="round" />
              <line x1="34.5" y1="28" x2="42.5" y2="36" stroke={eye} strokeWidth="2.2" strokeLinecap="round" />
              <line x1="42.5" y1="28" x2="34.5" y2="36" stroke={eye} strokeWidth="2.2" strokeLinecap="round" />
            </>
          );
        case 'cool':
          return (
            <>
              <rect x={20.5} y={29.5} width="9" height="5" rx="2.5" fill={eye} />
              <rect x={34.5} y={29.5} width="9" height="5" rx="2.5" fill={eye} />
            </>
          );
        case 'watch':
          // Círculos abiertos: sigue lo que escribes, no sólo piensa.
          return (
            <>
              <g className="nono-watch-eyes">
                <circle cx={24} cy={32} r="3.1" fill={eye} />
                <circle cx={38} cy={32} r="3.1" fill={eye} />
              </g>
            </>
          );
        case 'thinking':
          // Concentrado: barras más cortas, como entrecerrando los ojos.
          return (
            <>
              <rect x={22.5} y={29} width="5" height="6" rx="2.5" fill={eye} />
              <rect x={36.5} y={29} width="5" height="6" rx="2.5" fill={eye} />
            </>
          );
        case 'curious':
          // Un ojo más abierto que el otro: se nota que pregunta.
          return (
            <>
              <rect x={21.5} y={25.5} width="6" height="12" rx="3" fill={eye} />
              <rect x={37} y={28.5} width="5" height="8" rx="2.5" fill={eye} />
            </>
          );
        default:
          return (
            <>
              {bar(22.5)}
              {bar(36.5)}
            </>
          );
      }
    };

    /**
     * Cara de procesamiento: los ojos de barra miran arriba (hacia el chat).
     * El orbe no dibuja boca en ninguna expresión ni estado.
     * `nono-orb-affirm` deja que el ajuste de Configuración decida si asiente;
     * el componente no anima nada.
     */
    const renderBusyFace = () => (
      <g
        data-testid="nono-orb-busy-face"
        data-look="up"
        className="nono-orb-affirm"
        aria-hidden="true"
      >
        {blink ? (
          <>
            <rect x={22.5} y={28} width="5" height="2.5" rx="1.25" fill={eye} />
            <rect x={36.5} y={28} width="5" height="2.5" rx="1.25" fill={eye} />
          </>
        ) : (
          <>
            {bar(22.5)}
            {bar(36.5)}
          </>
        )}
      </g>
    );

    return (
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        data-variant="orb"
        data-expression={expression}
        data-blink={blink ? 'true' : 'false'}
      >
        <defs>
          <linearGradient id={`nonoOrbBody-${uid}`} x1="18%" y1="8%" x2="82%" y2="95%">
            <stop offset="0%" stopColor={orbPalette.top} />
            <stop offset="55%" stopColor={orbPalette.mid} />
            <stop offset="100%" stopColor={orbPalette.bottom} />
          </linearGradient>
          <radialGradient id={`nonoOrbGloss-${uid}`} cx="34%" cy="20%" r="48%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <filter id={`nonoOrbHalo-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <circle cx="32" cy="32" r="23" fill={orbPalette.mid} opacity="0.3" filter={`url(#nonoOrbHalo-${uid})`} />
        <circle cx="32" cy="32" r="21" fill={`url(#nonoOrbBody-${uid})`} />
        <ellipse cx="25.5" cy="20.5" rx="10.5" ry="6" fill={`url(#nonoOrbGloss-${uid})`} />
        <circle cx="32" cy="32" r="21" fill="none" stroke={orbPalette.eyes} strokeOpacity="0.22" strokeWidth="0.8" />
        <g
          data-testid="nono-orb-gaze"
          className="nono-gaze-shift"
          style={{ transform: `translate(${dx}px, ${dy}px)` }}
        >
          {busyLookingUp ? (
            renderBusyFace()
          ) : (
            <g
              data-testid="nono-orb-eyes"
              className={!busy && idleGaze ? 'nono-orb-gaze' : undefined}
            >
              {renderOrbEyes()}
            </g>
          )}
        </g>
      </svg>
    );
  }

  return null;
};
