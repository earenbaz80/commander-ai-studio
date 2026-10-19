import React from 'react';

/**
 * AI Icon - Icono fijo de inteligencia artificial para el área de chat.
 * Representa un chip/circuito con conexiones neuronales.
 * Estética retro Norton (cyan/amarillo).
 */

export interface AIIconProps {
  size?: number;
  className?: string;
}

export const AIIcon: React.FC<AIIconProps> = ({
  size = 96,
  className = '',
}) => {
  return (
    <svg
      viewBox="0 0 96 96"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Inteligencia Artificial"
      style={{ overflow: 'visible' }}
    >
      <defs>
        {/* Gradiente del chip */}
        <linearGradient id="aiChip" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00243e" />
          <stop offset="50%" stopColor="#001a33" />
          <stop offset="100%" stopColor="#000d1a" />
        </linearGradient>

        {/* Gradiente del núcleo */}
        <radialGradient id="aiCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00ffff" />
          <stop offset="40%" stopColor="#0088cc" />
          <stop offset="100%" stopColor="#003355" />
        </radialGradient>

        {/* Gradiente de conexiones */}
        <linearGradient id="aiConn" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00ffff" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#00ffff" stopOpacity="0.2" />
        </linearGradient>

        {/* Gradiente de pines */}
        <linearGradient id="aiPin" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00ffff" />
          <stop offset="100%" stopColor="#004466" />
        </linearGradient>

        {/* Glow del núcleo */}
        <radialGradient id="aiGlow" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#00ffff" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#00ffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Glow de fondo */}
      <circle cx="48" cy="48" r="44" fill="url(#aiGlow)" opacity="0.3" />

      {/* Pines del chip - arriba */}
      {[28, 40, 52, 64, 76].map((x) => (
        <rect key={`pin-t-${x}`} x={x - 2} y={4} width={4} height={12} rx={1} fill="url(#aiPin)" />
      ))}
      {/* Pines del chip - abajo */}
      {[28, 40, 52, 64, 76].map((x) => (
        <rect key={`pin-b-${x}`} x={x - 2} y={80} width={4} height={12} rx={1} fill="url(#aiPin)" />
      ))}
      {/* Pines del chip - izquierda */}
      {[28, 40, 52, 64, 76].map((y) => (
        <rect key={`pin-l-${y}`} x={4} y={y - 2} width={12} height={4} rx={1} fill="url(#aiPin)" />
      ))}
      {/* Pines del chip - derecha */}
      {[28, 40, 52, 64, 76].map((y) => (
        <rect key={`pin-r-${y}`} x={80} y={y - 2} width={12} height={4} rx={1} fill="url(#aiPin)" />
      ))}

      {/* Cuerpo del chip */}
      <rect x="16" y="16" width="64" height="64" rx="8" fill="url(#aiChip)" stroke="#00ffff" strokeWidth="2" />

      {/* Circuitos internos */}
      <g stroke="#00ffff" strokeWidth="1" opacity="0.4" fill="none">
        {/* Conexiones horizontales */}
        <line x1="24" y1="32" x2="40" y2="32" />
        <line x1="56" y1="32" x2="72" y2="32" />
        <line x1="24" y1="48" x2="36" y2="48" />
        <line x1="60" y1="48" x2="72" y2="48" />
        <line x1="24" y1="64" x2="40" y2="64" />
        <line x1="56" y1="64" x2="72" y2="64" />
        {/* Conexiones verticales */}
        <line x1="32" y1="24" x2="32" y2="40" />
        <line x1="64" y1="24" x2="64" y2="40" />
        <line x1="32" y1="56" x2="32" y2="72" />
        <line x1="64" y1="56" x2="64" y2="72" />
        {/* Diagonales */}
        <line x1="24" y1="24" x2="36" y2="36" />
        <line x1="72" y1="24" x2="60" y2="36" />
        <line x1="24" y1="72" x2="36" y2="60" />
        <line x1="72" y1="72" x2="60" y2="60" />
      </g>

      {/* Núcleo central - "cerebro" de IA */}
      <circle cx="48" cy="48" r="16" fill="url(#aiCore)" stroke="#00ffff" strokeWidth="2" />

      {/* Neuronas dentro del núcleo */}
      <g>
        {/* Neurona central */}
        <circle cx="48" cy="48" r="4" fill="#ffffff" opacity="0.8" />
        {/* Neuronas conectadas */}
        <circle cx="40" cy="42" r="2.5" fill="#00ffff" opacity="0.7" />
        <circle cx="56" cy="42" r="2.5" fill="#00ffff" opacity="0.7" />
        <circle cx="40" cy="54" r="2.5" fill="#00ffff" opacity="0.7" />
        <circle cx="56" cy="54" r="2.5" fill="#00ffff" opacity="0.7" />
        <circle cx="48" cy="38" r="2" fill="#00ffff" opacity="0.6" />
        <circle cx="48" cy="58" r="2" fill="#00ffff" opacity="0.6" />
        {/* Conexiones neuronales */}
        <g stroke="#ffffff" strokeWidth="0.8" opacity="0.5">
          <line x1="48" y1="48" x2="40" y2="42" />
          <line x1="48" y1="48" x2="56" y2="42" />
          <line x1="48" y1="48" x2="40" y2="54" />
          <line x1="48" y1="48" x2="56" y2="54" />
          <line x1="48" y1="48" x2="48" y2="38" />
          <line x1="48" y1="48" x2="48" y2="58" />
        </g>
      </g>

      {/* Esquinas del chip */}
      <g fill="#00ffff" opacity="0.6">
        <circle cx="20" cy="20" r="2" />
        <circle cx="76" cy="20" r="2" />
        <circle cx="20" cy="76" r="2" />
        <circle cx="76" cy="76" r="2" />
      </g>

      {/* Texto IA */}
      <text
        x="48"
        y="88"
        fill="#00ffff"
        fontSize="10"
        fontFamily="monospace"
        textAnchor="middle"
        fontWeight="bold"
        opacity="0.8"
      >
        AI
      </text>
    </svg>
  );
};

export default AIIcon;