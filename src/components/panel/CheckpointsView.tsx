import type { Language } from '../../i18n/translations';
/**
 * Puntos de control del workspace (undo/restaurar).
 *
 * Lista los snapshots que se crean automáticamente antes de cada escritura del
 * agente y permite restaurarlos (revierte o borra los archivos afectados).
 */
import { useCallback, useEffect, useState } from 'react';
import { History, RotateCcw, Plus, RefreshCw } from 'lucide-react';
import {
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  type CheckpointMeta,
} from '../../utils/checkpointsApi';

interface CheckpointsViewProps {
  projectPath: string;
  lang?: Language;
}

function fmt(ts: number, lang: Language): string {
  try {
    return new Date(ts).toLocaleString(lang === 'es' ? 'es-ES' : lang === 'de' ? 'de-DE' : 'en-US');
  } catch {
    return String(ts);
  }
}

export function CheckpointsView({ projectPath, lang = 'es' }: CheckpointsViewProps) {
  
  const [items, setItems] = useState<CheckpointMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await listCheckpoints(projectPath);
    setItems(r.checkpoints);
    if (r.error) setError(r.error);
    setLoading(false);
  }, [projectPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRestore = async (id: string) => {
    setConfirmId(null);
    const r = await restoreCheckpoint(id, projectPath);
    if (!r.ok) {
      setError(r.error || (lang === 'es' ? 'No se pudo restaurar' : lang === 'de' ? 'Wiederherstellung fehlgeschlagen' : 'Could not restore'));
      return;
    }
    const n = (r.restored?.length || 0) + (r.deleted?.length || 0);
    setStatus(lang === 'es' ? `Restaurado: ${n} archivo(s)` : lang === 'de' ? `Wiederhergestellt: ${n} Datei(en)` : `Restored: ${n} file(s)`);
    await load();
  };

  const onCreate = async () => {
    const r = await createCheckpoint(undefined, projectPath);
    if (!r.ok) {
      setError(r.error || (lang === 'es' ? 'No se pudo crear' : lang === 'de' ? 'Erstellen fehlgeschlagen' : 'Could not create'));
      return;
    }
    setStatus(lang === 'es' ? 'Punto de control creado' : lang === 'de' ? 'Checkpoint erstellt' : 'Checkpoint created');
    await load();
  };

  return (
    <div className="flex flex-col h-full min-h-0 text-[11px] font-mono">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[#004466] shrink-0">
        <History className="w-3.5 h-3.5 text-[#00ffff]" />
        <span className="font-bold text-[#00ffff]">{lang === 'es' ? 'Puntos de control' : lang === 'de' ? 'Checkpoints' : 'Checkpoints'}</span>
        <button
          onClick={() => void onCreate()}
          title={lang === 'es' ? 'Crear punto de control' : lang === 'de' ? 'Checkpoint erstellen' : 'Create checkpoint'}
          aria-label={lang === 'es' ? 'Crear punto de control' : lang === 'de' ? 'Checkpoint erstellen' : 'Create checkpoint'}
          className="ml-auto p-1 text-black/80 hover:text-[#ffff55]"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => void load()}
          title={lang === 'es' ? 'Refrescar' : lang === 'de' ? 'Aktualisieren' : 'Refresh'}
          aria-label={lang === 'es' ? 'Refrescar' : lang === 'de' ? 'Aktualisieren' : 'Refresh'}
          className="p-1 text-black/80 hover:text-[#00ffff]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {status && <div className="px-2 py-1 text-[#ffff55] border-b border-[#004466] shrink-0">{status}</div>}
      {error && <div className="px-2 py-1 text-red-300 border-b border-[#004466] shrink-0">{error}</div>}

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        {loading && <div className="text-[#00ffff]">{lang === 'es' ? 'Cargando…' : lang === 'de' ? 'Wird geladen…' : 'Loading…'}</div>}

        {!loading && items.length === 0 && (
          <div className="text-white/60 leading-relaxed">
            {lang === 'es' ? 'Sin puntos de control todavía. Se crean automáticamente antes de cada cambio del agente.'
              : lang === 'de'
                ? 'Noch keine Checkpoints. Sie werden vor jeder Agentenänderung automatisch erstellt.'
                : 'No checkpoints yet. They are created automatically before every agent change.'}
          </div>
        )}

        {!loading &&
          items.map((cp) => (
            <div key={cp.id} className="border border-[#004466] bg-[#000022] p-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[#ffff55] truncate flex-1" title={cp.label}>
                  {cp.label}
                </span>
                {cp.tool && (
                  <span className="text-[9px] px-1 border border-[#00ffff]/40 text-[#00ffff]">{cp.tool}</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[9px] text-white/60">
                <span>{fmt(cp.ts, lang)}</span>
                <span>
                  · {cp.files.length} {lang === 'es' ? 'archivo(s)' : lang === 'de' ? 'Datei(en)' : 'file(s)'}
                </span>
              </div>
              <div className="mt-1.5 flex justify-end gap-1">
                {confirmId === cp.id ? (
                  <>
                    <span className="text-[9px] text-white/70 self-center">
                      {lang === 'es' ? '¿Restaurar?' : lang === 'de' ? 'Wiederherstellen?' : 'Restore?'}
                    </span>
                    <button
                      onClick={() => void onRestore(cp.id)}
                      className="nc-button text-[10px] px-2 py-0.5 bg-[#ffff55] text-black font-bold"
                    >
                      {lang === 'es' ? 'Sí' : lang === 'de' ? 'Ja' : 'Yes'}
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="nc-button text-[10px] px-2 py-0.5"
                    >
                      {lang === 'es' ? 'No' : lang === 'de' ? 'Nein' : 'No'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmId(cp.id)}
                    className="nc-button text-[10px] px-2 py-0.5 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> {lang === 'es' ? 'Restaurar' : lang === 'de' ? 'Wiederherstellen' : 'Restore'}
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
