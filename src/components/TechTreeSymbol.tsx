import React, { useEffect, useState } from 'react';

/**
 * Tech Tree Symbol - Componente de árbol tecnológico/red neuronal con:
 * - Nodos que pulsan/conectan
 * - Animación de flujo de datos entre nodos
 * - Estado "trabajando" con flujo de datos acelerado
 * - Estética retro Norton (cyan/amarillo)
 */

export interface TechTreeSymbolProps {
  size?: number;
  className?: string;
  animated?: boolean;
  /** Si está procesando/ejecutando algo */
  isWorking?: boolean;
}

interface Node {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  connections: number[];
}

const NODES: Node[] = [
  // Nodo central
  { id: 0, x: 32, y: 16, size: 8, color: '#00ffff', connections: [1, 2, 3, 4] },
  // Nivel 1 - 4 nodos alrededor
  { id: 1, x: 12, y: 32, size: 6, color: '#00ccff', connections: [0, 5, 6] },
  { id: 2, x: 52, y: 32, size: 6, color: '#00ccff', connections: [0, 7, 8] },
  { id: 3, x: 20, y: 48, size: 5, color: '#0099cc', connections: [0, 9] },
  { id: 4, x: 44, y: 48, size: 5, color: '#0099cc', connections: [0, 10] },
  // Nivel 2 - nodos hoja
  { id: 5, x: 4, y: 44, size: 4, color: '#0088aa', connections: [1] },
  { id: 6, x: 16, y: 52, size: 4, color: '#0088aa', connections: [1] },
  { id: 7, x: 48, y: 52, size: 4, color: '#0088aa', connections: [2] },
  { id: 8, x: 60, y: 44, size: 4, color: '#0088aa', connections: [2] },
  { id: 9, x: 12, y: 60, size: 3, color: '#006688', connections: [3] },
  { id: 10, x: 52, y: 60, size: 3, color: '#006688', connections: [4] },
];

export const TechTreeSymbol: React.FC<TechTreeSymbolProps> = ({
  size = 64,
  className = '',
  animated = true,
  isWorking = false,
}) => {
  const [pulse, setPulse] = useState(0);
  const [dataFlow, setDataFlow] = useState<Record<number, number>>({});

  // Pulso del nodo central
  useEffect(() => {
    if (!animated) return;
    let timeout: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const loop = () => {
      timeout = setTimeout(() => {
        if (cancelled) return;
        setPulse((p) => (p + 1) % 100);
        loop();
      }, 2000 + Math.random() * 3000);
    };
    loop();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [animated]);

  // Flujo de datos cuando está trabajando
  useEffect(() => {
    if (isWorking && animated) {
      let frame = 0;
      const interval = setInterval(() => {
        frame = (frame + 1) % 100;
        const newFlow: Record<number, number> = {};
        // Flujo desde el centro hacia las hojas
        NODES.forEach((node) => {
          if (node.connections.length > 0) {
            node.connections.forEach((connId) => {
              newFlow[connId] = (frame + node.id * 10) % 100;
            });
          }
        });
        setDataFlow(newFlow);
      }, 50);
      return () => clearInterval(interval);
    } else {
      setDataFlow({});
    }
  }, [isWorking, animated]);

  return (
    <svg
      className={`tech-tree-symbol ${className}`}
      viewBox="0 0 64 72"
      width={size}
      height={(size * 72) / 64}
      role="img"
      aria-hidden="true"
      style={{ overflow: 'visible' }}
    >
      <defs>
        {/* Gradiente para nodos principales */}
        <radialGradient id="nodeCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00ffff" />
          <stop offset="50%" stopColor="#0088cc" />
          <stop offset="100%" stopColor="#004466" />
        </radialGradient>

        <radialGradient id="nodeSecondary" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00ccff" />
          <stop offset="50%" stopColor="#0066aa" />
          <stop offset="100%" stopColor="#003355" />
        </radialGradient>

        <radialGradient id="nodeLeaf" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0088aa" />
          <stop offset="50%" stopColor="#005577" />
          <stop offset="100%" stopColor="#002233" />
        </radialGradient>

        {/* Gradiente para conexiones activas */}
        <linearGradient id="connectionActive" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00ffff" stopOpacity="0.3" />
          <stop offset="50%" stopColor="#ffff55" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#00ffff" stopOpacity="0.3" />
        </linearGradient>

        <linearGradient id="connectionIdle" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#004466" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#002233" stopOpacity="0.2" />
        </linearGradient>

        {/* Glow para nodo central */}
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#00ffff" stopOpacity="0.6" />
          <stop offset="50%" stopColor="#00ffff" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#00ffff" stopOpacity="0" />
        </radialGradient>

        {/* Flujo de datos */}
        <linearGradient id="dataFlow" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffff55" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffff55" stopOpacity="1" />
          <stop offset="100%" stopColor="#ffff55" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g className={animated ? 'tech-tree-float' : ''} style={{ transformOrigin: '32px 36px' }}>
        {/* Glow del nodo central */}
        {animated && (
          <circle
            cx="32"
            cy="16"
            r={16 + Math.sin(pulse * 0.0628) * 3}
            fill="url(#coreGlow)"
            opacity="0.3"
            className="tech-tree-core-glow"
          />
        )}

        {/* Conexiones */}
        <g className="tech-tree-connections">
          {NODES.flatMap((node) =>
            node.connections.map((connId) => {
              const target = NODES.find((n) => n.id === connId);
              if (!target) return null;
              const isActive = isWorking && (dataFlow[target.id] !== undefined);
              const flowProgress = dataFlow[target.id] || 0;

              return (
                <g key={`${node.id}-${connId}`}>
                  {/* Línea de conexión base */}
                  <line
                    x1={node.x}
                    y1={node.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={isActive ? 'url(#connectionActive)' : 'url(#connectionIdle)'}
                    strokeWidth={node.size > 5 ? 2 : 1.5}
                    strokeLinecap="round"
                    opacity={isActive ? 0.8 : 0.4}
                    className="tech-tree-connection"
                  />
                  {/* Partícula de flujo de datos */}
                  {isActive && (
                    <>
                      <circle
                        cx={
                          node.x +
                          (target.x - node.x) * (flowProgress / 100)
                        }
                        cy={
                          node.y +
                          (target.y - node.y) * (flowProgress / 100)
                        }
                        r={3}
                        fill="url(#dataFlow)"
                        opacity="0.9"
                        className="tech-tree-data-particle"
                      />
                    </>
                  )}
                </g>
              );
            })
          )}
        </g>

        {/* Nodos */}
        <g className="tech-tree-nodes">
          {NODES.map((node) => {
            const isCore = node.id === 0;
            const isActive = isWorking && (dataFlow[node.id] !== undefined);
            const pulseScale = isCore && animated
              ? 1 + Math.sin(pulse * 0.0628) * 0.15
              : 1;

            return (
              <g
                key={node.id}
                className="tech-tree-node"
                style={{
                  transform: `scale(${pulseScale})`,
                  transformOrigin: `${node.x}px ${node.y}px`,
                }}
              >
                {/* Anillo de actividad cuando está trabajando */}
                {isActive && animated && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.size + 4 + (dataFlow[node.id] || 0) * 0.1}
                    fill="none"
                    stroke="#ffff55"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    opacity={0.6}
                    className="tech-tree-activity-ring"
                  />
                )}

                {/* Anillo exterior para nodo central */}
                {isCore && animated && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.size + 4 + Math.sin(pulse * 0.0628) * 3}
                    fill="none"
                    stroke="#00ffff"
                    strokeWidth={1.5}
                    strokeDasharray="8 8"
                    opacity={0.4}
                    className="tech-tree-core-ring"
                  />
                )}

                {/* Nodo principal */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.size * pulseScale}
                  fill={
                    node.id === 0
                      ? 'url(#nodeCore)'
                      : node.size >= 6
                      ? 'url(#nodeSecondary)'
                      : 'url(#nodeLeaf)'
                  }
                  stroke="#00ffff"
                  strokeWidth={isCore ? 2 : 1.5}
                  opacity={isActive ? 1 : 0.9}
                />

                {/* Brillo interior para nodo central */}
                {isCore && !isWorking && (
                  <circle
                    cx={node.x - 2}
                    cy={node.y - 2}
                    r={node.size * 0.3}
                    fill="#ffffff"
                    opacity="0.3"
                  />
                )}

                {/* Indicador de procesamiento en nodo central */}
                {isCore && isWorking && (
                  <text
                    x={node.x}
                    y={node.y + 20}
                    fill="#ffff55"
                    fontSize="7"
                    fontFamily="monospace"
                    textAnchor="middle"
                    fontWeight="bold"
                    className="tech-tree-processing-text"
                  >
                    ⟳ PROCESANDO
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* Partículas flotantes decorativas */}
        {animated && !isWorking && (
          <g className="tech-tree-particles">
            {[1, 2, 3, 4, 5].map((i) => (
              <circle
                key={i}
                cx={10 + i * 10 + Math.sin(pulse * 0.01 * i) * 5}
                cy={5 + i * 12 + Math.cos(pulse * 0.01 * i) * 3}
                r={1.5}
                fill="#00ffff"
                opacity={0.3 + Math.sin(pulse * 0.02 * i) * 0.2}
                className="tech-tree-particle"
              />
            ))}
          </g>
        )}
      </g>
    </svg>
  );
};

export default TechTreeSymbol;