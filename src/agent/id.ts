export function uid(prefix = 'id'): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c?.randomUUID) return `${prefix}_${c.randomUUID().slice(0, 8)}`;
  } catch { /* ignore */ }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
