import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getSubAgentsConnectionSnapshot,
  getSubAgentsSnapshot,
  subscribeSubAgentsStore,
  type SubAgentRow,
  type SubAgentsConnectionState,
} from '../agent/subAgentsStream';
import type { Language } from '../i18n/translations';
import { deText } from '../i18n/de';

/** Traduce un par es/en; el alemán sale del diccionario, con inglés de reserva. */
type Traductor = (es: string, en: string) => string;

/**
 * Subagentes que corren en el servidor (`spawn_agents` / `task`).
 *
 * El panel de subagentes de antes sólo conocía los agentes que se creaban a
 * mano en la interfaz; los subagentes reales se lanzan en el servidor y hasta
 * ahora no había forma de verlos: la tool devolvía todos los resultados de
 * golpe cuando terminaban.
 *
 * El estado llega por SSE desde `subAgentsStream` (atado a la sesión padre, no a
 * este panel), así que al abrir la pestaña se pinta lo último recibido y no hay
 * que sondear. Si el stream se cae, el panel lo dice: una lista congelada sin
 * aviso se lee como si los subagentes siguieran igual.
 */

function estadoTexto(status: SubAgentRow['status'], t: Traductor): string {
  if (status === 'running') return t('corriendo', 'running');
  if (status === 'completed') return t('completo', 'done');
  if (status === 'cancelled') return t('cancelado', 'cancelled');
  return t('falló', 'failed');
}

function colorEstado(status: SubAgentRow['status']): string {
  if (status === 'running') return 'text-[var(--nc-text)]';
  if (status === 'completed') return 'text-green-400';
  if (status === 'cancelled') return 'text-[var(--nc-text-accent)]';
  return 'text-red-400';
}

/**
 * Tiempo que tardó el subagente, en una unidad legible. Con `endedAt` el dato
 * ya está en la fila, así que no hace falta recalcular nada mientras se ve.
 */
function duracionTexto(row: SubAgentRow): string {
  if (!row.endedAt) return '';
  const ms = row.endedAt - row.startedAt;
  if (ms < 1000) return `${Math.round(Math.max(0, ms))} ms`;
  const segundos = ms / 1000;
  if (segundos < 60) return `${segundos.toFixed(1)} s`;
  const minutos = Math.floor(segundos / 60);
  return `${minutos} m ${Math.round(segundos - minutos * 60)} s`;
}

/**
 * Tiempo en marcha, redondeado a segundos: «hace 40 s», «40 s ago», «seit 40 s».
 * La preposición va dentro porque cambia de sitio según el idioma. Sin
 * decimales: el número se mueve solo y «41.0 s» parpadeando es peor que «41 s».
 */
function haceTexto(ms: number, lang: Language): string {
  const total = Math.max(0, ms);
  if (total < 1000) {
    return lang === 'es' ? 'hace menos de 1 s' : lang === 'de' ? 'seit unter 1 s' : 'less than 1 s ago';
  }
  const segundos = Math.floor(total / 1000);
  let valor: string;
  if (segundos < 60) {
    valor = `${segundos} s`;
  } else {
    const minutos = Math.floor(segundos / 60);
    const resto = segundos - minutos * 60;
    valor = resto ? `${minutos} m ${resto} s` : `${minutos} m`;
  }
  return lang === 'es' ? `hace ${valor}` : lang === 'de' ? `seit ${valor}` : `${valor} ago`;
}

/**
 * Resumen de la fila pegada: cuántos siguen corriendo y desde cuándo. Cuando
 * hay varios, la espera más larga (el que arrancó antes) es el dato que importa.
 */
function resumenCorriendo(rows: SubAgentRow[], ahora: number, t: Traductor, lang: Language): string {
  const activos = rows.filter((r) => r.status === 'running');
  if (activos.length === 0) return '';
  const masAntiguo = activos.reduce((a, r) => (r.startedAt < a.startedAt ? r : a));
  const hace = haceTexto(ahora - masAntiguo.startedAt, lang);
  const cuantos = `${activos.length} ${t('corriendo', 'running')}`;
  if (activos.length === 1) return `${cuantos} · ${hace}`;
  return `${cuantos} · ${t('el más antiguo', 'oldest')} ${hace}`;
}

/** «2.4 s · 5 pasos», sin dejar separadores colgando si falta un dato. */
function resumenTexto(row: SubAgentRow, t: Traductor): string {
  const partes: string[] = [];
  const duracion = duracionTexto(row);
  if (duracion) partes.push(duracion);
  if (row.steps > 0) partes.push(`${row.steps} ${row.steps === 1 ? t('paso', 'step') : t('pasos', 'steps')}`);
  return partes.join(' · ');
}

/**
 * Los que están corriendo van primero y, dentro de cada grupo, el más reciente
 * arriba. El servidor manda la lista en orden de llegada, así que sin ordenar
 * un subagente terminado podía quedar por encima del que sigue trabajando.
 */
export function ordenarSubAgentes(rows: SubAgentRow[]): SubAgentRow[] {
  return [...rows].sort((a, b) => {
    const corrida = Number(b.status === 'running') - Number(a.status === 'running');
    if (corrida !== 0) return corrida;
    if (a.startedAt !== b.startedAt) return b.startedAt - a.startedAt;
    return a.id.localeCompare(b.id);
  });
}

/** Respuestas que el usuario dejó plegadas, para no reabrirlas al volver al panel. */
const PLEGADO_KEY = 'commander_subagents_collapsed_v1';
/** Tope de ids recordados: la lista no debe crecer sin fin entre turnos. */
const PLEGADO_MAX = 200;
/** Si el filtro de fallidos estaba activo, se mantiene al reabrir el panel. */
const FILTRO_FALLIDOS_KEY = 'commander_subagents_failed_only_v1';

function leerPlegadas(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const crudo = localStorage.getItem(PLEGADO_KEY);
    if (!crudo) return {};
    const ids = JSON.parse(crudo);
    if (!Array.isArray(ids)) return {};
    const plegadas: Record<string, boolean> = {};
    for (const id of ids) if (typeof id === 'string') plegadas[id] = true;
    return plegadas;
  } catch {
    // Valor corrupto o almacenamiento bloqueado: se empieza sin nada plegado.
    return {};
  }
}

function leerFiltroFallidos(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(FILTRO_FALLIDOS_KEY) === 'true';
  } catch {
    return false;
  }
}

function guardarFiltroFallidos(activo: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FILTRO_FALLIDOS_KEY, activo ? 'true' : 'false');
  } catch {
    /* sin almacenamiento disponible */
  }
}

function guardarPlegadas(plegadas: Record<string, boolean>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const ids = Object.keys(plegadas).filter((id) => plegadas[id]).slice(-PLEGADO_MAX);
    localStorage.setItem(PLEGADO_KEY, JSON.stringify(ids));
  } catch {
    /* sin almacenamiento disponible */
  }
}

/**
 * A partir de aquí la respuesta se muestra recortada. Es un número de
 * caracteres y no de líneas porque las respuestas vienen sin formato fijo.
 */
const LONGITUD_RECORTE = 400;

/**
 * Umbral de «posible atasco», configurable en Configuración. Cinco minutos es
 * holgado para una tarea normal y bastante menos que «me olvidé del panel».
 */
export const ATASCO_KEY = 'commander_subagents_stuck_minutes';
/** Configuración avisa por aquí para que el panel no necesite recargarse. */
export const PREFERENCIAS_EVENT = 'commander:prefs-changed';
const ATASCO_MINUTOS_POR_DEFECTO = 5;
const ATASCO_MINUTOS_MIN = 1;
const ATASCO_MINUTOS_MAX = 120;

/** Deja el valor en un rango usable: ni cero ni un número absurdo de horas. */
export function normalizarUmbralAtasco(minutos: number): number {
  if (!Number.isFinite(minutos)) return ATASCO_MINUTOS_POR_DEFECTO;
  return Math.min(ATASCO_MINUTOS_MAX, Math.max(ATASCO_MINUTOS_MIN, Math.round(minutos)));
}

function leerUmbralAtasco(): number {
  if (typeof localStorage === 'undefined') return ATASCO_MINUTOS_POR_DEFECTO;
  try {
    const crudo = localStorage.getItem(ATASCO_KEY);
    if (crudo === null || crudo.trim() === '') return ATASCO_MINUTOS_POR_DEFECTO;
    const minutos = Number(crudo);
    // Valor basura o fuera de rango: se vuelve al valor por defecto.
    if (!Number.isFinite(minutos) || minutos <= 0) return ATASCO_MINUTOS_POR_DEFECTO;
    return normalizarUmbralAtasco(minutos);
  } catch {
    return ATASCO_MINUTOS_POR_DEFECTO;
  }
}

/** El último lanzado: es el que se ancla y el que queda pegado arriba. */
function masReciente(rows: SubAgentRow[]): SubAgentRow | null {
  return rows.reduce<SubAgentRow | null>((a, r) => (a === null || r.startedAt > a.startedAt ? r : a), null);
}

function conexionTexto(state: SubAgentsConnectionState, t: Traductor): string {
  if (state === 'live') return t('en vivo', 'live');
  if (state === 'connecting') return t('conectando…', 'connecting…');
  if (state === 'reconnecting') return t('reconectando…', 'reconnecting…');
  if (state === 'offline') return t('sin conexión', 'offline');
  if (state === 'ended') return t('sesión cerrada', 'session closed');
  return t('sin sesión', 'no session');
}

function colorConexion(state: SubAgentsConnectionState): string {
  if (state === 'live') return 'text-green-400';
  if (state === 'offline') return 'text-red-400';
  if (state === 'ended') return 'text-cyan-500/70';
  return 'text-[var(--nc-text-accent)]';
}

function vacioTexto(state: SubAgentsConnectionState, t: Traductor): string {
  if (state === 'offline') return t('Sin conexión: el estado se actualiza al volver la red.', 'Offline: the state updates when the network returns.');
  if (state === 'reconnecting') return t('Reconectando con el servidor…', 'Reconnecting to the server…');
  if (state === 'connecting') return t('Conectando con el servidor…', 'Connecting to the server…');
  if (state === 'ended') return t('La sesión del servidor ya no existe: no hay nada más que mostrar.', 'The server session no longer exists: there is nothing left to show.');
  return t('Sin subagentes todavía…', 'No subagents yet…');
}

export function ServerSubAgents({ lang = 'es' }: { lang?: Language }) {
  const t: Traductor = (es, en) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);
  const rows = useSyncExternalStore(subscribeSubAgentsStore, getSubAgentsSnapshot, getSubAgentsSnapshot);
  const connection = useSyncExternalStore(
    subscribeSubAgentsStore,
    getSubAgentsConnectionSnapshot,
    getSubAgentsConnectionSnapshot
  );
  const ordenadas = ordenarSubAgentes(rows);
  // Filtro local: con muchos subagentes, revisar los fallos uno a uno es peor
  // que poder mirar sólo esos.
  const [soloFallidos, setSoloFallidos] = useState(leerFiltroFallidos);
  const visibles = soloFallidos ? ordenadas.filter((r) => r.status === 'failed') : ordenadas;
  // La fila del más reciente se queda pegada arriba de la lista, así que al
  // recorrer los que corren no se pierde de vista la última tarea lanzada.
  // Con el filtro activo se fija el último de los visibles.
  const fijadoId = masReciente(visibles)?.id ?? '';
  const filasRef = useRef<Record<string, HTMLLIElement | null>>({});
  // Respuestas plegadas por el usuario. Empiezan abiertas: plegar es una
  // elección suya, no algo que el panel imponga al llegar el resultado.
  const [plegadas, setPlegadas] = useState<Record<string, boolean>>(leerPlegadas);
  // Respuestas largas que se abrieron del todo. No se persiste: al volver al
  // panel lo normal es querer el resumen otra vez, no el muro de texto.
  const [completas, setCompletas] = useState<Record<string, boolean>>({});
  const [umbralAtasco, setUmbralAtasco] = useState(leerUmbralAtasco);

  // Cambiar el umbral en Configuración debe verse aquí sin recargar la página.
  useEffect(() => {
    const alCambiar = () => setUmbralAtasco(leerUmbralAtasco());
    window.addEventListener(PREFERENCIAS_EVENT, alCambiar);
    return () => window.removeEventListener(PREFERENCIAS_EVENT, alCambiar);
  }, []);

  // Se recuerda entre montajes del panel (y recargas): reabrir el panel no debe
  // desplegar otra vez las respuestas largas que ya habías cerrado.
  useEffect(() => { guardarPlegadas(plegadas); }, [plegadas]);
  // Igual con el filtro: quien revisa fallos quiere seguir en esa vista.
  useEffect(() => { guardarFiltroFallidos(soloFallidos); }, [soloFallidos]);
  const corriendo = rows.filter((r) => r.status === 'running').length;
  const terminados = rows.length - corriendo;
  // Un fallo no debe verse como avance limpio: la barra se tiñe en cuanto hay uno.
  const fallidos = rows.filter((r) => r.status === 'failed').length;
  // Cancelar a mano también deja de correr, pero no es lo mismo que acabar bien:
  // sin nombrarlos, una tanda cortada se resume igual que una que salió sola.
  const cancelados = rows.filter((r) => r.status === 'cancelled').length;
  // Sin filas no hay progreso que calcular (evita 0/0).
  const porcentaje = rows.length > 0 ? Math.round((terminados / rows.length) * 100) : 0;
  // Con el stream caído lo que se ve puede estar desfasado: se atenúa en vez
  // de seguir mostrando «corriendo» como si nada.
  const desfasado = connection.state === 'offline' || connection.state === 'reconnecting';

  // El resumen de la fila pegada dice «hace cuánto»: sin un reloj que avance
  // se quedaría en el número de cuando llegó el último evento. Sólo late
  // mientras hay alguien corriendo, y se apaga en cuanto no queda ninguno.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (corriendo === 0) return;
    setAhora(Date.now());
    const timer = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [corriendo]);

  // Al abrir el panel se deja a la vista el último lanzado: con los que corren
  // ordenados arriba, el más reciente puede quedar por debajo del borde y el
  // panel parecería abrir en una tarea vieja. Sólo se ancla al montarse, para
  // no mover la lista mientras se lee.
  useEffect(() => {
    const reciente = masReciente(getSubAgentsSnapshot());
    if (!reciente) return;
    filasRef.current[reciente.id]?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  return (
    <div className="mt-3 border border-cyan-700/40 rounded p-2" data-testid="server-subagents">
      <div className="flex items-center justify-between text-xs text-cyan-300 mb-1">
        <span>{t('Subagentes del servidor', 'Server subagents')}</span>
        <span className="flex items-center gap-2 text-[10px]">
          <span className="text-cyan-500/70" data-testid="subagents-progress">
            {rows.length === 0
              ? `0 ${t('terminados', 'finished')}`
              : `${corriendo > 0 ? `${corriendo} ${t('corriendo', 'running')} · ` : ''}${terminados}/${rows.length} ${t('terminados', 'finished')}${cancelados > 0 ? ` · ${cancelados} ${t('cancelados', 'cancelled')}` : ''} · ${porcentaje} %`}
          </span>
          {(fallidos > 0 || soloFallidos) && (
            <button
              type="button"
              onClick={() => setSoloFallidos((prev) => !prev)}
              aria-pressed={soloFallidos}
              className={`underline ${soloFallidos ? 'text-red-300' : 'text-cyan-500/70 hover:text-cyan-200'}`}
              data-testid="subagents-filter-failed"
            >
              {soloFallidos ? t('ver todos', 'show all') : `${t('sólo fallidos', 'failed only')} (${fallidos})`}
            </button>
          )}
          {connection.state !== 'idle' && (
            <span className={colorConexion(connection.state)} data-connection={connection.state}>
              ● {conexionTexto(connection.state, t)}
            </span>
          )}
        </span>
      </div>

      {/* Barra fina bajo la cabecera: el mismo porcentaje que el texto, para
          leer el avance de un vistazo sin contar filas. */}
      {rows.length > 0 && (
        <div
          className="h-[3px] bg-cyan-900/40 rounded overflow-hidden mb-1"
          role="progressbar"
          aria-label={t('Progreso de los subagentes', 'Subagent progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={porcentaje}
          data-testid="subagents-progress-bar"
        >
          <div
            className={`h-full transition-[width] duration-300 ${fallidos > 0 ? 'bg-red-400' : cancelados > 0 ? 'bg-[var(--nc-active-bg)]' : 'bg-[var(--nc-highlight-bg)]'}`}
            style={{ width: `${porcentaje}%` }}
            data-failed={fallidos > 0 ? 'true' : undefined}
            data-cancelled={cancelados > 0 ? 'true' : undefined}
            data-testid="subagents-progress-fill"
          />
        </div>
      )}

      {desfasado && (
        <div className="text-[10px] text-[var(--nc-text-accent)] mb-1" data-testid="subagents-stale">
          {conexionTexto(connection.state, t)} {t('Estos datos pueden estar desfasados', 'This data may be stale')}
          {connection.state === 'offline'
            ? t('; se reconecta solo al volver la red.', '; it reconnects on its own when the network returns.')
            : '.'}
        </div>
      )}

      {rows.length === 0 && (
        <div className="text-[10px] text-cyan-500/60">{vacioTexto(connection.state, t)}</div>
      )}

      {/* La lista es su propio contenedor con scroll para que la fila pegada
          se quede arriba del panel y no del viewport. */}
      {soloFallidos && visibles.length === 0 && (
        <div className="text-[10px] text-cyan-500/60">{t('Sin subagentes fallidos.', 'No failed subagents.')}</div>
      )}

      <ul className={`space-y-1 max-h-72 overflow-y-auto ${desfasado ? 'opacity-60' : ''}`}>
        {visibles.map((r) => {
          const fijada = r.id === fijadoId;
          const plegada = Boolean(plegadas[r.id]);
          // Sólo las respuestas largas se recortan; el resto se ve entero.
          const recortada = !completas[r.id] && (r.answer?.length ?? 0) > LONGITUD_RECORTE;
          // Se calcula contra `ahora`, así que el aviso aparece solo al cruzar
          // el umbral sin esperar a un evento nuevo del servidor.
          const atascado = r.status === 'running' && ahora - r.startedAt >= umbralAtasco * 60_000;
          return (
            <li
              key={r.id}
              ref={(el) => { filasRef.current[r.id] = el; }}
              className={`text-[10px] border rounded p-1 ${
                fijada
                  ? 'sticky top-0 z-10 bg-[var(--nc-bg-panel)] border-cyan-500/50'
                  : 'border-cyan-900/40'
              } ${atascado ? 'outline outline-1 outline-[var(--nc-text-accent)]' : ''}`}
              data-status={r.status}
              data-pinned={fijada ? 'true' : undefined}
              data-stuck={atascado ? 'true' : undefined}
            >
              <div className="flex items-center gap-2">
                <span className={colorEstado(r.status)}>●</span>
                <span className="text-[var(--nc-text-accent)] truncate">{r.goal}</span>
                {atascado && (
                  <span className="text-[var(--nc-text-accent)]" data-testid="subagent-stuck">
                    {`${t('posible atasco', 'possible stall')} (> ${umbralAtasco} min)`}
                  </span>
                )}
                <span className={`ml-auto ${colorEstado(r.status)}`}>{estadoTexto(r.status, t)}</span>
              </div>
              {r.status === 'running' && r.steps > 0 && (
                <div className="text-cyan-600/70 mt-0.5">
                  {r.steps} {t('pasos', 'steps')}
                </div>
              )}
              {fijada && resumenCorriendo(rows, ahora, t, lang) && (
                <div className="text-[var(--nc-text-accent)] mt-0.5" data-testid="subagent-pinned-summary">
                  {resumenCorriendo(rows, ahora, t, lang)}
                </div>
              )}
              {r.status !== 'running' && resumenTexto(r, t) && (
                <div className="text-cyan-600/70 mt-0.5" data-testid="subagent-meta">{resumenTexto(r, t)}</div>
              )}
              {r.answer && (
                <div className="mt-0.5">
                  <button
                    type="button"
                    onClick={() => setPlegadas((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                    aria-expanded={plegada ? 'false' : 'true'}
                    className="text-cyan-400/80 hover:text-cyan-100 underline"
                    data-testid="subagent-answer-toggle"
                  >
                    {plegada ? t('ver respuesta', 'show answer') : t('ocultar respuesta', 'hide answer')}
                  </button>
                  {!plegada && (
                    <div className="text-cyan-200 mt-0.5 whitespace-pre-wrap" data-testid="subagent-answer">
                      {recortada ? `${r.answer.slice(0, LONGITUD_RECORTE)}…` : r.answer}
                    </div>
                  )}
                  {!plegada && (r.answer.length > LONGITUD_RECORTE) && (
                    <button
                      type="button"
                      onClick={() => setCompletas((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                      className="text-cyan-400/80 hover:text-cyan-100 underline mt-0.5"
                      data-testid="subagent-answer-more"
                    >
                      {completas[r.id]
                        ? t('ver menos', 'show less')
                        : `${t('ver el resto', 'show the rest')} (${r.answer.length - LONGITUD_RECORTE} ${t('caracteres más', 'more characters')})`}
                    </button>
                  )}
                </div>
              )}
              {r.error && <div className="text-red-300 mt-0.5 whitespace-pre-wrap">{r.error}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
