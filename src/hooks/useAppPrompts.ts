import { useCallback } from 'react';
import type { StudioMode } from '../types/studio';
import { buildAuditPrompt } from '../data/auditPrompts';

export interface AppPromptsOptions {
  activeTab: any;
  setProjectToast: (toast: any) => void;
  lang: string;
  tabs: any;
  setMode: (mode: StudioMode) => void;
  handleSendMessage: (prompt: string, attachments: any[]) => Promise<void>;
  setIsAuditing: (auditing: boolean) => void;
  currentSessionId: React.MutableRefObject<string>;
  setPromptTitle: (title: string) => void;
  setNonoStatus: (status: any) => void;
}

export function useAppPrompts(opts: AppPromptsOptions) {
  const {
    activeTab, setProjectToast, lang, tabs, setMode,
    handleSendMessage, setIsAuditing, currentSessionId,
    setPromptTitle, setNonoStatus,
  } = opts;

  const handleGeneralAudit = useCallback(() => {
    if (!activeTab?.projectPath) {
      setProjectToast({ kind: 'err', text: lang === 'es' ? 'Selecciona un proyecto primero' : lang === 'de' ? 'Wähle zuerst ein Projekt aus' : 'Select a project first' });
      return;
    }
    setIsAuditing(true);
    const prompt = buildAuditPrompt(activeTab.projectPath, lang as 'es' | 'en');
    tabs.updateTab({ mode: 'agent' });
    setMode('agent');
    setTimeout(() => {
      handleSendMessage(prompt, []).finally(() => setIsAuditing(false));
    }, 60);
  }, [activeTab, setProjectToast, lang, tabs, setMode, handleSendMessage, setIsAuditing]);

  const handleNewPrompt = useCallback(() => {
    const sessionId = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    currentSessionId.current = sessionId;
    setPromptTitle('Nuevo Proyecto Prompt');
    tabs.newTab({ mode: 'chat', projectPath: activeTab?.projectPath || '', sessionId, promptTitle: 'Nuevo Proyecto Prompt' });
    setNonoStatus({ type: 'new_prompt' });
  }, [currentSessionId, setPromptTitle, tabs, activeTab, setNonoStatus]);

  return { handleGeneralAudit, handleNewPrompt };
}
