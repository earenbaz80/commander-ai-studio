export interface ToolMetric {
  toolId: string;
  ok: boolean;
  durationMs: number;
  ts: number;
  taskId?: string;
}

const KEY = 'commander_tool_metrics_v1';
const MAX = 300;

export function recordMetric(m: ToolMetric) {
  try {
    const all: ToolMetric[] = JSON.parse(localStorage.getItem(KEY) || '[]');
    all.unshift(m);
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX)));
  } catch { /* ignore */ }
}

export function loadMetrics(): ToolMetric[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function metricsSummary(list: ToolMetric[]) {
  const byTool: Record<string, { calls: number; fails: number; avgMs: number }> = {};
  for (const m of list) {
    const e = byTool[m.toolId] || (byTool[m.toolId] = { calls: 0, fails: 0, avgMs: 0 });
    e.calls++;
    if (!m.ok) e.fails++;
    e.avgMs += m.durationMs;
  }
  for (const k of Object.keys(byTool)) {
    byTool[k].avgMs = Math.round(byTool[k].avgMs / Math.max(1, byTool[k].calls));
  }
  return byTool;
}
