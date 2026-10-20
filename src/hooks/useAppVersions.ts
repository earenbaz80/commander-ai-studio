import { useCallback } from 'react';
import type { PromptVersion } from '../types/studio';
import { savePromptVersion } from '../lib/firebase';

export interface AppVersionsOptions {
  promptTitle: string;
  parameters: any;
  setParameters: (params: any) => void;
  setPromptTitle: (title: string) => void;
  setNonoStatus: (status: any) => void;
}

export function useAppVersions(opts: AppVersionsOptions) {
  const { promptTitle, parameters, setParameters, setPromptTitle, setNonoStatus } = opts;

  const handleSaveVersion = useCallback(async (title: string, note?: string) => {
    try {
      const projectId = promptTitle.toLowerCase().replace(/[^a-z0-9]/g, '-');
      await savePromptVersion(projectId, parameters, title, note);
      setNonoStatus({ type: 'success' });
      alert('Versión guardada exitosamente.');
    } catch (error) {
      console.error(error);
      alert('Error al guardar la versión.');
    }
  }, [promptTitle, parameters, setNonoStatus]);

  const handleLoadVersion = useCallback((version: PromptVersion) => {
    setParameters(version.parameters);
    setPromptTitle(version.title);
    alert('Versión cargada exitosamente.');
  }, [setParameters, setPromptTitle]);

  return { handleSaveVersion, handleLoadVersion };
}
