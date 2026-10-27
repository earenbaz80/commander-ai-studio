import { useState, useEffect, useCallback } from 'react';

interface NonoMemory {
  /** Stack tecnológico detectado/preferido del usuario */
  preferredStack: string[];
  /** Patrones de uso del usuario */
  patterns: {
    usesTests: boolean;
    usesDocker: boolean;
    usesTypeScript: boolean;
    usesGit: boolean;
    preferredProvider?: string;
    preferredModel?: string;
  };
  /** Preferencias de UI */
  ui: {
    showNono: boolean;
    reducedMotion: boolean;
    compactMode: boolean;
  };
  /** Historial de interacciones para aprendizaje */
  interactionHistory: {
    timestamp: number;
    type: 'command' | 'suggestion' | 'error_fix' | 'git_commit' | 'code_review';
    context: string;
  }[];
}

const DEFAULT_MEMORY: NonoMemory = {
  preferredStack: [],
  patterns: {
    usesTests: false,
    usesDocker: false,
    usesTypeScript: false,
    usesGit: false,
  },
  ui: {
    showNono: true,
    reducedMotion: false,
    compactMode: false,
  },
  interactionHistory: [],
};

const STORAGE_KEY = 'nono-memory-v1';
const MAX_HISTORY = 100;

/**
 * Hook para memoria persistente de Nono.
 * - Guarda en localStorage
 * - Aprende del comportamiento del usuario
 * - Expone preferencias para personalización
 */
export function useNonoMemory() {
  const [memory, setMemory] = useState<NonoMemory>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_MEMORY, ...JSON.parse(stored) };
      }
    } catch {
      // Ignore parse errors
    }
    return DEFAULT_MEMORY;
  });

  // Persistir cambios
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
    } catch {
      // Ignore quota errors
    }
  }, [memory]);

  const updateStack = useCallback((stack: string[]) => {
    setMemory(prev => ({
      ...prev,
      preferredStack: Array.from(new Set([...prev.preferredStack, ...stack])).slice(0, 10),
    }));
  }, []);

  const updatePattern = useCallback((key: keyof NonoMemory['patterns'], value: boolean | string) => {
    setMemory(prev => ({
      ...prev,
      patterns: { ...prev.patterns, [key]: value },
    }));
  }, []);

  const updateUI = useCallback((key: keyof NonoMemory['ui'], value: boolean) => {
    setMemory(prev => ({
      ...prev,
      ui: { ...prev.ui, [key]: value },
    }));
  }, []);

  const recordInteraction = useCallback((
    type: NonoMemory['interactionHistory'][0]['type'],
    context: string
  ) => {
    setMemory(prev => ({
      ...prev,
      interactionHistory: [
        { timestamp: Date.now(), type, context },
        ...prev.interactionHistory.slice(0, MAX_HISTORY - 1),
      ],
    }));
  }, []);

  const getSuggestions = useCallback(() => {
    const { preferredStack, patterns } = memory;
    const suggestions: string[] = [];

    if (patterns.usesTypeScript && preferredStack.includes('typescript')) {
      suggestions.push('TypeScript detectado — ¿ejecutamos `tsc --noEmit`?');
    }
    if (patterns.usesTests) {
      suggestions.push('Tests detectados — ¿corremos suite con coverage?');
    }
    if (patterns.usesDocker) {
      suggestions.push('Docker en proyecto — ¿optimizamos Dockerfile?');
    }
    if (patterns.usesGit) {
      suggestions.push('Git activo — ¿creamos checkpoint antes de cambios?');
    }

    return suggestions;
  }, [memory]);

  const reset = useCallback(() => {
    setMemory(DEFAULT_MEMORY);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    memory,
    updateStack,
    updatePattern,
    updateUI,
    recordInteraction,
    getSuggestions,
    reset,
  };
}