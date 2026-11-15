/**
 * Respaldo de la transcripción de audio.
 *
 * Gemini devuelve 503 «modelo sobrecargado» con cierta frecuencia y el dictado
 * se quedaba sin transcribir por depender de un solo id. Se reintenta con la
 * misma cadena que usa el chat, de modo que un lite o Gemma contesten cuando el
 * flash grande está saturado.
 */
import { GEMINI_FALLBACK_MODELS } from '../config/geminiModels';

/** Modelos a probar, sin repetidos, en el orden de respaldo del chat. */
export const TRANSCRIPTION_MODELS: string[] = [...new Set(GEMINI_FALLBACK_MODELS)];

/**
 * `true` si tiene sentido probar otro modelo: sobrecarga, cuota, timeout o
 * error interno. Un 400 (audio inválido o clave mala) no se reintenta.
 */
export function isRetryableTranscriptionError(error: unknown): boolean {
  const status = Number((error as any)?.status ?? (error as any)?.code);
  if ([429, 500, 502, 503, 504].includes(status)) return true;

  const message = error instanceof Error ? error.message : String(error ?? '');
  return /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overload|timed? ?out|deadline/i.test(message);
}

export const INVALID_AUDIO_MESSAGE =
  'El audio no se pudo procesar. Vuelve a grabarlo e inténtalo de nuevo.';
export const TRANSCRIPTION_FAILED_MESSAGE = 'No se pudo transcribir el audio. Inténtalo de nuevo.';

/**
 * `true` sólo para el 400 que Gemini usa cuando no puede interpretar el audio.
 * No incluye claves, cuotas ni saturación: esos no se arreglan reencodando.
 */
export function isInvalidAudioError(error: unknown): boolean {
  const status = Number((error as any)?.status ?? (error as any)?.code);
  if (Number.isFinite(status) && status !== 0 && status !== 400) return false;

  const raw = error instanceof Error ? error.message : String(error ?? '');
  let detail = raw;
  try {
    detail = String(JSON.parse(raw)?.error?.message || raw);
  } catch {
    /* el mensaje ya es texto plano */
  }
  return /request contains an invalid argument|invalid_argument|unsupported mime|base64 decoding failed/i.test(
    detail
  );
}
