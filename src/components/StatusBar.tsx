import { useCallback, useEffect, useRef, useState } from 'react';
import { GitBranch, AlertTriangle, Cpu, Activity } from 'lucide-react';
import type { Language } from '../i18n/translations';

interface StatusBarProps {
  lang: Language;
  model: string;
  isGenerating?: boolean;
  diagnosticsCount?: number;
}

export function StatusBar({ lang, model, isGenerating = false, diagnosticsCount = 0 }: StatusBarProps) {
  const [branch, setBranch] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlight = useRef(false);

  /**
   * Sin sondeo. Antes esto pedía `git.status` cada 15 s, incluso con la pestaña
   * oculta: es un `POST /api/agent/run-tool` (rate-limit 60/min) y un `git`
   * lanzado en el servidor para un dato que casi nunca cambia. Ahora se pide al
   * montar, al volver a la ventana/pestaña y a mano desde la rama del pie.
   */
  const refreshBranch = useCallback(async () => {
    // Sin intervalo no hay sondeo de fondo que frenar: cada llamada es a propósito.
    if (inFlight.current) return;
    inFlight.current = true;
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/agent/run-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolId: 'git.status', input: {} }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const out = (data?.data?.output || data?.data?.status || '').toString();
      const m = out.match(/##\s*([^\s]+)/) || out.match(/On branch\s+(\S+)/);
      if (m) setBranch(m[1]);
    } catch {
      // Sin servidor se conserva la última rama conocida; el pie no es crítico.
    } finally {
      inFlight.current = false;
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshBranch();
    // Volver a la app es la señal de que pudo cambiar algo (checkout, rebase).
    const onReturn = () => {
      if (!document.hidden) refreshBranch();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [refreshBranch]);

  const L = (es: string, en: string) => (lang === 'es' ? es : en);
  const refreshLabel = L('Actualizar rama git', 'Refresh git branch');
  return (
    <div className="flex items-center gap-3 px-2 py-0.5 bg-[var(--nc-bg-panel)] text-[var(--nc-text-accent)] text-[11px] font-mono border-t border-[var(--nc-border-light)]/40 select-none">
      <button
        type="button"
        onClick={refreshBranch}
        disabled={isRefreshing}
        title={refreshLabel}
        aria-label={refreshLabel}
        className={`flex items-center gap-1 hover:text-white transition-colors ${isRefreshing ? 'opacity-60' : ''}`}
      >
        <GitBranch className="w-3 h-3" /> {branch || '—'}
      </button>
      <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> {model || '—'}</span>
      <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {diagnosticsCount}</span>
      <span className="flex items-center gap-1 ml-auto">
        <Activity className="w-3 h-3" /> {isGenerating ? L('agente: ejecutando', 'agent: running') : L('agente: inactivo', 'agent: idle')}
      </span>
    </div>
  );
}
