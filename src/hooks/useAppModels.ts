import { useCallback } from 'react';
import type { DownloadedLocalModel } from '../types/studio';
import type { ChatCodeSnippet } from '../components/ChatLiveAppViewerModal';
import { extractSnippetsFromMessages } from '../utils/codeSnippetExtractor';

export interface AppModelsOptions {
  messages: any[];
  setLiveViewerSnippets: (snippets: ChatCodeSnippet[]) => void;
  setActiveSnippetIndex: (index: number) => void;
  setIsLiveViewerOpen: (open: boolean) => void;
  setDownloadedModels: (fn: (prev: DownloadedLocalModel[]) => DownloadedLocalModel[]) => void;
}

export function useAppModels(opts: AppModelsOptions) {
  const { messages, setLiveViewerSnippets, setActiveSnippetIndex, setIsLiveViewerOpen, setDownloadedModels } = opts;

  const handleOpenLiveViewer = useCallback((snippets?: ChatCodeSnippet[], index: number = 0) => {
    if (snippets && snippets.length > 0) {
      setLiveViewerSnippets(snippets);
      setActiveSnippetIndex(index);
    } else {
      const extracted = extractSnippetsFromMessages(messages);
      setLiveViewerSnippets(extracted);
      setActiveSnippetIndex(extracted.length > 0 ? extracted.length - 1 : 0);
    }
    setIsLiveViewerOpen(true);
  }, [messages, setLiveViewerSnippets, setActiveSnippetIndex, setIsLiveViewerOpen]);

  const handleAddDownloadedModel = useCallback((model: DownloadedLocalModel) => {
    setDownloadedModels((prev) => {
      if (prev.some((m) => m.hfRepoId === model.hfRepoId)) return prev;
      return [model, ...prev];
    });
  }, [setDownloadedModels]);

  const handleRemoveDownloadedModel = useCallback((modelId: string) => {
    setDownloadedModels((prev) => prev.filter((m) => m.id !== modelId));
  }, [setDownloadedModels]);

  return { handleOpenLiveViewer, handleAddDownloadedModel, handleRemoveDownloadedModel };
}
