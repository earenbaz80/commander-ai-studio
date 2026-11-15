/**
 * Avatares PNG opcionales de `public/avatars/`.
 *
 * El manifiesto se regenera con `npm run avatars:sync` (y antes de `dev` y
 * `build`). Si está vacío, el selector usa los 12 SVG de `avatarCatalog.ts`.
 */
import manifest from '../../../public/avatars/manifest.json';
import { AVATAR_FILE_RE, AVATAR_ID_RE, slugifyAvatarId } from './avatarNaming';

export interface PngAvatarDefinition {
  readonly id: string;
  readonly file: string;
  readonly label: string;
}

function fallbackLabel(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

/**
 * Normaliza y valida el manifiesto.
 *
 * No se aceptan rutas: `file` es un nombre plano dentro de `public/avatars/`.
 * Así un manifiesto manipulado no puede sacar una imagen de esa carpeta.
 */
export function normalizePngAvatars(input: unknown): PngAvatarDefinition[] {
  const raw =
    input && typeof input === 'object' && Array.isArray((input as { avatars?: unknown }).avatars)
      ? (input as { avatars: unknown[] }).avatars
      : [];

  const seen = new Set<string>();
  const avatars: PngAvatarDefinition[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const file = typeof record.file === 'string' ? record.file.trim() : '';
    if (!AVATAR_FILE_RE.test(file) || file.includes('/') || file.includes('\\')) continue;

    const declaredId = typeof record.id === 'string' ? record.id : '';
    const id = AVATAR_ID_RE.test(declaredId)
      ? declaredId
      : slugifyAvatarId(file.replace(/\.png$/i, ''));
    if (!AVATAR_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);

    const declaredLabel = typeof record.label === 'string' ? record.label.trim() : '';
    avatars.push({
      id,
      file,
      label: declaredLabel ? declaredLabel.slice(0, 60) : fallbackLabel(id),
    });
  }

  return avatars;
}

export const PNG_AVATARS = normalizePngAvatars(manifest);

export function getPngAvatar(id?: string | null): PngAvatarDefinition | undefined {
  if (!id) return undefined;
  return PNG_AVATARS.find((avatar) => avatar.id === id);
}

/** URL del PNG respetando la base relativa de Vite y el protocolo `file:` de Electron. */
export function getPngAvatarSrc(avatar: PngAvatarDefinition): string {
  const path = `avatars/${encodeURIComponent(avatar.file)}`;
  // En `node` no hay `document`: la guarda mantiene el módulo importable desde
  // la suite de lógica y conserva la base de reserva de la versión anterior.
  const locationHref = typeof location !== 'undefined' ? location.href : '';
  const fallback = locationHref || 'http://localhost/';
  if (typeof document === 'undefined') return new URL(path, fallback).href;
  const base = document.baseURI || fallback;
  try {
    return new URL(path, base).href;
  } catch {
    return `avatars/${avatar.file}`;
  }
}
