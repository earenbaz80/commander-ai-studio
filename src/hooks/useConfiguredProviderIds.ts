import { useEffect, useState } from 'react';
import type { ModelFilter } from '../lib/providerFilters';

const asList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
    : [];

/** Proveedor local configurado cuyo host no responde. */
export interface OfflineLocalProvider {
  id: string;
  name: string;
  host: string;
}

/**
 * Proveedores utilizables y sus filtros de modelos.
 *
 * `ids` deja fuera los apagados en el gestor, y `filters` trae las listas
 * blanca/negra de cada uno para que los selectores recorten su catálogo igual
 * que el servidor. `failed` distingue «no hay ninguno configurado» de «no pude
 * preguntar»: en el segundo caso el selector vuelve a mostrar la lista base en
 * vez de quedarse vacío por un fallo de red.
 *
 * `offline` son los locales configurados que no contestan: sin esto, un LM
 * Studio apagado se veía igual que uno sin configurar (cero modelos y nada
 * más).
 */
export function useConfiguredProviderIds(): {
  ids: Set<string>;
  filters: Record<string, ModelFilter>;
  loaded: boolean;
  failed: boolean;
  offline: OfflineLocalProvider[];
} {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Record<string, ModelFilter>>({});
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState<OfflineLocalProvider[]>([]);

  useEffect(() => {
    let dead = false;
    if (typeof fetch !== 'function') {
      setFailed(true);
      setLoaded(true);
      return;
    }
    fetch('/api/providers', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (dead) return;
        const next = new Set<string>();
        const nextFilters: Record<string, ModelFilter> = {};
        const nextOffline: OfflineLocalProvider[] = [];
        for (const provider of Array.isArray(data?.providers) ? data.providers : []) {
          if (!provider?.configured) continue;
          const id = String(provider.id);
          nextFilters[id] = {
            whitelist: asList(provider.whitelist),
            blacklist: asList(provider.blacklist),
          };
          if (provider.enabled !== false) next.add(id);
          if (provider.enabled !== false && typeof provider.host === 'string' && provider.reachable === false) {
            nextOffline.push({ id, name: String(provider.name || id), host: provider.host });
          }
        }
        setIds(next);
        setFilters(nextFilters);
        setOffline(nextOffline);
        setLoaded(true);
      })
      .catch(() => {
        if (dead) return;
        setFailed(true);
        setLoaded(true);
      });
    return () => {
      dead = true;
    };
  }, []);

  return { ids, filters, loaded, failed, offline };
}
