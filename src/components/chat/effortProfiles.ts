import type { ParameterConfig } from '../../types/studio';

/**
 * Perfiles de esfuerzo del chat (Rápido / Equilibrado / Potente).
 *
 * Solo tocan dos ajustes reales que todos los proveedores respetan de una u otra
 * forma: cuánto puede extenderse la respuesta (`maxTokens`) y cuánto razona el
 * modelo (`thinkingLevel`). La temperatura y el resto de ajustes del usuario se
 * dejan como están.
 */
export type EffortLevel = 'fast' | 'balanced' | 'powerful';

export interface EffortProfile {
  id: EffortLevel;
  maxTokens: number;
  thinkingLevel: NonNullable<ParameterConfig['thinkingLevel']>;
}

export const EFFORT_PROFILES: Record<EffortLevel, EffortProfile> = {
  fast: { id: 'fast', maxTokens: 1024, thinkingLevel: 'MINIMAL' },
  balanced: { id: 'balanced', maxTokens: 4096, thinkingLevel: 'LOW' },
  powerful: { id: 'powerful', maxTokens: 16384, thinkingLevel: 'HIGH' },
};

/** Orden de los botones: de menos a más esfuerzo. */
export const EFFORT_ORDER: EffortLevel[] = ['fast', 'balanced', 'powerful'];

export function applyEffort(previous: ParameterConfig, level: EffortLevel): ParameterConfig {
  const profile = EFFORT_PROFILES[level];
  return { ...previous, maxTokens: profile.maxTokens, thinkingLevel: profile.thinkingLevel };
}

/**
 * Perfil vigente. Primero manda el nivel de razonamiento (es lo que distingue a
 * los perfiles); si no coincide con ninguno, se deduce del máximo de tokens.
 * Devuelve `null` si los ajustes actuales no son de ningún perfil.
 */
export function detectEffort(parameters?: ParameterConfig | null): EffortLevel | null {
  if (!parameters) return null;
  const byThinking = EFFORT_ORDER.find(
    (id) => EFFORT_PROFILES[id].thinkingLevel === parameters.thinkingLevel
  );
  if (byThinking) return byThinking;

  const maxTokens = parameters.maxTokens ?? 0;
  if (maxTokens <= 0) return null;
  if (maxTokens <= 1_536) return 'fast';
  if (maxTokens <= 6_144) return 'balanced';
  return 'powerful';
}
