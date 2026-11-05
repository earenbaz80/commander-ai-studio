/**
 * Filtro del selector de modelos del compositor.
 *
 * La búsqueda cubre las dos cosas que el usuario tiene en la cabeza cuando
 * escribe: el proveedor («ollama», «google», «openrouter») y el modelo
 * («flash», «llama», «coder»). Sale en un módulo aparte para poder probarla sin
 * montar React ni depender del catálogo real.
 */
import type { AIModel } from '../../types/studio';
import type { ModelGroup, ModelGroupStatus } from './modelGroups';

export interface ModelSearchGroup {
  id: string;
  label: string;
  models: AIModel[];
  status?: ModelGroupStatus;
}

/** Minúsculas y sin acentos: «Gemini» y «gemini» buscan igual. */
const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Devuelve los grupos que quedan tras aplicar el filtro de proveedor y el texto.
 *
 * Cada palabra del texto debe aparecer en el nombre, id, badge, descripción o
 * en la etiqueta del proveedor. Así «google flash» encuentra los Flash de
 * Google y «ollama» lista el grupo entero aunque ningún modelo se llame así.
 */
export function filterModelGroups(
  groups: ModelGroup[],
  query: string,
  providerId: string | null = null
): ModelSearchGroup[] {
  const base = providerId ? groups.filter((group) => group.id === providerId) : groups;
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return base.map((group) => ({ id: group.id, label: group.label, models: [...group.models], status: group.status }));
  }

  const result: ModelSearchGroup[] = [];
  for (const group of base) {
    const providerText = `${normalize(group.label)} ${normalize(group.id)}`;
    const models = group.models.filter((model) => {
      const modelText = normalize(`${model.name} ${model.id} ${model.badge || ''} ${model.description || ''}`);
      return tokens.every((token) => modelText.includes(token) || providerText.includes(token));
    });
    if (models.length > 0) result.push({ id: group.id, label: group.label, models, status: group.status });
  }
  return result;
}

/** Total de modelos visibles, para el estado vacío y el pie del panel. */
export const countModels = (groups: ModelSearchGroup[]): number =>
  groups.reduce((total, group) => total + group.models.length, 0);
