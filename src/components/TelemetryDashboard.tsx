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
      <div className="flex-1 min-w-0 min-h-0 h-full flex items-center justify-center nc-container p-4 font-mono text-sm text-[#ffff55]">
        [CARGANDO TELEMETRÍA DE LA SESIÓN...]
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col p-4 nc-container font-mono text-xs overflow-hidden">
      <div className="bg-[#00aaaa] text-black font-bold px-3 py-1 flex items-center justify-between border-2 border-black shrink-0 mb-3">
        <span>╔═ MONITOR DE TELEMETRÍA Y MÉTRICAS (.LOG) ═╗</span>
        <span className="text-[10px] bg-[#0000aa] text-[#ffff55] px-2 py-0.5 border border-white">
          REGISTROS: {logs.length}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto nc-panel p-2">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="border-b-2 border-[#00ffff] text-[#ffff55] bg-[#0000aa]">
              <th className="p-2">MODELO</th>
              <th className="p-2">LATENCIA</th>
              <th className="p-2">TOKENS</th>
              <th className="p-2">ESTADO / ERROR</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-4 text-center text-[#00aaaa] italic">
                  No hay registros de telemetría aún. Envía prompts para capturar métricas.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-[#000055] hover:bg-[#0000aa]">
                  <td className="p-2 font-bold text-white">{log.modelUsed}</td>
                  <td className="p-2 text-[#00ffff]">{log.latencyMs} ms</td>
                  <td className="p-2 text-[#ffff55]">{log.tokensUsed} tok</td>
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
