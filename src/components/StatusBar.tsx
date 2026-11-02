import { useEffect, useState } from 'react';
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
  useEffect(() => {
    let cancelled = false;
    const fetchBranch = async () => {
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
        if (!cancelled && m) setBranch(m[1]);
      } catch { /* ignore */ }
    };
    fetchBranch();
    const id = setInterval(fetchBranch, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  const L = (es: string, en: string) => (lang === 'es' ? es : en);
  return (
    <div className="flex items-center gap-3 px-2 py-0.5 bg-[#000080] text-[#ffff55] text-[11px] font-mono border-t border-[#00ffff]/40 select-none">
      <span className="flex items-center gap-1"><GitBranch className="w-3 h-3" /> {branch || '—'}</span>
      <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> {model || '—'}</span>
      <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {diagnosticsCount}</span>
      <span className="flex items-center gap-1 ml-auto">
        <Activity className="w-3 h-3" /> {isGenerating ? L('agente: ejecutando', 'agent: running') : L('agente: inactivo', 'agent: idle')}
      </span>
    </div>
  );
}
