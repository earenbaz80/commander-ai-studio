import { describe, expect, test } from 'vitest';
import {
  TRANSCRIPTION_MODELS,
  isRetryableTranscriptionError,
} from '../../src/lib/transcription';

describe('respaldo de transcripción', () => {
  test('reintenta con otro modelo cuando Gemini está sobrecargado o sin cuota', () => {
    expect(isRetryableTranscriptionError('[503 Service Unavailable] model overloaded')).toBe(true);
    expect(isRetryableTranscriptionError(new Error('RESOURCE_EXHAUSTED: quota'))).toBe(true);
    expect(isRetryableTranscriptionError({ status: 429 })).toBe(true);
    expect(isRetryableTranscriptionError({ code: 504 })).toBe(true);
  });

  test('no reintenta un audio inválido ni una clave rechazada', () => {
    expect(isRetryableTranscriptionError('[400] Unsupported MIME type')).toBe(false);
    expect(isRetryableTranscriptionError('API_KEY_INVALID')).toBe(false);
    expect(isRetryableTranscriptionError({ status: 400 })).toBe(false);
  });

  test('la cadena tiene varios modelos y no repite ids', () => {
    expect(TRANSCRIPTION_MODELS.length).toBeGreaterThan(1);
    expect(new Set(TRANSCRIPTION_MODELS).size).toBe(TRANSCRIPTION_MODELS.length);
  });
});
