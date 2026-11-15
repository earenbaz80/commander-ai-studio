/**
 * Dictado por voz del chat.
 *
 * Graba un fragmento con `MediaRecorder`, lo manda a `/api/transcribe` y
 * devuelve el texto para insertarlo en el mensaje. No envía nada al modelo:
 * el usuario revisa y pulsa Enviar, igual que si lo hubiera escrito.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { blobToWav, pickRecorderMimeType } from '../lib/dictation';
import type { Language } from '../i18n/translations';

export type DictationState = 'idle' | 'recording' | 'transcribing';

type LangKey = 'es' | 'en' | 'de';

const MESSAGES: Record<LangKey, { unsupported: string; denied: string; failed: string }> = {
  es: {
    unsupported: 'Este navegador no permite grabar audio.',
    denied: 'No se pudo acceder al micrófono.',
    failed: 'No se pudo transcribir el audio.',
  },
  en: {
    unsupported: 'This browser cannot record audio.',
    denied: 'Could not access the microphone.',
    failed: 'Could not transcribe the audio.',
  },
  de: {
    unsupported: 'Dieser Browser kann kein Audio aufnehmen.',
    denied: 'Zugriff auf das Mikrofon nicht möglich.',
    failed: 'Das Audio konnte nicht transkribiert werden.',
  },
};

export interface DictationController {
  state: DictationState;
  supported: boolean;
  error: string;
  /** Segundos grabados: la UI los muestra para que se note que escucha. */
  seconds: number;
  toggle: () => void;
}

interface UseDictationOptions {
  lang: Language;
  onText: (text: string) => void;
}

type DictationResponse = {
  success?: boolean;
  text?: string;
  error?: string;
  retryWithWav?: boolean;
};

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('audio read failed'));
    reader.readAsDataURL(blob);
  });
}

export function useDictation({ lang, onText }: UseDictationOptions): DictationController {
  const langKey: LangKey = lang === 'es' ? 'es' : lang === 'de' ? 'de' : 'en';
  const [state, setState] = useState<DictationState>('idle');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const mountedRef = useRef(true);

  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Contador visible mientras graba; sin él, el botón rojo parece no hacer nada.
  useEffect(() => {
    if (state !== 'recording') {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => {
    // StrictMode ejecuta el cleanup de la primera montura y vuelve a montar.
    // Sin restaurar la marca, el primer `start()` veía `mountedRef=false` y
    // cerraba el stream antes de grabar.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* ya estaba parado */
        }
      }
      releaseStream();
    };
  }, [releaseStream]);

  const transcribe = useCallback(
    async (blob: Blob, mimeType: string) => {
      setState('transcribing');
      try {
        const send = async (upload: Blob, uploadMime: string, logFailure = true) => {
          const dataUrl = await readAsDataUrl(upload);
          const response = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioData: dataUrl.split(',')[1] || '',
              mimeType: uploadMime,
              lang: langKey,
            }),
          });
          const rawBody = await response.text();
          let data: DictationResponse = {};
          try {
            data = rawBody ? JSON.parse(rawBody) : {};
          } catch {
            /* el extracto conserva la respuesta no JSON */
          }
          if (logFailure && (!response.ok || !data.success)) {
            // Acotado a propósito: el error ya se ve en la UI y el cuerpo puede
            // ser un HTML entero; aquí sólo sirve el arranque de la respuesta.
            const excerpt = rawBody.replace(/\s+/g, ' ').trim().slice(0, 200);
            console.warn('[dictation] fallo /api/transcribe', JSON.stringify({
              mimeType: uploadMime,
              bytes: upload.size,
              status: response.status,
              ...(excerpt ? { body: excerpt } : {}),
            }));
          }
          return data;
        };

        // Primero se manda el contenedor original. Sólo si el servidor marca
        // el 400 de audio inválido se reencodea a WAV y se reintenta una vez.
        let data = await send(blob, mimeType);
        if (!mountedRef.current) return;
        if (!data.success && data.retryWithWav === true) {
          const wav = await blobToWav(blob);
          if (wav) {
            console.info('[dictation] reintento WAV', JSON.stringify({
              originalMime: mimeType,
              originalBytes: blob.size,
              wavBytes: wav.size,
            }));
            // El reintento no repite el fallo: el primer log ya conserva el
            // diagnóstico original y este conserva el tamaño del WAV.
            data = await send(wav, 'audio/wav', false);
          }
        }

        if (!mountedRef.current) return;
        if (data.success && typeof data.text === 'string' && data.text.trim()) {
          setError('');
          onText(data.text.trim());
        } else {
          const message = typeof data.error === 'string' ? data.error.trim() : '';
          setError(message && !message.startsWith('{') ? message : MESSAGES[langKey].failed);
        }
      } catch (e: any) {
        if (mountedRef.current) setError(e?.message || MESSAGES[langKey].failed);
      } finally {
        if (mountedRef.current) setState('idle');
      }
    },
    [langKey, onText]
  );

  const start = useCallback(async () => {
    if (!supported) {
      setError(MESSAGES[langKey].unsupported);
      return;
    }
    setError('');
    discardRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const type = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        recorderRef.current = null;
        releaseStream();
        if (discardRef.current || blob.size < 200) {
          discardRef.current = false;
          if (mountedRef.current) setState('idle');
          return;
        }
        void transcribe(blob, type);
      };

      recorder.start(250);
      setState('recording');
    } catch (e: any) {
      releaseStream();
      const detail = e?.message ? ` (${e.message})` : '';
      setError(`${MESSAGES[langKey].denied}${detail}`);
      setState('idle');
    }
  }, [supported, langKey, releaseStream, transcribe]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        releaseStream();
        setState('idle');
      }
    }
  }, [releaseStream]);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') void start();
    // Mientras transcribe no se puede empezar otra grabación.
  }, [state, start, stop]);

  return { state, supported, error, seconds, toggle };
}
