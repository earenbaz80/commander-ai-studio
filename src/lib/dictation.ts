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

/** Frecuencia del WAV que se manda a Gemini: suficiente para voz y ligera. */
const DICTATION_WAV_RATE = 16000;

/** Escribe texto ASCII en la cabecera RIFF. */
function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

/** Convierte muestras mono a un WAV PCM 16 bits. */
export function encodeWav(samples: Float32Array, sampleRate = DICTATION_WAV_RATE): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * bytesPerSample, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Convierte la grabación del navegador a WAV mono 16 kHz.
 *
 * `MediaRecorder` produce WebM, Ogg o MP4 según el navegador. Gemini acepta
 * esos formatos, pero un contenedor concreto puede acabar en un 400 de audio
 * inválido. Se usa sólo como reintento; si el navegador no puede decodificar
 * el blob, se devuelve `null` y se conserva el error original.
 */
export async function blobToWav(blob: Blob): Promise<Blob | null> {
  if (typeof AudioContext === 'undefined' || typeof OfflineAudioContext === 'undefined') {
    return null;
  }

  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.max(1, Math.ceil((decoded.length / decoded.sampleRate) * DICTATION_WAV_RATE));
    const offline = new OfflineAudioContext(1, frames, DICTATION_WAV_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0));
  } catch {
    return null;
  } finally {
    if (context) void context.close().catch(() => {});
  }
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
