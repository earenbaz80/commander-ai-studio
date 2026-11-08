import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_MEMORY,
  MAX_HISTORY,
  persistNonoMemory,
  readNonoMemory,
  subscribeNonoMemory,
  type NonoMemory,
} from '../nonoMemoryStore';
import type { NonoOrbColors } from '../orbPalette';

export type { NonoMemory };

/**
 * Hook para memoria persistente de Nono.
 * - Guarda en localStorage
 * - Aprende del comportamiento del usuario
 * - Expone preferencias para personalización
 * - Se sincroniza con otras instancias montadas (Configuración ↔ cabeza flotante)
 */
export function useNonoMemory() {
  const [memory, setMemory] = useState<NonoMemory>(readNonoMemory);
  const memoryRef = useRef<NonoMemory>(memory);

  useEffect(() => {
    return subscribeNonoMemory(() => {
      const next = readNonoMemory();
      // Evita re-render (y bucles) cuando el aviso viene de esta misma instancia.
      if (JSON.stringify(next) === JSON.stringify(memoryRef.current)) return;
      memoryRef.current = next;
      setMemory(next);
    });
  }, []);

  /** Aplica un cambio, lo persiste y avisa a las demás instancias montadas. */
  const commit = useCallback((updater: (prev: NonoMemory) => NonoMemory) => {
    const next = updater(memoryRef.current);
    memoryRef.current = next;
    setMemory(next);
    persistNonoMemory(next);
  }, []);

  const updateStack = useCallback((stack: string[]) => {
    commit(prev => ({
      ...prev,
      preferredStack: Array.from(new Set([...prev.preferredStack, ...stack])).slice(0, 10),
    }));
  }, [commit]);

  const updatePattern = useCallback((key: keyof NonoMemory['patterns'], value: boolean | string) => {
    commit(prev => ({
      ...prev,
      patterns: { ...prev.patterns, [key]: value },
    }));
  }, [commit]);

  const updateUI = useCallback(<K extends keyof NonoMemory['ui']>(
    key: K,
    value: NonoMemory['ui'][K],
  ) => {
    commit(prev => ({
      ...prev,
      ui: { ...prev.ui, [key]: value },
    }));
  }, [commit]);

  /** Aplica varias claves de `ui` en una sola escritura. */
  const updateUIPatch = useCallback((patch: Partial<NonoMemory['ui']>) => {
    commit(prev => ({
      ...prev,
      ui: { ...prev.ui, ...patch },
    }));
  }, [commit]);

  /** Cambia sólo las claves de color indicadas, conservando el resto. */
  const updateOrbColors = useCallback((patch: Partial<NonoOrbColors>) => {
    commit(prev => ({
      ...prev,
      ui: { ...prev.ui, orbColors: { ...prev.ui.orbColors, ...patch } },
    }));
  }, [commit]);

  const recordInteraction = useCallback((
    type: NonoMemory['interactionHistory'][0]['type'],
    context: string
  ) => {
    commit(prev => ({
      ...prev,
      interactionHistory: [
        { timestamp: Date.now(), type, context },
        ...prev.interactionHistory.slice(0, MAX_HISTORY - 1),
      ],
    }));
  }, [commit]);

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
    commit(() => ({
      ...DEFAULT_MEMORY,
      patterns: { ...DEFAULT_MEMORY.patterns },
      ui: { ...DEFAULT_MEMORY.ui, orbColors: { ...DEFAULT_MEMORY.ui.orbColors } },
      interactionHistory: [],
    }));
  }, [commit]);

  return {
    memory,
    updateStack,
    updatePattern,
    updateUI,
    updateUIPatch,
    updateOrbColors,
    recordInteraction,
    getSuggestions,
    reset,
  };
}
