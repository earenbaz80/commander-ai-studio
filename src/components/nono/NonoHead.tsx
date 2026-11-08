import React from 'react';
import type { NonoExpression } from './content';
import { DEFAULT_ORB_COLORS, type NonoOrbColors } from '../../features/nono/orbPalette';

/** Matriz de binario que recorre la pantalla mientras Nono procesa. */
const BINARY_COLUMNS = [
  { x: 14, digits: '1011010110', color: '#ffffff', delay: '0s', duration: '1.2s' },
  { x: 25, digits: '0101101001', color: '#ffffff', delay: '-0.35s', duration: '1.6s' },
  { x: 36, digits: '1100101110', color: '#ffffff', delay: '-0.7s', duration: '1.35s' },
  { x: 47, digits: '0011010010', color: '#ffffff', delay: '-0.15s', duration: '1.5s' },
];

/** Corazón 24×24 para los ojos de `love`. */
const HEART_PATH =
  'M12 21s-7-4.35-9.33-8.28C.6 9.36 2.6 5 6.5 5c2.2 0 3.6 1.2 4.5 2.5C11.9 6.2 13.3 5 15.5 5c3.9 0 5.9 4.36 3.83 7.72C19 16.65 12 21 12 21z';

/** Cabeza de Nono: ojos que miran al puntero, parpadeo, expresiones dinámicas - Estilo 3D mejorado */
export const NonoHead: React.FC<{
  expression: NonoExpression;
  eyeOffset: { x: number; y: number };
  blink: boolean;
  size?: number;
  show3D?: boolean;
  /** El chat o el agente están procesando: la pantalla muestra actividad. */
  busy?: boolean;
  /** El orbe mira a los lados por su cuenta cuando el puntero está quieto. */
  idleGaze?: boolean;
  /**
   * Estilo visual. `classic` es la cabeza retro-Norton de siempre; `orb` es la
   * variante extra: esfera con degradado turquesa→verde y ojos de barra.
   */
  variant?: 'classic' | 'orb' | 'eyes';
  /** Colores del cuerpo y los ojos del orbe (por defecto, los del GIF). */
  orbColors?: Partial<NonoOrbColors>;
  /** Color de contorno, ojos y boca de la variante clásica. */
  classicAccent?: string;
}> = ({
  expression,
  eyeOffset,
  blink,
  size = 64,
  show3D = true,
  busy = false,
  idleGaze = false,
  variant = 'classic',
  orbColors,
  classicAccent = '#ffffff',
}) => {
  // IDs únicos por instancia: la vista previa de Configuración y la cabeza
  // flotante pueden convivir con paletas distintas sin pisarse los gradientes.
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const orbPalette = { ...DEFAULT_ORB_COLORS, ...orbColors };
  // Cabeza, ojos, boca y antena van con el acento elegido; el estado (error,
  // reposo, actividad) lo sigue avisando sólo el LED de la antena.
  const headStroke = classicAccent;

  // Los ojos clásicos son cuadrados y no tienen pupila: el bloque entero se
  // desplaza un poco para conservar el gesto de mirar al puntero.
  const eyeShiftX = Math.max(-3, Math.min(3, eyeOffset.x * 0.5));
  const eyeShiftY = Math.max(-2, Math.min(2, eyeOffset.y * 0.5));

  // LED de la antena: es el único indicador que parpadea en Nono.
  // · Activo → amarillo Norton. · Reposo (dormido) → verde. · Alerta/error → rojo.
  const ledAlert = expression === 'error' || expression === 'angry';
  const ledResting = expression === 'sleepy';
  const antennaColor = ledAlert ? '#ff5555' : ledResting ? '#00ff66' : '#ffff55';
  const ledState = ledAlert ? 'alert' : ledResting ? 'resting' : 'active';

  // Contorno de cabeza más fino: 1.5px en lugar de 2.5px para estilo más ligero
  const strokeWidth = 1.5;

  const renderEyes = () => {
    // Ojos con contorno blanco: resaltan sobre el azul del cuerpo. El trazo
    // heredado (cian/rojo) queda sólo para la antena, que sigue avisando del
    // estado con su LED.
    const strokeColor = classicAccent;
    // Ojos cuadrados, sin pupila: un bloque de luz por ojo. El bloque entero
    // se desplaza con el puntero para no perder el gesto de mirada.
    const squareEye = (cx: number, cy: number, side: number) => (
      <rect
        className={blink ? 'nono-eye-square nono-eye-shutter' : 'nono-eye-square'}
        x={cx + eyeShiftX - side / 2}
        y={cy + eyeShiftY - side / 2}
        width={side}
        height={side}
        rx="1"
        fill={show3D ? 'url(#nonoEyeWhite)' : 'none'}
        stroke={strokeColor}
        strokeWidth="2"
        filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))"
      />
    );

    // Los ojos cuadrados no se sustituyen por líneas: se recogen con la
    // animación de persiana. Las expresiones de trazo conservan su cierre rápido.
    const usesSquareEyes =
      expression === 'neutral' ||
      expression === 'surprised' ||
      expression === 'thinking' ||
      expression === 'watch' ||
      expression === 'curious';

    if (blink && !usesSquareEyes) {
      return (
        <>
          <line x1="14" y1="38" x2="26" y2="38" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.5))" />
          <line x1="38" y1="38" x2="50" y2="38" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.5))" />
        </>
      );
    }

    switch (expression) {
      case 'happy':
        return (
          <>
            <path d="M14 38 Q20 32 26 38" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <path d="M38 38 Q44 32 50 38" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'love':
        return (
          <>
            <g transform="translate(14 31) scale(0.5)">
              <path className="nono-heart" d={HEART_PATH} fill={strokeColor} filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            </g>
            <g transform="translate(38 31) scale(0.5)">
              <path className="nono-heart nono-heart-right" d={HEART_PATH} fill={strokeColor} filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            </g>
          </>
        );
      case 'sad':
        return (
          <>
            <path d="M14 42 Q20 46 26 42" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <path d="M38 42 Q44 46 50 42" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'surprised':
        return (
          <>
            {squareEye(20, 38, 10)}
            {squareEye(44, 38, 10)}
          </>
        );
      case 'angry':
        return (
          <>
            <line x1="14" y1="34" x2="26" y2="40" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <line x1="50" y1="34" x2="38" y2="40" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'wink':
        return (
          <>
            <line x1="14" y1="38" x2="26" y2="38" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <path d="M38 38 Q44 34 50 38" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'sleepy':
        return (
          <>
            <path d="M14 38 Q20 40 26 38" fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <path d="M38 38 Q44 40 50 38" fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'thinking':
        return (
          <>
            {squareEye(20, 38, 8)}
            {squareEye(44, 38, 8)}
          </>
        );
      case 'watch':
        // Ojos cuadrados grandes: está pendiente de lo que escribes.
        return (
          <>
            <g className="nono-watch-eyes">
              {squareEye(20, 38, 10)}
              {squareEye(44, 38, 10)}
            </g>
          </>
        );
      case 'curious':
        return (
          <>
            {squareEye(20, 38, 11)}
            {squareEye(44, 38, 8)}
          </>
        );
      case 'error':
        return (
          <>
            <line x1="14" y1="32" x2="26" y2="44" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <line x1="26" y1="32" x2="14" y2="44" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <line x1="38" y1="32" x2="50" y2="44" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <line x1="50" y1="32" x2="38" y2="44" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'cool':
        return (
          <>
            <rect x="12" y="34" width="16" height="10" rx="2" fill="#001a33" stroke={strokeColor} strokeWidth="1.5" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <rect x="36" y="34" width="16" height="10" rx="2" fill="#001a33" stroke={strokeColor} strokeWidth="1.5" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <line x1="28" y1="38" x2="36" y2="38" stroke={strokeColor} strokeWidth="1.5" />
          </>
        );
      default: // neutral - ojos cuadrados que siguen al puntero
        return (
          <>
            {squareEye(20, 38, 9)}
            {squareEye(44, 38, 9)}
          </>
        );
    }
  };

  const renderMouth = () => {
    // La boca acompaña a los ojos: mismo contorno blanco en todas las expresiones.
    const strokeColor = classicAccent;
    switch (expression) {
      case 'happy':
      case 'love':
        return <path d="M20 50 Q32 58 44 50" fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />;
      case 'sad':
        return <path d="M20 56 Q32 48 44 56" fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />;
      case 'surprised':
        return <ellipse cx="32" cy="52" rx="4" ry="5" fill="none" stroke={strokeColor} strokeWidth="2" />;
      case 'angry':
        return <path d="M22 54 L42 50" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />;
      case 'wink':
        return <path d="M22 52 Q32 56 42 52" fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />;
      case 'sleepy':
        return <line x1="24" y1="52" x2="40" y2="52" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />;
      case 'thinking':
        return <path d="M26 54 Q32 52 38 54" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />;
      case 'watch':
        return <line x1="27" y1="54" x2="37" y2="54" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />;
      case 'curious':
        return <ellipse cx="32" cy="52" rx="3" ry="4" fill="none" stroke={strokeColor} strokeWidth="2" />;
      case 'error':
        return <path d="M24 56 L40 50" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />;
      case 'cool':
        return <path d="M24 52 Q32 56 40 52" fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" />;
      default:
        return <line x1="24" y1="52" x2="40" y2="52" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />;
    }
  };

  if (variant === 'eyes') {
    // Variante «solo ojos»: dos rectángulos redondeados, sin cabeza, boca ni
    // antena. Cada expresión se resuelve con la geometría del rectángulo
    // (ancho, alto, inclinación y separación), sin curvas ni corazones.
    // Sin cabeza que ancle la mirada, el recorrido se amplía: ±7/±5 sobre el
    // viewBox de 64 se nota de verdad y sigue dejando los ojos dentro del lienzo.
    const dx = Math.max(-7, Math.min(7, eyeOffset.x * 7));
    const dy = Math.max(-5, Math.min(5, eyeOffset.y * 5));
    // El error es el único estado que cambia de color: rojo de alerta, el mismo
    // del LED de la antena clásica, para que se lea de un vistazo.
    const ink = expression === 'error' ? '#ff5555' : classicAccent;
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
          x={x - spec.w / 2 + dx}
          y={spec.y + dy}
          width={spec.w}
          height={spec.h}
          rx={spec.r ?? Math.min(3, spec.w / 3)}
          fill={ink}
          className={spec.className}
          transform={
            spec.tilt
              ? `rotate(${spec.side === 'left' ? -spec.tilt : spec.tilt} ${x + dx} ${spec.y + spec.h / 2 + dy})`
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
                    x={centerX[side] - 2 + dx}
                    y={23 + dy}
                    width={4}
                    height={18}
                    rx={1.5}
                    fill={ink}
                    transform={`rotate(${angle} ${centerX[side] + dx} ${32 + dy})`}
                  />
                )),
              )}
            </>
          );
        case 'cool':
          return (
            <>
              {both({ w: 16, h: 6, y: 28, r: 1.5 })}
              <rect data-eye="bridge" x={30 + dx} y={30.5 + dy} width={4} height={2} rx={1} fill={ink} />
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
        <g data-testid="nono-eyes" className={!busy && idleGaze ? 'nono-orb-gaze' : undefined}>
          {renderEyeRects()}
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
    // El orbe se dibuja a 36–48 px sobre un viewBox de 64: se amplía el
    // desplazamiento para que el seguimiento del puntero se note.
    const dx = busyLookingUp ? 0 : Math.max(-4, Math.min(4, eyeOffset.x * 4));
    const dy = busyLookingUp ? -3 : Math.max(-3, Math.min(3, eyeOffset.y * 3));
    const eye = orbPalette.eyes;
    const bar = (x: number) => (
      <rect x={x + dx} y={27.5 + dy} width="5" height="9" rx="2.5" fill={eye} />
    );
    const renderOrbEyes = () => {
      if (blink) {
        return (
          <>
            <rect x={22.5 + dx} y={31 + dy} width="5" height="2.5" rx="1.25" fill={eye} />
            <rect x={36.5 + dx} y={31 + dy} width="5" height="2.5" rx="1.25" fill={eye} />
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
              <circle cx={25 + dx} cy={32 + dy} r="3.4" fill={eye} />
              <circle cx={39 + dx} cy={32 + dy} r="3.4" fill={eye} />
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
              <rect x={20.5 + dx} y={29.5 + dy} width="9" height="5" rx="2.5" fill={eye} />
              <rect x={34.5 + dx} y={29.5 + dy} width="9" height="5" rx="2.5" fill={eye} />
            </>
          );
        case 'watch':
          // Círculos abiertos: sigue lo que escribes, no sólo piensa.
          return (
            <>
              <g className="nono-watch-eyes">
                <circle cx={24 + dx} cy={32 + dy} r="3.1" fill={eye} />
                <circle cx={38 + dx} cy={32 + dy} r="3.1" fill={eye} />
              </g>
            </>
          );
        case 'thinking':
          // Concentrado: barras más cortas, como entrecerrando los ojos.
          return (
            <>
              <rect x={22.5 + dx} y={29 + dy} width="5" height="6" rx="2.5" fill={eye} />
              <rect x={36.5 + dx} y={29 + dy} width="5" height="6" rx="2.5" fill={eye} />
            </>
          );
        case 'curious':
          // Un ojo más abierto que el otro: se nota que pregunta.
          return (
            <>
              <rect x={21.5 + dx} y={25.5 + dy} width="6" height="12" rx="3" fill={eye} />
              <rect x={37 + dx} y={28.5 + dy} width="5" height="8" rx="2.5" fill={eye} />
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
     * Cara de procesamiento: los ojos de barra miran arriba (hacia el chat) y
     * una sonrisa pequeña los acompaña. `nono-orb-affirm` deja que el ajuste
     * de Configuración decida si asiente; el componente no anima nada.
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
            <rect x={22.5 + dx} y={28 + dy} width="5" height="2.5" rx="1.25" fill={eye} />
            <rect x={36.5 + dx} y={28 + dy} width="5" height="2.5" rx="1.25" fill={eye} />
          </>
        ) : (
          <>
            {bar(22.5)}
            {bar(36.5)}
            <path
              d="M27 39 Q32 43 37 39"
              fill="none"
              stroke={eye}
              strokeWidth="2"
              strokeLinecap="round"
            />
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
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} data-variant="classic" data-expression={expression} data-blink={blink ? 'true' : 'false'}>
      <defs>
        {/* 3D radial gradient for body */}
        <radialGradient id="nonoBody" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#003355" />
          <stop offset="50%" stopColor="#002244" />
          <stop offset="100%" stopColor="#001122" />
        </radialGradient>
        {/* 3D eye white gradient */}
        <radialGradient id="nonoEyeWhite" cx="40%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#e8f4ff" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#cce8ff" stopOpacity="0.4" />
        </radialGradient>
        {/* 3D body highlight gradient */}
        <linearGradient id="nonoHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00ffff" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#00ffff" stopOpacity="0" />
        </linearGradient>
        {/* Scanlines del cristal: la cara se lee como una pantalla CRT. */}
        <pattern id="nonoScanlines" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="0.6" fill="#00ffff" opacity="0.1" />
        </pattern>
        {/* El binario se recorta a la pantalla: al desplazarse no invade la cara. */}
        <clipPath id="nonoScreenClip">
          <rect x="9" y="13" width="46" height="42" rx="11" />
        </clipPath>
        {/* Filtro de sombra vectorial para profundidad */}
        <filter id="nonoShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="3" dy="6" stdDeviation="4" floodColor="#000000" floodOpacity="0.4" />
          <feGaussianBlur stdDeviation="0.5" result="blur" />
        </filter>
        {/* Inner glow for 3D effect */}
        <filter id="nonoInnerGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Cabeza con sombra vectorial 3D */}
      <g filter="url(#nonoShadow)">
        {/* Tapones laterales: dos remates cortos, centrados en la carcasa. */}
        <g className="nono-side-caps" data-testid="nono-side-caps" aria-hidden="true">
          <rect className="nono-side-cap" x="3" y="29.5" width="7" height="9" rx="2" fill="url(#nonoBody)" stroke={headStroke} strokeWidth={strokeWidth} />
          <rect className="nono-side-cap" x="54" y="29.5" width="7" height="9" rx="2" fill="url(#nonoBody)" stroke={headStroke} strokeWidth={strokeWidth} />
          <line x1="5.5" y1="32" x2="5.5" y2="37" stroke={headStroke} strokeWidth="0.8" opacity="0.6" />
          <line x1="58.5" y1="32" x2="58.5" y2="37" stroke={headStroke} strokeWidth="0.8" opacity="0.6" />
        </g>
        <rect x="8" y="12" width="48" height="44" rx="12" fill="url(#nonoBody)" stroke={headStroke} strokeWidth={strokeWidth} />
        {/* Inner highlight for 3D depth */}
        <rect x="10" y="14" width="44" height="18" rx="10" fill="url(#nonoHighlight)" stroke="none" opacity="0.3" />
      </g>
      {/* La cara es la pantalla: marco interior y scanlines quedan por debajo
          de los ojos y la boca, que se leen como la imagen del CRT. */}
      <g className="nono-face-screen" data-nono-screen="true">
        <rect x="9" y="13" width="46" height="42" rx="11" fill="#001a33" opacity="0.35" />
        <rect x="9" y="13" width="46" height="42" rx="11" fill="url(#nonoScanlines)" />
        <rect x="9.5" y="13.5" width="45" height="41" rx="10.5" fill="none" stroke="#00ffff" strokeWidth="0.6" opacity="0.35" />
      </g>
      {/* Proceso: la pantalla sólo muestra columnas de binario. Los ojos y la
          boca se omiten para que la cara entera se lea como una máquina. */}
      {busy && (
        <g
          className="nono-face-process"
          data-testid="nono-face-process"
          aria-hidden="true"
          clipPath="url(#nonoScreenClip)"
        >
          {BINARY_COLUMNS.map((column) => (
            <g
              key={column.x}
              className="nono-binary-column"
              style={{ animationDelay: column.delay, animationDuration: column.duration }}
            >
              {column.digits.split('').map((digit, index) => (
                <text
                  key={`${column.x}-${index}`}
                  x={column.x}
                  y={15 + index * 9}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="nono-binary-digit"
                  fill={column.color}
                  fontSize="10.5"
                  fontFamily="'Courier New', monospace"
                  fontWeight="700"
                  opacity="1"
                >
                  {digit}
                </text>
              ))}
            </g>
          ))}
        </g>
      )}
      {/* Antena */}
      <line x1="32" y1="12" x2="32" y2="6" stroke={headStroke} strokeWidth="2.5" strokeLinecap="round" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
      {/* LED de la antena: único parpadeo de Nono (halo + núcleo) */}
      <g className="nono-antenna-led" data-led={ledState}>
        <circle cx="32" cy="5" r="6" fill={antennaColor} opacity="0.25" className="nono-led-halo" filter="drop-shadow(0 0 8px currentColor)" />
        <circle cx="32" cy="5" r="3" fill={antennaColor} className="nono-led-core" filter="drop-shadow(0 0 4px currentColor)" />
      </g>
      {/* Ojos y boca desaparecen mientras procesa: en la pantalla sólo queda
          el binario. */}
      {!busy && <g data-testid="nono-face-eyes">{renderEyes()}</g>}
      {!busy && <g data-testid="nono-face-mouth">{renderMouth()}</g>}
      {/* Mejillas */}
      {!busy && (expression === 'happy' || expression === 'love') && (
        <>
          <circle cx="14" cy="48" r="3" fill="#ff5555" opacity="0.3" filter="drop-shadow(0 1px 2px rgba(255,0,0,0.3))" />
          <circle cx="50" cy="48" r="3" fill="#ff5555" opacity="0.3" filter="drop-shadow(0 1px 2px rgba(255,0,0,0.3))" />
        </>
      )}
    </svg>
  );
};