/**
 * Descarga local de contenido ya construido en memoria.
 *
 * Los artifacts y capturas viven en el renderer: no hay subida ni cuenta, sólo
 * un Blob que se entrega al navegador. Un único lugar para el enlace temporal
 * evita que cada vista repita el mismo ritual con sutiles diferencias.
 */

export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof URL.createObjectURL !== 'function') throw new Error('descarga no disponible');
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL?.(objectUrl), 1_000);
}

export function downloadText(
  content: string,
  filename: string,
  mime = 'text/plain;charset=utf-8'
): void {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

export function downloadBase64(data: string, mimeType: string, filename: string): void {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  downloadBlob(new Blob([bytes], { type: mimeType }), filename);
}
