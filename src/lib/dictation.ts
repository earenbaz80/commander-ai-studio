/**
 * Utilidades del dictado por voz del compositor.
 *
 * El dictado no responde por voz: escribe en el mensaje para que las
 * instrucciones habladas se puedan revisar y enviar al modelo como cualquier
 * otro texto. La transcripción la hace `/api/transcribe` (Gemini).
 */

/** Une la transcripción al texto que ya había, sin pegar palabras. */
export function mergeDictationText(existing: string, transcript: string): string {
  const text = String(transcript || '').trim();
  if (!text) return existing;
  if (!existing.trim()) return text;
  return `${existing.replace(/\s+$/, '')} ${text}`;
}

/** MIME que acepta `MediaRecorder` en este navegador (audio/webm suele serlo). */
export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  for (const candidate of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}
