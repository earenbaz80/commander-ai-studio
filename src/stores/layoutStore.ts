/**
 * Anchos de los paneles laterales en un solo sitio.
 *
 * Cada panel declara su clave de persistencia y sus límites; el arrastre y el
 * guardado en `localStorage` los pone `useResizableWidth`.
 */
export interface PanelWidthSpec {
  key: string;
  defaultWidth: number;
  min: number;
  max: number;
}

export const LAYOUT_PANELS = {
  workbench: { key: 'commander_workbench_width', defaultWidth: 380, min: 280, max: 720 },
  nono: { key: 'commander_nono_width', defaultWidth: 320, min: 260, max: 560 },
} as const satisfies Record<string, PanelWidthSpec>;

export type PanelId = keyof typeof LAYOUT_PANELS;

export function panelWidthSpec(id: PanelId): PanelWidthSpec {
  return LAYOUT_PANELS[id];
}
