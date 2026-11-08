import { useCallback, useEffect, useRef, useState } from 'react';

const LMSTUDIO_PREFIX = 'lmstudio/';
/** El servidor tarda como máximo un segundo en reflejar el inicio de la carga. */
const POLL_MS = 1000;

export interface LmStudioLoadingState {
  loading: boolean;
  /** Momento en el que empezó la carga (epoch ms), para el cronómetro. */
  startedAt: number | null;
  /** Contexto (tokens) que se pidió a LM Studio al cargar el modelo. */
  contextLength: number | null;
  /** Fallo reciente de la carga, tal como lo informa el servidor. */
  error: string | null;
  /** Oculta el fallo sin volver a lanzar la carga. */
  dismissError: () => void;
}

interface LmStudioLoadingPayload {
  loading?: boolean;
  model?: string;
  startedAt?: number;
  contextLength?: number;
  error?: string;
}

/** El servidor manda `error` junto al `loading: false` de un intento fallido. */
const readError = (data: LmStudioLoadingPayload | null): string | null =>
  data && data.loading === false && typeof data.error === 'string' && data.error.trim()
    ? data.error.trim()
    : null;

async function fetchLoading(model: string): Promise<LmStudioLoadingPayload | null> {
  try {
    const response = await fetch(
      `/api/lmstudio/loading?model=${encodeURIComponent(model)}`,
      { cache: 'no-store' }
    );
    return response.ok ? await response.json().catch(() => null) : null;
  } catch {
    // Servidor viejo o caído: no se inventa ni una carga ni un error.
    return null;
  }
}

/**
 * Estado de la carga del modelo LM Studio elegido.
 *
 * El endpoint de generación es bloqueante y no informa del progreso, así que la
 * UI consulta un estado pequeño en paralelo. Solo se sondea cuando hay una
 * ejecución en curso y el modelo activo es de LM Studio: en reposo no se hace
 * ninguna petición.
 */
export function useLmStudioLoading(
  selectedModel: string,
  busy: boolean
): LmStudioLoadingState {
  const model = selectedModel.startsWith(LMSTUDIO_PREFIX)
    ? selectedModel.slice(LMSTUDIO_PREFIX.length)
    : '';
  const [loading, setLoading] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [contextLength, setContextLength] = useState<number | null>(null);
  // El fallo se guarda con su modelo: al cambiar de modelo no se arrastra.
  const [failure, setFailure] = useState<{ model: string; message: string } | null>(null);
  // Si el servidor no manda startedAt (versión vieja), el cronómetro empieza
  // cuando la UI ve la carga por primera vez.
  const fallbackStartedAt = useRef<number | null>(null);
  const dismissedRef = useRef(false);
  // La consulta final solo vale para la misma ejecución: si el modelo cambió
  // mientras tanto, no hay ningún fallo que recoger de él.
  const previousRun = useRef({ busy: false, model: '' });

  useEffect(() => {
    fallbackStartedAt.current = null;
    if (!busy || !model) {
      setLoading(false);
      setStartedAt(null);
      setContextLength(null);
      return;
    }

    // Cada ejecución es un intento nuevo; el fallo anterior ya no aplica.
    dismissedRef.current = false;
    setFailure(null);

    let cancelled = false;
    let sawLoading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const data = await fetchLoading(model);
      if (cancelled) return;

      if (!data || data.loading !== true) {
        fallbackStartedAt.current = null;
        setLoading(false);
        setStartedAt(null);
        setContextLength(null);
        // Puede ser el final normal de la carga o su fallo: si el servidor
        // informa un error, se queda visible hasta que el usuario lo descarte.
        const message = readError(data);
        if (message && !dismissedRef.current) setFailure({ model, message });
        // Si la carga ya se vio terminar no hace falta seguir consultando. Si
        // aún no se vio empezar, se sigue: el servidor puede registrarla tarde.
        return sawLoading ? undefined : schedule();
      }

      sawLoading = true;
      const serverStartedAt =
        typeof data.startedAt === 'number' &&
        Number.isFinite(data.startedAt) &&
        data.startedAt > 0
          ? data.startedAt
          : null;
      const start = serverStartedAt ?? fallbackStartedAt.current ?? Date.now();
      fallbackStartedAt.current = start;
      setStartedAt(start);
      setContextLength(
        typeof data.contextLength === 'number' &&
          Number.isFinite(data.contextLength) &&
          data.contextLength > 0
          ? Math.floor(data.contextLength)
          : null
      );
      setLoading(true);
      schedule();
    };

    const schedule = () => {
      if (!cancelled) timer = setTimeout(() => void poll(), POLL_MS);
    };

    setLoading(false);
    setStartedAt(null);
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [busy, model]);

  // El servidor apaga `loading` justo cuando la carga falla, así que cuando la
  // ejecución termina se hace una última consulta: es la que ve el error y
  // evita que el aviso desaparezca sin explicar por qué.
  useEffect(() => {
    const previous = previousRun.current;
    previousRun.current = { busy, model };
    if (!model || busy || !previous.busy || previous.model !== model) return;

    let cancelled = false;
    void fetchLoading(model).then((data) => {
      if (cancelled || dismissedRef.current) return;
      const message = readError(data);
      if (message) setFailure({ model, message });
    });
    return () => {
      cancelled = true;
    };
  }, [busy, model]);

  const dismissError = useCallback(() => {
    dismissedRef.current = true;
    setFailure(null);
  }, []);

  return {
    loading,
    startedAt,
    contextLength,
    error: failure && failure.model === model ? failure.message : null,
    dismissError,
  };
}
