import { useEffect, useState } from 'react';

/**
 * Ids de proveedor que tienen credenciales (gestor o entorno).
 *
 * Lo usan los selectores de modelo para no ofrecer lo que no se puede usar.
 * `failed` distingue «no hay ninguno configurado» de «no pude preguntar»: en el
 * segundo caso el selector vuelve a mostrar la lista base en vez de quedarse
 * vacío por un fallo de red.
 */
export function useConfiguredProviderIds(): { ids: Set<string>; loaded: boolean; failed: boolean } {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

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
        for (const provider of Array.isArray(data?.providers) ? data.providers : []) {
          if (provider?.configured) next.add(String(provider.id));
        }
        setIds(next);
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

  return { ids, loaded, failed };
}
