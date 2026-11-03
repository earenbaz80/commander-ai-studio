import React from 'react';
import { useResizableWidth } from '../hooks/useResizableWidth';
import { panelWidthSpec, type PanelId } from '../stores/layoutStore';
import type { Language } from '../i18n/translations';

/**
 * Panel lateral con asa de arrastre. El ancho sale del catálogo de
 * `layoutStore` y se recuerda entre sesiones; el asa se coloca en el borde
 * interior según el lado en que viva el panel.
 */
export interface ResizableSplitProps {
  id: PanelId;
  side: 'left' | 'right';
  lang?: Language;
  children: React.ReactNode;
}

export const ResizableSplit: React.FC<ResizableSplitProps> = ({ id, side, lang = 'es', children }) => {
  const spec = panelWidthSpec(id);
  const { width, onMouseDown, onDoubleClick } = useResizableWidth({
    ...spec,
    // Panel pegado a la derecha: arrastrar hacia la izquierda lo agranda.
    invert: side === 'right',
  });

  const label =
    lang === 'es' ? 'Ancho del panel' : lang === 'de' ? 'Breite des Panels' : 'Panel width';
  const hint =
    lang === 'es'
      ? 'Arrastra para cambiar el ancho · doble clic para restablecer'
      : lang === 'de'
        ? 'Ziehen zum Ändern der Breite · Doppelklick zum Zurücksetzen'
        : 'Drag to resize · double click to reset';

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={hint}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className="w-1 shrink-0 cursor-col-resize bg-[#00ffff]/25 hover:bg-[#00ffff] transition-colors"
    />
  );

  return (
    <div className="flex h-full shrink-0" style={{ width }}>
      {side === 'right' && handle}
      <div className="flex-1 min-w-0 h-full overflow-hidden">{children}</div>
      {side === 'left' && handle}
    </div>
  );
};

export default ResizableSplit;
