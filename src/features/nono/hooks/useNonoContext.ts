import { useState, useCallback } from 'react';
import { listObservations, saveObservation } from '../nonoPersistence';

export interface NonoContextSuggestion {
  id: string;
  kind: 'diagnostics' | 'git' | 'terminal' | 'memory' | 'todo';
  text: string;
  severity: 'info' | 'warning' | 'error';
}

async function runTool(toolId: string, input: any = {}): Promise<any> {
  try {
    const res = await fetch('/api/agent/run-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId, input }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Hook context-aware para Nono: recoge diagnósticos TS y estado git del
 * workspace y genera sugerencias no intrusivas (toasts). Opt-in: solo se
 * activa si `enabled` es true. No bloquea la UI.
 */
export function useNonoContext(enabled: boolean, projectId: string | null = null) {
  const [suggestions, setSuggestions] = useState<NonoContextSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    const out: NonoContextSuggestion[] = [];
    try {
      const diag = await runTool('read_diagnostics', {});
      const d = diag?.data ?? diag;
      const errs = Array.isArray(d?.errors) ? d.errors : (Array.isArray(d) ? d : []);
      if (errs.length > 0) {
        out.push({
          id: 'diag',
          kind: 'diagnostics',
          text: `Hay ${errs.length} error(es) de TypeScript. ¿Revisamos el primero?`,
          severity: 'error',
        });
        // Persistir observación durable
        saveObservation(projectId, 'diagnostics', `${errs.length} errores TS detectados`).catch(() => {});
      }
      const git = await runTool('git.status', {});
      const g = git?.data ?? git;
      const branch = g?.branch || g?.current;
      const dirty = Array.isArray(g?.files) ? g.files.length : (g?.dirty ? 1 : 0);
      if (dirty > 0) {
        out.push({
          id: 'git',
          kind: 'git',
          text: `${dirty} archivo(s) modificado(s) en ${branch || 'la rama actual'}. ¿Hacemos commit?`,
          severity: 'info',
        });
        saveObservation(projectId, 'git', `${dirty} archivos modificados en ${branch || 'rama actual'}`).catch(() => {});
      }
      // TODO/FIXME/HACK en el código: recordatorio no intrusivo
      const todos = await runTool('fs.grep', { pattern: 'TODO|FIXME|HACK|XXX' });
      const t = todos?.data ?? todos;
      const todoMatches = Array.isArray(t?.matches) ? t.matches : (Array.isArray(t) ? t : []);
      if (todoMatches.length > 0) {
        out.push({
          id: 'todo',
          kind: 'todo',
          text: `${todoMatches.length} TODO/FIXME/HACK en el código. ¿Los revisamos?`,
          severity: 'info',
        });
        saveObservation(projectId, 'todo', `${todoMatches.length} TODO/FIXME/HACK encontrados`).catch(() => {});
      }
      // Trabajos de terminal fallidos
      const jobs = await runTool('shell.job', { action: 'list' });
      const j = jobs?.data ?? jobs;
      const jobList = Array.isArray(j?.jobs) ? j.jobs : (Array.isArray(j) ? j : []);
      const failed = jobList.filter((x: any) => x?.status === 'failed' || x?.exitCode !== 0 && x?.exitCode != null);
      if (failed.length > 0) {
        out.push({
          id: 'term',
          kind: 'terminal',
          text: `${failed.length} trabajo(s) de terminal fallaron. ¿Revisamos el log?`,
          severity: 'warning',
        });
        saveObservation(projectId, 'terminal', `${failed.length} jobs fallidos`).catch(() => {});
      }
      // Memoria durable: recordatorios de observaciones recientes
      const obs = await listObservations(projectId, 5);
      const recent = obs.filter((o) => Date.now() - o.ts < 1000 * 60 * 60 * 24 * 7);
      if (recent.length > 0) {
        const last = recent[0];
        out.push({
          id: 'mem-' + last.id,
          kind: 'memory',
          text: `Recordatorio: ${last.content}`,
          severity: 'info',
        });
      }
    } catch { /* ignore */ }
    // Aprendizaje por corrección: no repetir sugerencias descartadas recientemente
    const dismissed = await listObservations(projectId, 50).catch(() => []);
    const isDismissed = (s: NonoContextSuggestion) => dismissed.some((o: any) => (o.kind === 'dismissed' || String(o.content).startsWith('dismissed::')) && String(o.content).includes(s.text));
    const filtered = out.filter((s) => !isDismissed(s));
    setSuggestions(filtered);
    setLoading(false);
  }, [enabled, projectId]);

  const dismiss = useCallback((id: string) => {
    setSuggestions((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) {
        saveObservation(projectId, 'dismissed', `${target.kind}::${target.text}`).catch(() => {});
      }
      return prev.filter((s) => s.id !== id);
    });
  }, [projectId]);

  return { suggestions, loading, refresh, dismiss };
}
