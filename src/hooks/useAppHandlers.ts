import { useCallback } from 'react';
import type { StudioMode } from '../types/studio';
import type { PromptTemplate, ChatMessage } from '../types/studio';
import type { GalleryProject } from '../lib/firebase';
import { HUGGINGFACE_MODELS } from '../data/models';

export interface AppHandlersOptions {
  setParameters: (fn: (p: any) => any) => void;
  setPromptTitle: (title: string) => void;
  setSelectedModel: (model: string) => void;
  setSelectedProvider: (provider: any) => void;
  setMode: (mode: StudioMode) => void;
  setMessages: (messages: ChatMessage[]) => void;
}

export function useAppHandlers(opts: AppHandlersOptions) {
  const { setParameters, setPromptTitle, setSelectedModel, setSelectedProvider, setMode, setMessages } = opts;

  const handleSelectTemplate = useCallback((template: PromptTemplate) => {
    setParameters((p) => ({
      ...p,
      systemInstruction: template.systemInstruction,
    }));
    setPromptTitle(template.title);
    if (template.recommendedModel) {
      setSelectedModel(template.recommendedModel);
      setSelectedProvider(HUGGINGFACE_MODELS.some((m) => m.id === template.recommendedModel) ? 'huggingface' : 'google');
    }
    setMode('chat');
  }, [setParameters, setPromptTitle, setSelectedModel, setSelectedProvider, setMode]);

  const handleSelectGalleryProject = useCallback((project: GalleryProject) => {
    setPromptTitle(project.title);
    setSelectedModel(project.selectedModel);
    setSelectedProvider(project.provider as any || 'google');
    setParameters((prev) => ({
      ...prev,
      systemInstruction: project.systemInstruction,
      temperature: project.temperature,
      topP: project.topP,
      topK: project.topK,
    }));
    if (project.defaultPrompt) {
      setMessages([
        {
          id: Date.now().toString(),
          role: 'user',
          content: project.defaultPrompt,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }
      ]);
    }
    setMode('chat');
  }, [setPromptTitle, setSelectedModel, setSelectedProvider, setParameters, setMessages, setMode]);

  return { handleSelectTemplate, handleSelectGalleryProject };
}
