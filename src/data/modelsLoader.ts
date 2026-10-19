import { useEffect, useState } from 'react';
import { ALL_MODELS } from './models';
import type { AIModel } from '../types/studio';
import {
  applyCatalog,
  readProviderStatus,
  type CatalogEntry,
  type LiveCatalog,
  type ProviderStatus,
} from './catalog';

export interface ModelsCatalog {
  /** Catálogo resultante (base + estático + vivo). */
  models: AIModel[];
  /** Estado de los proveedores opcionales (Ollama/custom) reportado por el server. */
  providers: ProviderStatus;
}

/**
 * Catálogo de modelos dinámico:
 *  1. base local (`src/data/models.ts`),
 *  2. catálogo estático servido en `./models.json`,
 *  3. catálogo vivo (`GET /api/models/live`: OpenRouter público + Ollama/custom).
 *
 * Un proveedor opcional caído (p. ej. Ollama sin arrancar) no rompe el
 * catálogo: llega como `providers.ollama.available === false`.
 */
export function useModelsCatalog(): ModelsCatalog {
  const [models, setModels] = useState<AIModel[]>(() => ALL_MODELS);
  const [providers, setProviders] = useState<ProviderStatus>({});

  useEffect(() => {
    let dead = false;

    async function load() {
      let staticEntries: CatalogEntry[] | undefined;
      let live: LiveCatalog | null = null;

      try {
        const res = await fetch('./models.json');
        if (res.ok) {
          const data = (await res.json()) as { models?: CatalogEntry[] };
          staticEntries = Array.isArray(data?.models) ? data.models : undefined;
        }
      } catch { /* catálogo estático opcional */ }

      try {
        const res = await fetch('/api/models/live');
        if (res.ok) live = (await res.json()) as LiveCatalog;
      } catch { /* catálogo vivo opcional */ }

      if (dead) return;
      setModels(applyCatalog(ALL_MODELS, [staticEntries, live?.models]));
      setProviders(readProviderStatus(live));
    }

    void load();
    return () => { dead = true; };
  }, []);

  return { models, providers };
}
