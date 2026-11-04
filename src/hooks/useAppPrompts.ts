import { useCallback } from 'react';
import { buildAuditPrompt } from '../data/auditPrompts';

export interface AppPromptsOptions {
  activeTab: any;
  setProjectToast: (toast: any) => void;
  lang: string;
  tabs: any;
  /**
   * Arranca la auditoría como un turno del chat con herramientas.
   * El chat simple del proveedor no tiene tools, así que la corrida va por el
   * bucle del agente (`useGeneralAudit`).
   */
  onAuditStart: (prompt: string) => void;
  currentSessionId: React.MutableRefObject<string>;
  setPromptTitle: (title: string) => void;
  setNonoStatus: (status: any) => void;
}

export function useAppPrompts(opts: AppPromptsOptions) {
  const {
    activeTab, setProjectToast, lang, tabs,
    onAuditStart, currentSessionId,
    setPromptTitle, setNonoStatus,
  } = opts;

  const handleGeneralAudit = useCallback(() => {
    if (!activeTab?.projectPath) {
      setProjectToast({ kind: 'err', text: lang === 'es' ? 'Selecciona un proyecto primero' : lang === 'de' ? 'Wähle zuerst ein Projekt aus' : 'Select a project first' });
      return;
    }
    onAuditStart(buildAuditPrompt(activeTab.projectPath, lang as 'es' | 'en'));
  }, [activeTab, setProjectToast, lang, onAuditStart]);

  const handleNewChat = useCallback(() => {
    const sessionId = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    currentSessionId.current = sessionId;
    setPromptTitle('Nuevo Proyecto Prompt');
    tabs.newTab({ mode: 'chat', projectPath: activeTab?.projectPath || '', sessionId, promptTitle: 'Nuevo Proyecto Prompt' });
    setNonoStatus({ type: 'new_prompt' });
  }, [currentSessionId, setPromptTitle, tabs, activeTab, setNonoStatus]);

  return { handleGeneralAudit, handleNewChat };
}
