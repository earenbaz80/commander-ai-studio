import { sessionFileName, sessionToMarkdown, type ExportableRun } from './sessionExport';

/**
 * Descarga de la corrida como `.md`.
 *
 * Vive aparte de `sessionExport.ts` porque toca `document`/`Blob`: así la
 * serialización sigue siendo pura y la suite de lógica la puede importar sin
 * arrastrar el DOM.
 */
export function downloadSessionMarkdown(run: ExportableRun): void {
  const blob = new Blob([sessionToMarkdown(run)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sessionFileName();
  link.click();
  URL.revokeObjectURL(url);
}
