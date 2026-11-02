import { useRef, useState } from 'react';
import { Play, Plus, Square, X, Users } from 'lucide-react';
import { setSubAgentsSession } from '../agent/subAgentsStream';
import type { Language } from '../i18n/translations';
import { deText } from '../i18n/de';

/**
 * Lanzar varios agentes a la vez desde la interfaz.
 *
 * El backend ya sabía hacerlo: `spawn_agents` corre hasta seis subagentes con
 * `Promise.allSettled` sobre sesiones hijas reales, y el stream SSE los pinta en
 * `ServerSubAgents`. Lo que faltaba era el disparador humano: hasta ahora sólo el
 * modelo podía pedirlos, escribiendo la tool en su turno.
 *
 * Aquí se arma la misma petición: se registra la sesión padre (la que presta cwd
 * y modelo a los hijos), se abre su stream y se llama a la tool. El `POST` a la
 * tool no responde hasta que *todos* terminan, así que el avance no se sigue por
 * la respuesta sino por el stream — por eso se abre antes de lanzar, y por eso
 * el botón queda ocupado mientras dura la corrida.
 */

/** Tope duro del servidor: `spawn_agents` recorta la lista a seis. */
export const MAX_PARALELOS = 6;

export type ModoHijo = 'build' | 'plan' | 'readonly';

interface FilaAgente {
  id: number;
  goal: string;
  mode: ModoHijo;
}

/** Contador de montaje: las claves de React sólo tienen que ser únicas aquí. */
let siguienteId = 1;
const filaVacia = (): FilaAgente => ({ id: siguienteId++, goal: '', mode: 'build' });

interface ParallelLaunchProps {
  /** Proyecto abierto: lo heredan los hijos como cwd. */
  cwd: string;
  /** Si hay una tarea en curso, el stream pertenece a ella y no se lanza nada. */
  running?: boolean;
  lang?: Language;
}

export function ParallelLaunch({ cwd, running = false, lang = 'es' }: ParallelLaunchProps) {
  const t = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);
  const [filas, setFilas] = useState<FilaAgente[]>(() => [filaVacia(), filaVacia()]);
  const [lanzando, setLanzando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  /** Sesión padre de la tanda en curso: es la que se cancela. */
  const [sesionPadre, setSesionPadre] = useState('');
  const [cancelando, setCancelando] = useState(false);
  /** Cancelada a mano: el resultado que llegue después no debe fingir otra cosa. */
  const canceladoRef = useRef(false);

  const objetivos = filas.map((f) => f.goal.trim()).filter(Boolean);

  const cambiar = (id: number, parche: Partial<FilaAgente>) => {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, ...parche } : f)));
    // El error anterior describía otra lista de objetivos: se limpia al editarla.
    setError('');
  };

  const anadir = () => {
    setFilas((prev) => (prev.length >= MAX_PARALELOS ? prev : [...prev, filaVacia()]));
    setError('');
  };

  const quitar = (id: number) => {
    // Dos filas es el mínimo con el que «en paralelo» significa algo.
    setFilas((prev) => (prev.length <= 2 ? prev : prev.filter((f) => f.id !== id)));
    setError('');
  };

  const lanzar = async () => {
    if (lanzando || running) return;
    if (objetivos.length < 2) {
      setError(t('Escribe al menos dos objetivos: uno solo es una tarea normal.', 'Write at least two goals: a single one is just a normal task.'));
      return;
    }
    setLanzando(true);
    setError('');
    setAviso('');
    try {
      // Sesión padre: existe para dar cwd, modelo y límites a los hijos. No
      // arranca ningún bucle propio (el servidor sólo la registra).
      const resPadre = await fetch('/api/agent/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: `${t('Ejecución paralela', 'Parallel run')}: ${objetivos.join(' | ')}`.slice(0, 200),
          cwd,
          maxSteps: 20,
        }),
      });
      const dataPadre: any = await resPadre.json().catch(() => ({}));
      const parentSessionId = dataPadre?.session?.id;
      if (!parentSessionId) {
        throw new Error(dataPadre?.error || t('El servidor no registró la sesión padre', 'The server did not register the parent session'));
      }
      // Antes de lanzar: el panel de al lado se suscribe a este id y recibe el
      // estado inicial vacío, en vez de perder los primeros eventos.
      setSubAgentsSession(String(parentSessionId));
      setSesionPadre(String(parentSessionId));
      canceladoRef.current = false;

      const agentes = filas
        .filter((f) => f.goal.trim())
        .map((f) => ({ goal: f.goal.trim(), mode: f.mode }));

      const res = await fetch('/api/agent/run-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolId: 'spawn_agents', input: { parentSessionId, agents: agentes } }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const lanzados = Number(body?.data?.spawned) || agentes.length;
      // Si se canceló, el `spawn_agents` vuelve con los hijos cortados: decir
      // «terminados» aquí taparía lo que el usuario acaba de hacer.
      if (canceladoRef.current) {
        const cancelados = (Array.isArray(body?.data?.results) ? body.data.results : [])
          .filter((r: any) => r?.cancelled).length;
        setAviso(`${cancelados || lanzados} ${t('cancelados', 'cancelled')}`);
        return;
      }
      setAviso(
        body?.data?.capped
          ? `${lanzados}/${agentes.length} ${t('lanzados: el resto pasa del tope de', 'launched: the rest exceed the cap of')} ${MAX_PARALELOS}`
          : `${lanzados} ${t('agentes terminados', 'agents finished')}`,
      );
    } catch (e: any) {
      setError(e?.message || t('No se pudo lanzar', 'Could not launch'));
    } finally {
      setLanzando(false);
    }
  };

  /**
   * Parar la tanda. No basta con cerrar el panel: los hijos seguirían en su
   * bucle escribiendo archivos, así que se pide al servidor que los pare, y el
   * `POST` de `spawn_agents` termina en cuanto salen del bucle.
   */
  const cancelar = async () => {
    if (!sesionPadre || cancelando) return;
    setCancelando(true);
    setError('');
    try {
      const res = await fetch(`/api/agent/sessions/${encodeURIComponent(sesionPadre)}/cancel`, { method: 'POST' });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      canceladoRef.current = true;
      setAviso(`${Number(body?.cancelled) || 0} ${t('cancelados', 'cancelled')}`);
    } catch (e: any) {
      setError(e?.message || t('No se pudo cancelar', 'Could not cancel'));
    } finally {
      setCancelando(false);
    }
  };

  const bloqueado = running || lanzando;

  return (
    <div className="mb-3 border border-cyan-700/40 rounded p-2" data-testid="parallel-launch">
      <div className="flex items-center justify-between text-xs text-cyan-300 mb-1">
        <span className="flex items-center gap-1">
          <Users className="w-3.5 h-3.5" />
          {t('Agentes en paralelo', 'Agents in parallel')}
        </span>
        <span className="text-[10px] text-cyan-500/70">
          {objetivos.length}/{MAX_PARALELOS} {t('objetivos', 'goals')}
        </span>
      </div>

      <ul className="space-y-1">
        {filas.map((fila, i) => (
          <li key={fila.id} className="flex items-start gap-1">
            <textarea
              value={fila.goal}
              onChange={(e) => cambiar(fila.id, { goal: e.target.value })}
              rows={1}
              disabled={bloqueado}
              aria-label={t(`Objetivo del agente ${i + 1}`, `Goal for agent ${i + 1}`)}
              placeholder={t('Objetivo independiente para este agente…', 'Independent goal for this agent…')}
              className="flex-1 bg-black/40 border border-cyan-900/40 rounded p-1 text-[10px] text-cyan-100 resize-none disabled:opacity-50"
              data-testid={`parallel-goal-${i}`}
            />
            <select
              value={fila.mode}
              onChange={(e) => cambiar(fila.id, { mode: e.target.value as ModoHijo })}
              disabled={bloqueado}
              aria-label={t(`Modo del agente ${i + 1}`, `Mode for agent ${i + 1}`)}
              className="bg-black/40 border border-cyan-900/40 rounded px-1 py-1 text-[10px] text-cyan-100 disabled:opacity-50"
              data-testid={`parallel-mode-${i}`}
            >
              <option value="build">build</option>
              <option value="plan">plan</option>
              <option value="readonly">readonly</option>
            </select>
            <button
              type="button"
              onClick={() => quitar(fila.id)}
              disabled={bloqueado || filas.length <= 2}
              aria-label={t(`Quitar el agente ${i + 1}`, `Remove agent ${i + 1}`)}
              className="text-cyan-500/70 hover:text-red-300 p-1 disabled:opacity-30"
              data-testid={`parallel-remove-${i}`}
            >
              <X className="w-3 h-3" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          onClick={anadir}
          disabled={bloqueado || filas.length >= MAX_PARALELOS}
          className="text-[10px] px-2 py-1 border border-cyan-700/40 rounded text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-40 flex items-center gap-1"
          data-testid="parallel-add"
        >
          <Plus className="w-3 h-3" />
          {t('Agente', 'Agent')}
        </button>
        <button
          type="button"
          onClick={lanzar}
          disabled={bloqueado}
          className="text-[10px] px-2 py-1 border border-cyan-500/50 rounded text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-40 flex items-center gap-1"
          data-testid="parallel-run"
        >
          <Play className={`w-3 h-3 ${lanzando ? 'animate-spin' : ''}`} />
          {lanzando ? t('corriendo…', 'running…') : t('Lanzar en paralelo', 'Launch in parallel')}
        </button>
        {lanzando && sesionPadre && (
          <button
            type="button"
            onClick={cancelar}
            disabled={cancelando}
            className="text-[10px] px-2 py-1 border border-red-500/50 rounded text-red-200 hover:bg-red-500/10 disabled:opacity-40 flex items-center gap-1"
            data-testid="parallel-cancel"
          >
            <Square className="w-3 h-3" />
            {cancelando ? t('cancelando…', 'cancelling…') : t('Cancelar', 'Cancel')}
          </button>
        )}
      </div>

      {running && (
        <div className="text-[10px] text-[#ffff55] mt-1" data-testid="parallel-blocked">
          {t(
            'Hay una tarea en curso: su stream es el que se ve abajo. Detenla para lanzar otra tanda.',
            'A task is running: the stream below belongs to it. Stop it to launch another batch.',
          )}
        </div>
      )}
      {error && (
        <div className="text-[10px] text-red-300 mt-1" role="alert" data-testid="parallel-error">
          {error}
        </div>
      )}
      {aviso && (
        <div className="text-[10px] text-green-400 mt-1" data-testid="parallel-status">
          {aviso}
        </div>
      )}
    </div>
  );
}
