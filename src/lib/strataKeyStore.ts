/**
 * Persistencia de la API key de Strata.
 *
 * La config (`commander.json`) es texto plano y está versionada en el repo: una
 * clave guardada ahí acaba en el historial. La vía por defecto es el vault
 * AES-256-GCM que ya usan las integraciones; el servidor sólo toca la config
 * para migrar una clave antigua y borrarla.
 */
import {
  deleteVaultSecret,
  getVaultSecret,
  saveVaultSecret,
} from '../integrations/tokenVault';

export const STRATA_API_KEY_NAMESPACE = 'strata-local.api-key';

export function normalizeStrataApiKey(value: unknown): string | undefined {
  const clean = typeof value === 'string' ? value.trim() : '';
  return clean || undefined;
}

export function saveStrataApiKey(value: string): void {
  const clean = normalizeStrataApiKey(value);
  if (!clean) throw new Error('La API key de Strata no puede estar vacía.');
  saveVaultSecret(STRATA_API_KEY_NAMESPACE, clean);
}

/** Devuelve `undefined` si no hay clave o si el vault no se puede abrir. */
export function getStrataApiKey(): string | undefined {
  try {
    return normalizeStrataApiKey(getVaultSecret(STRATA_API_KEY_NAMESPACE));
  } catch {
    return undefined;
  }
}

export function deleteStrataApiKey(): boolean {
  try {
    return deleteVaultSecret(STRATA_API_KEY_NAMESPACE);
  } catch {
    return false;
  }
}
