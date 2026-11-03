import React from 'react';
import { useResizableWidth } from '../../hooks/useResizableWidth';

/**
 * Nono acoplado: el mismo asistente, pero como panel lateral con ancho propio
 * en lugar de flotando sobre el contenido. El ancho se recuerda entre sesiones
 * y el asa se ve sólo al pasar por encima para no competir con el borde.
 */
export interface NonoDockProps {
  lang?: 'es' | 'de' | 'en';
  children: React.ReactNode;
}

const WIDTH_KEY = 'commander_nono_width';

export const NonoDock: React.FC<NonoDockProps> = ({ lang = 'es', children }) => {
  const { width, onMouseDown, onDoubleClick } = useResizableWidth({
    key: WIDTH_KEY,
    defaultWidth: 320,
    min: 260,
    max: 560,
    // Panel pegado a la derecha: arrastrar hacia la izquierda lo agranda.
    invert: true,
  });

  const label =
    lang === 'es' ? 'Ancho del panel de Nono' : lang === 'de' ? 'Breite des Nono-Panels' : 'Nono panel width';
  const hint =
    lang === 'es'
      ? 'Arrastra para cambiar el ancho · doble clic para restablecer'
      : lang === 'de'
        ? 'Ziehen zum Ändern der Breite · Doppelklick zum Zurücksetzen'
        : 'Drag to resize · double click to reset';

  return (
    <div className="flex h-full shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        title={hint}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        className="w-1 shrink-0 cursor-col-resize bg-[#00ffff]/25 hover:bg-[#00ffff] transition-colors"
      />
      <div className="h-full border-l-2 border-[#00ffff] overflow-hidden" style={{ width }}>
        {children}
      </div>
    </div>
  );
};

export default NonoDock;
