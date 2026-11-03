import React, { useEffect, useState } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Language } from '../i18n/translations';

interface TelemetryDashboardProps {
  lang?: Language;
}

interface TelemetryEntry {
  id: string;
  modelUsed: string;
  latencyMs: number;
  tokensUsed: number;
  error: string | null;
  timestamp: any;
}

export const TelemetryDashboard: React.FC<TelemetryDashboardProps> = () => {
  const [logs, setLogs] = useState<TelemetryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      if (!auth.currentUser) {
        setLoading(false);
        return;
      }
      try {
        const q = query(
          collection(db, 'telemetry_logs'),
          where('userId', '==', auth.currentUser.uid),
          orderBy('timestamp', 'desc'),
          limit(50)
        );
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TelemetryEntry));
        setLogs(data);
      } catch (error) {
        console.error('Error fetching telemetry:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 min-w-0 min-h-0 h-full flex items-center justify-center nc-container p-4 font-mono text-sm text-[var(--nc-text-accent)]">
        [CARGANDO TELEMETRÍA DE LA SESIÓN...]
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col p-4 nc-container font-mono text-xs overflow-hidden">
      <div className="bg-[var(--nc-header-bg)] text-black font-bold px-3 py-1 flex items-center justify-between border-2 border-black shrink-0 mb-3">
        <span>╔═ MONITOR DE TELEMETRÍA Y MÉTRICAS (.LOG) ═╗</span>
        <span className="text-[10px] bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)] px-2 py-0.5 border border-white">
          REGISTROS: {logs.length}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto nc-panel p-2">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="border-b-2 border-[var(--nc-border-light)] text-[var(--nc-text-accent)] bg-[var(--nc-bg-main)]">
              <th className="p-2">MODELO</th>
              <th className="p-2">LATENCIA</th>
              <th className="p-2">TOKENS</th>
              <th className="p-2">ESTADO / ERROR</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-4 text-center text-[var(--nc-text-dim)] italic">
                  No hay registros de telemetría aún. Envía prompts para capturar métricas.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-[var(--nc-border-dark)] hover:bg-[var(--nc-bg-hover)]">
                  <td className="p-2 font-bold text-white">{log.modelUsed}</td>
                  <td className="p-2 text-[var(--nc-text)]">{log.latencyMs} ms</td>
                  <td className="p-2 text-[var(--nc-text-accent)]">{log.tokensUsed} tok</td>
                  <td className="p-2">
                    {log.error ? (
                      <span className="text-red-400 font-bold">ERR: {log.error}</span>
                    ) : (
                      <span className="text-green-400 font-bold">200 OK</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
