import { useEffect } from 'react';
import { migrateLegacyKeys, loadAllApiKeysIntoCache } from '../lib/apiKeys';

export interface AppEffectsOptions {
  showNono: boolean;
  isolateSessions: boolean;
  nonoRef: React.RefObject<any>;
}

export function useAppEffects(opts: AppEffectsOptions) {
  const { showNono, isolateSessions, nonoRef } = opts;

  useEffect(() => {
    try { localStorage.setItem('commander_show_nono', JSON.stringify(showNono)); } catch { /* ignore */ }
  }, [showNono]);

  useEffect(() => {
    try { localStorage.setItem('commander_isolate_sessions', JSON.stringify(isolateSessions)); } catch { /* ignore */ }
  }, [isolateSessions]);

  useEffect(() => {
    (async () => {
      try { await migrateLegacyKeys(); } catch (e) { console.warn('migrateLegacyKeys failed', e); }
      try { await loadAllApiKeysIntoCache(); } catch (e) { console.warn('loadAllApiKeysIntoCache failed', e); }
    })();
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent<{ prompt: string; send?: boolean }>) => {
      nonoRef.current?.openWithPrompt(e.detail.prompt, e.detail.send);
    };
    window.addEventListener('nono:open-with-prompt', handler as EventListener);
    return () => window.removeEventListener('nono:open-with-prompt', handler as EventListener);
  }, [nonoRef]);
}
