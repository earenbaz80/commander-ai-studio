import { useCallback, useMemo } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export interface AppTelemetryOptions {
  history: any[];
  activeTabId: string;
  firstTabIdRef: React.MutableRefObject<string>;
}

export function useAppTelemetry(opts: AppTelemetryOptions) {
  const { history, activeTabId, firstTabIdRef } = opts;

  const tabHistory = useMemo(() => {
    const owner = firstTabIdRef.current;
    return history.filter((h) => (h.tabId || owner) === activeTabId);
  }, [history, activeTabId]);

  const logTelemetry = useCallback(async (data: any) => {
    if (!auth.currentUser) {
      console.warn('Telemetry: No user authenticated');
      return;
    }
    try {
      await addDoc(collection(db, 'telemetry_logs'), {
        ...data,
        userId: auth.currentUser.uid,
        timestamp: serverTimestamp()
      });
      console.log('Telemetry: Successfully logged');
    } catch (e) {
      console.error('Telemetry: Failed to log', e);
    }
  }, []);

  return { tabHistory, logTelemetry };
}
