/**
 * Salida en vivo de un trabajo de `shell.run` en segundo plano.
 *
 * El comando de fondo ya contestó al agente con su id (no se espera a que
 * termine), así que lo único que queda es leer su log: se consulta
 * `shell.job { action: "logs" }` cada segundo mientras siga en marcha y se deja
 * de sondear en cuanto sale o se para. Sin cambios en el servidor: el registro
 * de trabajos ya expone el log por esa tool.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Square } from 'lucide-react';
import type { Language } from '../i18n/translations';
import { deText } from '../i18n/de';

interface ShellJobLogProps {
  jobId: string;
  command?: string;
  lang: Language;
}

type JobState = 'running' | 'exited' | 'stopped' | 'unknown';

/** Pausa entre lecturas del log: suficiente para leer, barata para el server. */
const POLL_MS = 1000;

/** Líneas que se piden en cada lectura (el server corta a 500). */
const TAIL_LINES = 200;

function asState(value: unknown): JobState {
  return value === 'running' || value === 'exited' || value === 'stopped' ? value : 'unknown';
}

async function callJobTool(input: Record<string, unknown>) {
  const res = await fetch('/api/agent/run-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId: 'shell.job', input }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    throw new Error(String(body?.error || `HTTP ${res.status}`));
  }
  return body?.data ?? {};
}

export const ShellJobLog: React.FC<ShellJobLogProps> = ({ jobId, command, lang }) => {
  const t = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);
  const [content, setContent] = useState('');
  const [state, setState] = useState<JobState>('running');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);
  // Una lectura lenta no se solapa con la siguiente: si el server tarda, el
  // intervalo se salta el turno en vez de acumular peticiones.
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await callJobTool({ action: 'logs', id: jobId, tail: TAIL_LINES });
      setContent(String(data.content ?? ''));
      setState(asState(data.status));
      setExitCode(typeof data.exitCode === 'number' ? data.exitCode : null);
      setError(null);
    } catch (e: any) {
      setError(String(e?.message || e));
      setState('unknown');
    } finally {
      inFlight.current = false;
    }
  }, [jobId]);

  useEffect(() => {
    if (state !== 'running') return;
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [poll, state]);

  // El log crece por abajo: se sigue el final salvo que el usuario lea arriba.
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content]);

  const stop = async () => {
    setStopping(true);
    try {
      await callJobTool({ action: 'stop', id: jobId });
      // Última lectura para mostrar la marca del `stop`, pero sin dejar que su
      // respuesta reabra el sondeo: el estado lo decide la parada, no el log.
      const last = await callJobTool({ action: 'logs', id: jobId, tail: TAIL_LINES }).catch(() => null);
      if (last && typeof last.content === 'string') setContent(last.content);
      setState('stopped');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setStopping(false);
    }
  };

  const badge = state === 'running'
    ? { text: t('EN MARCHA', 'RUNNING'), cls: 'text-[#ffff55]' }
    : state === 'stopped'
      ? { text: t('DETENIDO', 'STOPPED'), cls: 'text-white/60' }
      : state === 'exited'
        ? {
          text: exitCode === 0
            ? t('SALIÓ 0', 'EXIT 0')
            : `${t('SALIÓ', 'EXIT')} ${exitCode ?? '?'}`,
          cls: exitCode === 0 ? 'text-[#00ff66]' : 'text-red-400',
        }
        : { text: t('SIN DATOS', 'NO DATA'), cls: 'text-red-400' };

  return (
    <div className="border border-[#00ffff]/40 bg-black/50 rounded">
      <div className="flex items-center gap-2 px-1.5 py-1 border-b border-[#00ffff]/20">
        <span className="text-[10px] font-bold text-[#ffff55] shrink-0">
          {t('SALIDA EN VIVO', 'LIVE OUTPUT')}
        </span>
        <span className="text-[10px] text-[#00ffff]/70 font-mono truncate" title={command || jobId}>
          {command || jobId}
        </span>
        <span className={`ml-auto text-[10px] font-bold shrink-0 ${badge.cls}`}>{badge.text}</span>
        {state === 'running' && (
          <button
            type="button"
            onClick={stop}
            disabled={stopping}
            className="text-[10px] px-1 py-0.5 bg-[#aa0000] text-white disabled:opacity-50 shrink-0"
            title={t('Parar el trabajo', 'Stop the job')}
          >
            <Square className="w-3 h-3" />
          </button>
        )}
      </div>
      <pre
        ref={preRef}
        aria-label={t('Salida del comando', 'Command output')}
        className="max-h-40 overflow-auto p-1.5 text-[10px] text-white/85 font-mono whitespace-pre-wrap break-all"
      >
        {content || t('Sin salida todavía…', 'No output yet…')}
      </pre>
      {error && <p className="px-1.5 pb-1 text-[10px] text-red-400">{error}</p>}
    </div>
  );
};

export default ShellJobLog;
