import React from 'react';
import { ResizableSplit } from '../../components/ResizableSplit';
import type { Language } from '../../i18n/translations';

/**
 * Nono acoplado: el mismo asistente, pero como panel lateral con ancho propio
 * en lugar de flotando sobre el contenido. El ancho lo gobierna
 * `ResizableSplit` (clave `nono` del catálogo de layout) y se recuerda entre
 * sesiones.
 */
export interface NonoDockProps {
  lang?: Language;
  children: React.ReactNode;
}

export const NonoDock: React.FC<NonoDockProps> = ({ lang = 'es', children }) => (
  <ResizableSplit id="nono" side="right" lang={lang}>
    <div className="h-full border-l-2 border-[var(--nc-border-light)] overflow-hidden">{children}</div>
  </ResizableSplit>
);

export default NonoDock;
