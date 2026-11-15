import React from 'react';
import type { NonoExpression } from './content';

/** Corazón 24×24 para los ojos de `love`. */
const HEART_PATH =
  'M12 21s-7-4.35-9.33-8.28C.6 9.36 2.6 5 6.5 5c2.2 0 3.6 1.2 4.5 2.5C11.9 6.2 13.3 5 15.5 5c3.9 0 5.9 4.36 3.83 7.72C19 16.65 12 21 12 21z';

// Colores del GIF expuestos como tokens del tema (src/index.css, en
// `.nono-classic-face`): el SVG no repite literales y se pueden ajustar sin
// tocar el componente.
const INK = 'var(--nono-ink)';
const SHADOW = 'var(--nono-shadow)';
const HALO = 'var(--nono-halo)';
const PINK = 'var(--nono-pink)';
const DANGER = 'var(--nono-danger)';

/**
 * Corchetes medidos sobre el fotograma del GIF (132×76 px de cara).
 * Se escalan a un lienzo de 64 con la misma proporción: 52×30.
 */
const LEFT_BRACKET =
  'M15.5 17 H11.1 Q6 17 6 22.1 V41.45 Q6 46.55 11.1 46.55 H15.5 Q16.4 46.55 16.4 45.5 Q16.4 44.4 15.5 44.4 H13.5 Q11.1 44.4 11.1 42 V24.2 Q11.1 21.8 13.5 21.8 H15.5 Q16.4 21.8 16.4 19.4 Q16.4 17 15.5 17 Z';
const RIGHT_BRACKET =
  'M48.5 17 H52.9 Q58 17 58 22.1 V41.45 Q58 46.55 52.9 46.55 H48.5 Q47.6 46.55 47.6 45.5 Q47.6 44.4 48.5 44.4 H50.5 Q52.9 44.4 52.9 42 V24.2 Q52.9 21.8 50.5 21.8 H48.5 Q47.6 21.8 47.6 19.4 Q47.6 17 48.5 17 Z';

// Centros de los dos puntos del GIF, medidos en píxeles y escalados.
const EYES = { left: 22.4, right: 41.5, y: 31.8 } as const;
const EYE_R = 3.5;

/**
 * Cara clásica de Nono dibujada con SVG puro.
 *
 * Reproduce la silueta de `bothead2.gif`: dos corchetes y dos ojos. No tiene
 * boca, cejas ni pupilas. Cada expresión cambia únicamente la forma, el tamaño
 * o la inclinación de los ojos; pensando/procesando los sustituye por puntos
 * que aparecen en cadena. La mirada del puntero sólo desplaza los ojos.
 */
export const NonoClassicFace: React.FC<{
  expression: NonoExpression;
  eyeOffset: { x: number; y: number };
  blink: boolean;
  busy?: boolean;
}> = ({ expression, eyeOffset, blink, busy = false }) => {
  const dx = Math.max(-1.8, Math.min(1.8, eyeOffset.x * 1.8));
  const dy = Math.max(-1.2, Math.min(1.2, eyeOffset.y * 1.2));
  // Procesar manda sobre el parpadeo; el error sigue siendo error.
  const processing = expression !== 'error' && (busy || expression === 'thinking');
  // El parpadeo no cambia los ojos: baja un párpado de recorte sobre ellos.
  // Error, proceso y sueño no parpadean (el sueño ya tiene los ojos cerrados).
  const blinking = blink && !processing && expression !== 'error' && expression !== 'sleepy';
  const eyeStyle = processing ? 'thinking' : expression;
  // Animaciones de una sola vez; el cambio de expresión las reinicia.
  const eyeMotion =
    eyeStyle === 'surprised'
      ? 'pop'
      : eyeStyle === 'curious'
        ? 'tilt'
        : eyeStyle === 'angry'
          ? 'squeeze'
          : eyeStyle === 'error'
            ? 'shake'
            : undefined;
  const eyelidId = `nono-classic-eyelid-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const dot = (cx: number, cy: number = EYES.y, r = EYE_R) => (
    <circle cx={cx} cy={cy} r={r} fill={INK} />
  );

  const oval = (cx: number, cy: number, rx: number, ry: number) => (
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={INK} />
  );

  const renderEyes = () => {
    switch (eyeStyle) {
      case 'happy':
        return (
          <>
            <path
              d="M18.8 33 Q22.4 28.4 26 33"
              fill="none"
              stroke={INK}
              strokeWidth="1.9"
              strokeLinecap="round"
            />
            <path
              d="M37.9 33 Q41.5 28.4 45.1 33"
              fill="none"
              stroke={INK}
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </>
        );
      case 'love':
        return (
          <>
            <g transform="translate(18.8 28.2) scale(0.3)">
              <path className="nono-heart" d={HEART_PATH} fill={PINK} />
            </g>
            <g transform="translate(37.9 28.2) scale(0.3)">
              <path
                className="nono-heart nono-heart-right"
                d={HEART_PATH}
                fill={PINK}
                style={{ animationDelay: '0.12s' }}
              />
            </g>
          </>
        );
      case 'sad':
        return (
          <>
            <path d="M18.9 34.4 L26 30.8" stroke={INK} strokeWidth="2" strokeLinecap="round" />
            <path d="M45.1 34.4 L38 30.8" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          </>
        );
      case 'surprised':
        return (
          <>
            {dot(EYES.left, EYES.y, 4.2)}
            {dot(EYES.right, EYES.y, 4.2)}
          </>
        );
      case 'angry':
        // Medias lunas inclinadas hacia dentro: el borde superior recto y el
        // inferior curvo, para que se lean como ojos enfadados y no como rayas.
        return (
          <>
            <path d="M18.4 29.4 L26 31.8 Q22.2 35.2 18.4 29.4 Z" fill={INK} />
            <path d="M45.6 29.4 L38 31.8 Q41.8 35.2 45.6 29.4 Z" fill={INK} />
          </>
        );
      case 'wink':
        return (
          <>
            <path
              d="M18.9 31.4 Q22.4 35.1 25.9 31.4"
              fill="none"
              stroke={INK}
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            {dot(EYES.right)}
          </>
        );
      case 'sleepy':
        return (
          <>
            <path
              d="M19 31.8 Q22.4 34.6 25.8 31.8"
              fill="none"
              stroke={INK}
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M38.1 31.8 Q41.5 34.6 44.9 31.8"
              fill="none"
              stroke={INK}
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </>
        );
      case 'thinking':
        return (
          <g data-testid="nono-thinking-dots">
            {[26, 32, 38].map((cx) => (
              <circle key={cx} cx={cx} cy={EYES.y} r="2.4" fill={INK} className="nono-thinking-dot" />
            ))}
          </g>
        );
      case 'watch':
        return (
          <g className="nono-watch-eyes">
            {oval(EYES.left, EYES.y, 4, 2.7)}
            {oval(EYES.right, EYES.y, 4, 2.7)}
          </g>
        );
      case 'curious':
        return (
          <>
            {dot(EYES.left, 31.4, 4)}
            {dot(EYES.right, 32.2, 2.4)}
          </>
        );
      case 'error':
        return (
          <>
            <path d="M19.4 29.4 L25.4 34.2" stroke={DANGER} strokeWidth="2" strokeLinecap="round" />
            <path d="M19.4 34.2 L25.4 29.4" stroke={DANGER} strokeWidth="2" strokeLinecap="round" />
            <path d="M38.6 29.4 L44.6 34.2" stroke={DANGER} strokeWidth="2" strokeLinecap="round" />
            <path d="M38.6 34.2 L44.6 29.4" stroke={DANGER} strokeWidth="2" strokeLinecap="round" />
          </>
        );
      case 'cool':
        return (
          <>
            <path d="M18.8 30.8 Q22.4 31.4 26 30.8" stroke={INK} strokeWidth="3" strokeLinecap="round" />
            <path d="M37.9 30.8 Q41.5 31.4 45.1 30.8" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          </>
        );
      default:
        return (
          <>
            {dot(EYES.left)}
            {dot(EYES.right)}
          </>
        );
    }
  };

  return (
    <svg
      className="nono-bothead__svg nono-classic-face"
      viewBox="0 0 64 64"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      data-testid="nono-classic-face"
      data-eye-shape={eyeStyle}
      data-busy={busy ? 'true' : 'false'}
      data-eyelid={blinking ? 'true' : 'false'}
    >
      {blinking && (
        <defs>
          <clipPath id={eyelidId} data-testid="nono-classic-eyelid">
            {/* La rendija deja ver el borde inferior de los ojos actuales. */}
            <rect x="16.5" y="31.1" width="31" height="1.5" rx="0.75" />
          </clipPath>
        </defs>
      )}
      {/* Halo azul fijo bajo el borde, como el del GIF. */}
      <g fill={HALO} opacity="0.28" transform="translate(0.55 0.65)">
        <path d={LEFT_BRACKET} />
        <path d={RIGHT_BRACKET} />
      </g>
      <g
        fill={INK}
        stroke={SHADOW}
        strokeWidth="0.7"
        strokeLinejoin="round"
        data-testid="nono-classic-brackets"
      >
        <path d={LEFT_BRACKET} />
        <path d={RIGHT_BRACKET} />
      </g>

      <g
        className="nono-gaze-shift"
        clipPath={blinking ? `url(#${eyelidId})` : undefined}
        style={{ transform: `translate(${dx}px, ${dy}px)` }}
      >
        <g
          data-testid="nono-classic-eyes"
          data-eye-style={eyeStyle}
          data-eye-motion={eyeMotion}
          className={eyeMotion ? 'nono-classic-eye-motion' : undefined}
        >
          {renderEyes()}
        </g>
      </g>
    </svg>
  );
};
