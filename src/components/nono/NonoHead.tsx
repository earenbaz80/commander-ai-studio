import React from 'react';
import type { NonoExpression } from './content';

/** Cabeza de Nono: ojos que miran al puntero, parpadeo, expresiones dinámicas - Estilo 3D mejorado */
export const NonoHead: React.FC<{
  expression: NonoExpression;
  eyeOffset: { x: number; y: number };
  blink: boolean;
  size?: number;
  show3D?: boolean;
  /** El chat o el agente están procesando: la pantalla muestra actividad. */
  busy?: boolean;
}> = ({ expression, eyeOffset, blink, size = 64, show3D = true, busy = false }) => {
  // Cabeza, ojos, boca y antena van con contorno blanco; el estado (error,
  // reposo, actividad) lo sigue avisando sólo el LED de la antena.
  const headStroke = '#ffffff';

  const pupilOffsetX = Math.max(-3, Math.min(3, eyeOffset.x * 0.5));
  const pupilOffsetY = Math.max(-2, Math.min(2, eyeOffset.y * 0.5));

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
    const strokeColor = '#ffffff';
    // 3D eye whites with gradient
    const eyeHighlight = show3D ? (
      <>
        <ellipse cx="17" cy="35" rx="1.5" ry="1" fill="#ffffff" opacity="0.3" />
        <ellipse cx="41" cy="35" rx="1.5" ry="1" fill="#ffffff" opacity="0.3" />
        <ellipse cx="16" cy="34" rx="0.8" ry="0.6" fill="#ffffff" opacity="0.5" />
        <ellipse cx="40" cy="34" rx="0.8" ry="0.6" fill="#ffffff" opacity="0.5" />
      </>
    ) : null;

    if (blink) {
      return (
        <>
          <line x1="14" y1="38" x2="26" y2="38" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.5))" />
          <line x1="38" y1="38" x2="50" y2="38" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.5))" />
        </>
      );
    }

    switch (expression) {
      case 'happy':
      case 'love':
        return (
          <>
            {eyeHighlight}
            <path d="M14 38 Q20 32 26 38" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <path d="M38 38 Q44 32 50 38" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'sad':
        return (
          <>
            {eyeHighlight}
            <path d="M14 42 Q20 46 26 42" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <path d="M38 42 Q44 46 50 42" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
          </>
        );
      case 'surprised':
        return (
          <>
            {eyeHighlight}
            <circle cx="20" cy="38" r="6" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx="44" cy="38" r="6" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx={20 + pupilOffsetX} cy={38 + pupilOffsetY} r="3" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={44 + pupilOffsetX} cy={38 + pupilOffsetY} r="3" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={18 + pupilOffsetX} cy={36 + pupilOffsetY} r="0.8" fill="#ffffff" opacity="0.6" />
            <circle cx={42 + pupilOffsetX} cy={36 + pupilOffsetY} r="0.8" fill="#ffffff" opacity="0.6" />
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
            {eyeHighlight}
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
      case 'watch':
        return (
          <>
            {eyeHighlight}
            <circle cx="20" cy="38" r="5" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx="44" cy="38" r="5" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx={20 + pupilOffsetX} cy={38 + pupilOffsetY} r="3" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={44 + pupilOffsetX} cy={38 + pupilOffsetY} r="3" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={18 + pupilOffsetX} cy={36 + pupilOffsetY} r="0.8" fill="#ffffff" opacity="0.6" />
            <circle cx={42 + pupilOffsetX} cy={36 + pupilOffsetY} r="0.8" fill="#ffffff" opacity="0.6" />
          </>
        );
      case 'curious':
        return (
          <>
            {eyeHighlight}
            <circle cx={20 + pupilOffsetX * 1.5} cy={38 + pupilOffsetY * 1.5} r="7" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx={44 + pupilOffsetX * 1.5} cy={38 + pupilOffsetY * 1.5} r="7" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx={20 + pupilOffsetX * 2} cy={38 + pupilOffsetY * 2} r="3.5" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={44 + pupilOffsetX * 2} cy={38 + pupilOffsetY * 2} r="3.5" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={17 + pupilOffsetX * 2} cy={35 + pupilOffsetY * 2} r="1" fill="#ffffff" opacity="0.8" />
            <circle cx={41 + pupilOffsetX * 2} cy={35 + pupilOffsetY * 2} r="1" fill="#ffffff" opacity="0.8" />
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
      default: // neutral - ojos que miran al puntero
        return (
          <>
            {eyeHighlight}
            <circle cx="20" cy="38" r="6" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx="44" cy="38" r="6" fill={show3D ? 'url(#nonoEyeWhite)' : 'none'} stroke={strokeColor} strokeWidth="2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.3))" />
            <circle cx={20 + pupilOffsetX} cy={38 + pupilOffsetY} r="3" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={44 + pupilOffsetX} cy={38 + pupilOffsetY} r="3" fill="#000000" filter="drop-shadow(0 1px 1px rgba(0,0,0,0.5))" />
            <circle cx={18 + pupilOffsetX} cy={36 + pupilOffsetY} r="0.8" fill="#ffffff" opacity="0.6" />
            <circle cx={42 + pupilOffsetX} cy={36 + pupilOffsetY} r="0.8" fill="#ffffff" opacity="0.6" />
          </>
        );
    }
  };

  const renderMouth = () => {
    // La boca acompaña a los ojos: mismo contorno blanco en todas las expresiones.
    const strokeColor = '#ffffff';
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
      case 'watch':
        return <path d="M26 54 Q32 52 38 54" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />;
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

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} data-expression={expression} data-blink={blink ? 'true' : 'false'}>
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
      {/* Proceso: un anillo y un arco que giran dentro de la pantalla, sin
          mover el cuerpo entero. */}
      {busy && (
        <g className="nono-face-process" data-testid="nono-face-process" aria-hidden="true">
          <circle
            cx="32"
            cy="36"
            r="18"
            fill="none"
            stroke="#00ffff"
            strokeWidth="1.4"
            strokeDasharray="5 10"
            strokeLinecap="round"
            opacity="0.9"
            filter="drop-shadow(0 0 3px rgba(0,255,255,0.8))"
          />
          <path
            d="M32 18 A18 18 0 0 1 49.5 28"
            fill="none"
            stroke="#ffff55"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.9"
          />
        </g>
      )}
      {/* Antena */}
      <line x1="32" y1="12" x2="32" y2="6" stroke={headStroke} strokeWidth="2.5" strokeLinecap="round" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))" />
      {/* LED de la antena: único parpadeo de Nono (halo + núcleo) */}
      <g className="nono-antenna-led" data-led={ledState}>
        <circle cx="32" cy="5" r="6" fill={antennaColor} opacity="0.25" className="nono-led-halo" filter="drop-shadow(0 0 8px currentColor)" />
        <circle cx="32" cy="5" r="3" fill={antennaColor} className="nono-led-core" filter="drop-shadow(0 0 4px currentColor)" />
      </g>
      {/* Ojos */}
      {renderEyes()}
      {/* Boca */}
      {renderMouth()}
      {/* Mejillas */}
      {(expression === 'happy' || expression === 'love') && (
        <>
          <circle cx="14" cy="48" r="3" fill="#ff5555" opacity="0.3" filter="drop-shadow(0 1px 2px rgba(255,0,0,0.3))" />
          <circle cx="50" cy="48" r="3" fill="#ff5555" opacity="0.3" filter="drop-shadow(0 1px 2px rgba(255,0,0,0.3))" />
        </>
      )}
    </svg>
  );
};