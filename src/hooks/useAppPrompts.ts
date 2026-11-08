import { useCallback } from 'react';
import { buildAuditPrompt, hasProjectPath } from '../data/auditPrompts';

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
    // Sin proyecto real no hay nada que auditar: con «.» o vacío el agente
    // leería el cwd del servidor y el informe hablaría de otro sitio.
    if (!hasProjectPath(activeTab?.projectPath)) {
      setProjectToast({
        kind: 'err',
        text:
          lang === 'es'
            ? 'Elige, añade o crea un proyecto antes de lanzar la auditoría'
            : lang === 'de'
              ? 'Wähle, füge hinzu oder erstelle zuerst ein Projekt'
              : 'Pick, add or create a project before running the audit',
      });
      return;
    }
    onAuditStart(buildAuditPrompt(activeTab.projectPath, lang as 'es' | 'en'));
  }, [activeTab, setProjectToast, lang, onAuditStart]);

  const openNewChat = useCallback((projectPath: string) => {
    const sessionId = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    currentSessionId.current = sessionId;
    setPromptTitle('Nuevo Proyecto Prompt');
    tabs.newTab({ mode: 'chat', projectPath, sessionId, promptTitle: 'Nuevo Proyecto Prompt' });
    setNonoStatus({ type: 'new_prompt' });
  }, [currentSessionId, setPromptTitle, tabs, setNonoStatus]);

  const handleNewChat = useCallback(() => {
    openNewChat(activeTab?.projectPath || '');
  }, [openNewChat, activeTab]);

  /** Chat limpio en el proyecto elegido desde el historial. */
  const handleNewChatInProject = useCallback((projectPath: string) => {
    openNewChat(projectPath || '');
  }, [openNewChat]);

  return { handleGeneralAudit, handleNewChat, handleNewChatInProject };
}
