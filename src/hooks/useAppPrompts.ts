import { useCallback } from 'react';
import type { StudioMode } from '../types/studio';
import { buildAuditPrompt } from '../data/auditPrompts';

export interface AppPromptsOptions {
  activeTab: any;
  setProjectToast: (toast: any) => void;
  lang: string;
  tabs: any;
  setMode: (mode: StudioMode) => void;
  /**
   * Arranca una corrida del agente con ese objetivo.
   * La auditoría pide herramientas (fs.*, read_diagnostics, shell.run), así que
   * tiene que ir por el bucle del agente y no por el chat simple.
   */
  onAuditStart: (prompt: string) => void;
  currentSessionId: React.MutableRefObject<string>;
  setPromptTitle: (title: string) => void;
  setNonoStatus: (status: any) => void;
}

export function useAppPrompts(opts: AppPromptsOptions) {
  const {
    activeTab, setProjectToast, lang, tabs, setMode,
    onAuditStart, currentSessionId,
    setPromptTitle, setNonoStatus,
  } = opts;

  const handleGeneralAudit = useCallback(() => {
    if (!activeTab?.projectPath) {
      setProjectToast({ kind: 'err', text: lang === 'es' ? 'Selecciona un proyecto primero' : lang === 'de' ? 'Wähle zuerst ein Projekt aus' : 'Select a project first' });
      return;
    }
    const prompt = buildAuditPrompt(activeTab.projectPath, lang as 'es' | 'en');
    tabs.updateTab({ mode: 'agent' });
    setMode('agent');
    onAuditStart(prompt);
  }, [activeTab, setProjectToast, lang, tabs, setMode, onAuditStart]);

  const handleNewChat = useCallback(() => {
    const sessionId = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    currentSessionId.current = sessionId;
    setPromptTitle('Nuevo Proyecto Prompt');
    tabs.newTab({ mode: 'chat', projectPath: activeTab?.projectPath || '', sessionId, promptTitle: 'Nuevo Proyecto Prompt' });
    setNonoStatus({ type: 'new_prompt' });
  }, [currentSessionId, setPromptTitle, tabs, activeTab, setNonoStatus]);

  return { handleGeneralAudit, handleNewChat };
}
