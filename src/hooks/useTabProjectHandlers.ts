import { useCallback } from 'react';
import { projectName } from '../data/auditPrompts';
import { forkSessionWorkspace } from '../lib/sessionWorkspace';
import { addAgentRoot, listAgentRoots, removeAgentRoot, createProject } from '../lib/agentProjects';

export interface TabProjectHandlersOptions {
  tabs: any;
  setProjectToast: (toast: { kind: 'ok' | 'err'; text: string } | null) => void;
  isolateSessions: boolean;
  agentRoots: any[];
  setAgentRoots: (roots: any[]) => void;
  activeTab: any;
}

export function useTabProjectHandlers(opts: TabProjectHandlersOptions) {
  const { tabs, setProjectToast, isolateSessions, setAgentRoots, activeTab } = opts;

  const handleTabProject = useCallback(async (p: string) => {
    if (!p) {
      tabs.setProject('');
      setProjectToast({ kind: 'ok', text: 'Proyecto quitado' });
      return;
    }
    if (isolateSessions) {
      try {
        const forked = await forkSessionWorkspace(p);
        tabs.setProject(forked.path, undefined, forked.id);
        setProjectToast({ kind: 'ok', text: `Sesión aislada: ${projectName(p)}` });
        return;
      } catch (e: any) {
        setProjectToast({ kind: 'err', text: e?.message || 'No se pudo aislar la sesión' });
        return;
      }
    }
    tabs.setProject(p);
    setProjectToast({ kind: 'ok', text: `Proyecto: ${projectName(p)}` });
  }, [tabs, setProjectToast, isolateSessions]);

  const handleAddDirectory = useCallback(async () => {
    const raw = window.prompt('Ruta absoluta del directorio a añadir como proyecto:');
    if (!raw || !raw.trim()) return;
    try {
      setAgentRoots(await addAgentRoot(raw.trim()));
      setProjectToast({ kind: 'ok', text: `Proyecto añadido: ${projectName(raw.trim())}` });
    } catch (e: any) {
      setProjectToast({ kind: 'err', text: e.message || 'No se pudo añadir' });
    }
  }, [setAgentRoots, setProjectToast]);

  const handleCreateProject = useCallback(async () => {
    const raw = window.prompt('Nombre del nuevo proyecto:');
    if (!raw || !raw.trim()) return;
    try {
      const created = await createProject(raw.trim());
      setAgentRoots(await listAgentRoots());
      await handleTabProject(created.path);
      setProjectToast({ kind: 'ok', text: `Proyecto creado: ${created.name}` });
    } catch (e: any) {
      setProjectToast({ kind: 'err', text: e.message || 'No se pudo crear' });
    }
  }, [setAgentRoots, setProjectToast, handleTabProject]);

  const handleRemoveProject = useCallback(async (p: string) => {
    try {
      setAgentRoots(await removeAgentRoot(p));
      if (activeTab?.projectPath === p) tabs.setProject('');
      setProjectToast({ kind: 'ok', text: 'Proyecto quitado de la lista' });
    } catch (e: any) {
      setProjectToast({ kind: 'err', text: e.message || 'No se pudo quitar' });
    }
  }, [setAgentRoots, activeTab, tabs, setProjectToast]);

  return { handleTabProject, handleAddDirectory, handleCreateProject, handleRemoveProject };
}
