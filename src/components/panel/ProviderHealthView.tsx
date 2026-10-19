import React, { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface ProviderHealth { providerId: string; healthy: boolean; latencyMs: number; errorCount: number; lastError?: string; circuitOpen: boolean; }
interface ProviderMetric { requests: number; successes: number; errors: number; errorRate: number; avgLatencyMs: number; healthy: boolean; circuitOpen: boolean; }

interface Props { lang?: 'es' | 'en' | 'de'; }

export const ProviderHealthView: React.FC<Props> = ({ lang = 'es' }) => {
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [metrics, setMetrics] = useState<Record<string, ProviderMetric>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [hRes, mRes] = await Promise.all([
        fetch('/api/providers/health', { credentials: 'include' }),
        fetch('/api/providers/metrics', { credentials: 'include' }),
      ]);
      const hData = await hRes.json().catch(() => ({}));
      const mData = await mRes.json().catch(() => ({}));
      setHealth(Array.isArray(hData) ? hData : (hData?.providers || []));
      setMetrics(mData || {});
    } catch (e: any) {
      setError(e?.message || 'Error cargando métricas');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const reset = async (id: string) => {
    try {
      await fetch(`/api/providers/${encodeURIComponent(id)}/reset`, { method: 'POST', credentials: 'include' });
      await load();
    } catch { /* ignore */ }
  };

  const t = (es: string, en: string, de: string) => lang === 'es' ? es : lang === 'de' ? de : en;

  return (
    <div className="flex-1 flex flex-col min-h-0 p-2 gap-2 font-mono text-xs text-white overflow-auto">
      <div className="flex items-center justify-between">
        <span className="text-[#ffff55] font-bold">{t('Proveedores / Observabilidad', 'Providers / Observability', 'Anbieter / Beobachtbarkeit')}</span>
        <button onClick={load} disabled={loading} className="nc-button !px-2 !py-1 text-[10px]">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {error && <div className="text-red-400 text-[10px]">{error}</div>}
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="text-[#00ffff] border-b border-[#00ffff]/40">
            <th className="text-left p-1">ID</th>
            <th className="text-left p-1">{t('Estado', 'Status', 'Status')}</th>
            <th className="text-right p-1">{t('Latencia', 'Latency', 'Latenz')}</th>
            <th className="text-right p-1">{t('Req', 'Req', 'Req')}</th>
            <th className="text-right p-1">{t('Errores', 'Errors', 'Fehler')}</th>
            <th className="text-right p-1">{t('Tasa err', 'Err rate', 'Fehlerrate')}</th>
            <th className="text-left p-1">{t('Último error', 'Last error', 'Letzter Fehler')}</th>
            <th className="p-1"></th>
          </tr>
        </thead>
        <tbody>
          {health.map((h) => {
            const m = metrics[h.providerId];
            return (
              <tr key={h.providerId} className="border-b border-[#004466]">
                <td className="p-1 text-[#00ffff]">{h.providerId}</td>
                <td className="p-1">
                  {h.circuitOpen ? (
                    <span className="text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {t('Circuito abierto', 'Circuit open', 'Schaltung offen')}</span>
                  ) : h.healthy ? (
                    <span className="text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> OK</span>
                  ) : (
                    <span className="text-yellow-400">{t('Degradado', 'Degraded', 'Eingeschränkt')}</span>
                  )}
                </td>
                <td className="p-1 text-right">{h.latencyMs}ms</td>
                <td className="p-1 text-right">{m?.requests ?? 0}</td>
                <td className="p-1 text-right">{m?.errors ?? 0}</td>
                <td className="p-1 text-right">{m ? (m.errorRate * 100).toFixed(1) + '%' : '-'}</td>
                <td className="p-1 text-[#aaaaaa] truncate max-w-[180px]">{h.lastError || '-'}</td>
                <td className="p-1">
                  {h.circuitOpen && (
                    <button onClick={() => reset(h.providerId)} className="nc-button !px-1 !py-0 text-[9px]">
                      {t('Reset', 'Reset', 'Zurücksetzen')}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {health.length === 0 && !loading && (
            <tr><td colSpan={8} className="p-2 text-center text-[#aaaaaa]">{t('Sin datos', 'No data', 'Keine Daten')}</td></tr>
          )}
        </tbody>
      </table>
      {loading && <div className="text-[#00ffff] text-[10px]">{t('Cargando…', 'Loading…', 'Lädt…')}</div>}
    </div>
  );
};